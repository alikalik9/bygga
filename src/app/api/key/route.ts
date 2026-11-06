import { fromApp, ipOf, isDevKey, rateLimited, userKey } from "@/lib/openrouter";

/** Checks that a pasted OpenRouter key works, without storing it. */
export async function POST(req: Request) {
  // the scanner posts the key alone, with no body
  if (!fromApp(req, false)) return Response.json({ ok: false, reason: "forbidden" }, { status: 403 });
  if (isDevKey(req)) return Response.json({ ok: true });
  // a string that can't be a key is turned away before it costs a check
  const key = userKey(req);
  if (!key) return Response.json({ ok: false, reason: "format" });
  // too many checks: "busy" is never taken for a working key
  if (rateLimited(ipOf(req) + ":key", 12, 10 * 60_000)) return Response.json({ ok: false, reason: "busy" }, { status: 429 });
  try {
    const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    await r.body?.cancel();
    if (r.ok) return Response.json({ ok: true });
    return Response.json({ ok: false, reason: r.status === 401 || r.status === 403 ? "rejected" : "unavailable" });
  } catch {
    return Response.json({ ok: false, reason: "unavailable" });
  }
}
