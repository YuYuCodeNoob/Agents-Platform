import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { InjectionHook, ContentBlock, InjectionContext } from './types.js';

export class PersonaInjectionHook implements InjectionHook {
  id = 'persona-injection';
  slot = 'system.suffix' as const;
  priority = 50;
  cacheStrategy = 'none' as const;

  constructor(private personalityDir: string) {}

  async execute(ctx: InjectionContext): Promise<ContentBlock[] | null> {
    if (!ctx.agentId) return null;

    const personaPath = join(this.personalityDir, `${ctx.agentId}.md`);
    if (!existsSync(personaPath)) return null;

    let content: string;
    try {
      content = await readFile(personaPath, 'utf-8');
    } catch {
      return null;
    }

    const trimmed = content.trim();
    if (trimmed === '') return null;

    return [{
      role: 'system',
      text: `\n\n## Agent Persona\n\n${trimmed}\n`,
    }];
  }
}
