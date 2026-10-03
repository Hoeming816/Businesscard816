// meeting-notes: summarises notes + transcript with Claude, and optionally
// transcribes a recording with Whisper through the Vercel AI Gateway
// (AI_GATEWAY_API_KEY), or OpenAI directly (OPENAI_API_KEY).
import { HttpError, json, requireCaller, requireFeature, serve } from "../_shared/http.ts";
import { structuredReply } from "../_shared/claude.ts";
import { LEAD_STATUSES } from "../_shared/taxonomy.js";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Whisper's upload limit

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "key_points", "action_items", "follow_up_on", "lead_status"],
  properties: {
    summary: { type: "string" },
    key_points: { type: "array", items: { type: "string" } },
    action_items: { type: "array", items: { type: "string" } },
    follow_up_on: { type: "string" },
    lead_status: { type: "string" },
  },
};

const SYSTEM = `You summarise a salesperson's notes and conversation transcripts about one business contact, for the team's shared contact history.

Return:
- summary: 3 to 6 plain sentences covering what was discussed, decisions, the contact's needs or objections, and where the opportunity stands.
- key_points: the main points raised, one short line each, in the order they came up (prices, quantities, dates, decisions, concerns). Empty list if none.
- action_items: short imperative tasks with an owner when one is clear ("Send revised CCTV quote to Maria"). Empty list if none.
- follow_up_on: a suggested next follow-up date as YYYY-MM-DD, based on what was agreed (or a sensible default of about one week after the meeting date when a follow-up is implied). Empty string if no follow-up makes sense.
- lead_status: the most fitting status from ${LEAD_STATUSES.map((s) => `"${s}"`).join(", ")} after this conversation, or an empty string if the notes give no signal.

Write summary, key_points and action_items in the language the conversation was held in. If it is in Chinese, write in Chinese; if it mixes languages (for example English and Chinese), keep that mix as the speakers did, and keep names, product terms and numbers exactly as spoken. Do not translate.

Only use what is in the notes and transcript; do not invent facts. A transcript from live speech recognition may contain recognition errors, so read it for meaning.`;

async function summarise(body: Record<string, unknown>) {
  const notes = String(body.notes ?? "").trim();
  const transcript = String(body.transcript ?? "").trim();
  if (!notes && !transcript) throw new HttpError(400, "Add some notes or a transcript first.");

  const contact = (body.contact ?? {}) as Record<string, string | null>;
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(body.today)) ? String(body.today) : new Date().toISOString().slice(0, 10);
  const header = [
    `Meeting date: ${today}`,
    `Entry type: ${body.kind ?? "Meeting"}`,
    `Contact: ${[contact.full_name, contact.job_title, contact.company].filter(Boolean).join(", ") || "none linked (a general meeting)"}`,
    `Current lead status: ${contact.lead_status || "not set"}`,
  ].join("\n");

  const result = await structuredReply<{
    summary: string; key_points: string[]; action_items: string[]; follow_up_on: string; lead_status: string;
  }>({
    system: SYSTEM,
    content: [{
      type: "text",
      text: `${header}\n\n<notes>\n${notes || "(none)"}\n</notes>\n\n<transcript>\n${transcript || "(none)"}\n</transcript>`,
    }],
    schema: SUMMARY_SCHEMA,
  });

  return {
    summary: result.summary.trim(),
    key_points: result.key_points.map((a) => a.trim()).filter(Boolean),
    action_items: result.action_items.map((a) => a.trim()).filter(Boolean),
    follow_up_on: /^\d{4}-\d{2}-\d{2}$/.test(result.follow_up_on) ? result.follow_up_on : null,
    lead_status: LEAD_STATUSES.includes(result.lead_status) ? result.lead_status : null,
  };
}

// Speech to text. Uses the Vercel AI Gateway key when it is set (the same key the
// summaries use), and OpenAI's own API with OPENAI_API_KEY otherwise or as a fallback.
const TRANSCRIBE_MODEL = Deno.env.get("AI_GATEWAY_TRANSCRIBE_MODEL") || "openai/whisper-1";

function toBase64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function viaGateway(key: string, audio: File, language: string) {
  const res = await fetch("https://ai-gateway.vercel.sh/v4/ai/transcription-model", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "ai-gateway-protocol-version": "0.0.1",
      "ai-transcription-model-specification-version": "4",
      "ai-model-id": TRANSCRIBE_MODEL,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio: toBase64(new Uint8Array(await audio.arrayBuffer())),
      mediaType: audio.type || "audio/webm",
      ...(language ? { providerOptions: { openai: { language } } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${await res.text()}`);
  return String((await res.json()).text ?? "");
}

async function viaOpenAI(key: string, audio: File, language: string) {
  const upstream = new FormData();
  upstream.append("file", audio, audio.name || "recording.webm");
  upstream.append("model", "whisper-1");
  if (language) upstream.append("language", language);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: upstream,
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  return String((await res.json()).text ?? "");
}

async function transcribe(form: FormData) {
  const gatewayKey = Deno.env.get("AI_GATEWAY_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!gatewayKey && !openaiKey) {
    throw new HttpError(501, "Transcription is not set up. Add the AI_GATEWAY_API_KEY (or OPENAI_API_KEY) secret, or use the live transcript.");
  }
  const audio = form.get("audio");
  if (!(audio instanceof File)) throw new HttpError(400, "No recording was sent.");
  if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, "This recording is too long to transcribe (25 MB limit).");
  const lang = String(form.get("language") ?? "").slice(0, 2).toLowerCase();
  const language = /^[a-z]{2}$/.test(lang) ? lang : ""; // empty: the model detects it (mixed English/Chinese)

  const attempts: [string, (k: string, a: File, l: string) => Promise<string>][] = [];
  if (gatewayKey) attempts.push([gatewayKey, viaGateway]);
  if (openaiKey) attempts.push([openaiKey, viaOpenAI]);
  for (const [key, run] of attempts) {
    try {
      return { transcript: (await run(key, audio, language)).trim() };
    } catch (e) {
      console.error("transcription error", e instanceof Error ? e.message : e);
    }
  }
  throw new HttpError(502, "Transcription failed. Please try again.");
}

serve(async (req) => {
  requireFeature(await requireCaller(req), "meeting", "Meeting");
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    if (form.get("action") !== "transcribe") throw new HttpError(400, "Unknown action.");
    return json(await transcribe(form));
  }
  const body = await req.json().catch(() => ({}));
  if (body.action === "summarise") return json(await summarise(body));
  throw new HttpError(400, "Unknown action.");
});
