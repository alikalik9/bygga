import "server-only";

/**
 * How the guide hears you, on OpenRouter: short pieces of mic audio turned
 * into text. Whisper first (the best at picking a word out from under the
 * voice), Parakeet if it's unavailable.
 */
export const STT = {
  models: ["openai/whisper-large-v3", "nvidia/parakeet-tdt-0.6b-v3"],
  label: "Whisper on OpenRouter",
};

/** Text of one piece of 16 kHz mono WAV. Throws when every model fails; the message has the status, as "model 401: ...". */
export async function transcribe(wav: ArrayBuffer, key: string, signal?: AbortSignal) {
  let last = "";
  const input_audio = { data: Buffer.from(wav).toString("base64"), format: "wav" };
  for (const model of STT.models) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": (process.env.NEXT_PUBLIC_SITE_URL || "https://www.usebygga.com").replace(/\/$/, ""),
          "X-OpenRouter-Title": "Bygga",
        },
        body: JSON.stringify({ model, input_audio }),
        signal,
      });
      if (r.ok) return String(((await r.json()) as { text?: unknown }).text ?? "").trim();
      last = `${model} ${r.status}: ${(await r.text()).slice(0, 160)}`;
      // a bad key or no credit fails the same way on every model
      if (r.status === 401 || r.status === 402 || r.status === 403) break;
    } catch (e) {
      if (signal?.aborted) throw e;
      last = `${model}: ${(e as Error).message}`;
    }
  }
  throw new Error(last || "no model");
}
