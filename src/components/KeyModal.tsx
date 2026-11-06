"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Figure } from "./art/Figure";
import { ICamera, ICheck, IClose, IExternal, IImage, IKey, ILock, IMic, IVolume, IWand } from "./art/Icons";
import { KEY_URL, setUserKey, useUserKey } from "@/lib/userKey";

/** What brought the person here: the modal leads with that. "key" is for checking or changing a saved key. */
export type KeyWhy = "voice" | "ask" | "photo" | "draft" | "key";
/** A key OpenRouter turned away, or an account out of credit. */
export type KeyTrouble = "key" | "credits";

const BILLING_URL = "https://openrouter.ai/settings/credits";

const FEATURES = {
  next: { icon: IMic, b: "Say “next”", rest: "and it moves on. Your hands stay on the build." },
  ask: { icon: IVolume, b: "Ask when you're stuck,", rest: "out loud or typed, and hear the answer." },
  see: { icon: IImage, b: "See the exact part", rest: "it means, drawn from your guide." },
  photo: { icon: ICamera, b: "Snap the box label", rest: "to find its guide." },
  draft: { icon: IWand, b: "Steps for any product,", rest: "even ones we don't have yet." },
};

const COPY: Record<KeyWhy, { title: (name?: string) => string; bubble: string; features: (keyof typeof FEATURES)[] }> = {
  voice: { title: () => "Go hands-free", bubble: "Next!", features: ["next", "ask", "see"] },
  ask: { title: () => "Ask about any step", bubble: "Which one?", features: ["ask", "see", "next"] },
  photo: { title: () => "Search with a photo", bubble: "Found it", features: ["photo", "ask", "next"] },
  draft: { title: (name) => (name ? `Steps for ${name}` : "Steps for any product"), bubble: "How?", features: ["draft", "next", "ask"] },
  key: { title: () => "Your OpenRouter key", bubble: "Hi!", features: ["next", "ask", "see"] },
};

/**
 * Asks for the person's own OpenRouter key, which every AI feature runs on:
 * what it unlocks, what it costs (about a cent a build) and where to get one.
 * Their key stays in this browser.
 */
