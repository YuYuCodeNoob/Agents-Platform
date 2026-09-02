import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { StructuredRecord, MemoryQuery, MemoryResult } from './types.js';
import { rrfMerge, bm25RankToScore } from './search-utils.js';

interface L1Record {
  record_id: string;
  agent_id: string;
  content: string;
  type: string;
  priority: number;
  scene_name: string;
  metadata_json: string | null;
  created_time: number;
}

export class SqliteStore {
  private db: Database.Database;
  private vectorSupported = false;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.initSchema();
    this.tryInitVector();
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
        agent_id UNINDEXED,
        type UNINDEXED,
        content_rowid = 'rowid'
      );
    `);
  }

  private tryInitVector(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS records_vec USING vec0(
          record_id TEXT PRIMARY KEY,
          embedding float[1536] distance_metric=cosine
        );
      `);
      this.vectorSupported = true;
    } catch {
      this.vectorSupported = false;
    }
  }

  save(record: StructuredRecord): void {
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO structured_records (id, agent_id, type, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(
      record.id,
      record.agentId,
      record.type,
      record.content,
      record.metadata ? JSON.stringify(record.metadata) : null,
      record.createdAt
    );

    const deleteFtsStmt = this.db.prepare(`DELETE FROM records_fts WHERE rowid = (SELECT rowid FROM structured_records WHERE id = ?)`);
    try { deleteFtsStmt.run(record.id); } catch { /* ignore */ }

    const ftsStmt = this.db.prepare(`
      INSERT INTO records_fts (content, agent_id, type) VALUES (?, ?, ?)
    `);
    ftsStmt.run(record.content, record.agentId, record.type);

    if (this.vectorSupported && record.embedding && record.embedding.length > 0) {
      try {
        const deleteVecStmt = this.db.prepare(`DELETE FROM records_vec WHERE record_id = ?`);
        deleteVecStmt.run(record.id);
        const vecStmt = this.db.prepare(`INSERT INTO records_vec (record_id, embedding) VALUES (?, ?)`);
        vecStmt.run(record.id, Buffer.from(record.embedding.buffer));
      } catch {
        // embedding write failure is non-fatal
      }
    }
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM structured_records WHERE id = ?`).run(id);
    try { this.db.prepare(`DELETE FROM records_fts WHERE rowid = ?`).run(id); } catch { /* ignore */ }
    if (this.vectorSupported) {
      try { this.db.prepare(`DELETE FROM records_vec WHERE record_id = ?`).run(id); } catch { /* ignore */ }
    }
  }

  getRecord(id: string): L1Record | undefined {
    const row = this.db.prepare(`SELECT * FROM structured_records WHERE id = ?`).get(id) as L1Record | undefined;
    return row;
  }

  searchKeyword(query: MemoryQuery): MemoryResult[] {
    const limit = (query.limit ?? 20) * 2;
    let sql: string;
    let params: unknown[];

    if (query.agentFilter) {
      sql = `SELECT id, agent_id, type, content, metadata, created_at, bm25(records_fts) as rank
             FROM records_fts WHERE records_fts MATCH ? AND agent_id = ?
             ORDER BY rank LIMIT ?`;
      params = [query.query, query.agentFilter, limit];
    } else {
      sql = `SELECT id, agent_id, type, content, metadata, created_at, bm25(records_fts) as rank
             FROM records_fts WHERE records_fts MATCH ?
             ORDER BY rank LIMIT ?`;
      params = [query.query, limit];
    }

    const rows = this.db.prepare(sql).all(...params) as Array<L1Record & { rank: number }>;
    return rows.map((row) => ({
      layer: 'structured' as const,
      agentId: row.agent_id,
      content: row.content,
      score: bm25RankToScore(row.rank),
      timestamp: row.created_time,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    }));
  }

  searchVector(embedding: Float32Array, query: MemoryQuery): MemoryResult[] {
    if (!this.vectorSupported) return [];

    const limit = (query.limit ?? 20) * 2;
    const sql = `SELECT record_id, distance
                 FROM records_vec
                 WHERE embedding MATCH ? AND k = ?
                 ORDER BY distance`;

    const rows = this.db.prepare(sql).all(Buffer.from(embedding.buffer), limit) as Array<{
      record_id: string;
      distance: number;
    }>;

    const results: MemoryResult[] = [];
    for (const row of rows) {
      const record = this.getRecord(row.record_id);
      if (!record) continue;
      if (query.agentFilter && record.agent_id !== query.agentFilter) continue;
      results.push({
        layer: 'structured' as const,
        agentId: record.agent_id,
        content: record.content,
        score: 1.0 - row.distance,
        timestamp: record.created_time,
        metadata: record.metadata_json ? JSON.parse(record.metadata_json) : undefined,
      });
    }

    return results;
  }

  searchHybrid(query: MemoryQuery, embedding?: Float32Array): MemoryResult[] {
    const keywordResults = this.searchKeyword(query);
    const vectorResults = embedding ? this.searchVector(embedding, query) : [];

    if (vectorResults.length === 0) return keywordResults;
    if (keywordResults.length === 0) return vectorResults;

    return rrfMerge([keywordResults, vectorResults], (r) =>
      `${r.agentId}:${r.content.slice(0, 50)}`
    );
  }

  search(query: MemoryQuery, embedding?: Float32Array): MemoryResult[] {
    if (embedding && this.vectorSupported) {
      return this.searchHybrid(query, embedding);
    }
    return this.searchKeyword(query);
  }

  isVectorSupported(): boolean {
    return this.vectorSupported;
  }

  close(): void {
    this.db.close();
  }
}
