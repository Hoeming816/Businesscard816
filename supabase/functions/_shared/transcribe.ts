// Speech to text through the Vercel AI Gateway (AI_GATEWAY_API_KEY), or OpenAI
// directly (OPENAI_API_KEY), with a language hint ("en", "zh", "tl").
import { HttpError } from "./http.ts";

const TRANSCRIBE_MODEL = Deno.env.get("AI_GATEWAY_TRANSCRIBE_MODEL") || "openai/whisper-1";

// Voice languages offered in the app, with the speech recognition hint for each.
export const VOICE_LANGUAGES: Record<string, { name: string; code: string }> = {
  English: { name: "English", code: "en" },
  Chinese: { name: "Simplified Chinese (中文)", code: "zh" },
  Tagalog: { name: "Tagalog", code: "tl" },
};
export const voiceLanguage = (v: unknown) => VOICE_LANGUAGES[String(v ?? "")] ?? VOICE_LANGUAGES.English;

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
    body: JSON.stringify({ audio: toBase64(new Uint8Array(await audio.arrayBuffer())), mediaType: audio.type || "audio/webm", providerOptions: { openai: { language } } }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${await res.text()}`);
  return String((await res.json()).text ?? "");
}

async function viaOpenAI(key: string, audio: File, language: string) {
  const form = new FormData();
  form.append("file", audio, audio.name || "audio.webm");
  form.append("model", "whisper-1");
  form.append("language", language);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  return String((await res.json()).text ?? "");
}

export async function transcribe(audio: File, language: string) {
  const gatewayKey = Deno.env.get("AI_GATEWAY_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!gatewayKey && !openaiKey) throw new HttpError(501, "Voice is not set up. Add the AI_GATEWAY_API_KEY (or OPENAI_API_KEY) secret.");
  const attempts: [string, (k: string, a: File, l: string) => Promise<string>][] = [];
  if (gatewayKey) attempts.push([gatewayKey, viaGateway]);
  if (openaiKey) attempts.push([openaiKey, viaOpenAI]);
  for (const [key, run] of attempts) {
    try {
      return (await run(key, audio, language)).trim();
    } catch (e) {
      console.error("transcription error", e instanceof Error ? e.message : e);
    }
  }
  throw new HttpError(502, "Could not hear that. Please try again.");
}
