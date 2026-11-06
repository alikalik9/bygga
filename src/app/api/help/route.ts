import { chat, fromApp, ipOf, keyTrouble, MODELS, rateLimited, OpenRouterError, userKey, type Msg } from "@/lib/openrouter";

interface Body {
  context?: string;
  question?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  image?: string;
}

const SYSTEM = `You are the helper inside Bygga, an app that walks people through assembling flat pack furniture step by step, mostly from IKEA. The person is mid-build, often on the floor with tools in hand.
Answer in plain, warm English. At most 3 short sentences, or a short numbered list when giving steps. No headings, no markdown tables.
Be practical and specific to the step they are on. If something could hurt them or damage the furniture, say so first.
If a part is missing or broken: tell them to note the number printed on the bag or panel, and that IKEA stores and customer service usually replace small fittings for free.
If they send a photo of a part, say which part from the list it most likely is and why (size, shape, head).
They see pictures from their own guide when you add tags: [part B] shows panel B, [fitting 3] shows fitting 3, [step 5] shows the drawing of step 5, using the letters and numbers in the lists below. Add the tags for what your answer is about: the panel or fitting you matched in a photo, the ones you name, the step you point them to, or this step when they ask what to do. At most 3, together on the last line. Never mention the tags or the pictures in words. In your words, call a panel by its letter and name ("panel B, the divider") and a fitting by its name ("the wooden dowels"), never by its number.
Never use em dashes or en dashes.`;

export async function POST(req: Request) {
  if (!fromApp(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const key = userKey(req);
  if (!key) return Response.json({ error: "key" }, { status: 401 });
  if (rateLimited(ipOf(req) + ":help", 20)) return Response.json({ error: "slow down" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Body;
  const question = (b.question ?? "").toString().slice(0, 600);
  const context = (b.context ?? "").toString().slice(0, 7000);
  const history = (Array.isArray(b.history) ? b.history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .slice(-6)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 800) })) as Msg[];
  // the app sends photos at 1024px, well under this
  const image = typeof b.image === "string" && b.image.startsWith("data:image/") && b.image.length < 3_000_000 ? b.image : undefined;
  const user: Msg = image
    ? { role: "user", content: [{ type: "text", text: question || "Which part is this?" }, { type: "image_url", image_url: { url: image } }] }
    : { role: "user", content: question };
  try {
    const { res } = await chat({
      key,
      models: image ? MODELS.vision : MODELS.text,
      stream: true,
      maxTokens: image ? 1500 : 900,
      temperature: 0.4,
      messages: [{ role: "system", content: SYSTEM + "\n\nWhere they are:\n" + context }, ...history, user],
    });
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const reader = res.body!.getReader();
        let buf = "";
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith("data:")) continue;
              const data = t.slice(5).trim();
              if (data === "[DONE]") continue;
              try {
                const j = JSON.parse(data);
                const piece: string = j?.choices?.[0]?.delta?.content ?? "";
                if (piece) ctrl.enqueue(enc.encode(piece.replace(/\s*[\u2013\u2014]\s*/g, ", ")));
              } catch {
                /* partial line */
              }
            }
          }
        } finally {
          ctrl.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[help]", (e as Error).message);
    const trouble = e instanceof OpenRouterError ? keyTrouble(e.status) : null;
    return Response.json({ error: trouble ?? "failed" }, { status: trouble === "key" ? 401 : trouble === "credits" ? 402 : 502 });
  }
}
