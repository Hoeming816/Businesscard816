// notes-ai: Quick Notes by voice. Transcribes a recording, then works out what
// was asked: a new Topic ("Create a new topic, call it Inventory Management
// software"), a note for a Topic ("Add to Cebu trip: book the hotel"), or just
// a note. Notes are written in the voice language picked in the app (English
// unless Chinese or Tagalog is chosen), translated if something else was said.
// The `dictate` action only tidies the words, for adding to a note being edited.
// The `cleanup` action turns a rushed note into a tidy one (a title and points).
// The `actions` action finds things to do in a note ("Need to call James tomorrow
// about the CCTV quotation"), for the "Add to To-Do" offer; it needs the To Do List.
import { HttpError, json, requireCaller, requireFeature, serve } from "../_shared/http.ts";
import { structuredReply } from "../_shared/claude.ts";
import { transcribe, voiceLanguage } from "../_shared/transcribe.ts";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const ACTION_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["title", "due_on", "due_time"],
  properties: { title: { type: "string" }, due_on: { type: "string" }, due_time: { type: "string" } },
};

const VOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "topic", "title", "body", "checklist", "tags", "actions"],
  properties: {
    action: { type: "string", enum: ["note", "topic"] },
    topic: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    checklist: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    actions: { type: "array", items: ACTION_ITEM },
  },
};

const VOICE_SYSTEM = `You help someone keep quick notes by voice. You get what they said (transcribed, so expect small speech-to-text mistakes), the names of their existing topics, and the topic they have open, if any. Topics are folders of notes. They may speak English, Mandarin Chinese, or Tagalog (including Taglish).

Decide what they want:
- action "topic": they asked to create (make, start, add, open) a new topic and said nothing to note in it, e.g. "Create a new topic, call it Inventory Management software", "新建一个主题叫库存管理", "Gumawa ng bagong topic na Cebu trip". topic is the name they gave, exactly as said (keep its language and capitals; no quotes). title, body, checklist and tags are empty.
- action "note": anything else. topic is where the note goes:
  - the topic they named ("add a note inside Inventory Management: …", "add to Cebu trip: …", "in the Acme project topic, note that …", "new topic Cebu trip, first note: …"); when it is clearly one of their topics, even said a little differently (case, a word changed or missing such as "inventory management system" for "Inventory Management software", transcription mistakes, another language), use that topic's name exactly as listed; when it is new, the name they said;
  - otherwise the open topic, when one is open;
  - otherwise an empty string.

For a note:
- body: what they want to remember, cleaned up into clear, well-written sentences with punctuation (fix false starts, "um", repeats and rambling; e.g. "Idea for the inventory system. We should have an alert when stock falls below minimum quantity and automatically notify purchasing." becomes "Add a minimum-stock alert. When inventory falls below the preset quantity, automatically notify Purchasing."). Keep every fact, name, number, date and detail; do not summarise away content. Leave out the instructions to you ("add a note", "write down", "in the topic …", "tag it work"). LANGUAGE_RULE
- title: a short title (2 to 6 words) in the same language naming what it is about ("Inventory System Idea"), or the title they gave ("title: …"); an empty string only when the whole note is a few words.
- checklist: when they list several things to buy, pack, check or do ("a checklist: eggs, milk, bread"), the items, each short; then body holds only anything else they said (often empty). Otherwise [].
- tags: words they asked to tag it with ("tag it work" = ["Work"]), capitalised; otherwise [].
- actions: ACTIONS_RULE

When they only asked to add or start a note ("add note", "new note", "add a note inside Inventory Management") without saying what it should say, return action "note" with that topic and empty title, body, checklist and tags: the app then opens a blank note for them.

Never invent content.`;

const DICTATE_SYSTEM = `You tidy dictated speech (transcribed, so expect small speech-to-text mistakes) into clear written text with punctuation and paragraphs, to add to a note. Keep every fact, name, number and detail; do not summarise, answer or add anything. LANGUAGE_RULE Return only the text.`;

const ACTIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["actions"],
  properties: {
    actions: {
      type: "array",
      items: ACTION_ITEM,
    },
  },
};

