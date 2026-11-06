import { PRODUCTS, toSpec } from "@/lib/catalog";
import { categoryOf, fold, guessSpec, matchCatalog, searchCatalog } from "@/lib/search";
import { parseSpec, SPEC_PROMPT } from "@/lib/spec";
import { ikeaType } from "@/lib/ikea";
import { chatText, extractJson, fromApp, ipOf, keyTrouble, MODELS, rateLimited, OpenRouterError, userKey } from "@/lib/openrouter";
import type { ProductSpec } from "@/lib/types";

const cache = new Map<string, { spec: ProductSpec; model: string }>();

export async function POST(req: Request) {
  if (!fromApp(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { q?: string };
  const q = (body.q ?? "").toString().slice(0, 80).trim();
  if (!q) return Response.json({ error: "empty" }, { status: 400 });

  const hit = matchCatalog(q);
  if (hit) return Response.json({ spec: hit, via: "catalog" });

  const key = fold(q);
  const cached = cache.get(key);
  if (cached) return Response.json({ spec: cached.spec, via: "ai", model: cached.model });

  const suggestions = (more: string[] = []) => [...new Set([...more, ...searchCatalog(q, 8).filter((h) => h.score >= 40).map((h) => h.entry.name)])].filter((x) => fold(x) !== key).slice(0, 4);

  // IKEA's own word for what this is: steers the draft, and says plainly when it's something we can't draw
  const type = await ikeaType(q);
  if (type && !drawable(type)) return Response.json({ found: false, ikea: type, suggestions: suggestions(), via: "ikea" });
  // names read the same to the model however they were typed
  const said = q.replace(/\s+/g, " ").toUpperCase();
  const hint = type ? `${said} (IKEA sells this as: ${type})` : said;

  // working out a product we don't know runs on the person's own key; without one, they pick its shape
  const own = userKey(req);
  let trouble: string | null = null;
  if (own) {
    if (rateLimited(ipOf(req) + ":guide", 12)) return Response.json({ error: "slow down" }, { status: 429 });
    try {
      const d = await draft(own, hint);
      if (d && "found" in d) {
        return Response.json({ found: false, suggestions: suggestions(d.suggestions), via: "ai" });
      }
      if (d) {
        const { spec, model } = d;
        // prefer our checked catalog when the model lands on a product we know
        const known = PRODUCTS.find((c) => fold(c.name) === fold(spec.name) && c.archetype === spec.archetype && Math.abs(c.size.w - spec.size.w) < 6 && Math.abs(c.size.h - spec.size.h) < 6);
        if (known) return Response.json({ spec: { ...toSpec(known), slug: known.slug }, via: "catalog" });
        const out = { ...spec, slug: key.replace(/\s+/g, "-") };
        if (cache.size > 1000) cache.clear();
        cache.set(key, { spec: out, model });
        return Response.json({ spec: out, via: "ai", model });
      }
    } catch (e) {
      const err = e as OpenRouterError;
      trouble = keyTrouble(err.status);
      console.error("[guide] openrouter error", err.status, err.message);
    }
  }

  const g = guessSpec(type ? `${q} ${type}` : q);
  if (g && categoryOf(type ? `${q} ${type}` : q)) return Response.json({ spec: { ...g, variant: type ?? g.variant }, via: "guess", trouble: trouble ?? undefined });
  return Response.json({ found: false, ikea: type ?? undefined, suggestions: suggestions(), via: own ? "ai" : "offline", trouble: trouble ?? undefined });
}

/** Types the plan generator can draw: lamps, mattresses, textiles, plants and the like it can't. */
function drawable(type: string) {
  if (/lamp|light|mattress|picture frame|mirror|rug|cushion|curtain|plant|pot\b|hook/i.test(type)) return false;
  return categoryOf(type) !== null;
}

type Draft = { spec: ProductSpec; model: string } | { found: false; suggestions: string[] };

async function draft(own: string, q: string): Promise<Draft | null> {
  const { text, model } = await chatText({
    key: own,
    models: MODELS.text,
    json: true,
    maxTokens: 1800,
    temperature: 0.2,
    messages: [
      { role: "system", content: SPEC_PROMPT },
      { role: "user", content: q },
    ],
  });
  const raw = extractJson(text) as { found?: boolean; suggestions?: string[] } | null;
  if (raw && raw.found === false) return { found: false, suggestions: (raw.suggestions ?? []).slice(0, 3) };
  const spec = parseSpec(raw);
  return spec ? { spec, model } : null;
}
