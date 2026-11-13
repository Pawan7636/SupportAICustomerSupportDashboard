import { v4 as uuidv4 } from "uuid";
import { getDb } from "./database";

// ─────────────────────────────────────────────────────────────────────────────
//  Knowledge Base DB helpers
//
//  Wraps all CRUD operations for the `knowledge_base` table.
//  Embeddings are stored as JSON-serialised float arrays (text-embedding-004,
//  768 dimensions). Cosine similarity is computed in Node.js — see
//  utils/embeddings.ts for the actual computation.
// ─────────────────────────────────────────────────────────────────────────────

export type KbCategory =
  | "orders"
  | "payments"
  | "refunds"
  | "account"
  | "technical"
  | "general";

export interface KbArticle {
  id: string;
  title: string;
  content: string;
  category: KbCategory;
  tags: string[];
  embedding: number[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Raw SQLite row — booleans come back as numbers, arrays as JSON strings */
interface KbRow {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string;
  embedding: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function rowToArticle(row: KbRow): KbArticle {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category as KbCategory,
    tags: JSON.parse(row.tags ?? "[]") as string[],
    embedding: row.embedding ? (JSON.parse(row.embedding) as number[]) : null,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** List all active articles (omits embeddings for performance) */
export function listArticles(category?: string): KbArticle[] {
  const db = getDb();
  const rows = category && category !== "all"
    ? (db.prepare(`
        SELECT id, title, content, category, tags, NULL AS embedding, is_active, created_at, updated_at
        FROM knowledge_base
        WHERE is_active = 1 AND category = ?
        ORDER BY created_at DESC
      `).all(category) as unknown as KbRow[])
    : (db.prepare(`
        SELECT id, title, content, category, tags, NULL AS embedding, is_active, created_at, updated_at
        FROM knowledge_base
        WHERE is_active = 1
        ORDER BY created_at DESC
      `).all() as unknown as KbRow[]);
  return rows.map(rowToArticle);
}

/** Fetch ALL active articles INCLUDING their embeddings (used by RAG retrieval) */
export function listArticlesWithEmbeddings(): KbArticle[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, title, content, category, tags, embedding, is_active, created_at, updated_at
    FROM knowledge_base
    WHERE is_active = 1
    ORDER BY created_at DESC
  `).all() as unknown as KbRow[];
  return rows.map(rowToArticle);
}

/** Fetch a single article by id (including embedding) */
export function getArticleById(id: string): KbArticle | undefined {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM knowledge_base WHERE id = ?
  `).get(id) as KbRow | undefined;
  return row ? rowToArticle(row) : undefined;
}

export interface CreateArticleInput {
  title: string;
  content: string;
  category: KbCategory;
  tags?: string[];
  embedding?: number[] | null;
}

/** Insert a new article and return it */
export function createArticle(input: CreateArticleInput): KbArticle {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO knowledge_base (id, title, content, category, tags, embedding, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    input.title,
    input.content,
    input.category,
    JSON.stringify(input.tags ?? []),
    input.embedding ? JSON.stringify(input.embedding) : null,
    now,
    now,
  );
  return getArticleById(id)!;
}

export interface UpdateArticleInput {
  title?: string;
  content?: string;
  category?: KbCategory;
  tags?: string[];
  embedding?: number[] | null;
  is_active?: boolean;
}

/** Update an article's fields; returns undefined if not found */
export function updateArticle(
  id: string,
  input: UpdateArticleInput,
): KbArticle | undefined {
  const existing = getArticleById(id);
  if (!existing) return undefined;

  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE knowledge_base
    SET title      = ?,
        content    = ?,
        category   = ?,
        tags       = ?,
        embedding  = ?,
        is_active  = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    input.title      ?? existing.title,
    input.content    ?? existing.content,
    input.category   ?? existing.category,
    JSON.stringify(input.tags ?? existing.tags),
    "embedding" in input
      ? (input.embedding ? JSON.stringify(input.embedding) : null)
      : (existing.embedding ? JSON.stringify(existing.embedding) : null),
    "is_active" in input ? (input.is_active ? 1 : 0) : (existing.is_active ? 1 : 0),
    now,
    id,
  );

  return getArticleById(id)!;
}

/** Permanently delete an article */
export function deleteArticle(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM knowledge_base WHERE id = ?`).run(id);
  return (result.changes ?? 0) > 0;
}

/** Store/update the embedding for an existing article */
export function saveEmbedding(id: string, embedding: number[]): void {
  const db = getDb();
  db.prepare(`
    UPDATE knowledge_base
    SET embedding = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(embedding), new Date().toISOString(), id);
}
