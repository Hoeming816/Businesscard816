// meeting-notes: summarises notes + transcript with Claude, writes typed
// meeting minutes and answers questions about a meeting, and optionally
// transcribes a recording with Whisper through the Vercel AI Gateway
// (AI_GATEWAY_API_KEY), or OpenAI directly (OPENAI_API_KEY).
import { HttpError, json, requireCaller, requireFeature, serve } from "../_shared/http.ts";
import { structuredReply } from "../_shared/claude.ts";
import { ACTION_PRIORITIES, LEAD_STATUSES, MEETING_TYPES } from "../_shared/taxonomy.js";

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

Leave out small talk, jokes and topics unrelated to the business discussed.

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

// ---------------------------------------------------------------------------
// Meeting minutes: the AI outputs for a typed meeting, focused by its type.
// ---------------------------------------------------------------------------

const list = { type: "array", items: { type: "string" } };
const MINUTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["quick_summary", "chairperson", "attendees", "location", "agenda", "discussion", "decisions", "action_items", "issues", "next_steps", "next_meeting", "follow_up"],
  properties: {
    quick_summary: list,
    chairperson: { type: "string" },
    attendees: list,
    location: { type: "string" },
    agenda: list,
    discussion: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "points"],
        properties: { topic: { type: "string" }, points: list },
      },
    },
    decisions: list,
    action_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "assigned_to", "due", "priority"],
        properties: {
          action: { type: "string" },
          assigned_to: { type: "string" },
          due: { type: "string" },
          priority: { type: "string", enum: ACTION_PRIORITIES },
        },
      },
    },
    issues: list,
    next_steps: list,
    next_meeting: { type: "string" },
    follow_up: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "status", "note"],
        properties: {
          ref: { type: "string" },
          status: { type: "string", enum: ["completed", "discussed"] },
          note: { type: "string" },
        },
      },
    },
  },
};

const MINUTES_SYSTEM = `You write the minutes of a business meeting from its transcript and the organiser's notes. Formal minutes are the main output: classify what was said into the right sections rather than retelling the conversation in order.

Return:
- quick_summary: 5 to 10 short bullets for someone who was not at the meeting.
- chairperson: who chaired or led the meeting, if clear; otherwise an empty string.
- attendees: the people who took part, by name or role as they were referred to. Empty list if unknown.
- location: where it was held, if mentioned; otherwise an empty string.
- agenda: the topics covered, as short headings in the order they came up.
- discussion: one entry per agenda topic, with the main points made, one short line each.
- decisions: each decision actually agreed, one clear sentence each ("Proceed with Supplier A."). Do not list suggestions that were not agreed.
- action_items: each task someone committed to: action (short imperative), assigned_to (a person or team; empty string if nobody was named), due (YYYY-MM-DD when a date or relative day was given, worked out from the meeting date; empty string otherwise), priority (High, Medium or Low, judged from urgency and impact).
- issues: unresolved issues, risks and concerns that need follow-up.
- next_steps: what happens next, beyond the individual action items.
- next_meeting: when the next meeting is, as said (a date as YYYY-MM-DD when one was given); empty string if not mentioned.
- follow_up: for each open action item from earlier meetings (listed in <earlier_actions>, each with a ref) that this meeting talked about: its ref, status "completed" when the meeting says it is done, otherwise "discussed", and a short note of what was said about it. Leave out items the meeting did not mention. Empty list if there are none.

The meeting type tells you what to concentrate on; give those things the most care and detail.

Leave out everything that is not business: small talk, jokes and banter, personal chat, and topics unrelated to the meeting's purpose. They must not appear in any field, not even as an agenda item or a passing mention. The full transcript is kept separately, so nothing is lost by leaving them out.

Write in the language the meeting was held in. If it is in Chinese, write in Chinese; if it mixes languages (for example English and Chinese), keep that mix as the speakers did, and keep names, product terms and numbers exactly as spoken. Do not translate.

Only use what is in the transcript and notes; never invent names, dates, figures or decisions. Leave a field empty rather than guess. A transcript from speech recognition may contain recognition errors, so read it for meaning.`;

