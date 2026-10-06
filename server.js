// Small server that keeps model API keys off the browser.
// `npm run dev` serves the React app through Vite; `npm start` serves the built app from dist/.
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ask, describeModels, LlmError } from "./llm.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--dev");
const PORT = Number(process.env.PORT) || 5173;

const Explanation = z.object({
  lemma: z.string().describe("Dictionary form of the selected word or phrase"),
  part_of_speech: z.string().describe("Part of speech as used in this sentence, e.g. noun, verb, idiom"),
  source_language: z.string().describe("BCP-47 code of the book's language, e.g. en, fr, es"),
  ipa: z.string().describe("IPA pronunciation of the word as used here, without slashes"),
  meaning_in_context: z.string().describe("One or two plain sentences explaining what the word means in THIS passage, in the reader's language"),
  example: z.string().describe("One short, new example sentence in the book's language using the word with the same meaning"),
  translation: z.string().describe("The word in this sense translated into the reader's language, or empty string if the reader's language is the book's language or not given"),
  other_meaning_note: z.string().describe("If the word's most common meaning differs from this one, a short note in the reader's language naming it; otherwise empty string"),
});

const PassageExplanation = z.object({
  source_language: z.string().describe("BCP-47 code of the passage's language"),
  summary: z.string().describe("One or two sentences in the reader's language saying what the passage means"),
  simpler_version: z.string().describe("The passage rewritten in the book's language with simpler words and shorter sentences, same meaning"),
  translation: z.string().describe("Faithful translation of the passage into the reader's language, or empty string if the reader's language is the book's language or not given"),
  grammar_notes: z
    .array(z.object({ phrase: z.string().describe("Exact phrase from the passage"), note: z.string().describe("Short grammar explanation in the reader's language") }))
    .describe("One to four grammar points a learner would find hard, most useful first"),
  key_words: z
    .array(z.object({ word: z.string().describe("Word or expression from the passage"), meaning: z.string().describe("Its meaning here, in the reader's language") }))
    .describe("Up to five harder words or expressions from the passage"),
});

const language = z.string().max(40).default("");
const WordRequest = z.object({
  word: z.string().trim().min(1).max(80),
  context: z.string().max(3000).default(""),
  nativeLanguage: language,
  targetLanguage: language, // v1 name for nativeLanguage
});
const PassageRequest = z.object({
  text: z.string().trim().min(1).max(2000),
  context: z.string().max(4000).default(""),
  nativeLanguage: language,
});

function readerLanguage(nativeLanguage) {
  return nativeLanguage
    ? `The reader's own language is ${nativeLanguage}. Write every explanation, note and translation in ${nativeLanguage}, even when the book is in another language.`
    : "The reader did not give their own language. Write explanations in the same language as the book and leave translations empty.";
}

const WORD_SYSTEM = `You help people understand unfamiliar words while reading a book, often in a language they are learning.
You receive a word or short phrase the reader selected and the sentences around it.
Explain the specific sense the passage uses, not every dictionary sense.
Write for a learner: short sentences, everyday words, no jargon.
The example sentence is always in the book's language, so the reader sees the word used again.
If the selection is a name, a typo or OCR noise, say so briefly in meaning_in_context.`;

const PASSAGE_SYSTEM = `You help people understand difficult passages while reading a book, often in a language they are learning.
You receive a passage the reader selected and, when available, the text around it.
Explain what the passage means, rewrite it more simply in the book's language, and point out the grammar a learner would stumble on.
Write for a learner: short sentences, everyday words, no jargon. Never add facts that are not in the text.`;

// Repeat lookups (same word, same sentence, same language) are answered from memory.
const CACHE_SIZE = 500;
const cache = new Map();
async function cached(key, compute) {
  if (cache.has(key)) {
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }
  const value = await compute();
  cache.set(key, value);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return value;
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

function sendError(res, error) {
  if (error instanceof LlmError) return res.status(error.status).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: "Something went wrong on the server." });
}

const app = express();
app.use(express.json({ limit: "20kb" }));

app.post("/api/explain", async (req, res) => {
  const parsed = WordRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select a word (up to 80 characters)." });
  if (rateLimited(req.ip)) return res.status(429).json({ error: "Too many lookups. Wait a minute and try again." });

  const { word, context } = parsed.data;
  const nativeLanguage = parsed.data.nativeLanguage || parsed.data.targetLanguage;
  const user = [`Selected: "${word}"`, `Passage:\n"""\n${context || word}\n"""`, readerLanguage(nativeLanguage)].join("\n\n");
  try {
    const result = await cached(JSON.stringify(["word", word.toLowerCase(), context, nativeLanguage]), () =>
      ask("word", { system: WORD_SYSTEM, user, schema: Explanation }),
    );
    res.json({ word, ...result });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/explain-passage", async (req, res) => {
  const parsed = PassageRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select a passage of up to 2,000 characters." });
  if (rateLimited(req.ip)) return res.status(429).json({ error: "Too many lookups. Wait a minute and try again." });

  const { text, context, nativeLanguage } = parsed.data;
  const user = [
    `Selected passage:\n"""\n${text}\n"""`,
    context && context !== text ? `Surrounding text:\n"""\n${context}\n"""` : "",
    readerLanguage(nativeLanguage),
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const result = await cached(JSON.stringify(["passage", text, nativeLanguage]), () =>
      ask("passage", { system: PASSAGE_SYSTEM, user, schema: PassageExplanation }),
    );
    res.json({ text, ...result });
  } catch (error) {
    sendError(res, error);
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
  console.log(`Smart Reader running at http://localhost:${PORT} (model: ${describeModels()})`);
});
