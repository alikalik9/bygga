"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Plan } from "@/lib/types";
import { faqFor } from "@/lib/faq";
import { stepContents } from "@/lib/plan/contents";
import { ICamera, IChevronDown, IClose, IExternal, IFlag, IKey, ISend, ISparkle } from "../art/Icons";
import { Figure } from "../art/Figure";
import { HwArt } from "../art/Hardware";
import Thumb from "../Thumb";
import type { KeyTrouble, KeyWhy } from "../KeyModal";
import { keyHeaders } from "@/lib/userKey";

interface Msg {
  role: "user" | "assistant";
  content: string;
  image?: string;
  /** The answer didn't come: the key was turned away, the credit ran out, or the helper couldn't be reached. */
  error?: KeyTrouble | "failed";
}

/** A picture from this guide that an answer points at. */
type Show = { kind: "part"; id: string } | { kind: "fit"; id: string } | { kind: "step"; index: number };

/** Fittings are numbered in the order the plan lists them, the same in the context and in the answer's tags. */
const fittingNo = (plan: Plan, id: string) => plan.hardware.findIndex((h) => h.id === id) + 1;

export function helpContext(plan: Plan, index: number) {
  const s = plan.spec;
  const part = (p: { label: string; name: string }, n: number) => `[part ${p.label}] ${p.name} x${n}`;
  const fit = (h: { id: string; name: string; spec: string }, n: number) => `[fitting ${fittingNo(plan, h.id)}] ${h.name}${h.spec ? " " + h.spec : ""} x${n}`;
  const lines = [`Product: ${s.name}, ${s.variant} (${s.category}), ${s.size.w} x ${s.size.h} x ${s.size.d} cm.`];
  if (index >= 0) {
    const st = plan.steps[index];
    const c = stepContents(plan, index);
    lines.push(`Current step: [step ${index + 1}] of ${plan.steps.length}: ${st.title}. ${st.detail ?? ""}`);
    if (st.repeat) lines.push(`This step is repeated ${st.repeat} times.`);
    if (c.parts.length) lines.push("Panels in this step: " + c.parts.map((p) => part(p.type, p.count)).join(", "));
    if (c.hardware.length) lines.push("Fittings in this step: " + c.hardware.map((h) => fit(h.type, h.count)).join(", "));
    if (st.tools.length) lines.push("Tools: " + st.tools.join(", "));
    if (index > 0) lines.push(`Previous step: [step ${index}] ${plan.steps[index - 1].title}.`);
    if (index + 1 < plan.steps.length) lines.push(`Next step: [step ${index + 2}] ${plan.steps[index + 1].title}.`);
  }
  lines.push("All panels: " + plan.parts.filter((p) => !p.extra).map((p) => part(p, p.qty)).join(", "));
  lines.push("All fittings: " + plan.hardware.map((h) => fit(h, h.qty) + (h.notIncluded ? " (not included)" : "")).join(", "));
  lines.push("All steps: " + plan.steps.map((x, i) => `[step ${i + 1}] ${x.title}`).join("; "));
  return lines.join("\n").slice(0, 7000);
}

const TAG = /\[(part|panel|fitting|step)\s+([A-Za-z0-9]{1,4})\]/gi;

