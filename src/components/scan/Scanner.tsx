"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { ProductSpec } from "@/lib/types";
import { buildPlan } from "@/lib/plan";
import { slugify } from "@/lib/search";
import { cacheSpec } from "@/lib/store";
import { getUserKey, setUserKey, subscribeKey } from "@/lib/userKey";
import Thumb from "../Thumb";
import { IArrowRight, ICamera, ICheck, IClose, IExternal, IImage, IKey, ILock, IPlus } from "../art/Icons";

const MAX_PAGES = 24;
/** Keeps the whole scan under upload limits: a page is compressed until its data URL fits. */
const MAX_PAGE_CHARS = 150_000;
const KEY_URL = "https://openrouter.ai/settings/keys";

interface Page {
  id: string;
  url: string;
  label?: string;
  read?: boolean;
}

type Stage = "reading" | "planning" | "checking" | "fixing";
type Err = "key" | "credits" | "busy" | "unreadable" | "failed" | "pages" | "pdf";

const ERRORS: Record<Err, string> = {
  key: "OpenRouter didn't accept your key. Check it and try again.",
  credits: "Your OpenRouter account is out of credits. Top it up, then try again.",
  busy: "Too many scans at once. Give it a minute, then try again.",
  unreadable: "We couldn't read those pages. Try bright, flat, straight on photos, or a clearer PDF.",
  failed: "Something went wrong while drawing your guide. Try again.",
  pages: "Those pages didn't come through. Add them again.",
  pdf: "We couldn't open that PDF. Try one without a password, or use photos of the pages.",
};

