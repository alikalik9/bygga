import { connection } from "next/server";
import { ipOf, rateLimited, userKey } from "@/lib/openrouter";
import { forTTS, speak } from "@/lib/voice/tts";

/**
 * Records a line live in the same voice as the pre-recorded clips, for text
 * that has no clip yet: scanned guides and spoken help answers. It runs on the
 * person's own key. Responses are cached for good on the CDN too, so each line
 * is only paid for once.
 */
export async function GET(req: Request) {
  await connection();
  const key = userKey(req);
  if (!key) return Response.json({ error: "key" }, { status: 401 });
  // only the app's own pages, which always say so: not other sites or scripts using it as a free voice
  if (req.headers.get("sec-fetch-site") !== "same-origin") return Response.json({ error: "forbidden" }, { status: 403 });
  const text = (new URL(req.url).searchParams.get("t") ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 400) return Response.json({ error: "bad text" }, { status: 400 });
  if (rateLimited(ipOf(req) + ":voice", 40)) return Response.json({ error: "slow down" }, { status: 429 });
  try {
    const audio = await speak(forTTS(text), key);
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=31536000, immutable", "CDN-Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch (e) {
    const err = (e as Error).message;
    console.error("[voice]", err);
    // the key turned away, or the account out of credit, as the other routes say it
    if (/ 40[13]:/.test(err)) return Response.json({ error: "key" }, { status: 401 });
    if (/ 402:/.test(err)) return Response.json({ error: "credits" }, { status: 402 });
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