type Earlier = { ref: string; action: string; assigned_to?: string; due?: string; meeting?: string; date?: string };

// Open action items from earlier meetings, for the AI to check off.
function earlierBlock(body: Record<string, unknown>) {
  const items = (Array.isArray(body.earlier_actions) ? body.earlier_actions : []).slice(0, 60) as Earlier[];
  if (!items.length) return { text: "", refs: new Set<string>() };
  const lines = items.map((a) =>
    `- ref ${String(a.ref).slice(0, 80)}: ${String(a.action ?? "").slice(0, 300)}` +
    `${a.assigned_to ? ` (assigned to ${String(a.assigned_to).slice(0, 80)})` : ""}` +
    `${a.due ? `, due ${String(a.due).slice(0, 10)}` : ""}` +
    `${a.meeting ? `, from "${String(a.meeting).slice(0, 120)}"` : ""}${a.date ? ` on ${String(a.date).slice(0, 10)}` : ""}`
  );
  return { text: `\n\n<earlier_actions>\n${lines.join("\n")}\n</earlier_actions>`, refs: new Set(items.map((a) => String(a.ref))) };
}

type Minutes = {
  quick_summary: string[]; chairperson: string; attendees: string[]; location: string; agenda: string[];
  discussion: { topic: string; points: string[] }[]; decisions: string[];
  action_items: { action: string; assigned_to: string; due: string; priority: string }[];
  issues: string[]; next_steps: string[]; next_meeting: string;
  follow_up: { ref: string; status: string; note: string }[];
};

const clean = (a: unknown) => (Array.isArray(a) ? a.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");

function meetingHeader(body: Record<string, unknown>) {
  const type = MEETING_TYPES.find((t: { value: string }) => t.value === body.meeting_type) ?? MEETING_TYPES[0];
  const contact = (body.contact ?? {}) as Record<string, string | null>;
  const date = isoDate(body.date) || new Date().toISOString().slice(0, 10);
  return [
    `Meeting: ${String(body.title ?? "").trim() || type.value}`,
    `Meeting type: ${type.value}. Concentrate on: ${type.focus}.`,
    `Date: ${date}`,
    body.time ? `Time: ${String(body.time).slice(0, 40)}` : "",
    `Contact: ${[contact.full_name, contact.job_title, contact.company].filter(Boolean).join(", ") || "none linked"}`,
  ].filter(Boolean).join("\n");
}

function requireText(body: Record<string, unknown>) {
  const notes = String(body.notes ?? "").trim();
  const transcript = String(body.transcript ?? "").trim();
  if (!notes && !transcript) throw new HttpError(400, "There is no transcript or notes to work from yet.");
  return `<notes>\n${notes || "(none)"}\n</notes>\n\n<transcript>\n${transcript || "(none)"}\n</transcript>`;
}

async function minutes(body: Record<string, unknown>) {
  const earlier = earlierBlock(body);
  const r = await structuredReply<Minutes>({
    system: MINUTES_SYSTEM,
    content: [{ type: "text", text: `${meetingHeader(body)}\n\n${requireText(body)}${earlier.text}` }],
    schema: MINUTES_SCHEMA,
    effort: "high",
  });
  return {
    quick_summary: clean(r.quick_summary),
    chairperson: String(r.chairperson ?? "").trim(),
    attendees: clean(r.attendees),
    location: String(r.location ?? "").trim(),
    agenda: clean(r.agenda),
    discussion: (Array.isArray(r.discussion) ? r.discussion : [])
      .map((d) => ({ topic: String(d?.topic ?? "").trim(), points: clean(d?.points) }))
      .filter((d) => d.topic || d.points.length),
    decisions: clean(r.decisions),
    action_items: (Array.isArray(r.action_items) ? r.action_items : [])
      .map((a) => ({
        action: String(a?.action ?? "").trim(),
        assigned_to: String(a?.assigned_to ?? "").trim(),
        due: isoDate(a?.due),
        priority: ACTION_PRIORITIES.includes(a?.priority) ? a.priority : "Medium",
      }))
      .filter((a) => a.action),
    issues: clean(r.issues),
    next_steps: clean(r.next_steps),
    next_meeting: String(r.next_meeting ?? "").trim(),
    follow_up: (Array.isArray(r.follow_up) ? r.follow_up : [])
      .filter((f) => earlier.refs.has(String(f?.ref)))
      .map((f) => ({ ref: String(f.ref), status: f.status === "completed" ? "completed" : "discussed", note: String(f.note ?? "").trim() })),
  };
}

const ASK_SYSTEM = `You answer questions about one business meeting for the person who recorded it, using its transcript, notes and minutes. You can also draft things from it when asked, such as an email to attendees with the agreed action items, or a short management report.

Answer directly and briefly, in plain text without Markdown headings. Use short lists where they help. Quote names, dates and figures exactly as they appear. If the meeting does not contain the answer, say so plainly rather than guess. Reply in the language the question is asked in.`;

async function ask(body: Record<string, unknown>) {
  const question = String(body.question ?? "").trim().slice(0, 2000);
  if (!question) throw new HttpError(400, "Type a question first.");
  const history = (Array.isArray(body.history) ? body.history : []).slice(-6)
    .map((h: { q?: string; a?: string }) => `Earlier question: ${String(h?.q ?? "").slice(0, 2000)}\nYour answer: ${String(h?.a ?? "").slice(0, 4000)}`)
    .join("\n\n");
  const minutesJson = body.minutes ? JSON.stringify(body.minutes).slice(0, 40000) : "(none yet)";
  const r = await structuredReply<{ answer: string }>({
    system: ASK_SYSTEM,
    content: [{
      type: "text",
      text: `${meetingHeader(body)}\n\n<minutes>\n${minutesJson}\n</minutes>\n\n${requireText(body)}${history ? `\n\n${history}` : ""}\n\nQuestion: ${question}`,
    }],
    schema: { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } },
  });
  return { answer: String(r.answer ?? "").trim() };
}

