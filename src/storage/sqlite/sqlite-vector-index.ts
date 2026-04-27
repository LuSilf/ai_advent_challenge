import type {
  Chunk,
  ChunkStrategy,
  ChunkWithVector,
  VectorSearchHit,
} from "../../domain/models/chunking";
import type { VectorIndex, VectorSearchFilter } from "../../domain/ports/vector-index";
import { getDb } from "../../db";

type ChunkRow = {
  id: number;
  strategy: ChunkStrategy;
  source: string;
  title: string | null;
  section: string | null;
  chunk_index: number;
  char_start: number;
  char_end: number;
  text: string;
  line_start: number | null;
  line_end: number | null;
};

function rowToChunk(row: ChunkRow): Chunk {
  return {
    id: row.id,
    strategy: row.strategy,
    source: row.source,
    title: row.title,
    section: row.section,
    chunkIndex: row.chunk_index,
    charStart: row.char_start,
    charEnd: row.char_end,
    text: row.text,
    lineStart: row.line_start ?? undefined,
    lineEnd: row.line_end ?? undefined,
  };
}

function vectorToBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

export class SqliteVectorIndex implements VectorIndex {
  upsert(chunks: ChunkWithVector[]): void {
    if (chunks.length === 0) return;

    const db = getDb();
    const insertChunk = db.prepare(
      `INSERT INTO chunks (strategy, source, title, section, chunk_index, char_start, char_end, text, line_start, line_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertVector = db.prepare(
      `INSERT INTO chunk_vectors (chunk_id, embedding) VALUES (?, ?)`
    );

    const tx = db.transaction((batch: ChunkWithVector[]) => {
      for (const c of batch) {
        const res = insertChunk.run(
          c.strategy,
          c.source,
          c.title,
          c.section,
          c.chunkIndex,
          c.charStart,
          c.charEnd,
          c.text,
          c.lineStart ?? null,
          c.lineEnd ?? null,
        );
        const chunkId = Number(res.lastInsertRowid);
        insertVector.run(chunkId, vectorToBlob(c.embedding));
      }
    });

    tx(chunks);
  }

  search(queryVector: Float32Array, k: number, filter?: VectorSearchFilter): VectorSearchHit[] {
    const db = getDb();
    // Over-fetch from vec0, then post-filter by metadata. Safe for datasets up to
    // a few thousand chunks; re-evaluate if the corpus grows by orders of magnitude.
    const overFetch = Math.max(k * 10, 100);

    const knn = db.query<{ chunk_id: number; distance: number }, [Uint8Array, number]>(
      `SELECT chunk_id, distance
       FROM chunk_vectors
       WHERE embedding MATCH ? AND k = ?
       ORDER BY distance`
    ).all(vectorToBlob(queryVector), overFetch);

    if (knn.length === 0) return [];

    const ids = knn.map((r) => r.chunk_id);
    const placeholders = ids.map(() => "?").join(",");
    const conditions: string[] = [`id IN (${placeholders})`];
    const params: (number | string)[] = [...ids];

    if (filter?.strategy) {
      conditions.push("strategy = ?");
      params.push(filter.strategy);
    }
    if (filter?.source) {
      conditions.push("source = ?");
      params.push(filter.source);
    }

    const rows = db
      .query<ChunkRow, (number | string)[]>(
        `SELECT * FROM chunks WHERE ${conditions.join(" AND ")}`
      )
      .all(...params);

    const byId = new Map<number, ChunkRow>();
    for (const r of rows) byId.set(r.id, r);

    const hits: VectorSearchHit[] = [];
    for (const { chunk_id, distance } of knn) {
      const row = byId.get(chunk_id);
      if (!row) continue;
      hits.push({ ...rowToChunk(row), distance });
      if (hits.length >= k) break;
    }
    return hits;
  }

  deleteByStrategy(strategy: ChunkStrategy, source?: string): number {
    const db = getDb();
    const params: (string)[] = [strategy];
    let where = "strategy = ?";
    if (source) {
      where += " AND source = ?";
      params.push(source);
    }

    const ids = db
      .query<{ id: number }, string[]>(`SELECT id FROM chunks WHERE ${where}`)
      .all(...params)
      .map((r) => r.id);

    if (ids.length === 0) return 0;

    const tx = db.transaction(() => {
      const placeholders = ids.map(() => "?").join(",");
      db.run(`DELETE FROM chunk_vectors WHERE chunk_id IN (${placeholders})`, ids);
      db.run(`DELETE FROM chunks WHERE id IN (${placeholders})`, ids);
    });
    tx();
    return ids.length;
  }

  countByStrategy(strategy: ChunkStrategy, source?: string): number {
    const db = getDb();
    if (source) {
      const row = db
        .query<{ c: number }, [string, string]>(
          `SELECT COUNT(*) AS c FROM chunks WHERE strategy = ? AND source = ?`
        )
        .get(strategy, source);
      return row?.c ?? 0;
    }
    const row = db
      .query<{ c: number }, [string]>(
        `SELECT COUNT(*) AS c FROM chunks WHERE strategy = ?`
      )
      .get(strategy);
    return row?.c ?? 0;
  }
}