const ACTIONS_SYSTEM = `You read one of someone's own notes and find the things they still need to do: calls, emails, sending, buying, meeting, checking, paying, following up. The note may be in English, Mandarin Chinese, or Tagalog (including Taglish).

For each, return:
- title: the task as a short imperative in the note's language ("Call James about CCTV quotation", "打电话给James", "Tawagan si James"). Leave out the date and time words.
- due_on: the date as YYYY-MM-DD worked out from today's date below ("tomorrow"/"明天"/"bukas", "Friday", "next week", "on the 15th"); a weekday means the next one from today. Empty string if no day was said.
- due_time: 24-hour HH:MM when a time was said, else an empty string.

Only real, specific things they must do; not facts, ideas, wishes or things already done. Usually none or one; at most 5. Never invent tasks.`;

const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");
const isoTime = (v: unknown) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? "")) ? String(v) : "");
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function findActions(textIn: unknown, todayIn: unknown, timeIn: unknown) {
  const text = String(textIn ?? "").trim().slice(0, 8000);
  if (!text) return [];
  const r = await structuredReply<{ actions: Action[] }>({
    system: ACTIONS_SYSTEM,
    content: [{ type: "text", text: `${clockLine(todayIn, timeIn)}\n\n<note>\n${text}\n</note>` }],
    schema: ACTIONS_SCHEMA,
    maxTokens: 2000,
    effort: "low",
  });
  return cleanActions(r.actions);
}

function cleanActions(list: unknown) {
  return (Array.isArray(list) ? list as Action[] : []).slice(0, 5).map((a) => {
    const due_on = isoDate(a?.due_on) || null;
    return { title: String(a?.title ?? "").trim().slice(0, 300), due_on, due_time: due_on ? isoTime(a?.due_time) || null : null };
  }).filter((a) => a.title);
}

const clockLine = (todayIn: unknown, timeIn: unknown) => {
  const today = isoDate(todayIn) || new Date().toISOString().slice(0, 10);
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
  return `Today is ${weekday} ${today}, and the time is ${isoTime(timeIn) || "09:00"}.`;
};

const CLEANUP_SYSTEM = `You tidy up a note someone typed or dictated in a hurry (abbreviations, no punctuation, mixed order), so it is easy to read later. It may be in English, Mandarin Chinese, or Tagalog (including Taglish); write the result in the same language (keep their Taglish mix).

Return:
- title: a short title naming what it is about (2 to 6 words), e.g. "CCTV Project – James". Keep their title when it already says that.
- body: the content as short clear points, one per line, each starting with "• ". Spell out abbreviations ("abt" = about, "qty" = quantity), fix spelling, and put each thing to do or fact on its own line, starting with a verb for things to do ("Request revised quotation", "Check camera stock availability", "Follow up by Thursday"). Who it is with goes in the title or the points. When the note is a paragraph of thoughts rather than a list, return tidy short paragraphs instead of points.

Keep every name, number, date and fact; never add anything that is not in the note.

Example. Note: "call james abt cctv project need revised quote maybe thursday and ask him about camera stock"
title: "CCTV Project – James"
body: "• Request revised quotation\n• Check camera stock availability\n• Follow up by Thursday"`;

async function cleanUp(titleIn: unknown, bodyIn: unknown) {
  const title = String(titleIn ?? "").trim().slice(0, 200);
  const body = String(bodyIn ?? "").trim().slice(0, 15000);
  if (!title && !body) throw new HttpError(400, "Write something first.");
  const r = await structuredReply<{ title: string; body: string }>({
    system: CLEANUP_SYSTEM,
    content: [{ type: "text", text: `<note>\n${title ? `Title: ${title}\n` : ""}${body}\n</note>` }],
    schema: { type: "object", additionalProperties: false, required: ["title", "body"], properties: { title: { type: "string" }, body: { type: "string" } } },
    maxTokens: 6000,
    effort: "low",
  });
  return { title: String(r.title ?? "").trim().slice(0, 200), body: String(r.body ?? "").trim().slice(0, 20000) || body };
}

const languageRule = (output: string) => `Write it in ${output}${output === "Tagalog" ? " (Taglish is fine)" : ""}; if they spoke another language, translate it into natural ${output}. Keep people's names, company and product terms, and numbers as said.`;

