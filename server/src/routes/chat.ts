import { Router } from "express";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { badRequest, serverError } from "../utils/response";
import { logger } from "../utils/logger";
import { listArticlesWithEmbeddings } from "../db/knowledgeBase";
import { retrieveContext, type ScoredArticle } from "../utils/embeddings";

// ─────────────────────────────────────────────────────────────────────────────
//  Chat router — powers the AI Assistant screen
//
//  POST /api/chat          — generate a support response (JSON) with RAG
//  POST /api/chat/stream   — same, but streams text/event-stream (SSE) with RAG
//
//  RAG pipeline (both endpoints):
//    1. Embed the user message via text-embedding-004
//    2. Cosine-similarity search over the knowledge_base table
//    3. Top-k (default 3) articles injected into the system prompt
//    4. Sources returned alongside the response so the UI can cite them
//
//  Both endpoints retry up to MAX_RETRIES times on transient 503/429 errors
//  using exponential backoff before surfacing the error to the client.
// ─────────────────────────────────────────────────────────────────────────────

export const chatRouter = Router();

// ── Retry config ──────────────────────────────────────────────────────────────
const MAX_RETRIES    = 3;   // total attempts = 1 original + 3 retries
const BASE_DELAY_MS  = 800; // first retry after 800 ms
const MAX_DELAY_MS   = 8000;

/** Returns true for transient Google API errors worth retrying */
function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("high demand") ||
    msg.includes("rate limit") ||
    msg.includes("Service Unavailable") ||
    msg.includes("Too Many Requests")
  );
}

/** Exponential backoff with full jitter */
function backoffMs(attempt: number): number {
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return Math.floor(Math.random() * exp);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry wrapper — calls `fn` up to MAX_RETRIES times on retryable errors.
 * Throws the last error if all attempts fail.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES) throw err;
      const delay = backoffMs(attempt);
      logger.warn(`Gemini transient error — retrying in ${delay}ms`, {
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ── Lazy Gemini client (initialised on first request) ─────────────────────────
let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (_genAI) return _genAI;

  const key = process.env["GEMINI_API_KEY"];
  if (!key || key.startsWith("CHANGE_ME")) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Set it in server/.env — " +
      "get a free key at https://aistudio.google.com/app/apikey"
    );
  }

  _genAI = new GoogleGenerativeAI(key);
  return _genAI;
}

// ── Validation ────────────────────────────────────────────────────────────────

const ChatSchema = z.object({
  message:  z.string().min(1, "Message is required").max(2000),
  category: z.enum(["Orders", "Payments", "Refunds", "Account", "General"]).default("General"),
  tone:     z.enum(["Friendly & professional", "Concise", "Empathetic"]).default("Friendly & professional"),
});

// ── System prompt factory ─────────────────────────────────────────────────────

function buildSystemPrompt(category: string, tone: string, ragContext: string): string {
  const toneInstructions: Record<string, string> = {
    "Friendly & professional":
      "Write in a warm, friendly, and professional tone. Be approachable but polished.",
    "Concise":
      "Be concise and direct. Use short sentences and bullet points where appropriate. No filler.",
    "Empathetic":
      "Lead with empathy. Acknowledge the customer's frustration before providing the solution.",
  };

  const categoryContext: Record<string, string> = {
    "Orders":
      "This query is about order tracking, delivery, shipping, or order status.",
    "Payments":
      "This query is about billing, charges, invoices, subscriptions, or payment methods.",
    "Refunds":
      "This query is about refunds, returns, chargebacks, or reimbursements.",
    "Account":
      "This query is about account access, password resets, profile settings, or account management.",
    "General":
      "This is a general customer support query.",
  };

  const ragSection = ragContext
    ? `\n\n${ragContext}\n\nIMPORTANT: Base your answer primarily on the KNOWLEDGE BASE CONTEXT above. If the answer is covered there, use it as your source of truth. If the knowledge base does not cover the topic, say so honestly and offer to escalate to a human agent.`
    : "\n\nNote: No specific knowledge base articles were found for this query. Answer based on general customer support best practices, but do NOT invent specific policies, prices, or procedures. Offer to escalate if unsure.";

  return `You are a helpful, honest customer support agent for SupportAI, a modern SaaS platform.

TONE: ${toneInstructions[tone] ?? toneInstructions["Friendly & professional"]}

CATEGORY CONTEXT: ${categoryContext[category] ?? categoryContext["General"]}
${ragSection}

INSTRUCTIONS:
- Respond ONLY to customer support questions. If the message is unrelated to customer support, politely redirect the customer.
- Provide clear, actionable steps. Number them when there are multiple steps.
- If you cannot resolve the issue from the information given, tell the customer what information you need, or offer to escalate to a human agent.
- Do NOT invent specific order numbers, dates, refund amounts, or account details you don't have.
- End with a brief, friendly sign-off.
- Keep responses under 300 words unless the complexity genuinely requires more.
- Do not include any markdown headers (##). Use plain paragraphs or numbered lists only.`;
}

