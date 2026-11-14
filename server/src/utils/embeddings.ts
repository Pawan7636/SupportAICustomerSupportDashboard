import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
//  Embeddings utility
//
//  Uses Google's `text-embedding-004` model (768 dimensions) to vectorise
//  text.  Cosine similarity is computed in pure JS — no native add-ons needed.
//
//  Usage:
//    const vec = await embedText("How do I track my order?");
//    const top = retrieveTopK(queryVec, articlesWithEmbeddings, 3);
// ─────────────────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-004";

/** Lazy singleton for the embedding client (same API key as chat) */
let _embeddingClient: GoogleGenerativeAI | null = null;

function getEmbeddingClient(): GoogleGenerativeAI {
  if (_embeddingClient) return _embeddingClient;
  const key = process.env["GEMINI_API_KEY"];
  if (!key || key.startsWith("CHANGE_ME")) {
    throw new Error("GEMINI_API_KEY is not configured — cannot generate embeddings.");
  }
  _embeddingClient = new GoogleGenerativeAI(key);
  return _embeddingClient;
}

/**
 * Generate a 768-dimension embedding vector for `text` using
 * Google's text-embedding-004 model.
 */
export async function embedText(text: string): Promise<number[]> {
  const client = getEmbeddingClient();
  const model = client.getGenerativeModel({ model: EMBEDDING_MODEL });

  const result = await model.embedContent({
    content: { role: "user", parts: [{ text }] },
  });

  return result.embedding.values;
}

/**
 * Compute the cosine similarity between two equal-length vectors.
 * Returns a value in [-1, 1]; higher = more similar.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot   += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface ScoredArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  score: number;
}

export interface ArticleForRetrieval {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  embedding: number[] | null;
}

/**
 * Retrieve the top-k articles most semantically similar to `queryEmbedding`.
 * Articles without an embedding are skipped.
 * Results are sorted descending by cosine similarity.
 */
export function retrieveTopK(
  queryEmbedding: number[],
  articles: ArticleForRetrieval[],
  k = 3,
  minScore = 0.5,
): ScoredArticle[] {
  const scored: ScoredArticle[] = [];

  for (const article of articles) {
    if (!article.embedding || article.embedding.length === 0) continue;
    const score = cosineSimilarity(queryEmbedding, article.embedding);
    if (score >= minScore) {
      scored.push({
        id: article.id,
        title: article.title,
        content: article.content,
        category: article.category,
        tags: article.tags,
        score,
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * Build the RAG context block to inject into the Gemini system prompt.
 * Returns an empty string if no relevant articles were found.
 */
export function buildRagContext(articles: ScoredArticle[]): string {
  if (articles.length === 0) return "";

  const sections = articles.map((a, i) =>
    `[${i + 1}] ${a.title}\n${a.content.trim()}`,
  );

  return `
KNOWLEDGE BASE CONTEXT:
The following verified articles from the knowledge base are relevant to this query. Use them as your primary source of truth. Do NOT fabricate information not present in these articles.

${sections.join("\n\n")}

SOURCE TITLES (for citation):
${articles.map((a, i) => `[${i + 1}] ${a.title}`).join("\n")}
`.trim();
}

/**
 * Convenience wrapper: embed a query and retrieve top-k matching articles.
 * Returns `{ articles, ragContext }` — if the embedding API fails, returns
 * empty results so the chat endpoint degrades gracefully (no RAG, raw Gemini).
 */
export async function retrieveContext(
  query: string,
  allArticles: ArticleForRetrieval[],
  k = 3,
): Promise<{ articles: ScoredArticle[]; ragContext: string }> {
  if (allArticles.length === 0) {
    return { articles: [], ragContext: "" };
  }

  try {
    const queryEmbedding = await embedText(query);
    const articles = retrieveTopK(queryEmbedding, allArticles, k);
    const ragContext = buildRagContext(articles);
    logger.info("RAG retrieval completed", {
      query: query.slice(0, 80),
      candidateArticles: allArticles.length,
      retrievedArticles: articles.length,
      topScore: articles[0]?.score?.toFixed(3) ?? "n/a",
    });
    return { articles, ragContext };
  } catch (err) {
    logger.warn("RAG embedding failed — falling back to base Gemini", {
      error: String(err),
    });
    return { articles: [], ragContext: "" };
  }
}
