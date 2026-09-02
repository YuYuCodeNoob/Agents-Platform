import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { ToolLoopRunner } from './tool-loop-runner.js';
import { createWriteTool, createEditTool, createReadTool } from './scene-tools.js';
import { readSceneIndex, type SceneIndexEntry } from './scene-index.js';
import { buildPersonaPrompt } from '../prompts/l3-persona-generation.js';
import type { CheckpointManager } from './checkpoint.js';
import type { MemoryPromptMode } from '../prompts/l1-extraction.js';
import { eventBus } from '../../events/eventBus.js';

export interface PersonaResult {
  success: boolean;
  mode: 'first' | 'incremental';
  reason: string;
  error?: string;
}

export interface L3Config {
  llmApiUrl: string;
  llmApiKey: string;
  llmModel: string;
  dataDir: string;
  personalityDir: string;
  promptMode?: MemoryPromptMode;
  triggerEveryN?: number;
  maxIterations?: number;
}

interface TriggerResult {
  should: boolean;
  reason: string;
  mode: 'first' | 'incremental';
}

export class L3PersonaGenerator {
  private promptMode: MemoryPromptMode;
  private triggerEveryN: number;
  private runner: ToolLoopRunner;

  constructor(
    private config: L3Config,
    private checkpoint: CheckpointManager
  ) {
    this.promptMode = config.promptMode ?? 'chat';
    this.triggerEveryN = config.triggerEveryN ?? 10;
    this.runner = new ToolLoopRunner({
      llmApiUrl: config.llmApiUrl,
      llmApiKey: config.llmApiKey,
      llmModel: config.llmModel,
      maxIterations: config.maxIterations ?? 10,
    });
  }

  async shouldGenerate(
    sceneDir: string,
    agentId: string
  ): Promise<TriggerResult> {
    const cp = await this.checkpoint.read();
    const index = await readSceneIndex(sceneDir);

    if (cp.request_persona_update) {
      return { should: true, reason: 'LLM requested persona update', mode: 'incremental' };
    }

    if (cp.scenes_processed > 0 && !cp.last_persona_time && index.length > 0) {
      return { should: true, reason: 'Cold start — scenes exist but no persona yet', mode: 'first' };
    }

    if (cp.last_persona_time) {
      const personaPath = join(this.config.personalityDir, `${agentId}.md`);
      if (!existsSync(personaPath)) {
        return { should: true, reason: 'Persona file missing but was generated before', mode: 'first' };
      }
      const content = await readFile(personaPath, 'utf-8').catch(() => '');
      if (content.trim() === '') {
        return { should: true, reason: 'Persona file empty/corrupted', mode: 'first' };
      }
    }

    if (cp.scenes_processed === 1 && cp.memories_since_last_persona > 0) {
      return { should: true, reason: 'First scene processed', mode: 'incremental' };
    }

    if (cp.memories_since_last_persona >= this.triggerEveryN) {
      return { should: true, reason: `Threshold reached (${cp.memories_since_last_persona} >= ${this.triggerEveryN})`, mode: 'incremental' };
    }

    return { should: false, reason: 'No trigger condition met', mode: 'incremental' };
  }

  async generate(
    sceneDir: string,
    agentId: string,
    triggerReason?: string
  ): Promise<PersonaResult> {
    const trigger = await this.shouldGenerate(sceneDir, agentId);
    if (!trigger.should) {
      return { success: true, mode: trigger.mode, reason: trigger.reason };
    }

    const index = await readSceneIndex(sceneDir);
    const cp = await this.checkpoint.read();

    const changedScenes = await this.getChangedScenes(sceneDir, index, cp.last_persona_time);
    if (changedScenes.length === 0) {
      return { success: true, mode: trigger.mode, reason: 'No changed scenes' };
    }

    const existingPersona = await this.readExistingPersona(agentId);

    const changedContent = changedScenes
      .map((s) => `### ${s.filename}\n${s.content}`)
      .join('\n\n---\n\n');

    const { systemPrompt, userPrompt } = buildPersonaPrompt({
      mode: trigger.mode,
      promptMode: this.promptMode,
      currentTime: new Date().toISOString(),
      totalProcessed: cp.memories_since_last_persona,
      sceneCount: index.length,
      changedSceneCount: changedScenes.length,
      changedScenesContent: changedContent,
      existingPersona: existingPersona ?? undefined,
      triggerInfo: triggerReason ?? trigger.reason,
    });

    const tools = [
      createReadTool(this.config.personalityDir),
      createWriteTool(this.config.personalityDir),
      createEditTool(this.config.personalityDir),
    ];

    try {
      const result = await this.runner.run(systemPrompt, userPrompt, tools);

      await this.checkpoint.markPersonaGenerated();

      eventBus.emitEvent('memory.extracted', agentId, {
        layer: 'L3',
        mode: trigger.mode,
        reason: trigger.reason,
        changedScenes: changedScenes.length,
        toolCallsMade: result.toolCallsMade,
      });

      return { success: true, mode: trigger.mode, reason: trigger.reason };
    } catch (err) {
      eventBus.emitEvent('warning', agentId, { error: 'L3 persona generation failed', detail: String(err) });
      return { success: false, mode: trigger.mode, reason: trigger.reason, error: String(err) };
    }
  }

  private async getChangedScenes(
    sceneDir: string,
    index: SceneIndexEntry[],
    lastPersonaTime: string | null
  ): Promise<Array<{ filename: string; content: string }>> {
    if (index.length === 0) return [];

    const personaMs = lastPersonaTime ? new Date(lastPersonaTime).getTime() : 0;
    const changed: Array<{ filename: string; content: string }> = [];

    for (const entry of index) {
      if (lastPersonaTime) {
        const updatedMs = new Date(entry.updated).getTime();
        if (!Number.isNaN(updatedMs) && !Number.isNaN(personaMs) && updatedMs <= personaMs) {
          continue;
        }
      }
      const filePath = join(sceneDir, entry.filename);
      if (!existsSync(filePath)) continue;
      const content = await readFile(filePath, 'utf-8');
      changed.push({ filename: entry.filename, content });
    }

    return changed;
  }

  private async readExistingPersona(agentId: string): Promise<string | null> {
    const personaPath = join(this.config.personalityDir, `${agentId}.md`);
    if (!existsSync(personaPath)) return null;
    try {
      return await readFile(personaPath, 'utf-8');
    } catch {
      return null;
    }
  }
}