export default function Scanner() {
  const router = useRouter();
  const key = useSyncExternalStore(subscribeKey, getUserKey, () => "");
  const [pages, setPages] = useState<Page[]>([]);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [found, setFound] = useState<{ name?: string; brand?: string; parts?: number; steps?: number }>({});
  const [read, setRead] = useState(0);
  const [result, setResult] = useState<{ slug: string; spec: ProductSpec } | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [drag, setDrag] = useState(false);
  const [importing, setImporting] = useState("");
  const [notice, setNotice] = useState("");
  const ac = useRef<AbortController | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const adding = useRef(false);
  const keyBox = useRef<{ edit: () => void } | null>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => () => ac.current?.abort(), []);

  async function addFiles(list: FileList | File[]) {
    if (adding.current) return;
    const picked = [...list];
    if (!picked.length) return;
    adding.current = true;
    setErr(null);
    setNotice("");
    // one shared budget, so a PDF and photos added together still stop at MAX_PAGES
    const room = { left: Math.max(0, MAX_PAGES - pages.length) };
    const add = (url: string) => {
      if (room.left <= 0) return false;
      room.left -= 1;
      setPages((p) => (p.length >= MAX_PAGES ? p : [...p, { id: Math.random().toString(36).slice(2), url }]));
      return true;
    };
    try {
      for (const f of picked) {
        if (!room.left) break;
        if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
          try {
            const { total, added } = await readPdf(f, add, () => room.left > 0, setImporting);
            if (total > added) setNotice(`Added the first ${added} of ${total} pages. A scan can hold ${MAX_PAGES}.`);
          } catch {
            setErr("pdf");
          }
        } else if (f.type.startsWith("image/")) {
          try {
            setImporting("Preparing your pages");
            add(await shrink(f));
          } catch {
            /* unreadable image */
          }
        }
      }
    } finally {
      adding.current = false;
      setImporting("");
    }
  }

  async function start() {
    if (importing) return;
    if (!key) {
      keyBox.current?.edit();
      return;
    }
    if (!pages.length) {
      files.current?.click();
      return;
    }
    const c = new AbortController();
    ac.current = c;
    setBusy(true);
    setErr(null);
    setStage("reading");
    setFound({});
    setRead(0);
    setResult(null);
    setPages((p) => p.map((x) => ({ ...x, read: false, label: undefined })));
    const t0 = Date.now();
    window.scrollTo({ top: 0, behavior: "smooth" });
    setStarted(t0);
    setNow(t0);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-openrouter-key": key },
        body: JSON.stringify({ pages: pages.map((p) => p.url), hint }),
        signal: c.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: Err };
        throw new Error(j.error ?? "failed");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let done: ProductSpec | null = null;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "stage") setStage(ev.stage);
          else if (ev.type === "page") {
            setRead(ev.read);
            setPages((p) => p.map((x, i) => (i === ev.index ? { ...x, read: true, label: ev.label } : x)));
            if (ev.product) setFound((f) => ({ ...f, name: f.name ?? ev.product, brand: f.brand ?? ev.brand }));
          } else if (ev.type === "drafted") setFound((f) => ({ ...f, name: ev.name ?? f.name, brand: ev.brand ?? f.brand, parts: ev.parts, steps: ev.steps }));
          else if (ev.type === "error") throw new Error(ev.code);
          else if (ev.type === "done") done = ev.spec;
        }
      }
      if (!done) throw new Error("failed");
      const slug = `scan-${slugify(done.name).slice(0, 30) || "build"}-${Math.random().toString(36).slice(2, 6)}`;
      const spec: ProductSpec = { ...done, slug, source: "scan" };
      cacheSpec(slug, spec);
      setResult({ slug, spec });
      if (navigator.vibrate) navigator.vibrate(18);
    } catch (e) {
      if (c.signal.aborted) return;
      const code = (e as Error).message as Err;
      setErr(code in ERRORS ? code : "failed");
      if (code === "key") keyBox.current?.edit();
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  function cancel() {
    ac.current?.abort();
    setBusy(false);
    setStage(null);
    setPages((p) => p.map((x) => ({ ...x, read: false, label: undefined })));
  }

  const plan = useMemo(() => {
    if (!result) return null;
    try {
      return buildPlan(result.spec);
    } catch {
      return null;
    }
  }, [result]);

  const elapsed = busy ? Math.max(0, Math.round((now - started) / 1000)) : 0;
  const working = busy || !!result;

  return (
    <div className="scan">
      <header className="scan-head">
        <h1>Scan a paper manual</h1>
        <p className="lead">For furniture that isn&apos;t from IKEA. Photograph the manual or upload a PDF, and OpenRouter turns it into a step by step guide in 3D.</p>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {!working ? (
          <motion.div key="form" className="scan-form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            <section className="sf-row">
              <span className="sf-n">1</span>
              <div className="sf-body">
                <h2>Your OpenRouter key</h2>
                <KeyBox value={key} api={keyBox} />
              </div>
            </section>

            <section className="sf-row">
              <span className="sf-n">2</span>
              <div className="sf-body">
                <h2>Photos or a PDF of the manual</h2>
                <p className="sf-help">Just the cover works. Every page gives an exact match.</p>
                <div
                  className={"drop" + (drag ? " over" : "") + (pages.length ? " has" : "")}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    addFiles(e.dataTransfer.files);
                  }}
                >
                  {pages.length === 0 ? (
                    <div className="drop-empty">
                      <ManualArt />
                      <p>
                        Drop photos or a PDF here, or <button onClick={() => files.current?.click()}>choose them</button>
                      </p>
                      <button className="btn ghost cam-only" onClick={() => cam.current?.click()}>
                        <ICamera size={18} /> Take a photo
                      </button>
                    </div>
                  ) : (
                    <ol className="pages">
                      <AnimatePresence initial={false}>
                        {pages.map((p, i) => (
                          <motion.li key={p.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.22 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.url} alt={`Page ${i + 1}`} />
                            <span className="pg-n">{i + 1}</span>
                            <button className="pg-x" onClick={() => setPages((x) => x.filter((y) => y.id !== p.id))} aria-label={`Remove page ${i + 1}`}>
                              <IClose size={14} />
                            </button>
                          </motion.li>
                        ))}
                      </AnimatePresence>
                      {pages.length < MAX_PAGES && (
                        <li className="pg-add">
                          <button onClick={() => files.current?.click()}>
                            <IPlus size={20} />
                            <span>Add</span>
                          </button>
                          <button className="cam-only" onClick={() => cam.current?.click()} aria-label="Take a photo">
                            <ICamera size={20} />
                          </button>
                        </li>
                      )}
                    </ol>
                  )}
                </div>
                <input ref={files} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files).then(() => (e.target.value = ""))} />
                <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files && addFiles(e.target.files).then(() => (e.target.value = ""))} />
                <p className="sf-tip" role={importing ? "status" : undefined}>
                  {importing ? (
                    <>
                      <span className="spin" style={{ width: 14, height: 14 }} /> {importing}
                    </>
                  ) : (
                    <>
                      <IImage size={15} /> Photos or a PDF, rendered page by page in your browser. Up to {MAX_PAGES} pages.
                    </>
                  )}
                </p>
                {notice && <p className="sf-tip">{notice}</p>}
              </div>
            </section>

            <section className="sf-row">
              <span className="sf-n">3</span>
              <div className="sf-body">
                <h2>
                  What is it? <span>Optional</span>
                </h2>
                <input className="sf-input" value={hint} onChange={(e) => setHint(e.target.value.slice(0, 80))} placeholder="Like “record player stand from Nordwood”" />
              </div>
            </section>

            <AnimatePresence>
              {err && (
                <motion.p className="scan-err" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {ERRORS[err]}
                  {err === "credits" && (
                    <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer">
                      Billing <IExternal size={13} />
                    </a>
                  )}
                </motion.p>
              )}
            </AnimatePresence>

            <div className="scan-go">
              <button className="btn primary big" onClick={start}>
                <span>
                  {!key
                    ? "Add your key to start"
                    : importing
                      ? "Preparing your pages"
                      : pages.length
                        ? `Make my guide from ${pages.length} ${pages.length === 1 ? "page" : "pages"}`
                        : "Add photos or a PDF to start"}
                </span>
                <IArrowRight />
              </button>
              <p>Takes about a minute. Uses your OpenRouter credits, usually a few cents.</p>
            </div>
          </motion.div>
        ) : (
          <motion.div key="work" className="scan-work" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
            {result && plan ? (
              <div className="sw-done">
                <motion.div className="sw-art" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
                  <Thumb id={"scan-" + result.slug} plan={plan} mode={{ kind: "assembled" }} w={520} h={380} className="sw-thumb" alt={result.spec.name} />
                </motion.div>
                <div className="sw-done-text">
                  <span className="sw-ok">
                    <ICheck size={16} strokeWidth={2.6} /> Guide ready
                  </span>
                  <h2>{result.spec.name}</h2>
                  <p>
                    {[result.spec.brand, result.spec.variant].filter(Boolean).join(", ")}. {plan.steps.length} steps, {plan.parts.reduce((s, p) => s + p.qty, 0)} parts, about {result.spec.minutes} minutes.
                  </p>
                  <div className="sw-actions">
                    <button className="btn primary" onClick={() => router.push(`/build/${result.slug}`)}>
                      Start building <IArrowRight size={18} />
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() => {
                        setResult(null);
                        setPages([]);
                        setHint("");
                      }}
                    >
                      Scan another
                    </button>
                  </div>
                  <p className="sw-note">Saved in this browser. Check each step against your paper manual.</p>
                </div>
              </div>
            ) : (
              <div className="sw-live">
                <div className="sw-stack" aria-hidden="true">
                  {pages.slice(0, 8).map((p, i, list) => {
                    const firstUnread = list.findIndex((x) => !x.read);
                    const reading = stage === "reading" && i === firstUnread;
                    const order = p.read ? list.filter((x) => x.read).indexOf(p) : i;
                    const tilt = ((i * 37) % 7) - 3;
                    return (
                      <motion.div
                        key={p.id}
                        className={"sw-page" + (p.read ? " read" : "") + (reading ? " now" : "")}
                        style={{ zIndex: p.read ? 20 + order : 20 - i }}
                        initial={{ opacity: 0, y: 16, x: -54 }}
                        animate={p.read ? { opacity: 1, y: -order * 2, x: 62, rotate: 3 + tilt * 0.6 } : { opacity: 1, y: (i - (firstUnread < 0 ? 0 : firstUnread)) * 3, x: -54, rotate: tilt }}
                        transition={{ type: "spring", stiffness: 220, damping: 26, delay: p.read ? 0 : i * 0.05 }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" />
                        {reading && <span className="sw-scanline" />}
                        {p.read && (
                          <span className="sw-tag">
                            <ICheck size={12} strokeWidth={3} /> {p.label ?? "Read"}
                          </span>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
                <ol className="sw-steps" aria-live="polite">
                  <Row on={stage === "reading"} done={!!stage && stage !== "reading"} title={`Reading ${pages.length} ${pages.length === 1 ? "page" : "pages"}`} note={stage === "reading" ? `${read} of ${pages.length}` : found.name ? `Found ${found.name}${found.brand ? ` by ${found.brand}` : ""}` : undefined} />
                  <Row on={stage === "planning"} done={stage === "checking" || stage === "fixing"} title="Working out the parts and steps" note={found.parts ? `${found.parts} parts, ${found.steps} steps` : stage === "planning" ? "The longest part" : undefined} />
                  <Row on={stage === "checking" || stage === "fixing"} done={false} title="Checking it all fits" note={stage === "fixing" ? "Fixing a few joints" : undefined} />
                </ol>
                <div className="sw-foot">
                  <span>
                    {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
                  </span>
                  <button className="btn ghost sm" onClick={cancel}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <p className="scan-privacy">
        <ILock size={14} /> Your key and pages go straight to OpenRouter for this scan. We don&apos;t keep them. The finished guide is saved only in this browser.
      </p>
    </div>
  );
}

function Row({ on, done, title, note }: { on: boolean; done: boolean; title: string; note?: string }) {
  return (
    <li className={"sw-row" + (on ? " on" : "") + (done ? " done" : "")}>
      <span className="sw-ico">{done ? <ICheck size={14} strokeWidth={3} /> : on ? <span className="spin" /> : null}</span>
      <span className="sw-text">
        <b>{title}</b>
        <AnimatePresence mode="wait">
          {note && (
            <motion.span key={note} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
              {note}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </li>
  );
}

function KeyBox({ value, api }: { value: string; api: React.RefObject<{ edit: () => void } | null> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "bad" | "offline">("idle");
  const input = useRef<HTMLInputElement>(null);
  const open = editing || !value;

  useImperativeHandle(api, () => ({
    edit: () => {
      setEditing(true);
      setTimeout(() => input.current?.focus(), 50);
    },
  }));

  async function save() {
    const k = draft.trim();
    if (!k) return;
    setState("checking");
    try {
      const r = await fetch("/api/key", { method: "POST", headers: { "x-openrouter-key": k } });
      const j = (await r.json()) as { ok: boolean; reason?: string };
      if (j.ok || j.reason === "unavailable") {
        setUserKey(k);
        setDraft("");
        setEditing(false);
        setState(j.ok ? "idle" : "offline");
      } else setState("bad");
    } catch {
      setUserKey(k);
      setDraft("");
      setEditing(false);
      setState("offline");
    }
  }

  if (!open)
    return (
      <div className="key-saved">
        <span className="key-ico">
          <IKey size={17} />
        </span>
        <span className="key-text">
          <b>Key saved</b>
          <span>Ending in {value.slice(-4)}{state === "offline" ? ". We couldn't check it just now." : ""}</span>
        </span>
        <button className="link-btn" onClick={() => api.current?.edit()}>
          Change
        </button>
        <button className="link-btn" onClick={() => setUserKey("")}>
          Remove
        </button>
      </div>
    );

  return (
    <div className="key-edit">
      <form
        className={"key-field" + (state === "bad" ? " bad" : "")}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <IKey size={17} />
        <input
          ref={input}
          type="password"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setState("idle");
          }}
          placeholder="Paste your key"
          aria-label="OpenRouter API key"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn primary sm" type="submit" disabled={!draft.trim() || state === "checking"}>
          {state === "checking" ? "Checking" : "Save"}
        </button>
        {value && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setEditing(false);
              setDraft("");
              setState("idle");
            }}
          >
            Cancel
          </button>
        )}
      </form>
      <p className={"sf-help" + (state === "bad" ? " bad" : "")}>
        {state === "bad" ? (
          "OpenRouter didn't accept that key. Copy it again from your dashboard."
        ) : (
          <>
            Scanning runs on your own key, so you control the cost.{" "}
            <a href={KEY_URL} target="_blank" rel="noreferrer">
              Get a key <IExternal size={12} />
            </a>
          </>
        )}
      </p>
    </div>
  );
}

function ManualArt() {
  return (
    <svg viewBox="0 0 180 110" width="180" height="110" aria-hidden="true">
      <g transform="rotate(-7 60 60)">
        <rect x="22" y="14" width="66" height="88" rx="3" fill="#fff" stroke="var(--ink)" strokeWidth="2" />
        <path d="M34 34 h30 M34 42 h42" stroke="var(--line-2)" strokeWidth="3" strokeLinecap="round" />
        <path d="M40 80 l14 -8 l18 9 l-14 8 z M40 80 v6 l18 9 v-6 M72 81 v6 l-14 8" fill="var(--accent-soft)" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" />
      </g>
      <g transform="rotate(6 120 60)">
        <rect x="92" y="10" width="66" height="88" rx="3" fill="#fff" stroke="var(--ink)" strokeWidth="2" />
        <text x="104" y="32" fontSize="15" fontWeight="800" fill="var(--ink)" fontFamily="var(--font)">
          1
        </text>
        <path d="M108 70 l20 -11 l20 10 l-20 11 z" fill="#fff" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M128 40 v14 h-4 l6 7 l6 -7 h-4 v-14 z" fill="var(--ink)" />
      </g>
    </svg>
  );
}

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, 1400 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return encode(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Every PDF page becomes one image, in order, until the scan is full. */
async function readPdf(
  file: File,
  add: (url: string) => boolean,
  hasRoom: () => boolean,
  progress: (s: string) => void,
): Promise<{ total: number; added: number }> {
  const pdf = await import("pdfjs-dist");
  // the worker is copied into public/ by scripts/pdf-worker.mjs, so the strict CSP holds
  pdf.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  let added = 0;
  try {
    for (let n = 1; n <= doc.numPages && hasRoom(); n++) {
      progress(`Rendering page ${n} of ${doc.numPages}`);
      const page = await doc.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 });
        // about 130 dpi on A4: small print stays readable to the model
        const scale = Math.min(2.5, Math.max(1, 1600 / Math.max(base.width, base.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        await page.render({ canvas, viewport }).promise;
        if (!add(encode(canvas))) break;
        added += 1;
      } finally {
        page.cleanup();
      }
    }
    return { total: doc.numPages, added };
  } finally {
    await task.destroy();
  }
}

let pageType: "image/webp" | "image/jpeg" | null = null;

/** WebP where the browser has it, then quality only as low as the scan's upload budget needs. */
function encode(canvas: HTMLCanvasElement): string {
  if (!pageType) {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    pageType = probe.toDataURL("image/webp").startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
  }
  let url = canvas.toDataURL(pageType, 0.8);
  for (let q = 0.72; url.length > MAX_PAGE_CHARS && q >= 0.4; q -= 0.08) {
    url = canvas.toDataURL(pageType, q);
  }
  return url;
}
