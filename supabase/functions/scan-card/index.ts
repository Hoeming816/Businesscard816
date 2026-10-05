// scan-card: reads the front (and optional back) of a business card with
// Claude vision and returns the contact fields for the user to review.
// With { multi: true } it reads every card in one photo and returns { cards }.
import { HttpError, json, requireCaller, requireFeature, serve } from "../_shared/http.ts";
import { structuredReply } from "../_shared/claude.ts";
import {
  BUSINESS_CATEGORIES, CONTACT_TYPES, INDUSTRIES, JOB_FUNCTIONS, OPPORTUNITIES,
  PHONE_LABELS, SENIORITIES,
} from "../_shared/taxonomy.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"];

const str = { type: "string" };
const strList = { type: "array", items: { type: "string" } };

const CARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "full_name", "job_title", "company", "department", "emails", "phones", "website",
    "address", "city", "region", "country", "contact_type", "industry", "business_category",
    "job_function", "seniority", "opportunities", "tags", "card_text",
  ],
  properties: {
    full_name: str, job_title: str, company: str, department: str,
    emails: strList,
    phones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "number"],
        properties: { label: { type: "string", enum: PHONE_LABELS }, number: str },
      },
    },
    website: str, address: str, city: str, region: str, country: str,
    contact_type: str, industry: str, business_category: str, job_function: str, seniority: str,
    opportunities: strList,
    tags: strList,
    card_text: str,
  },
};

// Several cards in one photo: each card plus where it sits in the photo
// (fractions of the photo's width and height) so the app can crop its picture.
const MAX_CARDS = 12;
const num = { type: "number" };
const MULTI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cards"],
  properties: {
    cards: {
      type: "array",
      items: {
        ...CARD_SCHEMA,
        required: [...CARD_SCHEMA.required, "box"],
        properties: {
          ...CARD_SCHEMA.properties,
          box: {
            type: "object",
            additionalProperties: false,
            required: ["left", "top", "width", "height"],
            properties: { left: num, top: num, width: num, height: num },
          },
        },
      },
    },
  },
};

const MULTI_NOTE = `This photo may show several business cards laid out together. Treat every card as a separate contact: return one entry in "cards" per card, in reading order (top to bottom, then left to right), up to ${MAX_CARDS}. Never mix details from two cards. If a card shows its back (logo only, no contact details), skip it.

For each card, "box" is where the whole card sits in the photo, as fractions of the photo's width and height from its top-left corner (0 to 1): left, top, width, height. Make the box cover the entire card.

card_text: for each card, only that card's text.`;

const clamp01 = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0));

const list = (values: string[]) => values.map((v) => `"${v}"`).join(", ");

const SYSTEM = `You read photographs of business cards and extract the contact's details for a sales team's contact database.

Copy names, titles, emails, phone numbers and web addresses exactly as printed. Use an empty string or empty list for anything not on the card; do not invent details.

Cards may be in Chinese (simplified or traditional), English, or both. Read Chinese characters exactly as printed; never convert between simplified and traditional, and never translate or romanise a name yourself.
- When a card prints the same name, title or company in both English (or another Latin-script form) and Chinese, give both as "English (中文)", for example "Tan Wei Ming (陈伟明)" or "Aspencom Tech Inc. (亚斯本通讯科技有限公司)".
- When only Chinese is printed, use the Chinese as printed.
- Write the address as printed (Chinese if the card is Chinese), but give "city", "region" and "country" in English.
- Classification values and tags are always in English.

Phones: label each number as one of ${list(PHONE_LABELS)} from the card's own markings (M/Mob/HP = Mobile, T/Tel = Office, DL/Direct = Direct, F = Fax). Keep the number as printed, including country code.
Address: put the full printed address in "address", and also split out "city", "region" (state/province) and "country". Infer the country from the address or phone country code when it is not printed, using the full English country name.

Classify the contact using these standard lists. Choose the single best standard value, or an empty string when the card gives no reasonable basis:
- contact_type: ${list(CONTACT_TYPES)} (from the company's likely relationship to a telecom / IT / low-voltage systems contractor; leave empty if unclear)
- industry: ${list(INDUSTRIES)}
- business_category: ${list(BUSINESS_CATEGORIES)}
- job_function: ${list(JOB_FUNCTIONS)}
- seniority: ${list(SENIORITIES)}
- opportunities: zero or more of ${list(OPPORTUNITIES)} — the services this company could plausibly buy or partner on, based on what the card says they do.
- tags: up to 5 short lowercase keywords about the company's products, services or specialities.

card_text: all text on the card(s), line by line, front then back, in the original characters.`;

