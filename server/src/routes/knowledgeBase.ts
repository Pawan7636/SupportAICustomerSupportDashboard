import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { authenticate, requireRoles } from "../middleware/authenticate";
import { notFound, badRequest } from "../utils/response";
import { embedText } from "../utils/embeddings";
import {
  listArticles,
  getArticleById,
  createArticle,
  updateArticle,
  deleteArticle,
  saveEmbedding,
  listArticlesWithEmbeddings,
  type KbCategory,
} from "../db/knowledgeBase";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
//  Knowledge Base router
//
//  GET    /api/kb              — list articles (public, no auth)
//  GET    /api/kb/:id          — single article (public)
//  POST   /api/kb              — create article (agent/admin)
//  PATCH  /api/kb/:id          — update article (agent/admin)
//  DELETE /api/kb/:id          — delete article (admin only)
//  POST   /api/kb/:id/embed    — (re-)generate embedding for an article (agent/admin)
//  POST   /api/kb/search       — semantic search (public)
// ─────────────────────────────────────────────────────────────────────────────

export const kbRouter = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

const KB_CATEGORIES = ["orders", "payments", "refunds", "account", "technical", "general"] as const;

const CreateArticleSchema = z.object({
  title:    z.string().min(3).max(200),
  content:  z.string().min(10).max(10_000),
  category: z.enum(KB_CATEGORIES).default("general"),
  tags:     z.array(z.string().max(50)).max(10).default([]),
});

const UpdateArticleSchema = z.object({
  title:     z.string().min(3).max(200).optional(),
  content:   z.string().min(10).max(10_000).optional(),
  category:  z.enum(KB_CATEGORIES).optional(),
  tags:      z.array(z.string().max(50)).max(10).optional(),
  is_active: z.boolean().optional(),
});

const SearchSchema = z.object({
  query: z.string().min(1).max(500),
  k:     z.number().int().min(1).max(10).default(3),
});

// ── GET /api/kb ───────────────────────────────────────────────────────────────

kbRouter.get("/", (req, res) => {
  const category = req.query["category"] as string | undefined;
  const articles = listArticles(category);
  // Strip embeddings from public list response — they're large and not needed
  const sanitised = articles.map(({ embedding: _e, ...rest }) => rest);
  res.json({ success: true, data: sanitised, count: sanitised.length });
});

// ── GET /api/kb/:id ───────────────────────────────────────────────────────────

kbRouter.get("/:id", (req, res) => {
  const article = getArticleById(String(req.params["id"]));
  if (!article) { notFound(res, "Article not found"); return; }
  const { embedding: _e, ...sanitised } = article;
  res.json({ success: true, data: sanitised });
});

// ── POST /api/kb — create article + auto-generate embedding ──────────────────

kbRouter.post(
  "/",
  authenticate,
  requireRoles("agent", "admin"),
  validate({ body: CreateArticleSchema }),
  async (req, res, next) => {
    try {
      const input = req.body as z.infer<typeof CreateArticleSchema>;

      // Create record first (without embedding)
      const article = createArticle({
        title:    input.title,
        content:  input.content,
        category: input.category as KbCategory,
        tags:     input.tags,
      });

      // Fire-and-forget embedding generation (do not block the HTTP response)
      embedText(`${input.title}\n\n${input.content}`)
        .then((vec) => {
          saveEmbedding(article.id, vec);
          logger.info("Embedding saved", { id: article.id, title: input.title });
        })
        .catch((err) => {
          logger.warn("Embedding generation failed", { id: article.id, error: String(err) });
        });

      const { embedding: _e, ...sanitised } = article;
      res.status(201).json({ success: true, data: sanitised });
    } catch (err) {
      next(err);
    }
  },
);

// ── PATCH /api/kb/:id ─────────────────────────────────────────────────────────

kbRouter.patch(
  "/:id",
  authenticate,
  requireRoles("agent", "admin"),
  validate({ body: UpdateArticleSchema }),
  async (req, res, next) => {
    try {
      const id    = String(req.params["id"]);
      const input = req.body as z.infer<typeof UpdateArticleSchema>;

      const existing = getArticleById(id);
      if (!existing) { notFound(res, "Article not found"); return; }

      const updated = updateArticle(id, {
        title:     input.title,
        content:   input.content,
        category:  input.category as KbCategory | undefined,
        tags:      input.tags,
        is_active: input.is_active,
      });

      // Re-generate embedding if title or content changed
      const contentChanged = (input.title && input.title !== existing.title)
        || (input.content && input.content !== existing.content);

      if (contentChanged && updated) {
        const textToEmbed = `${updated.title}\n\n${updated.content}`;
        embedText(textToEmbed)
          .then((vec) => {
            saveEmbedding(id, vec);
            logger.info("Embedding refreshed after update", { id });
          })
          .catch((err) => {
            logger.warn("Embedding refresh failed", { id, error: String(err) });
          });
      }

      const { embedding: _e, ...sanitised } = updated!;
      res.json({ success: true, data: sanitised });
    } catch (err) {
      next(err);
    }
  },
);

// ── DELETE /api/kb/:id ────────────────────────────────────────────────────────

kbRouter.delete(
  "/:id",
  authenticate,
  requireRoles("admin"),
  (req, res) => {
    const id = String(req.params["id"]);
    const deleted = deleteArticle(id);
    if (!deleted) { notFound(res, "Article not found"); return; }
    res.json({ success: true, data: { id } });
  },
);

// ── POST /api/kb/:id/embed — manually re-generate embedding ──────────────────

kbRouter.post(
  "/:id/embed",
  authenticate,
  requireRoles("agent", "admin"),
  async (req, res, next) => {
    try {
      const id      = String(req.params["id"]);
      const article = getArticleById(id);
      if (!article) { notFound(res, "Article not found"); return; }

      const vec = await embedText(`${article.title}\n\n${article.content}`);
      saveEmbedding(id, vec);
      logger.info("Embedding manually refreshed", { id });

      res.json({ success: true, data: { id, dimensions: vec.length } });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /api/kb/search — semantic similarity search ─────────────────────────

kbRouter.post(
  "/search",
  validate({ body: SearchSchema }),
  async (req, res, next) => {
    try {
      const { query, k } = req.body as z.infer<typeof SearchSchema>;

      const { retrieveContext } = await import("../utils/embeddings");
      const articles = listArticlesWithEmbeddings();

      const { articles: results } = await retrieveContext(query, articles, k);

      res.json({
        success: true,
        data: results.map(({ score, ...rest }) => ({
          ...rest,
          relevanceScore: Math.round(score * 100) / 100,
        })),
        count: results.length,
      });
    } catch (err) {
      next(err);
    }
  },
);
