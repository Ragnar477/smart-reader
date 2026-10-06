// Model providers behind one function: ask(task, { system, user, schema }) -> parsed object.
// LLM_PROVIDER=claude (default) uses the Anthropic API; LLM_PROVIDER=local uses any
// OpenAI-compatible local server such as LM Studio or Ollama.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const PROVIDER = (process.env.LLM_PROVIDER || "claude").toLowerCase();

// Word lookups are short and frequent, so they use the cheapest model; passages need more reasoning.
const CLAUDE_MODELS = {
  word: process.env.CLAUDE_MODEL || "claude-haiku-4-5",
  passage: process.env.CLAUDE_PASSAGE_MODEL || "claude-sonnet-5-5",
};
const LOCAL_URL = (process.env.LOCAL_LLM_URL || "http://localhost:1234/v1").replace(/\/$/, "");
const LOCAL_MODEL = process.env.LOCAL_LLM_MODEL || "";

export class LlmError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function describeModels() {
  return PROVIDER === "local"
    ? `local (${LOCAL_URL}${LOCAL_MODEL ? `, ${LOCAL_MODEL}` : ""})`
    : `claude (${CLAUDE_MODELS.word} for words, ${CLAUDE_MODELS.passage} for passages)`;
}

let client;
async function askClaude(task, { system, user, schema }) {
  client ??= new Anthropic();
  const model = CLAUDE_MODELS[task];
  // Haiku 4.5 rejects the effort setting; newer models accept it, and low effort keeps passages fast.
  const effort = model.startsWith("claude-haiku") ? {} : { effort: "low" };
  try {
    const response = await client.messages.parse({
      model,
      max_tokens: task === "passage" ? 4096 : 1024,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(schema), ...effort },
    });
    if (response.stop_reason === "refusal") throw new LlmError(422, "Claude declined to explain this text.");
    if (!response.parsed_output) throw new LlmError(502, "Claude returned an unexpected answer. Try again.");
    return response.parsed_output;
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (error instanceof Anthropic.AuthenticationError) {
      throw new LlmError(500, "The server's ANTHROPIC_API_KEY is missing or invalid.");
    }
    if (error instanceof Anthropic.RateLimitError) throw new LlmError(429, "Claude is busy right now. Try again in a moment.");
    if (error instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${error.status}: ${error.message}`);
      throw new LlmError(502, "Claude could not answer. Try again.");
    }
    if (/api key|apiKey|authentication/i.test(String(error?.message))) {
      throw new LlmError(500, "Set ANTHROPIC_API_KEY in .env and restart the server.");
    }
    throw error;
  }
}

async function askLocal(task, { system, user, schema }) {
  let res;
  try {
    res = await fetch(`${LOCAL_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(LOCAL_MODEL && { model: LOCAL_MODEL }),
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: `${task}_explanation`, strict: true, schema: z.toJSONSchema(schema) },
        },
      }),
    });
  } catch {
    throw new LlmError(502, `Could not reach the local model at ${LOCAL_URL}. Is LM Studio's server running?`);
  }
  if (!res.ok) {
    console.error(`Local model error ${res.status}: ${await res.text().catch(() => "")}`);
    throw new LlmError(502, "The local model could not answer. Try again.");
  }
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content ?? "";
  try {
    // Some local models wrap JSON in a code fence despite the schema.
    return schema.parse(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")));
  } catch {
    throw new LlmError(502, "The local model returned an unexpected answer. Try again.");
  }
}

export function ask(task, request) {
  return PROVIDER === "local" ? askLocal(task, request) : askClaude(task, request);
}