function normalise(value: unknown, standard: string[]): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return "";
  return standard.find((s) => s.toLowerCase() === v.toLowerCase()) ?? v;
}

function checkImage(b64: unknown, side: string): string {
  if (typeof b64 !== "string" || !b64) throw new HttpError(400, `The ${side} photo is missing.`);
  const data = b64.replace(/^data:[^,]+,/, "");
  if ((data.length * 3) / 4 > MAX_IMAGE_BYTES) throw new HttpError(413, `The ${side} photo is too large.`);
  return data;
}

// deno-lint-ignore no-explicit-any
function tidy(raw: Record<string, any>) {
  return {
    ...raw,
    emails: (raw.emails ?? []).map((e: string) => e.trim().toLowerCase()).filter(Boolean),
    phones: (raw.phones ?? []).filter((p: { number?: string }) => p.number?.trim()),
    contact_type: normalise(raw.contact_type, CONTACT_TYPES),
    industry: normalise(raw.industry, INDUSTRIES),
    business_category: normalise(raw.business_category, BUSINESS_CATEGORIES),
    job_function: normalise(raw.job_function, JOB_FUNCTIONS),
    seniority: normalise(raw.seniority, SENIORITIES),
    opportunities: [...new Set((raw.opportunities ?? []).map((o: string) => normalise(o, OPPORTUNITIES)))]
      .filter((o) => OPPORTUNITIES.includes(o as string)),
    tags: [...new Set((raw.tags ?? []).map((t: string) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 5),
  };
}

serve(async (req) => {
  requireFeature(await requireCaller(req), "scan_ai", "AI card reading");
  const body = await req.json().catch(() => ({}));
  const mediaType = MEDIA_TYPES.includes(body.media_type) ? body.media_type : "image/jpeg";

  if (body.multi) {
    // deno-lint-ignore no-explicit-any
    const raw = await structuredReply<{ cards: Record<string, any>[] }>({
      system: `${SYSTEM}\n\n${MULTI_NOTE}`,
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: checkImage(body.front, "cards") } },
        { type: "text", text: "Extract every business card in this photo as a separate contact." },
        // deno-lint-ignore no-explicit-any
      ] as any,
      schema: MULTI_SCHEMA,
      maxTokens: 32000,
    });
    const cards = (raw.cards ?? []).slice(0, MAX_CARDS).map(({ box, ...card }) => {
      const left = clamp01(box?.left), top = clamp01(box?.top);
      return {
        ...tidy(card),
        box: { left, top, width: Math.min(1 - left, clamp01(box?.width)), height: Math.min(1 - top, clamp01(box?.height)) },
      };
    });
    return json({ cards });
  }

  const content: Record<string, unknown>[] = [
    { type: "text", text: "Front of the card:" },
    { type: "image", source: { type: "base64", media_type: mediaType, data: checkImage(body.front, "front") } },
  ];
  if (body.back) {
    content.push(
      { type: "text", text: "Back of the card:" },
      { type: "image", source: { type: "base64", media_type: mediaType, data: checkImage(body.back, "back") } },
    );
  }
  content.push({ type: "text", text: "Extract this contact." });

  // deno-lint-ignore no-explicit-any
  const raw = await structuredReply<Record<string, any>>({
    system: SYSTEM,
    // deno-lint-ignore no-explicit-any
    content: content as any,
    schema: CARD_SCHEMA,
  });

  return json({ card: tidy(raw) });
});
