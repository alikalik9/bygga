import { fromApp, ipOf, rateLimited, userKey } from "@/lib/openrouter";
import { transcribe } from "@/lib/voice/stt";

/** 3 s of 16 kHz 16-bit mono is 96 KB; a little room above that, nothing like a recording. */
const MAX_BYTES = 128 * 1024;

/**
 * Hands-free listening: the guide sends a short piece of mic audio each time
 * someone talks (and, where echo cancelling fails, while the voice reads),
 * and gets back what was said. Nothing is kept.
 */
export async function POST(req: Request) {
  if (!fromApp(req, false) || !(req.headers.get("content-type") ?? "").startsWith("audio/wav")) return Response.json({ error: "forbidden" }, { status: 403 });
  // listening runs on the person's own key
  const key = userKey(req);
  if (!key) return Response.json({ error: "key" }, { status: 401 });
  // a busy room sends a piece every second or so; this is well above that
  if (rateLimited(ipOf(req) + ":listen", 150)) return Response.json({ error: "slow down" }, { status: 429 });
  const wav = await req.arrayBuffer().catch(() => null);
  if (!wav || wav.byteLength < 44 + 3200 || wav.byteLength > MAX_BYTES) return Response.json({ error: "bad audio" }, { status: 400 });
  const head = new TextDecoder().decode(new Uint8Array(wav, 0, 12));
  if (!head.startsWith("RIFF") || !head.endsWith("WAVE")) return Response.json({ error: "bad audio" }, { status: 400 });
  try {
    const text = await transcribe(wav, key, AbortSignal.timeout(8000));
    return Response.json({ text }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const err = (e as Error).message;
    console.error("[listen]", err);
    // the key turned away, or the account out of credit: the guide says so instead of retrying
    if (/ 40[13]:/.test(err)) return Response.json({ error: "key" }, { status: 401 });
    if (/ 402:/.test(err)) return Response.json({ error: "credits" }, { status: 402 });
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
