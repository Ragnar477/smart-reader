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
// Local models on a laptop can be slow, but a request that never returns should become an error.
const LOCAL_TIMEOUT_MS = (Number(process.env.LOCAL_LLM_TIMEOUT) || 120) * 1000;

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

// Small local models often wrap JSON in prose, code fences or <think> blocks,
// or leave out fields they had nothing to say about. Be forgiving about all of that.
function parseLocalAnswer(text, schema) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let data;
  try {
    data = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  for (const [key, field] of Object.entries(schema.shape)) {
    if (data[key] == null) data[key] = field instanceof z.ZodArray ? [] : "";
  }
  const parsed = schema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

async function callLocal(body) {
  try {
    return await fetch(`${LOCAL_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new LlmError(504, `The local model took longer than ${LOCAL_TIMEOUT_MS / 1000} seconds. Check that a model is loaded in LM Studio, or try a smaller one.`);
    }
    throw new LlmError(502, `Could not reach the local model at ${LOCAL_URL}. Is LM Studio's server running?`);
  }
}

async function askLocal(task, { system, user, schema }) {
  const started = Date.now();
  console.log(`Asking the local model (${LOCAL_URL}) to explain a ${task}...`);
  const { $schema, ...jsonSchema } = z.toJSONSchema(schema);
  const base = { ...(LOCAL_MODEL && { model: LOCAL_MODEL }), temperature: 0.2 };
  let res = await callLocal({
    ...base,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: { name: `${task}_explanation`, strict: true, schema: jsonSchema } },
  });
  if (res.status === 400) {
    // Some servers or models don't support structured output: ask for JSON in the prompt instead.
    console.warn(`Local model rejected the JSON schema format (${await res.text().catch(() => "")}); retrying without it.`);
    res = await callLocal({
      ...base,
      messages: [
        { role: "system", content: `${system}\n\nReply with only a JSON object that matches this JSON schema, no other text:\n${JSON.stringify(jsonSchema)}` },
        { role: "user", content: user },
      ],
    });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`Local model error ${res.status}: ${detail}`);
    const reason = detail.match(/"(?:message|error)"\s*:\s*"([^"]{1,160})/)?.[1];
    throw new LlmError(502, `The local model could not answer${reason ? `: ${reason}` : ""}.`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new LlmError(504, "The local model stopped before finishing its answer. Try again.");
  }
  const text = body.choices?.[0]?.message?.content ?? "";
  const result = parseLocalAnswer(text, schema);
  if (!result) {
    console.error(`Local model answer did not match the expected format:\n${text.slice(0, 1000)}`);
    throw new LlmError(502, "The local model returned an answer in the wrong format. Try again, or try another model.");
  }
  console.log(`Local model answered a ${task} lookup in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return result;
}

export function ask(task, request) {
  return PROVIDER === "local" ? askLocal(task, request) : askClaude(task, request);
}
