// todo-ai: turns a typed or spoken sentence into a task for the To Do List
// ("Remind me to call Peter tomorrow 10am" -> title, date, time, reminders).
// Works in English, Mandarin and Tagalog/Taglish: the task keeps the language
// it was said in, and dates and times are read whatever the language.
// Voice is transcribed through the Vercel AI Gateway (AI_GATEWAY_API_KEY), or
// OpenAI directly (OPENAI_API_KEY), with the spoken language detected.
import { HttpError, json, requireCaller, requireFeature, serve } from "../_shared/http.ts";
import { structuredReply } from "../_shared/claude.ts";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const PRIORITIES = ["Urgent", "High", "Normal", "Low"];
const CATEGORIES = ["Work", "Personal", "Finance", "Family", "Health", "Errands"];
const FREQS = ["", "daily", "weekly", "monthly", "yearly"];

const TASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "notes", "due_on", "due_time", "priority", "reminders", "repeat_freq", "repeat_interval", "repeat_days", "category", "tags", "subtasks"],
  properties: {
    title: { type: "string" },
    notes: { type: "string" },
    due_on: { type: "string" },
    due_time: { type: "string" },
    priority: { type: "string", enum: PRIORITIES },
    reminders: { type: "array", items: { type: "integer" } },
    repeat_freq: { type: "string", enum: FREQS },
    repeat_interval: { type: "integer" },
    repeat_days: { type: "array", items: { type: "integer" } },
    category: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    subtasks: { type: "array", items: { type: "string" } },
  },
};

const SYSTEM = `You turn one sentence someone typed or said into a task for their to-do list. It may be in English, Mandarin Chinese, or Tagalog (including Taglish, Tagalog mixed with English).

Return:
- title: the task itself as a short imperative ("Call Peter", "Send quotation to Acme", "打电话给Peter", "Tawagan si Peter"). Write it in the language the person used (for Taglish keep their mix). Leave out the date, time, repeat, priority words and lead-ins such as "remind me to", "提醒我", "paalala", "pakipaalala".
- notes: any extra detail that is not part of the title (who, what to bring, numbers); empty string if none.
- due_on: the date as YYYY-MM-DD, worked out from today's date given below ("tomorrow"/"明天"/"bukas", "Friday"/"星期五"/"周五"/"Biyernes", "next week", "on the 15th"). Empty string if no day was said. A weekday means the next one from today (today itself if it is that day).
- due_time: 24-hour HH:MM when a time was said ("10am", "下午三点" = 15:00, "alas tres ng hapon" = 15:00, "mamayang gabi" = 20:00 today, "morning"/"早上"/"umaga" = 09:00). Empty string if none. If only a time was said, due_on is today when that time is still ahead, otherwise tomorrow.
- priority: Urgent when it says urgent, ASAP, 紧急, 急, "agad", "importante agad"; High for important or high priority, 重要; Low for low priority or "whenever"; otherwise Normal.
- reminders: minutes before the deadline to remind them, largest first. When they asked for reminders ("remind me an hour before" = 60, "提前一天" = 1440), use those. Otherwise, when there is a due time: [15, 0], adding 60 for High and 1440 and 60 for Urgent. When there is only a date: [0], adding 1440 for High or Urgent. No date: [].
- repeat_freq: "daily", "weekly", "monthly" or "yearly" for a repeating task ("every Monday", "每天", "araw-araw", "tuwing Lunes"); empty string if it does not repeat. repeat_interval: every how many (1 unless "every 2 weeks" and so on). repeat_days: for weekly, the weekdays as numbers (0 = Sunday ... 6 = Saturday), e.g. weekdays = [1,2,3,4,5]; otherwise []. A repeating task needs due_on: its first date from today.
- category: one of ${CATEGORIES.join(", ")} when it clearly fits; otherwise an empty string.
- tags: a few short keywords only when they name a customer, project or place (e.g. "Acme"); usually [].
- subtasks: steps only when the sentence lists several things to do for this one task; usually [].

Only use what is in the sentence; never invent people, dates or details.`;

type Raw = {
  title: string; notes: string; due_on: string; due_time: string; priority: string; reminders: number[];
  repeat_freq: string; repeat_interval: number; repeat_days: number[]; category: string; tags: string[]; subtasks: string[];
};