// ── Shared safety settings ────────────────────────────────────────────────────

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// ── Serialisable source for the client ───────────────────────────────────────

interface SourceArticle {
  id:       string;
  title:    string;
  category: string;
  score:    number;
}

function toSources(articles: ScoredArticle[]): SourceArticle[] {
  return articles.map(({ id, title, category, score }) => ({
    id,
    title,
    category,
    score: Math.round(score * 100) / 100,
  }));
}

// ── POST /api/chat — full response (non-streaming) ───────────────────────────

chatRouter.post(
  "/",
  validate({ body: ChatSchema }),
  async (req, res, next) => {
    try {
      const { message, category, tone } = req.body as z.infer<typeof ChatSchema>;
      const modelName = process.env["GEMINI_MODEL"] ?? "gemini-3.8-flash";

      let genAI: GoogleGenerativeAI;
      try {
        genAI = getGenAI();
      } catch (err) {
        serverError(res, String(err));
        return;
      }

      // ── RAG: embed query and retrieve relevant articles ──────────────────
      const allArticles = listArticlesWithEmbeddings();
      const { articles: retrievedArticles, ragContext } = await retrieveContext(
        message,
        allArticles,
        3,
      );

      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: buildSystemPrompt(category, tone, ragContext),
        safetySettings: SAFETY_SETTINGS,
      });

      // ── Call Gemini with retry ───────────────────────────────────────────
      const result = await withRetry(() => model.generateContent(message));
      const text   = result.response.text();
      const sources = toSources(retrievedArticles);

      logger.info("Chat response generated (RAG)", {
        category,
        tone,
        model:    modelName,
        chars:    text.length,
        sources:  sources.length,
        topScore: sources[0]?.score ?? "n/a",
      });

      res.json({
        success: true,
        data: {
          response: text,
          model:    modelName,
          sources,
          ragEnabled: retrievedArticles.length > 0,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Gemini API error", { error: message });

      if (message.includes("API key") || message.includes("quota") || message.includes("403")) {
        badRequest(res, "AI service error: " + message);
        return;
      }
      next(err);
    }
  }
);

// ── POST /api/chat/stream — Server-Sent Events streaming ─────────────────────

chatRouter.post(
  "/stream",
  validate({ body: ChatSchema }),
  async (req, res, next) => {
    try {
      const { message, category, tone } = req.body as z.infer<typeof ChatSchema>;
      const modelName = process.env["GEMINI_MODEL"] ?? "gemini-3.8-flash";

      let genAI: GoogleGenerativeAI;
      try {
        genAI = getGenAI();
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
        return;
      }

      // ── RAG: embed query and retrieve relevant articles ──────────────────
      const allArticles = listArticlesWithEmbeddings();
      const { articles: retrievedArticles, ragContext } = await retrieveContext(
        message,
        allArticles,
        3,
      );

      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: buildSystemPrompt(category, tone, ragContext),
        safetySettings: SAFETY_SETTINGS,
      });

      // Set SSE headers before streaming starts
      res.setHeader("Content-Type",  "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection",    "keep-alive");
      res.flushHeaders();

      // Send sources as first event so the client can render citations early
      const sources = toSources(retrievedArticles);
      res.write(`data: ${JSON.stringify({ sources, ragEnabled: sources.length > 0 })}\n\n`);

      // ── Call Gemini stream with retry ────────────────────────────────────
      // Retries happen BEFORE headers are sent for the stream content, so we
      // can still recover from a 503 on the initial connection attempt.
      const streamResult = await withRetry(() =>
        model.generateContentStream(message)
      );

      for await (const chunk of streamResult.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          res.write(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`);
        }
      }

      // Signal completion
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();

      logger.info("Chat stream completed (RAG)", {
        category,
        tone,
        model:    modelName,
        sources:  sources.length,
        topScore: sources[0]?.score ?? "n/a",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Gemini stream error", { error: message });

      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "AI service error. Please try again." })}\n\n`);
        res.end();
      } else {
        next(err);
      }
    }
  }
);
