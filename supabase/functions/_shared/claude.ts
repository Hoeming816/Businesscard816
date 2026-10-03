// Anthropic client and a helper for schema-constrained JSON responses.
// Calls Claude directly with ANTHROPIC_API_KEY, or through Vercel AI Gateway
// when AI_GATEWAY_API_KEY is set (billing then goes through Vercel).
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { HttpError } from "./http.ts";

const GATEWAY_KEY = Deno.env.get("AI_GATEWAY_API_KEY");
const GATEWAY_URL = "https://ai-gateway.vercel.sh";
const VIA_GATEWAY = Boolean(GATEWAY_KEY);

const BASE_MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";

// AI Gateway names models "anthropic/claude-sonnet-5.5"; derive that from the
// Anthropic id unless AI_GATEWAY_MODEL overrides it.
function gatewayModel(id: string): string {
  if (id.includes("/")) return id;
  return `anthropic/${id.replace(/-(\d+)-(\d+)$/, "-$1.$2")}`;
}

export const MODEL = VIA_GATEWAY ? (Deno.env.get("AI_GATEWAY_MODEL") || gatewayModel(BASE_MODEL)) : BASE_MODEL;

// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (VIA_GATEWAY) {
    client ??= new Anthropic({ apiKey: GATEWAY_KEY, baseURL: GATEWAY_URL });
    return client;
  }
  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    throw new HttpError(500, "AI reading is not configured: set the ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY secret.");
  }
  client ??= new Anthropic();
  return client;
}

// Pulls the JSON object out of a text reply (tolerates code fences or prose).
function parseJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("no JSON object");
  return JSON.parse(text.slice(start, end + 1)) as T;
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
  };
  if (VIA_GATEWAY) {
    // The gateway's Anthropic-compatible endpoint may not pass through
    // structured outputs or beta features, so ask for the JSON in the prompt.
    params.system = `${opts.system}\n\nReply with only a JSON object (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(opts.schema)}`;
  } else {
    params.output_config = {
      effort: opts.effort ?? "medium",
      format: { type: "json_schema", schema: opts.schema },
    };
  }
  if (!VIA_GATEWAY && FALLBACK_MODELS.has(MODEL)) {
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
      throw new HttpError(500, VIA_GATEWAY ? "The AI_GATEWAY_API_KEY secret is invalid." : "The ANTHROPIC_API_KEY secret is invalid.");
    }
    if (err instanceof Anthropic.NotFoundError || err instanceof Anthropic.BadRequestError) {
      console.error(err);
      throw new HttpError(500, `The AI request was rejected (model "${MODEL}"). Check ${VIA_GATEWAY ? "AI_GATEWAY_MODEL" : "ANTHROPIC_MODEL"}.`);
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
    return parseJson<T>(text);
  } catch {
    throw new HttpError(502, "The AI reply could not be understood. Please try again.");
  }
}
