// Anthropic client and a helper for schema-constrained JSON responses.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { HttpError } from "./http.ts";

export const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";

// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    throw new HttpError(500, "AI reading is not configured: set the ANTHROPIC_API_KEY secret.");
  }
  client ??= new Anthropic();
  return client;
}

// Sends one request whose reply must match `schema`, and returns the parsed object.
export async function structuredReply<T>(opts: {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<T> {
  const params: Record<string, unknown> = {
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
    output_config: {
      effort: opts.effort ?? "medium",
      format: { type: "json_schema", schema: opts.schema },
    },
  };
  if (FALLBACK_MODELS.has(MODEL)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }

  let response;
  try {
    // deno-lint-ignore no-explicit-any
    response = await anthropic().beta.messages.create(params as any);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpError(429, "The AI service is busy. Please try again in a moment.");
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new HttpError(500, "The ANTHROPIC_API_KEY secret is invalid.");
    }
    if (err instanceof Anthropic.NotFoundError || err instanceof Anthropic.BadRequestError) {
      console.error(err);
      throw new HttpError(500, `The AI request was rejected (model "${MODEL}"). Check ANTHROPIC_MODEL.`);
    }
    if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
      throw new HttpError(502, "Could not reach the AI service. Please try again.");
    }
    throw err;
  }

  if (response.stop_reason === "refusal") {
    throw new HttpError(422, "The AI declined to read this. Please enter the details manually.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new HttpError(502, "The AI reply was cut off. Please try again.");
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, "The AI reply could not be understood. Please try again.");
  }
}