export default function KeyModal({
  why,
  name,
  trouble,
  skip,
  onSkip,
  onClose,
  onSaved,
  onGesture,
}: {
  why: KeyWhy;
  /** The product, for "draft". */
  name?: string;
  trouble?: KeyTrouble | null;
  /** The quiet way out, e.g. "Just read it aloud", and what it does (closing, unless given). */
  skip?: string;
  onSkip?: () => void;
  /** Closed with no new key. */
  onClose: () => void;
  /** A working key was saved. */
  onSaved?: () => void;
  /** Runs inside the tap on Save, before anything waits: lets the guide start audio, which Safari only allows from a tap. */
  onGesture?: () => void;
}) {
  const key = useUserKey();
  const copy = COPY[why];
  const [editing, setEditing] = useState(!key || trouble === "key");
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "bad" | "busy" | "saved">("idle");
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  // closed while a key was still being checked: it isn't saved, and nothing starts
  const gone = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = () => {
    gone.current = true;
    onClose();
  };
  useEffect(() => {
    // set again on mount: React can mount a component twice in development
    gone.current = false;
    return () => {
      gone.current = true;
      clearTimeout(timer.current);
    };
  }, []);

  // keyboards start inside; on phones the field waits for a tap so the keyboard doesn't cover what it's for
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (fine && input.current) input.current.focus({ preventScroll: true });
    else box.current?.focus({ preventScroll: true });
    return () => back?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // closes this alone, not the help sheet or guide behind it
        e.preventDefault();
        e.stopImmediatePropagation();
        gone.current = true;
        onClose();
      } else if (e.key === "Tab" && box.current) {
        // focus stays inside while it's open
        const all = [...box.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input")];
        if (!all.length) return;
        const first = all[0],
          last = all[all.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function save(value = draft) {
    const k = value.trim();
    if (!k || state === "checking" || done.current) return;
    onGesture?.();
    setState("checking");
    let reason = "";
    try {
      const r = await fetch("/api/key", { method: "POST", headers: { "x-openrouter-key": k } });
      const j = (await r.json()) as { ok: boolean; reason?: string };
      // a check that couldn't run doesn't block the key: it's tried for real on first use
      reason = j.ok || j.reason === "unavailable" ? "" : (j.reason ?? "rejected");
    } catch {
      reason = "";
    }
    if (gone.current) return;
    if (reason) {
      setState(reason === "busy" ? "busy" : "bad");
      input.current?.focus();
      return;
    }
    done.current = true;
    setUserKey(k);
    setState("saved");
    // a beat to see "Saved"; closed in that beat, the key stays saved but nothing else starts
    timer.current = setTimeout(() => !gone.current && (onSaved ?? onClose)(), 650);
  }

  const bad = state === "bad" || state === "busy";
  const help =
    state === "bad"
      ? "OpenRouter didn't accept that key. Copy it again from your OpenRouter dashboard."
      : state === "busy"
        ? "That's a lot of tries. Wait a few minutes, then paste it again."
        : trouble === "key" && !draft
      ? "OpenRouter turned your saved key away. Paste a new one."
      : null;

  // on the body, so nothing it's opened from (a moving search box, a sheet) can clip or shift it
  return createPortal(
    <motion.div className="key-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.16 } }} onClick={close}>
      <motion.div
        ref={box}
        tabIndex={-1}
        className="key-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-title"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.16 } }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="key-x" onClick={close} aria-label="Close">
          <IClose size={18} />
        </button>

        <div className="key-hero" aria-hidden="true">
          <Figure pose="wave" size={92} />
          <span className="key-bubble">{copy.bubble}</span>
          <span className="key-tag">
            <IKey size={15} />
          </span>
        </div>

        <h2 id="key-title">{copy.title(name)}</h2>
        <p className="key-sub">Bygga&apos;s AI runs on your own OpenRouter key.</p>

        <ul className="key-feats">
          {copy.features.map((f) => {
            const { icon: Icon, b, rest } = FEATURES[f];
            return (
              <li key={f}>
                <span className="key-feat-ico">
                  <Icon size={17} />
                </span>
                <span>
                  <b>{b}</b> {rest}
                </span>
              </li>
            );
          })}
        </ul>

        {trouble === "credits" ? (
          <div className="key-cost out">
            <span className="key-cent">$0</span>
            <span>
              <b>Your OpenRouter credit ran out.</b>
              <a href={BILLING_URL} target="_blank" rel="noreferrer">
                Add credit <IExternal size={12} />
              </a>{" "}
              and it picks up where it left off.
            </span>
          </div>
        ) : (
          <div className="key-cost">
            <span className="key-cent">1¢</span>
            <span>
              <b>About a cent a build.</b> A few cents if the room is busy. $5 of credit lasts 100+ builds.
            </span>
          </div>
        )}

        {!editing && key ? (
          <div className="key-have">
            <span className="key-have-ico">{state === "saved" ? <ICheck size={17} strokeWidth={2.6} /> : <IKey size={17} />}</span>
            <span className="key-have-text">
              <b>Key saved</b>
              <span>Ending in {key.slice(-4)}</span>
            </span>
            <button
              className="link-btn"
              onClick={() => {
                setEditing(true);
                setTimeout(() => input.current?.focus(), 30);
              }}
            >
              Change
            </button>
            <button className="link-btn" onClick={() => setUserKey("")}>
              Remove
            </button>
          </div>
        ) : (
          <form
            className={"key-form" + (bad ? " bad" : "") + (state === "saved" ? " saved" : "")}
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label className="key-input">
              <IKey size={17} />
              <input
                ref={input}
                type="password"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (bad) setState("idle");
                }}
                // a pasted key is the whole key: no need to also press Save
                onPaste={(e) => {
                  const v = e.clipboardData.getData("text").trim();
                  if (v.length < 20) return;
                  e.preventDefault();
                  setDraft(v);
                  save(v);
                }}
                placeholder="Paste your key"
                aria-label="OpenRouter API key"
                aria-invalid={bad}
                aria-describedby="key-help"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="done"
              />
            </label>
            <button className="btn primary key-save" type="submit" disabled={!draft.trim() || state === "checking" || state === "saved"}>
              {state === "saved" ? (
                <>
                  <ICheck size={17} strokeWidth={2.8} /> Saved
                </>
              ) : state === "checking" ? (
                "Checking"
              ) : (
                "Save"
              )}
            </button>
          </form>
        )}

        <p id="key-help" className={"key-help" + (help ? " bad" : "")} role={help ? "alert" : undefined}>
          {help ?? (
            <>
              No key yet?{" "}
              <a href={KEY_URL} target="_blank" rel="noreferrer">
                Make one at openrouter.ai <IExternal size={12} />
              </a>
            </>
          )}
        </p>
        <p className="key-safe">
          <ILock size={13} /> Stays in this browser. Bygga never stores it.
        </p>

        {skip && (
          <button
            className="key-skip"
            onClick={() => {
              gone.current = true;
              (onSkip ?? onClose)();
            }}
          >
            {skip}
          </button>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