// Speech to text. Uses the Vercel AI Gateway key when it is set (the same key the
// summaries use), and OpenAI's own API with OPENAI_API_KEY otherwise or as a fallback.
const TRANSCRIBE_MODEL = Deno.env.get("AI_GATEWAY_TRANSCRIBE_MODEL") || "openai/whisper-1";

function toBase64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

type Transcript = { text: string; segments: { t: number; text: string }[] };

// Timed lines of the transcript, as { t: seconds from the start, text }.
function toSegments(raw: unknown, startKey: string): Transcript["segments"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => ({ t: Math.max(0, Math.round(Number(s?.[startKey]) * 10) / 10), text: String(s?.text ?? "").trim() }))
    .filter((s) => Number.isFinite(s.t) && s.text);
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
      providerOptions: { openai: { timestampGranularities: ["segment"], ...(language ? { language } : {}) } },
    }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { text: String(data.text ?? ""), segments: toSegments(data.segments, "startSecond") };
}

async function viaOpenAI(key: string, audio: File, language: string) {
  const upstream = new FormData();
  upstream.append("file", audio, audio.name || "recording.webm");
  upstream.append("model", "whisper-1");
  upstream.append("response_format", "verbose_json");
  upstream.append("timestamp_granularities[]", "segment");
  if (language) upstream.append("language", language);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: upstream,
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { text: String(data.text ?? ""), segments: toSegments(data.segments, "start") };
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

  const attempts: [string, (k: string, a: File, l: string) => Promise<Transcript>][] = [];
  if (gatewayKey) attempts.push([gatewayKey, viaGateway]);
  if (openaiKey) attempts.push([openaiKey, viaOpenAI]);
  for (const [key, run] of attempts) {
    try {
      const r = await run(key, audio, language);
      return { transcript: r.text.trim(), segments: r.segments };
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
  if (body.action === "minutes") return json(await minutes(body));
  if (body.action === "ask") return json(await ask(body));
  throw new HttpError(400, "Unknown action.");
});
