import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

export interface Checkpoint {
  scenes_processed: number;
  memories_since_last_persona: number;
  last_persona_time: string | null;
  request_persona_update: boolean;
  last_l1_time: string | null;
  last_l2_time: string | null;
}

const DEFAULT_CHECKPOINT: Checkpoint = {
  scenes_processed: 0,
  memories_since_last_persona: 0,
  last_persona_time: null,
  request_persona_update: false,
  last_l1_time: null,
  last_l2_time: null,
};

export class CheckpointManager {
  constructor(private dataDir: string) {}

  private get checkpointPath(): string {
    return join(this.dataDir, '.metadata', 'checkpoint.json');
  }

  async read(): Promise<Checkpoint> {
    if (!existsSync(this.checkpointPath)) return { ...DEFAULT_CHECKPOINT };
    try {
      const raw = await readFile(this.checkpointPath, 'utf-8');
      return { ...DEFAULT_CHECKPOINT, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_CHECKPOINT };
    }
  }

  async write(cp: Checkpoint): Promise<void> {
    await mkdir(dirname(this.checkpointPath), { recursive: true });
    await writeFile(this.checkpointPath, JSON.stringify(cp, null, 2), 'utf-8');
  }

  async incrementMemories(count: number): Promise<void> {
    const cp = await this.read();
    cp.memories_since_last_persona += count;
    cp.last_l1_time = new Date().toISOString();
    await this.write(cp);
  }

  async incrementScenesProcessed(): Promise<void> {
    const cp = await this.read();
    cp.scenes_processed += 1;
    cp.last_l2_time = new Date().toISOString();
    await this.write(cp);
  }

  async setPersonaUpdateRequest(value: boolean): Promise<void> {
    const cp = await this.read();
    cp.request_persona_update = value;
    await this.write(cp);
  }

  async markPersonaGenerated(): Promise<void> {
    const cp = await this.read();
    cp.last_persona_time = new Date().toISOString();
    cp.memories_since_last_persona = 0;
    cp.request_persona_update = false;
    await this.write(cp);
  }
}
