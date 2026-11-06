import "server-only";

const BASE = "https://openrouter.ai/api/v1";
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.usebygga.com").replace(/\/$/, "");

export const MODELS = {
  // laying out a scanned manual: the strongest reasoning we can afford per scan
  plan: list(process.env.OPENROUTER_PLAN_MODEL, "anthropic/claude-opus-5.5,anthropic/claude-sonnet-5.5"),
  // product lookups and the "Stuck?" chat: quick and good enough
  text: list(process.env.OPENROUTER_TEXT_MODEL, "anthropic/claude-sonnet-5.5,anthropic/claude-haiku-5.5"),
  // box labels and loose parts
  vision: list(process.env.OPENROUTER_VISION_MODEL, "anthropic/claude-sonnet-5.5,anthropic/claude-haiku-5.5"),
  // reading manual pages, where small print matters most
  read: list(process.env.OPENROUTER_READ_MODEL, "anthropic/claude-opus-5.5,anthropic/claude-sonnet-5.5"),
};

function list(env: string | undefined, fallback: string) {
  return (env?.trim() || fallback).split(",").map((m) => m.trim()).filter(Boolean);
}

type Content = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
export interface Msg {
  role: "system" | "user" | "assistant";
  content: Content;
}

interface ChatOpts {
  models: string[];
  messages: Msg[];
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
  /** The person's own key: every call runs on it, and there is no other. */
  key: string;
  reasoning?: "low" | "medium" | "high";
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Headers OpenRouter uses to attribute the app, plus the person's own key. */
export function headers(key: string, json = true) {
  return {
    Authorization: `Bearer ${key}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
    "HTTP-Referer": SITE,
    "X-OpenRouter-Title": "Bygga",
  };
}

/** Calls OpenRouter's chat completions, falling back through the model list when one is unavailable. */
export async function chat(o: ChatOpts): Promise<{ res: Response; model: string }> {
  const key = o.key?.trim();
  if (!key) throw new OpenRouterError("missing key", 401);
  let lastErr: OpenRouterError | null = null;
  for (const model of o.models.map((m) => m.trim()).filter(Boolean)) {
    // a model that thinks before it answers gets a budget for it; other models ignore the hint
    const reasoning = o.reasoning ? { reasoning: { effort: o.reasoning } } : {};
    for (const withExtras of [true, false]) {
      const body = {
        model,
        messages: o.messages,
        max_tokens: o.maxTokens ?? 1400,
        temperature: o.temperature ?? 0.3,
        stream: !!o.stream,
        ...(o.json && withExtras ? { response_format: { type: "json_object" } } : {}),
        ...(withExtras ? reasoning : {}),
      };
      let res: Response;
      try {
        res = await fetch(`${BASE}/chat/completions`, {
          method: "POST",
          headers: headers(key),
          body: JSON.stringify(body),
          signal: o.signal,
        });
      } catch (e) {
        lastErr = new OpenRouterError((e as Error).message, 502);
        break;
      }
      if (res.ok) return { res, model };
      const text = await res.text().catch(() => "");
      lastErr = new OpenRouterError(text.slice(0, 300) || res.statusText, res.status);
      if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429) throw lastErr;
      // 400 may be an unsupported extra parameter: retry once without extras, otherwise move on
      if (res.status !== 400) break;
    }
  }
  throw lastErr ?? new OpenRouterError("no model available", 503);
}

export async function chatText(o: Omit<ChatOpts, "stream">) {
  // a model can spend its whole budget thinking and answer nothing: the next one in the list gets a go
  for (let models = o.models; ; ) {
    const { res, model } = await chat({ ...o, models });
    const j = await res.json();
    const text: string = j?.choices?.[0]?.message?.content ?? "";
    const rest = models.slice(models.indexOf(model) + 1);
    if (text.trim() || !rest.length) return { text, model };
    models = rest;
  }
}

export function extractJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Tiny in-memory rate limiter. Pass a bucket per route ("1.2.3.4:voice") so a
 * chatty route can't use up another's allowance; refused calls don't count.
 */
const hits = new Map<string, number[]>();

export function rateLimited(bucket: string, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(bucket, arr);
    return true;
  }
  arr.push(now);
  hits.set(bucket, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}

/** Only for trying the app locally: stands in for the key in .env.local. Never accepted in production. */
export const DEV_KEY = "bygga-dev-mock-key-000000";

export function isDevKey(req: Request) {
  return process.env.NODE_ENV !== "production" && req.headers.get("x-openrouter-key")?.trim() === DEV_KEY;
}

/** The key the person pasted into the app, sent along with each request. Never stored or logged, and the only key any AI call runs on. */
export function userKey(req: Request) {
  if (isDevKey(req)) return process.env.OPENROUTER_API_KEY?.trim() || undefined;
  const k = req.headers.get("x-openrouter-key")?.trim() ?? "";
  return k.length >= 20 && k.length <= 200 && /^[\w.-]+$/.test(k) ? k : undefined;
}

/** What a turned-away call tells the person: their key was refused, or their account is out of credit. */
export function keyTrouble(status: number) {
  return status === 401 || status === 403 ? "key" : status === 402 ? "credits" : null;
}

/**
 * True for requests from this site's own pages. Other sites can't make their visitors'
 * browsers spend the key: browsers say where a request came from, and a JSON body
 * can't be sent across sites without a preflight we never answer.
 */
export function fromApp(req: Request, json = true) {
  if (json && !(req.headers.get("content-type") ?? "").includes("application/json")) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export function ipOf(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
