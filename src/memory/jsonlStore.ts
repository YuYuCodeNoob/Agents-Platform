import { mkdir, appendFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import type { RawMessage } from './types.js';

export class JsonlStore {
  constructor(private dir: string) {}

  async save(msg: RawMessage): Promise<void> {
    const filePath = join(this.dir, `agent_${this.sanitizeName(msg.agentId)}.jsonl`);
    await mkdir(dirname(filePath), { recursive: true });
    const line = JSON.stringify(msg) + '\n';
    await appendFile(filePath, line, 'utf-8');
  }

  async readAll(agentId: string): Promise<RawMessage[]> {
    const filePath = join(this.dir, `agent_${this.sanitizeName(agentId)}.jsonl`);
    if (!existsSync(filePath)) return [];

    const content = await readFile(filePath, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as RawMessage);
  }

  async search(query: string, agentFilter?: string, limit = 20): Promise<RawMessage[]> {
    if (!existsSync(this.dir)) return [];

    const files = await readdir(this.dir);
    const results: RawMessage[] = [];
    const lowerQuery = query.toLowerCase();

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      if (agentFilter && !file.includes(this.sanitizeName(agentFilter))) continue;

      const content = await readFile(join(this.dir, file), 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        const msg = JSON.parse(line) as RawMessage;
        if (msg.content.toLowerCase().includes(lowerQuery)) {
          results.push(msg);
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}