/** An answer's words with its picture tags taken out, and the pictures they ask for (three at most). */
export function readAnswer(raw: string, plan: Plan, done = true) {
  const shows: Show[] = [];
  const add = (x: Show | null) => {
    if (!x || shows.length >= 3) return;
    if (shows.some((y) => y.kind === x.kind && (y.kind === "step" ? y.index === (x as { index: number }).index : y.id === (x as { id: string }).id))) return;
    shows.push(x);
  };
  const partOf = (ref: string): Show | null => {
    const p = plan.parts.find((p) => !p.extra && p.label.toUpperCase() === ref.toUpperCase());
    return p ? { kind: "part", id: p.id } : null;
  };
  const stepOf = (ref: string): Show | null => {
    const n = Number(ref);
    return Number.isInteger(n) && n >= 1 && n <= plan.steps.length ? { kind: "step", index: n - 1 } : null;
  };
  let tagged = false;
  let text = raw.replace(TAG, (_, kind: string, ref: string) => {
    tagged = true;
    const k = kind.toLowerCase();
    if (k === "part" || k === "panel") add(partOf(ref));
    else if (k === "step") add(stepOf(ref));
    else {
      const h = plan.hardware[Number(ref) - 1];
      add(h ? { kind: "fit", id: h.id } : null);
    }
    return "";
  });
  // a tag still arriving isn't shown half written
  if (!done) text = text.replace(/\[[^\]\n]{0,24}$/, "");
  text = text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+([.,!?])/g, "$1").trim();
  // an answer that names a panel or a step without tagging it still gets its picture
  if (done && !tagged) {
    for (const m of text.matchAll(/\b(?:part|panel)\s+([A-Z])\b/g)) add(partOf(m[1]));
    for (const m of text.matchAll(/\bstep\s+(\d{1,3})\b/gi)) add(stepOf(m[1]));
  }
  return { text, shows };
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
    const k = Math.min(1, 1024 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function HelpSheet({
  plan,
  index,
  ai,
  onClose,
  focusMissing,
  ask: asked,
  askId,
  onAnswer,
  onAddKey,
  onShow,
  onGoto,
}: {
  plan: Plan;
  index: number;
  /** A key is saved: asking works. Without one, asking opens the key modal and the question waits for it. */
  ai: boolean;
  onClose: () => void;
  focusMissing?: boolean;
  /** A question already asked out loud, and which time it was asked. */
  ask?: string;
  askId?: number;
  /** Hears each finished answer, to read it aloud. */
  onAnswer?: (text: string) => void;
  onAddKey?: (why: KeyWhy, trouble?: KeyTrouble) => void;
  /** Lights up a part or fitting on the drawing behind, while its picture is pointed at. */
  onShow?: (ids: string[] | null) => void;
  /** Goes to a step an answer points at. */
  onGoto?: (index: number) => void;
}) {
  const kind = index >= 0 ? plan.steps[index].kind : "general";
  const faqs = faqFor(kind);
  // keyboard and screen reader users land inside the sheet, not behind it
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => {
    sheet.current?.focus({ preventScroll: true });
  }, []);
  const [open, setOpen] = useState<number | null>(focusMissing ? faqs.length - 2 : null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // asked before there was a key: it goes as soon as one is saved
  const pending = useRef<{ q: string; image?: string } | null>(null);
  useEffect(() => {
    if (!ai || !pending.current) return;
    const p = pending.current;
    pending.current = null;
    const t = setTimeout(() => ask(p.q, p.image), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai]);
  useEffect(() => () => onShow?.(null), [onShow]);

  // a question asked by voice goes straight in, every time one is asked
  const sent = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!asked || !ai || sent.current === askId) return;
    const t = setTimeout(() => {
      sent.current = askId;
      ask(asked, undefined, true);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, askId, ai]);

  // closing the sheet ends the answer too, so it never talks over the next step
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  async function ask(question: string, image?: string, spoken = false) {
    if ((busy && !spoken) || (!question.trim() && !image)) return;
    if (!ai) {
      pending.current = { q: question, image };
      setQ("");
      onAddKey?.("ask");
      return;
    }
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    // answers that never came aren't part of the conversation
    const history = msgs.filter((m) => !m.error && m.content).map((m) => ({ role: m.role, content: m.content }));
    const next: Msg[] = [...msgs, { role: "user", content: question || "Which part is this?", image }, { role: "assistant", content: "" }];
    setMsgs(next);
    setQ("");
    setBusy(true);
    try {
      const res = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...keyHeaders() },
        body: JSON.stringify({ context: helpContext(plan, index), question: question || "Which part is this? Match it to the parts list.", history, image }),
        signal: c.signal,
      });
      if (res.status === 401 || res.status === 402) throw new Error(res.status === 401 ? "key" : "credits");
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        setMsgs((m) => {
          const c = [...m];
          c[c.length - 1] = { role: "assistant", content: text };
          return c;
        });
      }
      if (!text.trim()) throw new Error("empty");
      if (!c.signal.aborted) onAnswer?.(readAnswer(text, plan).text);
    } catch (e) {
      if (c.signal.aborted) return;
      const why = (e as Error).message;
      const error: Msg["error"] = why === "key" || why === "credits" ? why : "failed";
      setMsgs((m) => {
        const c = [...m];
        c[c.length - 1] = {
          role: "assistant",
          error,
          content:
            error === "key"
              ? "OpenRouter turned your key away, so I couldn't answer."
              : error === "credits"
                ? "Your OpenRouter credit ran out, so I couldn't answer."
                : "I couldn't reach the helper just now. Try the quick answers above, or ask again in a moment.",
        };
        return c;
      });
    } finally {
      if (ctrl.current === c) setBusy(false);
    }
  }

  return (
    <motion.div className="sheet-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside
        ref={sheet}
        tabIndex={-1}
        className="side-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Help"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <Figure pose="think" bubble="?" size={64} />
          <div>
            <h2>{index >= 0 ? `Stuck on step ${index + 1}?` : "Need a hand?"}</h2>
            <p className="sub">{index >= 0 ? plan.steps[index].title : "Common questions while unpacking."}</p>
          </div>
          <button className="btn round small" onClick={onClose} aria-label="Close help">
            <IClose />
          </button>
        </div>
        <div className="sheet-body" ref={scroller}>
          <div className="faq">
            {faqs.map((f, i) => (
              <div key={f.q} className={"faq-item" + (open === i ? " open" : "")}>
                <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  <span>{f.q}</span>
                  <IChevronDown size={18} />
                </button>
                <AnimatePresence initial={false}>
                  {open === i && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
                      <p>{f.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
          {index >= 0 && <Report plan={plan} index={index} />}

          <div className="ask-head">
            <ISparkle size={18} />
            <b>Ask about this step</b>
            <button className="ask-key" onClick={() => onAddKey?.(ai ? "key" : "ask")}>
              <IKey size={13} /> {ai ? "Your key" : "Add your key"}
            </button>
          </div>
          {msgs.length === 0 && (
            <>
              <div className="ask-suggest">
                {["What do I do here?", "Which screw goes where?", "Which way round does this go?"].map((s) => (
                  <button key={s} className="chip" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
              <p className="ask-note">{ai ? "Answers come with pictures of the parts. Snap a part to ask which one it is." : "Answers come with pictures of the parts. Runs on your own OpenRouter key, about a cent a build."}</p>
            </>
          )}
          <div className="msgs">
            {msgs.map((m, i) => {
              const last = i === msgs.length - 1;
              const a = m.role === "assistant" && !m.error ? readAnswer(m.content, plan, !(busy && last)) : null;
              return (
                <motion.div key={i} className={"msg " + m.role + (m.error ? " err" : "") + (a?.shows.length ? " pics" : "")} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {m.image && <img src={m.image} alt="Your photo" />}
                  {a ? a.text ? <p>{a.text}</p> : busy && last ? <span className="typing">Thinking</span> : null : <p>{m.content}</p>}
                  {a && a.shows.length > 0 && <Pictures plan={plan} index={index} shows={a.shows} onShow={onShow} onGoto={onGoto} />}
                  {m.error === "key" && (
                    <button className="msg-fix" onClick={() => onAddKey?.("key", "key")}>
                      <IKey size={14} /> Fix your key
                    </button>
                  )}
                  {m.error === "credits" && (
                    <a className="msg-fix" href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer">
                      Add credit <IExternal size={12} />
                    </a>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
        <form
          className="ask-bar"
          onSubmit={(e) => {
            e.preventDefault();
            ask(q);
          }}
        >
          <button type="button" className="btn round small" onClick={() => file.current?.click()} disabled={busy} aria-label="Which part is this? Take a photo" title="Which part is this?">
            <ICamera />
          </button>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type your question" aria-label="Your question" />
          <button type="submit" className="btn round small primary" disabled={busy || !q.trim()} aria-label="Send">
            <ISend />
          </button>
          <input
            ref={file}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const img = await shrink(f);
              ask("Which part is this?", img);
            }}
          />
        </form>
      </motion.aside>
    </motion.div>
  );
}

/** What an answer points at, drawn from this guide: the panel, the fitting, the step. */
function Pictures({ plan, index, shows, onShow, onGoto }: { plan: Plan; index: number; shows: Show[]; onShow?: (ids: string[] | null) => void; onGoto?: (index: number) => void }) {
  const id = plan.spec.name + plan.spec.variant;
  return (
    <div className="msg-pics">
      {shows.map((x) => {
        if (x.kind === "step") {
          const st = plan.steps[x.index];
          const here = x.index === index;
          return (
            <button key={"s" + x.index} className="pic step" disabled={here || !onGoto} onClick={() => onGoto?.(x.index)} aria-label={here ? `Step ${x.index + 1}, this step` : `Go to step ${x.index + 1}: ${st.title}`}>
              <Thumb id={id} plan={plan} mode={{ kind: "step", index: x.index }} w={260} h={190} className="pic-thumb" />
              <span className="pic-cap">
                <b>{here ? "This step" : `Step ${x.index + 1}`}</b>
                <span>{st.title}</span>
              </span>
            </button>
          );
        }
        if (x.kind === "part") {
          const p = plan.parts.find((p) => p.id === x.id)!;
          return (
            <figure key={"p" + p.id} className="pic" onMouseEnter={() => onShow?.([p.id])} onMouseLeave={() => onShow?.(null)}>
              <Thumb id={id} plan={plan} mode={{ kind: "part", ref: p.id }} w={260} h={190} className="pic-thumb" />
              <figcaption className="pic-cap">
                <b>
                  <span className="letter sm">{p.label}</span> {p.name}
                </b>
                <span>{p.qty} in the box</span>
              </figcaption>
            </figure>
          );
        }
        const h = plan.hardware.find((h) => h.id === x.id)!;
        return (
          <figure key={"h" + h.id} className="pic fit" onMouseEnter={() => onShow?.([h.id])} onMouseLeave={() => onShow?.(null)}>
            <span className="pic-art">
              <HwArt kind={h.kind} len={h.len} dia={h.dia} fit={76} />
            </span>
            <figcaption className="pic-cap">
              <b>{h.notIncluded ? (h.kind === "plug" ? "Wall plug" : "Wall screw") : h.name}</b>
              <span>{h.notIncluded ? "Not in the box" : [h.spec, `${h.qty} in the box`].filter(Boolean).join(", ")}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/** "This step doesn't match my box": goes to /api/feedback so wrong steps get fixed. */
function Report({ plan, index }: { plan: Plan; index: number }) {
  const [sent, setSent] = useState(false);
  const send = () => {
    setSent(true);
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: plan.spec.slug, name: plan.spec.name, variant: plan.spec.variant, match: false, step: index + 1, via: "help" }),
    }).catch(() => {});
  };
  return sent ? (
    <p className="report-done">Thanks. We&apos;ll check step {index + 1} against the real box. Trust the paper manual for now.</p>
  ) : (
    <button className="report-btn" onClick={send}>
      <IFlag size={16} /> This step doesn&apos;t match my box
    </button>
  );
}
