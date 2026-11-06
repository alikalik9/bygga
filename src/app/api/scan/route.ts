import { buildPlan } from "@/lib/plan";
import { clean, fallbackSpec, parseScan } from "@/lib/scan/parse";
import { PAGE_PROMPT, PLAN_PROMPT, planInput, repairInput } from "@/lib/scan/prompts";
import { SAMPLE_SCAN } from "@/lib/scan/sample";
import { chatText, extractJson, fromApp, ipOf, isDevKey, MODELS, rateLimited, OpenRouterError, userKey, type Msg } from "@/lib/openrouter";
import type { ProductSpec } from "@/lib/types";
import { SCAN_ENABLED } from "@/lib/site";

export const maxDuration = 300;

type Note = { kind?: string; product?: { name?: string; brand?: string; type?: string }; parts?: unknown[]; hardware?: unknown[]; steps?: { n?: number }[] };

export async function POST(req: Request) {
  if (!SCAN_ENABLED) return Response.json({ error: "off" }, { status: 404 });
  if (!fromApp(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  // the dev key tries the scan flow locally without spending credits
  const mock = isDevKey(req);
  const key = mock ? "mock" : userKey(req);
  if (!key) return Response.json({ error: "key" }, { status: 401 });
  if (rateLimited(ipOf(req) + ":scan", 6, 10 * 60_000)) return Response.json({ error: "busy" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { pages?: unknown[]; hint?: unknown } | null;
  const pages = (body?.pages ?? []).filter((p): p is string => typeof p === "string" && p.startsWith("data:image/") && p.length < 500_000).slice(0, 24);
  if (!pages.length) return Response.json({ error: "pages" }, { status: 400 });
  // hosts cap request bodies, so keep a whole scan comfortably inside one upload
  if (pages.reduce((n, p) => n + p.length, 0) > 4_000_000) return Response.json({ error: "pages" }, { status: 413 });
  const hint = clean(String(body?.hint ?? "")).slice(0, 80);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      let open = true;
      const send = (o: object) => {
        if (open) ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      };
      try {
        send({ type: "stage", stage: "reading", total: pages.length });
        const spec = mock ? await fake(pages.length, hint, send) : await scan(key, pages, hint, send, req.signal);
        send({ type: "done", spec });
      } catch (e) {
        const err = e as OpenRouterError;
        const status = err instanceof OpenRouterError ? err.status : 0;
        console.error("[scan]", status, (err.message ?? "").slice(0, 200));
        const code = status === 401 || status === 403 ? "key" : status === 402 ? "credits" : status === 429 ? "busy" : (err.message ?? "").startsWith("unreadable") ? "unreadable" : "failed";
        send({ type: "error", code });
      } finally {
        open = false;
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

async function scan(key: string, pages: string[], hint: string, send: (o: object) => void, signal: AbortSignal): Promise<ProductSpec> {
  // 1. read every page on its own, a few at a time
  const notes: Note[] = new Array(pages.length);
  let next = 0;
  let read = 0;
  const worker = async () => {
    while (next < pages.length) {
      const i = next++;
      try {
        const { text } = await chatText({
          key,
          models: MODELS.read,
          maxTokens: 2000,
          temperature: 0,
          signal,
          messages: [{ role: "user", content: [{ type: "text", text: PAGE_PROMPT }, { type: "image_url", image_url: { url: pages[i] } }] }],
        });
        notes[i] = (extractJson(text) as Note | null) ?? { kind: "other" };
      } catch (e) {
        if (e instanceof OpenRouterError && [401, 402, 403, 429].includes(e.status)) throw e;
        notes[i] = { kind: "other" };
      }
      read++;
      send({ type: "page", index: i, read, total: pages.length, label: pageLabel(notes[i]), product: notes[i].product?.name ? clean(String(notes[i].product?.name)).slice(0, 40) : undefined, brand: notes[i].product?.brand ? clean(String(notes[i].product?.brand)).slice(0, 40) : undefined });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pages.length) }, worker));
  const useful = notes.filter((n) => n && n.kind !== "other");
  if (!useful.length && !hint) throw new Error("unreadable");

  // 2. plan the build
  send({ type: "stage", stage: "planning" });
  const msgs: Msg[] = [
    { role: "system", content: PLAN_PROMPT },
    { role: "user", content: planInput(notes, hint) },
  ];
  const ask = async () => {
    const { text } = await chatText({ key, models: MODELS.plan, json: true, maxTokens: 16000, temperature: 0.2, reasoning: "medium", signal, messages: msgs });
    return { text, raw: extractJson(text) };
  };
  let { text, raw } = await ask();
  let r = parseScan(raw);
  if (r.spec) send({ type: "drafted", name: r.spec.name, brand: r.spec.brand, parts: r.spec.custom?.parts.length ?? 0, steps: r.spec.custom?.steps.length ?? 0 });

  // 3. check it fits together, ask for one round of fixes if not
  send({ type: "stage", stage: "checking" });
  let ok = !!r.spec && r.check.ok && builds(r.spec);
  if (!ok && raw) {
    send({ type: "stage", stage: "fixing" });
    msgs.push({ role: "assistant", content: text.slice(0, 24000) }, { role: "user", content: repairInput(r.check.issues.length ? r.check.issues : ["The parts list or steps couldn't be read. Make sure every part has id, name, size and pos, and every step has a title."]) });
    ({ text, raw } = await ask());
    const again = parseScan(raw);
    if (again.spec && again.check.ok && builds(again.spec)) {
      r = again;
      ok = true;
    }
  }
  if (ok && r.spec) return r.spec;
  const fb = fallbackSpec(raw);
  if (fb && builds(fb)) return fb;
  throw new Error("unbuildable");
}

function builds(spec: ProductSpec) {
  try {
    const p = buildPlan(spec);
    return p.steps.length > 0 && p.parts.length > 0;
  } catch {
    return false;
  }
}

function pageLabel(n: Note) {
  const steps = (n.steps ?? []).map((s) => Number(s?.n)).filter((x) => Number.isFinite(x) && x > 0);
  if (steps.length) {
    const a = Math.min(...steps), b = Math.max(...steps);
    return a === b ? `Step ${a}` : `Steps ${a} to ${b}`;
  }
  switch (n.kind) {
    case "cover":
      return "Cover";
    case "parts":
      return "Parts list";
    case "hardware":
      return "Fittings";
    case "tools":
      return "Tools";
    case "warnings":
      return "Safety notes";
    default:
      return "Page";
  }
}

async function fake(total: number, hint: string, send: (o: object) => void): Promise<ProductSpec> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const labels = ["Cover", "Parts list", "Fittings", "Steps 1 to 3", "Steps 4 to 6", "Steps 7 to 10"];
  for (let i = 0; i < total; i++) {
    await wait(700);
    send({ type: "page", index: i, read: i + 1, total, label: labels[i] ?? `Steps ${i * 2} to ${i * 2 + 1}`, product: i === 0 ? SAMPLE_SCAN.name : undefined, brand: i === 0 ? SAMPLE_SCAN.brand : undefined });
  }
  send({ type: "stage", stage: "planning" });
  await wait(2200);
  const spec: ProductSpec = { ...SAMPLE_SCAN, name: hint ? hint.split(" ")[0].toUpperCase().slice(0, 24) : SAMPLE_SCAN.name };
  send({ type: "drafted", name: spec.name, brand: spec.brand, parts: spec.custom!.parts.length, steps: spec.custom!.steps.length });
  send({ type: "stage", stage: "checking" });
  await wait(900);
  return spec;
}
