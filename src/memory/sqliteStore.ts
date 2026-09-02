import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { StructuredRecord, MemoryQuery, MemoryResult } from './types.js';

export class SqliteStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS structured_records (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_records_agent ON structured_records(agent_id);
      CREATE INDEX IF NOT EXISTS idx_records_type ON structured_records(type);

      CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
        content,
        agent_id,
        type,
        content_rowid = 'rowid'
      );
    `);
  }

  save(record: StructuredRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO structured_records (id, agent_id, type, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.agentId,
      record.type,
      record.content,
      record.metadata ? JSON.stringify(record.metadata) : null,
      record.createdAt
    );

    const ftsStmt = this.db.prepare(`
      INSERT INTO records_fts (content, agent_id, type) VALUES (?, ?, ?)
    `);
    ftsStmt.run(record.content, record.agentId, record.type);
  }

  search(query: MemoryQuery): MemoryResult[] {
    const limit = query.limit ?? 20;
    let sql: string;
    let params: unknown[];

    if (query.agentFilter) {
      sql = `
        SELECT id, agent_id, type, content, metadata, created_at
        FROM records_fts
        WHERE records_fts MATCH ? AND agent_id = ?
        LIMIT ?
      `;
      params = [query.query, query.agentFilter, limit];
    } else {
      sql = `
        SELECT id, agent_id, type, content, metadata, created_at
        FROM records_fts
        WHERE records_fts MATCH ?
        LIMIT ?
      `;
      params = [query.query, limit];
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      agent_id: string;
      type: string;
      content: string;
      metadata: string | null;
      created_at: number;
    }>;

    return rows.map((row) => ({
      layer: 'structured' as const,
      agentId: row.agent_id,
      content: row.content,
      timestamp: row.created_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  close(): void {
    this.db.close();
  }
}
