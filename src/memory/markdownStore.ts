import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { SkillRecord, PersonalityRecord, MemoryResult } from './types.js';

export class MarkdownStore {
  constructor(private skillsDir: string, private personalityDir: string) {}

  async saveSkill(skill: SkillRecord): Promise<void> {
    await mkdir(this.skillsDir, { recursive: true });
    const filePath = join(this.skillsDir, skill.filePath || `${skill.name}.md`);
    await writeFile(filePath, skill.content, 'utf-8');
  }

  async savePersonality(personality: PersonalityRecord): Promise<void> {
    await mkdir(this.personalityDir, { recursive: true });
    const filePath = join(this.personalityDir, personality.filePath || `${personality.agentId}.md`);
    await writeFile(filePath, personality.content, 'utf-8');
  }

  async searchSkills(query: string, limit = 10): Promise<MemoryResult[]> {
    return this.searchDir(this.skillsDir, query, 'skill', limit);
  }

  async searchPersonality(query: string, agentFilter?: string, limit = 10): Promise<MemoryResult[]> {
    const results = await this.searchDir(this.personalityDir, query, 'personality', limit);
    if (agentFilter) {
      return results.filter((r) => r.agentId?.includes(agentFilter));
    }
    return results;
  }

  private async searchDir(
    dir: string,
    query: string,
    layer: 'skill' | 'personality',
    limit: number
  ): Promise<MemoryResult[]> {
    if (!existsSync(dir)) return [];

    const files = await readdir(dir);
    const results: MemoryResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = join(dir, file);
      const content = await readFile(filePath, 'utf-8');

      if (content.toLowerCase().includes(lowerQuery)) {
        results.push({
          layer,
          agentId: file.replace('.md', ''),
          content: content.slice(0, 500),
          timestamp: Date.now(),
        });
        if (results.length >= limit) break;
      }
    }

    return results;
  }
}
