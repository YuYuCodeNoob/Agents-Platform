import { readFile, writeFile, readdir, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export interface SceneIndexEntry {
  filename: string;
  summary: string;
  heat: number;
  created: string;
  updated: string;
}

const INDEX_FILE = '.metadata/scene_index.json';

export async function readSceneIndex(workspaceDir: string): Promise<SceneIndexEntry[]> {
  const indexPath = join(workspaceDir, INDEX_FILE);
  if (!existsSync(indexPath)) return [];
  try {
    const raw = await readFile(indexPath, 'utf-8');
    return JSON.parse(raw) as SceneIndexEntry[];
  } catch {
    return [];
  }
}

export async function writeSceneIndex(workspaceDir: string, entries: SceneIndexEntry[]): Promise<void> {
  const indexPath = join(workspaceDir, INDEX_FILE);
  await mkdir(join(indexPath, '..'), { recursive: true });
  await writeFile(indexPath, JSON.stringify(entries, null, 2), 'utf-8');
}

function parseMeta(content: string): Partial<SceneIndexEntry> {
  const metaMatch = content.match(/-----META-START-----\n([\s\S]*?)\n-----META-END-----/);
  if (!metaMatch) return {};

  const metaBlock = metaMatch[1];
  const fields: Record<string, string> = {};
  for (const line of metaBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      fields[key] = val;
    }
  }

  return {
    summary: fields.summary ?? '',
    heat: parseInt(fields.heat ?? '1', 10) || 1,
    created: fields.created ?? new Date().toISOString(),
    updated: fields.updated ?? new Date().toISOString(),
  };
}

export async function cleanupSoftDeletes(workspaceDir: string): Promise<string[]> {
  const deleted: string[] = [];
  if (!existsSync(workspaceDir)) return deleted;

  const files = await readdir(workspaceDir);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const filePath = join(workspaceDir, file);
    const content = await readFile(filePath, 'utf-8');
    if (content.includes('[DELETED]') || content.replace(/-----META-[\s\S]*?-----END-----/g, '').trim() === '') {
      await unlink(filePath);
      deleted.push(file);
    }
  }
  return deleted;
}

export async function syncSceneIndex(workspaceDir: string): Promise<{ entries: SceneIndexEntry[]; created: string[]; updated: string[] }> {
  if (!existsSync(workspaceDir)) {
    await mkdir(workspaceDir, { recursive: true });
    return { entries: [], created: [], updated: [] };
  }

  const oldIndex = await readSceneIndex(workspaceDir);
  const oldMap = new Map(oldIndex.map((e) => [e.filename, e]));

  const files = await readdir(workspaceDir);
  const entries: SceneIndexEntry[] = [];
  const created: string[] = [];
  const updated: string[] = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const filePath = join(workspaceDir, file);
    const content = await readFile(filePath, 'utf-8');
    const meta = parseMeta(content);

    const entry: SceneIndexEntry = {
      filename: file,
      summary: meta.summary ?? '',
      heat: meta.heat ?? 1,
      created: meta.created ?? new Date().toISOString(),
      updated: meta.updated ?? new Date().toISOString(),
    };
    entries.push(entry);

    const old = oldMap.get(file);
    if (!old) {
      created.push(file);
    } else if (old.updated !== entry.updated || old.summary !== entry.summary) {
      updated.push(file);
    }
  }

  await writeSceneIndex(workspaceDir, entries);
  return { entries, created, updated };
}

export function buildSceneSummaries(entries: SceneIndexEntry[]): { summaries: string; filenames: string[]; count: number } {
  if (entries.length === 0) {
    return { summaries: '(当前无已有场景文件)', filenames: [], count: 0 };
  }

  const lines = entries.map((e, i) =>
    `${i + 1}. \`${e.filename}\` (heat=${e.heat}, updated=${e.updated})\n   ${e.summary}`
  );

  return {
    summaries: `当前场景总数：${entries.length}\n\n${lines.join('\n')}`,
    filenames: entries.map((e) => e.filename),
    count: entries.length,
  };
}

export function getSceneCountWarning(count: number, maxScenes: number): string | undefined {
  if (count >= maxScenes) {
    return `🔴 红色预警(≥ ${maxScenes})：当前 ${count} 个场景文件，必须先 MERGE 减少文件数量`;
  }
  if (count === maxScenes - 1) {
    return `🟠 橙色预警(= ${maxScenes - 1})：当前 ${count} 个场景文件，只能 UPDATE，不能 CREATE`;
  }
  if (count >= maxScenes - 3) {
    return `🟡 黄色预警：当前 ${count} 个场景文件，优先 UPDATE 或 MERGE`;
  }
  return undefined;
}
