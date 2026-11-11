import { Router } from "express";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { badRequest, serverError } from "../utils/response";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
//  Chat router — powers the AI Assistant screen
//
//  POST /api/chat          — generate a support response (JSON)
//  POST /api/chat/stream   — same, but streams text/event-stream (SSE)
//
//  No authentication required so the widget can be embedded publicly,
//  but it IS rate-limited by the global limiter in index.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const chatRouter = Router();

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

function buildSystemPrompt(category: string, tone: string): string {
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

  return `You are a helpful, honest customer support agent for SupportAI, a modern SaaS platform.

TONE: ${toneInstructions[tone] ?? toneInstructions["Friendly & professional"]}

CATEGORY CONTEXT: ${categoryContext[category] ?? categoryContext["General"]}

INSTRUCTIONS:
- Respond ONLY to customer support questions. If the message is unrelated to customer support, politely redirect the customer.
- Provide clear, actionable steps. Number them when there are multiple steps.
- If you cannot resolve the issue from the information given, tell the customer what information you need, or offer to escalate to a human agent.
- Do NOT invent specific order numbers, dates, refund amounts, or account details you don't have.
- End with a brief, friendly sign-off.
- Keep responses under 250 words unless the complexity genuinely requires more.
- Do not include any markdown headers (##). Use plain paragraphs or numbered lists only.`;
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

      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: buildSystemPrompt(category, tone),
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        ],
      });

      const result = await model.generateContent(message);
      const text = result.response.text();

      logger.info("Chat response generated", { category, tone, model: modelName, chars: text.length });

      res.json({ success: true, data: { response: text, model: modelName } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Gemini API error", { error: message });

      // Surface key quota/key errors clearly
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

      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: buildSystemPrompt(category, tone),
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        ],
      });

      // Set SSE headers before streaming starts
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const streamResult = await model.generateContentStream(message);

      for await (const chunk of streamResult.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          // SSE format: "data: <json>\n\n"
          res.write(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`);
        }
      }

      // Signal completion
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();

      logger.info("Chat stream completed", { category, tone, model: modelName });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Gemini stream error", { error: message });

      // If headers already sent, send error event then close
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "AI service error. Please try again." })}\n\n`);
        res.end();
      } else {
        next(err);
      }
    }
  }
);
