import { mkdir } from 'fs/promises';
import { join } from 'path';
import { ToolLoopRunner } from './tool-loop-runner.js';
import { createSceneTools } from './scene-tools.js';
import {
  readSceneIndex,
  syncSceneIndex,
  cleanupSoftDeletes,
  buildSceneSummaries,
  getSceneCountWarning,
  type SceneIndexEntry,
} from './scene-index.js';
import { buildSceneExtractionPrompt } from '../prompts/l2-scene-extraction.js';
import type { ExtractedMemory } from '../prompts/l1-dedup.js';
import type { MemoryPromptMode } from '../prompts/l1-extraction.js';
import { eventBus } from '../../events/eventBus.js';

export interface SceneExtractionResult {
  success: boolean;
  memoriesProcessed: number;
  scenesCreated: number;
  scenesUpdated: number;
  scenesDeleted: number;
  totalScenes: number;
  error?: string;
}

export interface L2Config {
  llmApiUrl: string;
  llmApiKey: string;
  llmModel: string;
  dataDir: string;
  maxScenes?: number;
  promptMode?: MemoryPromptMode;
  maxIterations?: number;
}

export class L2SceneExtractor {
  private maxScenes: number;
  private promptMode: MemoryPromptMode;
  private runner: ToolLoopRunner;

  constructor(private config: L2Config) {
    this.maxScenes = config.maxScenes ?? 15;
    this.promptMode = config.promptMode ?? 'chat';
    this.runner = new ToolLoopRunner({
      llmApiUrl: config.llmApiUrl,
      llmApiKey: config.llmApiKey,
      llmModel: config.llmModel,
      maxIterations: config.maxIterations ?? 20,
    });
  }

  async extract(
    memories: ExtractedMemory[],
    agentId: string
  ): Promise<SceneExtractionResult> {
    if (memories.length === 0) {
      return { success: true, memoriesProcessed: 0, scenesCreated: 0, scenesUpdated: 0, scenesDeleted: 0, totalScenes: 0 };
    }

    const sceneDir = join(this.config.dataDir, 'scene_blocks', agentId);
    await mkdir(sceneDir, { recursive: true });

    const oldIndex = await readSceneIndex(sceneDir);
    const oldFilenames = new Set(oldIndex.map((e) => e.filename));

    const { summaries, filenames, count } = buildSceneSummaries(oldIndex);
    const warning = getSceneCountWarning(count, this.maxScenes);

    const memoriesJson = JSON.stringify(memories.map((m) => ({
      content: m.content,
      type: m.type,
      priority: m.priority,
      scene_name: m.scene_name,
    })), null, 2);

    const { systemPrompt, userPrompt } = buildSceneExtractionPrompt({
      memoriesJson,
      sceneSummaries: summaries,
      currentTimestamp: new Date().toISOString(),
      sceneCountWarning: warning,
      existingSceneFiles: filenames,
      maxScenes: this.maxScenes,
      promptMode: this.promptMode,
    });

    const tools = createSceneTools(sceneDir);

    let result;
    try {
      result = await this.runner.run(systemPrompt, userPrompt, tools);
    } catch (err) {
      eventBus.emitEvent('warning', agentId, { error: 'L2 extraction failed', detail: String(err) });
      return {
        success: false,
        memoriesProcessed: memories.length,
        scenesCreated: 0,
        scenesUpdated: 0,
        scenesDeleted: 0,
        totalScenes: oldIndex.length,
        error: String(err),
      };
    }

    const deletedFiles = await cleanupSoftDeletes(sceneDir);
    const syncResult = await syncSceneIndex(sceneDir);

    const created = syncResult.created.filter((f) => !oldFilenames.has(f));
    const updated = syncResult.updated;

    const personaUpdateRequested = result.text.includes('[PERSONA_UPDATE_REQUEST]');

    eventBus.emitEvent('memory.extracted', agentId, {
      layer: 'L2',
      memoriesProcessed: memories.length,
      scenesCreated: created.length,
      scenesUpdated: updated.length,
      scenesDeleted: deletedFiles.length,
      totalScenes: syncResult.entries.length,
      toolCallsMade: result.toolCallsMade,
      personaUpdateRequested,
    });

    return {
      success: true,
      memoriesProcessed: memories.length,
      scenesCreated: created.length,
      scenesUpdated: updated.length,
      scenesDeleted: deletedFiles.length,
      totalScenes: syncResult.entries.length,
    };
  }

  getSceneDir(agentId: string): string {
    return join(this.config.dataDir, 'scene_blocks', agentId);
  }
}
