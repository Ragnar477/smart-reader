// Small server that keeps the Anthropic API key off the browser.
// `npm run dev` serves the React app through Vite; `npm start` serves the built app from dist/.
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const here = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--dev");
const PORT = Number(process.env.PORT) || 5173;
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";

const Explanation = z.object({
  lemma: z.string().describe("Dictionary form of the selected word or phrase"),
  part_of_speech: z.string().describe("Part of speech as used in this sentence, e.g. noun, verb, idiom"),
  source_language: z.string().describe("BCP-47 code of the book's language, e.g. en, fr, es"),
  ipa: z.string().describe("IPA pronunciation of the word as used here, without slashes"),
  meaning_in_context: z.string().describe("One or two plain sentences explaining what the word means in THIS passage"),
  example: z.string().describe("One short, new example sentence using the word with the same meaning"),
  translation: z.string().describe("Translation of the word in this sense into the requested language, or empty string if none requested"),
  other_meaning_note: z.string().describe("If the word's most common meaning differs from this one, a short note naming it; otherwise empty string"),
});

const Request = z.object({
  word: z.string().trim().min(1).max(80),
  context: z.string().max(3000).default(""),
  targetLanguage: z.string().max(40).default(""),
});

const SYSTEM = `You help readers understand unfamiliar words while reading a book.
You receive a word or short phrase the reader selected and the sentences around it.
Explain the specific sense the passage uses, not every dictionary sense.
Write for a curious reader who may be learning the book's language: short sentences, everyday words, no jargon.
Write the explanation and example in the same language as the book, unless the reader asked for a translation language, in which case write the explanation in that language.
If the selection is a name, a typo or OCR noise, say so briefly in meaning_in_context.`;

let client;
function getClient() {
  client ??= new Anthropic();
  return client;
}

// Tiny per-IP limiter so a public deployment can't be used to burn the API key.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 30;
}

const app = express();
app.use(express.json({ limit: "20kb" }));

app.post("/api/explain", async (req, res) => {
  const parsed = Request.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select a word (up to 80 characters)." });
  if (rateLimited(req.ip)) return res.status(429).json({ error: "Too many lookups. Wait a minute and try again." });

  const { word, context, targetLanguage } = parsed.data;
  const userText = [
    `Selected: "${word}"`,
    `Passage:\n"""\n${context || word}\n"""`,
    targetLanguage ? `Translate into and explain in: ${targetLanguage}` : "No translation needed.",
  ].join("\n\n");

  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: userText }],
      output_config: { format: zodOutputFormat(Explanation) },
    });
    if (!response.parsed_output) return res.status(502).json({ error: "Claude returned an unexpected answer. Try again." });
    res.json({ word, ...response.parsed_output });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      res.status(500).json({ error: "The server's ANTHROPIC_API_KEY is missing or invalid." });
    } else if (error instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "Claude is busy right now. Try again in a moment." });
    } else if (error instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${error.status}: ${error.message}`);
      res.status(502).json({ error: "Claude could not answer. Try again." });
    } else {
      console.error(error);
      const missingKey = /api key|apiKey|authentication/i.test(String(error?.message));
      res.status(500).json({
        error: missingKey ? "Set ANTHROPIC_API_KEY in .env and restart the server." : "Something went wrong on the server.",
      });
    }
  }
});

if (isDev) {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
} else {
  const dist = path.join(here, "dist");
  app.use(express.static(dist));
  app.get("/{*any}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`Smart Reader running at http://localhost:${PORT} (model: ${MODEL})`);
});