type Action = { title: string; due_on: string; due_time: string };
type Voice = { action: string; topic: string; title: string; body: string; checklist: string[]; tags: string[]; actions: Action[] };

const strs = (a: unknown, n: number, len: number) =>
  Array.isArray(a) ? a.map((x) => String(x ?? "").trim().slice(0, len)).filter(Boolean).slice(0, n) : [];

async function readVoice(text: string, output: string, topics: string[], inTopic: string, clock: string | null) {
  const r = await structuredReply<Voice>({
    system: VOICE_SYSTEM.replace("LANGUAGE_RULE", languageRule(output)).replace("ACTIONS_RULE", clock
      ? `real, specific things they still need to do (call, email, send, buy, meet, follow up), each with title (a short imperative in the note's language, without date words), due_on (YYYY-MM-DD from today's date, or empty) and due_time (HH:MM or empty). Usually none or one; at most 5; never invent tasks.`
      : "always []."),
    content: [{
      type: "text",
      text: `${clock ? `${clock}\n` : ""}Their topics: ${topics.length ? topics.map((t) => JSON.stringify(t)).join(", ") : "none yet"}\nOpen topic: ${inTopic ? JSON.stringify(inTopic) : "none"}\n\n<said>\n${text}\n</said>`,
    }],
    schema: VOICE_SCHEMA,
    maxTokens: 4000,
    effort: "low",
  });
  const action = r.action === "topic" && String(r.topic ?? "").trim() ? "topic" : "note";
  const out = {
    action,
    topic: String(r.topic ?? "").trim().slice(0, 80),
    title: action === "note" ? String(r.title ?? "").trim().slice(0, 200) : "",
    body: action === "note" ? String(r.body ?? "").trim().slice(0, 20000) : "",
    checklist: action === "note" ? strs(r.checklist, 50, 300) : [],
    tags: action === "note" ? strs(r.tags, 10, 30).map((t) => t.replace(/^#/, "")) : [],
    actions: action === "note" && clock ? cleanActions(r.actions) : [],
  };
  return out;
}

async function tidy(text: string, output: string) {
  const r = await structuredReply<{ text: string }>({
    system: DICTATE_SYSTEM.replace("LANGUAGE_RULE", languageRule(output)),
    content: [{ type: "text", text: `<said>\n${text}\n</said>` }],
    schema: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } },
    maxTokens: 4000,
    effort: "low",
  });
  return String(r.text ?? "").trim() || text;
}

serve(async (req) => {
  const caller = await requireCaller(req);
  requireFeature(caller, "notes", "Quick Notes");
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const body = await req.json().catch(() => ({}));
    if (body.action === "cleanup") return json(await cleanUp(body.title, body.body));
    if (body.action !== "actions") throw new HttpError(400, "Unknown action.");
    requireFeature(caller, "todo", "To Do List");
    return json({ actions: await findActions(body.text, body.today, body.time) });
  }
  const form = await req.formData();
  const action = form.get("action");
  if (action !== "voice" && action !== "dictate") throw new HttpError(400, "Unknown action.");
  const audio = form.get("audio");
  if (!(audio instanceof File) || !audio.size) throw new HttpError(400, "No recording was sent.");
  if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, "That recording is too long. Keep voice notes under 3 minutes.");
  const lang = voiceLanguage(form.get("language"));
  const text = await transcribe(audio, lang.code);
  if (!text) throw new HttpError(422, "Nothing was heard. Please try again.");
  if (action === "dictate") return json({ heard: text, text: await tidy(text, lang.name) });

  let topics: string[] = [];
  try { topics = strs(JSON.parse(String(form.get("topics") ?? "[]")), 300, 80); } catch { /* none */ }
  const inTopic = String(form.get("in_topic") ?? "").trim().slice(0, 80);
  // Things to do are only looked for when the To Do List is on for them.
  let clock: string | null = null;
  try { requireFeature(caller, "todo", "To Do List"); clock = clockLine(form.get("today"), form.get("time")); } catch { /* off */ }
  return json({ text, result: await readVoice(text, lang.name, topics, inTopic, clock) });
});
