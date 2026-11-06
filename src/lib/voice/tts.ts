import { NAMES as SPELLED } from "./names";

/**
 * The hands-free voice, on OpenRouter: one model and voice for the
 * pre-recorded clips (scripts/voice/record.ts) and for lines recorded live
 * (/api/voice), so a step never mixes two voices.
 */
export const TTS = {
  model: "hexgrad/kokoro-82m",
  voice: "af_heart",
  name: "Heart",
  label: "Kokoro on OpenRouter",
  usdPer1K: 0.004,
};

const NAMES = Object.entries(SPELLED);

function headers(key: string) {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": (process.env.NEXT_PUBLIC_SITE_URL || "https://www.usebygga.com").replace(/\/$/, ""),
    "X-OpenRouter-Title": "Bygga",
  };
}

/** The line as the voice should read it: product names get their phonetic spelling (scripts/voice/names.ts). */
export function forTTS(text: string) {
  let t = text;
  for (const [name, ipa] of NAMES) if (t.includes(name)) t = t.replace(new RegExp(`(?<!\\p{L})${name}(?!\\p{L})`, "gu"), `[${name}](/${ipa}/)`);
  return t;
}

/** Renders one line to mp3: on the person's own key live, on the recording script's key for the clips. */
export async function speak(text: string, key: string) {
  const r = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ model: TTS.model, voice: TTS.voice, input: text, response_format: "mp3" }),
  });
  if (!r.ok) throw new Error(`openrouter tts ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.arrayBuffer();
}
