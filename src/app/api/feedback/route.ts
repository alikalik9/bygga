import { saveFeedback, type FeedbackEntry } from "@/lib/feedback";
import { fromApp, ipOf, rateLimited } from "@/lib/openrouter";

const TOPICS = new Set(["looks", "size", "steps", "bug", "idea", "other"]);
const PHASES = new Set(["cover", "tools", "parts", "steps", "done"]);

/** "Safari on iPhone": enough to chase a bug that only one browser has, and no more. */
function device(ua: string) {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const app = /Edg\//.test(ua) ? "Edge" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [app, os].filter(Boolean).join(" on ") || undefined;
}

/**
 * Feedback from the guides: "Did this match your box?", "This step doesn't match my box" and the Feedback button.
 * Saved by src/lib/feedback.ts, so wrong guides can be found and fixed.
 */
export async function POST(req: Request) {
  if (!fromApp(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (rateLimited(ipOf(req) + ":feedback", 12, 10 * 60_000)) return Response.json({ error: "slow down" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n) || undefined : undefined);
  const flat = (v: unknown, n: number) => str(v, n)?.replace(/\s+/g, " ");
  const general = b.kind === "general";
  const email = flat(b.email, 120);
  const entry: FeedbackEntry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: general ? "general" : "match",
    slug: flat(b.slug, 80),
    name: flat(b.name, 60),
    variant: flat(b.variant, 80),
    match: typeof b.match === "boolean" ? b.match : undefined,
    topic: typeof b.topic === "string" && TOPICS.has(b.topic) ? b.topic : undefined,
    step: typeof b.step === "number" && b.step > 0 && b.step < 200 ? Math.floor(b.step) : undefined,
    phase: typeof b.phase === "string" && PHASES.has(b.phase) ? b.phase : undefined,
    note: general ? str(b.note, 2000) : flat(b.note, 400),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : undefined,
    via: flat(b.via, 12),
    page: flat(b.page, 160),
    device: device(req.headers.get("user-agent") ?? ""),
  };
  if (general ? !entry.note && !entry.topic : !entry.slug || entry.match === undefined) return Response.json({ error: "bad" }, { status: 400 });
  const ok = await saveFeedback(entry);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "not saved" }, { status: 502 });
}
