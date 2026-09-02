import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readSceneIndex,
  writeSceneIndex,
  syncSceneIndex,
  cleanupSoftDeletes,
  buildSceneSummaries,
  getSceneCountWarning,
  type SceneIndexEntry,
} from '../src/memory/extraction/scene-index.js';
import { CheckpointManager } from '../src/memory/extraction/checkpoint.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'gw-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('scene-index', () => {
  test('readSceneIndex returns empty when no index', async () => {
    const result = await readSceneIndex(tempDir);
    expect(result).toEqual([]);
  });

  test('writeSceneIndex + readSceneIndex round-trip', async () => {
    const entries: SceneIndexEntry[] = [
      { filename: 'scene1.md', summary: 'Test scene', heat: 3, created: '2026-01-01T00:00:00Z', updated: '2026-01-02T00:00:00Z' },
    ];
    await writeSceneIndex(tempDir, entries);
    const result = await readSceneIndex(tempDir);
    expect(result).toEqual(entries);
  });

  test('syncSceneIndex creates index from .md files', async () => {
    const sceneContent = `-----META-START-----
created: 2026-01-01T00:00:00Z
updated: 2026-01-02T00:00:00Z
summary: Test summary
heat: 5
-----META-END-----

## Content
Hello world`;

    await writeFile(join(tempDir, 'scene1.md'), sceneContent, 'utf-8');

    const result = await syncSceneIndex(tempDir);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].filename).toBe('scene1.md');
    expect(result.entries[0].summary).toBe('Test summary');
    expect(result.entries[0].heat).toBe(5);
    expect(result.created).toContain('scene1.md');

    const index = await readSceneIndex(tempDir);
    expect(index).toHaveLength(1);
  });

  test('syncSceneIndex detects created and updated', async () => {
    await mkdir(join(tempDir, '.metadata'), { recursive: true });
    const oldEntry: SceneIndexEntry = {
      filename: 'scene1.md',
      summary: 'Old summary',
      heat: 1,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
    };
    await writeSceneIndex(tempDir, [oldEntry]);

    const sceneContent = `-----META-START-----
created: 2026-01-01T00:00:00Z
updated: 2026-01-02T00:00:00Z
summary: New summary
heat: 2
-----META-END-----
Content`;
    await writeFile(join(tempDir, 'scene1.md'), sceneContent, 'utf-8');
    await writeFile(join(tempDir, 'scene2.md'), sceneContent, 'utf-8');

    const result = await syncSceneIndex(tempDir);
    expect(result.created).toContain('scene2.md');
    expect(result.updated).toContain('scene1.md');
  });

  test('cleanupSoftDeletes removes [DELETED] files', async () => {
    await writeFile(join(tempDir, 'scene1.md'), '[DELETED]', 'utf-8');
    await writeFile(join(tempDir, 'scene2.md'), 'Normal content', 'utf-8');

    const deleted = await cleanupSoftDeletes(tempDir);
    expect(deleted).toContain('scene1.md');
    expect(existsSync(join(tempDir, 'scene1.md'))).toBe(false);
    expect(existsSync(join(tempDir, 'scene2.md'))).toBe(true);
  });

  test('buildSceneSummaries formats entries', () => {
    const entries: SceneIndexEntry[] = [
      { filename: 'scene1.md', summary: 'First scene', heat: 3, created: '2026-01-01', updated: '2026-01-02' },
    ];
    const result = buildSceneSummaries(entries);
    expect(result.count).toBe(1);
    expect(result.filenames).toEqual(['scene1.md']);
    expect(result.summaries).toContain('First scene');
    expect(result.summaries).toContain('当前场景总数：1');
  });

  test('buildSceneSummaries handles empty', () => {
    const result = buildSceneSummaries([]);
    expect(result.count).toBe(0);
    expect(result.summaries).toContain('当前无已有场景文件');
  });

  test('getSceneCountWarning returns correct levels', () => {
    expect(getSceneCountWarning(15, 15)).toContain('红色预警');
    expect(getSceneCountWarning(14, 15)).toContain('橙色预警');
    expect(getSceneCountWarning(12, 15)).toContain('黄色预警');
    expect(getSceneCountWarning(5, 15)).toBeUndefined();
  });
});

describe('CheckpointManager', () => {
  test('reads default checkpoint when no file', async () => {
    const cp = new CheckpointManager(tempDir);
    const result = await cp.read();
    expect(result.scenes_processed).toBe(0);
    expect(result.memories_since_last_persona).toBe(0);
    expect(result.last_persona_time).toBeNull();
  });

  test('incrementMemories updates count and time', async () => {
    const cp = new CheckpointManager(tempDir);
    await cp.incrementMemories(5);
    const result = await cp.read();
    expect(result.memories_since_last_persona).toBe(5);
    expect(result.last_l1_time).not.toBeNull();
  });

  test('incrementScenesProcessed updates count', async () => {
    const cp = new CheckpointManager(tempDir);
    await cp.incrementScenesProcessed();
    await cp.incrementScenesProcessed();
    const result = await cp.read();
    expect(result.scenes_processed).toBe(2);
    expect(result.last_l2_time).not.toBeNull();
  });

  test('markPersonaGenerated resets counters', async () => {
    const cp = new CheckpointManager(tempDir);
    await cp.incrementMemories(10);
    await cp.setPersonaUpdateRequest(true);
    await cp.markPersonaGenerated();

    const result = await cp.read();
    expect(result.memories_since_last_persona).toBe(0);
    expect(result.request_persona_update).toBe(false);
    expect(result.last_persona_time).not.toBeNull();
  });

  test('setPersonaUpdateRequest persists flag', async () => {
    const cp = new CheckpointManager(tempDir);
    await cp.setPersonaUpdateRequest(true);
    const result = await cp.read();
    expect(result.request_persona_update).toBe(true);
  });
});