const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");
const isoTime = (v: unknown) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? "")) ? String(v) : "");
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function parse(textIn: unknown, todayIn: unknown, timeIn: unknown) {
  const text = String(textIn ?? "").trim().slice(0, 1000);
  if (!text) throw new HttpError(400, "Say or type the task first.");
  const today = isoDate(todayIn) || new Date().toISOString().slice(0, 10);
  const time = isoTime(timeIn) || "09:00";
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];

  const r = await structuredReply<Raw>({
    system: SYSTEM,
    content: [{ type: "text", text: `Today is ${weekday} ${today}, and the time is ${time}.\n\n<sentence>\n${text}\n</sentence>` }],
    schema: TASK_SCHEMA,
    maxTokens: 2000,
    effort: "low",
  });

  const due_on = isoDate(r.due_on) || null;
  const freq = FREQS.includes(r.repeat_freq) ? r.repeat_freq : "";
  const days = Array.isArray(r.repeat_days) ? [...new Set(r.repeat_days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : [];
  const repeat = freq && due_on
    ? { freq, interval: Math.min(99, Math.max(1, Math.round(Number(r.repeat_interval) || 1))), ...(freq === "weekly" && days.length ? { days } : {}), ...(freq === "monthly" ? { day: Number(due_on.slice(8)) } : {}) }
    : null;
  const strs = (a: unknown, n: number) => (Array.isArray(a) ? a.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, n) : []);
  return {
    title: String(r.title ?? "").trim().slice(0, 300) || text.slice(0, 300),
    notes: String(r.notes ?? "").trim(),
    due_on,
    due_time: due_on ? isoTime(r.due_time) || null : null,
    priority: PRIORITIES.includes(r.priority) ? r.priority : "Normal",
    reminders: due_on && Array.isArray(r.reminders)
      ? [...new Set(r.reminders.map(Number).filter((m) => Number.isInteger(m) && m >= 0 && m <= 60 * 24 * 60))].sort((a, b) => b - a).slice(0, 10)
      : [],
    repeat,
    category: CATEGORIES.includes(r.category) ? r.category : null,
    tags: strs(r.tags, 10).map((t) => t.replace(/^#/, "")),
    subtasks: strs(r.subtasks, 20),
  };
}

// ---------------------------------------------------------------------------
// Speech to text (language detected: English, Mandarin, Tagalog, Taglish)
// ---------------------------------------------------------------------------

const TRANSCRIBE_MODEL = Deno.env.get("AI_GATEWAY_TRANSCRIBE_MODEL") || "openai/whisper-1";

function toBase64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function viaGateway(key: string, audio: File) {
  const res = await fetch("https://ai-gateway.vercel.sh/v4/ai/transcription-model", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "ai-gateway-protocol-version": "0.0.1",
      "ai-transcription-model-specification-version": "4",
      "ai-model-id": TRANSCRIBE_MODEL,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ audio: toBase64(new Uint8Array(await audio.arrayBuffer())), mediaType: audio.type || "audio/webm" }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${await res.text()}`);
  return String((await res.json()).text ?? "");
}

async function viaOpenAI(key: string, audio: File) {
  const form = new FormData();
  form.append("file", audio, audio.name || "task.webm");
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  return String((await res.json()).text ?? "");
}

async function transcribe(audio: File) {
  const gatewayKey = Deno.env.get("AI_GATEWAY_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!gatewayKey && !openaiKey) throw new HttpError(501, "Voice is not set up. Add the AI_GATEWAY_API_KEY (or OPENAI_API_KEY) secret.");
  const attempts: [string, (k: string, a: File) => Promise<string>][] = [];
  if (gatewayKey) attempts.push([gatewayKey, viaGateway]);
  if (openaiKey) attempts.push([openaiKey, viaOpenAI]);
  for (const [key, run] of attempts) {
    try {
      return (await run(key, audio)).trim();
    } catch (e) {
      console.error("transcription error", e instanceof Error ? e.message : e);
    }
  }
  throw new HttpError(502, "Could not hear that. Please try again.");
}

serve(async (req) => {
  requireFeature(await requireCaller(req), "todo", "To Do List");
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    if (form.get("action") !== "voice") throw new HttpError(400, "Unknown action.");
    const audio = form.get("audio");
    if (!(audio instanceof File) || !audio.size) throw new HttpError(400, "No recording was sent.");
    if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, "That recording is too long for a task.");
    const text = await transcribe(audio);
    if (!text) throw new HttpError(422, "Nothing was heard. Please try again.");
    return json({ text, task: await parse(text, form.get("today"), form.get("time")) });
  }
  const body = await req.json().catch(() => ({}));
  if (body.action === "parse") return json({ task: await parse(body.text, body.today, body.time) });
  throw new HttpError(400, "Unknown action.");
});
