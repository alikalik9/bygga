import { chatText, extractJson, fromApp, ipOf, keyTrouble, MODELS, rateLimited, OpenRouterError, userKey } from "@/lib/openrouter";

const PROMPT = `This photo shows an IKEA product, its box, its label or its assembly manual cover. Read the product name.
Reply with JSON only: {"name": "KALLAX", "variant": "2x4 shelving unit", "confidence": 0.0-1.0}.
The name is the word in capitals (it may contain Å, Ä or Ö). If you can't read a name, guess the kind of furniture in "variant" and set name to "".`;

export async function POST(req: Request) {
  if (!fromApp(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const key = userKey(req);
  if (!key) return Response.json({ error: "key" }, { status: 401 });
  if (rateLimited(ipOf(req) + ":identify", 8)) return Response.json({ error: "slow down" }, { status: 429 });
  const { image } = (await req.json().catch(() => ({}))) as { image?: string };
  if (typeof image !== "string" || !image.startsWith("data:image/") || image.length > 3_000_000) return Response.json({ error: "bad image" }, { status: 400 });
  try {
    const { text } = await chatText({
      key,
      models: MODELS.vision,
      // vision models think before they answer: a short budget comes back empty
      maxTokens: 1500,
      temperature: 0,
      messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url: image } }] }],
    });
    const j = extractJson(text) as { name?: string; variant?: string; confidence?: number } | null;
    const name = (j?.name ?? "").toString().trim();
    const variant = (j?.variant ?? "").toString().trim();
    return Response.json({ name, variant, query: [name, variant].filter(Boolean).join(" ").trim(), confidence: Number(j?.confidence ?? 0) });
  } catch (e) {
    console.error("[identify]", (e as Error).message);
    const trouble = e instanceof OpenRouterError ? keyTrouble(e.status) : null;
    return Response.json({ error: trouble ?? "failed" }, { status: trouble === "key" ? 401 : trouble === "credits" ? 402 : 502 });
  }
}
