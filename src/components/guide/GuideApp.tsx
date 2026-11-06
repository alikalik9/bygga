"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { Plan, ProductSpec, ToolId } from "@/lib/types";
import { catalogSpec } from "@/lib/catalog";
import { buildPlan } from "@/lib/plan";
import { stepContents } from "@/lib/plan/contents";
import { matchCatalog, specForKind } from "@/lib/search";
import { KIND_LABELS, type Kind } from "@/lib/products";
import { BREAK_MS, cacheSpec, cachedSpec, getPref, isBuilt, loadProgress, saveProgress, setPref, uncacheSpec, type Phase, type Progress } from "@/lib/store";
import StageView, { type StageHandle } from "../StageView";
import type { StageMode } from "@/engine/stage";
import { LogoMark } from "../Logo";
import { HwArt } from "../art/Hardware";
import { Figure } from "../art/Figure";
import { ICheck, IGrid, IHelp, IMic, IPause, IPlay, IReplay, IRotate, IScan, ISound, ISoundOff, ISparkle } from "../art/Icons";
import CoverPanel from "./CoverPanel";
import ToolsPanel from "./ToolsPanel";
import PartsPanel from "./PartsPanel";
import StepPanel from "./StepPanel";
import DonePanel, { Confetti } from "./DonePanel";
import Feedback from "./Feedback";
import HelpSheet from "./HelpSheet";
import Overview from "./Overview";
import Loader from "./Loader";
import Drawing from "../Drawing";
import { haptic, micSupported, primeListening, useListener, useWakeLock, type Mic } from "./hooks";
import { playDone, playStep, playTick, setSound, soundOn } from "./sound";
import { mediaSession, voice } from "./voice";
import { LINES, builtLine, needsLine, spokenAnswer, stepLines, toolsLine, whereLine } from "@/lib/voice/script";
import { hearIntent, type Intent } from "@/lib/voice/commands";
import { useMounted } from "@/lib/useMounted";
import { getUserKey, keyHeaders, useUserKey } from "@/lib/userKey";
import KeyModal, { type KeyTrouble, type KeyWhy } from "../KeyModal";
import { decodeSpec } from "@/lib/scan/share";
import { track } from "@vercel/analytics";
import { SCAN_ENABLED } from "@/lib/site";

type Via = "catalog" | "ai" | "guess" | "scan";

export default function GuideApp({ slug, query, step, kind }: { slug: string; query?: string; step?: number; kind?: string }) {
  const router = useRouter();
  const mounted = useMounted();
  const picked = KIND_LABELS.some((k) => k.kind === kind) ? (kind as Kind) : null;
  const isScan = slug.startsWith("scan-");
  const q = query || slug.replace(/-/g, " ");
  const initial = useMemo(() => (isScan ? null : (catalogSpec(slug) ?? (picked ? { ...specForKind(picked, q.split(" ")[0] || q), slug } : null))), [isScan, slug, picked, q]);
  // asked again after a key was added: a typical build gives way to one worked out for this product
  const [attempt, setAttempt] = useState(0);
  // a build saved under this name (an AI draft, a picked shape) wins over a near-miss in the catalog
  const stored = useMemo(() => (mounted && !initial ? (cachedSpec(slug) ?? loadProgress(slug)?.spec ?? null) : null), [mounted, initial, slug, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const match = useMemo(() => (initial || isScan ? null : matchCatalog(q)), [initial, isScan, q]);
  const local = stored ? null : match;
  const [imported, setImported] = useState<{ slug: string; spec: ProductSpec | null } | null>(null);
  const cached = stored ?? (imported?.slug === slug ? imported.spec : null);
  const hash = useMemo(() => (mounted && isScan && location.hash.startsWith("#g=") ? location.hash.slice(3) : ""), [mounted, isScan]);

  // a scanned guide shared as a link carries its own data
  useEffect(() => {
    if (!hash) return;
    let alive = true;
    decodeSpec(hash).then((sp) => {
      if (!alive) return;
      if (sp) cacheSpec(slug, { ...sp, slug });
      setImported({ slug, spec: sp ? { ...sp, slug } : null });
      history.replaceState(null, "", location.pathname + location.search);
    });
    return () => {
      alive = false;
    };
  }, [hash, slug]);
  useEffect(() => {
    if (mounted && local?.slug && local.slug !== slug) router.replace(`/build/${local.slug}` + (step ? `?step=${step}` : ""));
  }, [mounted, local, slug, step, router]);
  const [fetched, setFetched] = useState<{ slug: string; spec?: ProductSpec; via?: Via; suggestions?: string[]; ikea?: string; error?: boolean; trouble?: KeyTrouble } | null>(null);
  // every AI feature runs on the person's own key
  const key = useUserKey();
  const ai = !!key;
  const [askKey, setAskKey] = useState<KeyTrouble | "" | null>(null);
  const again = () => {
    uncacheSpec(slug);
    setFetched(null);
    setAttempt((a) => a + 1);
  };
  const result = fetched?.slug === slug ? fetched : null;
  const spec = initial ?? cached ?? result?.spec ?? null;
  const via: Via = initial ? (initial.source === "guess" ? "guess" : "catalog") : cached ? cached.source : (result?.via ?? "ai");
  const scanGone = isScan && mounted && !cached && (!hash || (imported?.slug === slug && !imported.spec));
  const status = spec ? "ready" : scanGone ? "scangone" : result ? (result.error ? "error" : "notfound") : "loading";
  const suggestions = result?.suggestions ?? [];

  useEffect(() => {
    voice.live = !!key;
  }, [key]);

  // resolve unknown products through the API
  useEffect(() => {
    if (!mounted || initial || cached || local || isScan) return;
    let alive = true;
    fetch("/api/guide", { method: "POST", headers: { "Content-Type": "application/json", ...keyHeaders() }, body: JSON.stringify({ q }) })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.spec) {
          const sp = j.spec as ProductSpec;
          if (j.via === "catalog" && sp.slug && sp.slug !== slug) {
            router.replace(`/build/${sp.slug}` + (step ? `?step=${step}` : ""));
            return;
          }
          sp.slug = slug;
          // a typical build is only a stand-in: not kept, so the next visit (with a key, say) can ask for the real thing
          if (j.via !== "guess") cacheSpec(slug, sp);
          setFetched({ slug, spec: sp, via: j.via, trouble: j.trouble });
        } else setFetched({ slug, suggestions: j.suggestions ?? [], ikea: j.ikea, trouble: j.trouble });
      })
      .catch(() => alive && setFetched({ slug, error: true }));
    return () => {
      alive = false;
    };
  }, [mounted, initial, cached, local, isScan, slug, q, step, router, attempt]);

  const plan = useMemo(() => {
    if (!spec) return null;
    try {
      return buildPlan(spec);
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [spec]);

  const draftKey = (
    <AnimatePresence>
      {askKey !== null && (
        <KeyModal
          why="draft"
          name={(spec?.name ?? q.split(" ")[0]).toUpperCase()}
          trouble={askKey || null}
          onClose={() => setAskKey(null)}
          onSaved={() => {
            // with a key, ask again: this time AI works the product out
            setAskKey(null);
            again();
          }}
        />
      )}
    </AnimatePresence>
  );

  if (status === "scangone")
    return (
      <Shell title="Scanned guide">
        <div className="notfound">
          <Figure pose="think" bubble="?" size={120} />
          <h1>This guide lives on another device</h1>
          <p className="sub">Scanned guides are saved in the browser that made them. Ask for a share link from the done screen{SCAN_ENABLED ? ", or scan the manual again" : ""}.</p>
          <Link href={SCAN_ENABLED ? "/scan" : "/"} className="btn primary">
            {SCAN_ENABLED ? "Scan a manual" : "Back to search"}
          </Link>
        </div>
      </Shell>
    );
  if (status === "loading")
    return (
      <Shell title={isScan ? "Scanned guide" : q.toUpperCase()}>
        <Loader query={isScan ? "your guide" : q} ai={ai} />
      </Shell>
    );
  if (status === "notfound" || status === "error" || !plan)
    return (
      <Shell title={q.toUpperCase()}>
        <NotFound
          query={q}
          slug={slug}
          suggestions={suggestions}
          ikea={result?.ikea}
          error={status === "error"}
          ai={ai}
          trouble={result?.trouble}
          onAddKey={() => setAskKey(result?.trouble ?? "")}
          onRetry={again}
        />
        {draftKey}
      </Shell>
    );
  // a typical build, not yet started, can still be swapped for one worked out with the person's key
  const trouble = result?.trouble;
  const ownSteps =
    via === "guess" && !initial && mounted && !loadProgress(slug)
      ? !ai
        ? { text: `Add your OpenRouter key for ${plan.spec.name}'s own steps`, act: () => setAskKey("") }
        : trouble === "key"
          ? { text: `OpenRouter turned your key away. Fix it for ${plan.spec.name}'s own steps`, act: () => setAskKey("key") }
          : trouble === "credits"
            ? { text: "Your OpenRouter credit ran out. Top it up, then tap here to try again", act: again }
            : { text: `Try again for ${plan.spec.name}'s own steps`, act: again }
      : undefined;
  return (
    <>
      <Guide key={slug + (picked ?? "")} plan={plan} slug={slug} via={via} ai={ai} startStep={step} onOwnSteps={ownSteps} />
      {draftKey}
    </>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="guide shell">
      <header className="topbar">
        <Link href="/" className="home-btn" aria-label="Bygga home">
          <LogoMark size={34} />
        </Link>
        <div className="tb-title">
          <b>{title}</b>
        </div>
      </header>
      <main className="shell-main">{children}</main>
    </div>
  );
}

function NotFound({
  query,
  slug,
  suggestions,
  ikea,
  error,
  ai,
  trouble,
  onAddKey,
  onRetry,
}: {
  query: string;
  slug: string;
  suggestions: string[];
  ikea?: string;
  error: boolean;
  ai: boolean;
  trouble?: KeyTrouble;
  onAddKey: () => void;
  onRetry: () => void;
}) {
  const name = query.split(" ")[0].toUpperCase();
  const what = ikea?.toLowerCase();
  const kinds = KIND_LABELS;
  if (error)
    return (
      <div className="notfound">
        <Figure pose="think" bubble="?" size={120} />
        <h1>Something went wrong</h1>
        <p className="sub">Check your connection and try again.</p>
        <Link href="/" className="btn primary">
          Back to search
        </Link>
      </div>
    );
  return (
    <div className="notfound wide">
      <div className="nf-head">
        <Figure pose="think" bubble="?" size={96} />
        <div>
          {what ? (
            <>
              <h1>
                {name} is {/^[aeiou]/.test(what) ? "an" : "a"} {what}
              </h1>
              <p className="sub">
                We can&apos;t draw {what.replace(/s$/, "")}s step by step yet, so trust the paper manual for this one.{" "}
                <a href={`https://www.ikea.com/search/?q=${encodeURIComponent(name)}`} target="_blank" rel="noreferrer">
                  Find it on ikea.com
                </a>
                . If it looks like one of these, a typical build can still help.
              </p>
            </>
          ) : (
            <>
              <h1>What does {name} look like?</h1>
              <p className="sub">We don&apos;t have {name} on file yet. Pick the closest shape and we&apos;ll walk you through a typical build.</p>
            </>
          )}
        </div>
      </div>
      {!what && (!ai || trouble) && (
        <div className="nf-ai">
          <ISparkle size={18} />
          <span>
            {trouble === "credits" ? (
              <>
                <b>Your OpenRouter credit ran out.</b>{" "}
                <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer">
                  Top it up
                </a>{" "}
                and AI can work out {name}&apos;s own steps.
              </>
            ) : trouble === "key" ? (
              <>
                <b>OpenRouter turned your key away.</b> Fix it and AI can work out {name}&apos;s own steps.
              </>
            ) : (
              <>
                <b>Want {name}&apos;s own steps?</b> Add your OpenRouter key and AI works them out, for about a cent.
              </>
            )}
          </span>
          <button className="btn nf-ai-go" onClick={trouble === "credits" ? onRetry : onAddKey}>
            {trouble === "credits" ? "Try again" : trouble ? "Fix it" : "Add key"}
          </button>
        </div>
      )}
      <div className="kind-grid">
        {kinds.map((k, i) => (
          <motion.div key={k.kind} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.025 }}>
            <Link className="kind-card" href={`/build/${slug}?q=${encodeURIComponent(query)}&kind=${k.kind}`}>
              <Drawing name={"kind-" + k.kind} w={200} h={150} className="kind-thumb" eager />
              <span>{k.label}</span>
            </Link>
          </motion.div>
        ))}
      </div>
      {suggestions.length > 0 && (
        <div className="chips center">
          <span className="muted">Or did you mean</span>
          {suggestions.map((s) => (
            <Link key={s} className="chip" href={`/build/${encodeURIComponent(s.toLowerCase().replace(/\s+/g, "-"))}?q=${encodeURIComponent(s)}`}>
              {s}
            </Link>
          ))}
        </div>
      )}
      {SCAN_ENABLED && (
        <Link href="/scan" className="scan-link nf-scan">
          <IScan size={17} />
          <span>
            Not from IKEA? <u>Scan its paper manual</u>
          </span>
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Guide({ plan, slug, via, ai, startStep, onOwnSteps }: { plan: Plan; slug: string; via: Via; ai: boolean; startStep?: number; onOwnSteps?: { text: string; act: () => void } }) {
  const steps = plan.steps;
  const deep = startStep ? Math.min(startStep, steps.length) - 1 : null;
  const [phase, setPhase] = useState<Phase>(deep !== null ? "steps" : "cover");
  const [step, setStep] = useState(deep ?? 0);
  const [dir, setDir] = useState(1);
  const [tools, setTools] = useState<string[]>([]);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [startedAt, setStartedAt] = useState<number | undefined>();
  const [doneAt, setDoneAt] = useState<number | undefined>();
  const [resume, setResume] = useState<Progress | null>(null);
  const [maxStep, setMaxStep] = useState(0);
  const [reached, setReached] = useState(deep !== null ? 3 : 0);
  const [help, setHelp] = useState<null | { missing?: boolean; ask?: string; at?: number }>(null);
  const [overview, setOverview] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [offer, setOffer] = useState(true);
  const [usedVoice, setUsedVoice] = useState(false);
  const [hl, setHl] = useState<string[] | null>(null);
  const [hover3d, setHover3d] = useState<string | null>(null);
  const [introPlayed, setIntroPlayed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [slow, setSlow] = useState(false);
  const [moved, setMoved] = useState(false);
  const [stamp, setStamp] = useState(0);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [sound, setSoundState] = useState(true);
  const [seen, setSeen] = useState<number[]>(deep !== null ? [deep] : []);
  const [built, setBuilt] = useState<{ at: number; ms?: number; full?: boolean } | null>(null);
  const [finish, setFinish] = useState<{ ms: number; full: boolean } | null>(null);
  // building time: gaps longer than a break are left out, and so is time on the cover or the done screen
  const clock = useRef({ at: 0, ms: 0, live: false });
  const stage = useRef<StageHandle | null>(null);
  const mounted = useMounted();
  const key = useUserKey();
  const canListen = mounted && ai && micSupported();
  // asking for a key: why, and what to do once there is one
  const [askKey, setAskKey] = useState<{ why: KeyWhy; trouble?: KeyTrouble; then?: "voice" | "tip" } | null>(null);
  // a guide with no recordings (an AI draft) can't be read aloud without a key either
  const [readable, setReadable] = useState(true);
  // bumped after the key modal closes on a key problem (a top-up, say), so listening tries again
  const [listenTry, setListenTry] = useState(0);

  // restore progress once we are in the browser
  const [restored, setRestored] = useState(false);
  if (mounted && !restored) {
    setRestored(true);
    setSoundState(soundOn());
    setUsedVoice(getPref("voice", false));
    const p = loadProgress(slug);
    // a save made with another shape picked under the same name doesn't fit this plan
    const fits = p && (!p.spec || (p.spec.archetype === plan.spec.archetype && p.spec.variant === plan.spec.variant));
    if (p && fits) {
      setResume(p);
      setTools(p.tools);
      setMissing(new Set(p.missing ?? []));
      setStartedAt(p.startedAt);
      setMaxStep(Math.min(p.step, steps.length - 1));
      setReached(Math.max(deep !== null ? 3 : 0, PHASES.indexOf(p.phase)));
      setSeen((x) => [...new Set([...(p.seen ?? []), ...x])]);
      if (p.doneAt) setDoneAt(p.doneAt);
      if (isBuilt(p)) setBuilt({ at: p.builtAt ?? p.doneAt ?? p.updatedAt, ms: p.builtMs, full: p.builtFull });
    }
  }
  useEffect(() => {
    if (restored) clock.current = { at: Date.now(), ms: resume?.activeMs ?? 0, live: deep !== null };
    // only once, when the save has been read
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  // persist
  useEffect(() => {
    if (!restored || phase === "cover") return;
    saveProgress({
      slug,
      name: plan.spec.name,
      variant: plan.spec.variant,
      category: plan.spec.category,
      minutes: plan.spec.minutes,
      people: plan.spec.people,
      phase,
      step,
      steps: steps.length,
      tools,
      parts: [],
      missing: [...missing],
      startedAt,
      doneAt,
      updatedAt: Date.now(),
      spec: plan.spec.source === "catalog" ? undefined : plan.spec,
      activeMs: clock.current.ms,
      seen,
      builtAt: built?.at,
      builtMs: built?.ms,
      builtFull: built?.full,
    });
  }, [restored, slug, plan, phase, step, tools, missing, startedAt, doneAt, steps.length, seen, built]);

  useWakeLock(phase === "steps" || phase === "parts");

  const go = useCallback((p: Phase, s?: number, d = 1) => {
    const c = clock.current, now = Date.now();
    if (c.live && c.at) c.ms += Math.min(now - c.at, BREAK_MS);
    c.at = now;
    c.live = p !== "cover" && p !== "done";
    setDir(d);
    setPhase(p);
    setReached((r) => Math.max(r, PHASES.indexOf(p)));
    if (s !== undefined) {
      setStep(s);
      setMaxStep((m) => Math.max(m, s));
      if (p === "steps") setSeen((x) => (x.includes(s) ? x : [...x, s]));
    }
    setHl(null);
    setMoved(false);
    if (p === "done") setDoneAt((x) => x ?? Date.now());
    // back on the cover, "Continue at step N" should name where you just were
    if (p === "cover") setResume(loadProgress(slug));
  }, [slug]);

  const showToast = useCallback((text: string) => {
    const id = Date.now();
    setToast({ id, text });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 2600);
  }, []);

  const next = useCallback(() => {
    haptic(12);
    if (phase === "cover") {
      setStartedAt((x) => x ?? Date.now());
      go("tools");
    } else if (phase === "tools") go("parts");
    else if (phase === "parts") go("steps", 0);
    else if (phase === "steps") {
      setStamp((x) => x + 1);
      if (step < steps.length - 1) {
        playStep();
        const n = step + 1;
        const half = Math.floor(steps.length / 2);
        if (steps.length >= 6 && n === half) showToast("Halfway there. Nice work.");
        else if (n === steps.length - 1 && steps.length >= 4) showToast("Last step coming up.");
        go("steps", n);
      } else {
        playDone();
        go("done");
        const ms = clock.current.ms;
        // skipping through doesn't earn a time: most of the steps have to have been on screen
        const full = new Set([...seen, step]).size >= Math.ceil(steps.length * 0.8);
        setFinish({ ms, full });
        track("built", { product: plan.spec.name, slug, full, minutes: Math.round(ms / 60000) });
        setBuilt((b) => (!b ? { at: Date.now(), ms, full } : full && (!b.full || !b.ms || ms < b.ms) ? { ...b, ms, full } : b));
      }
    }
  }, [phase, step, steps.length, go, showToast, seen, plan.spec.name, slug]);

  const back = useCallback(() => {
    if (phase === "tools") go("cover", undefined, -1);
    else if (phase === "parts") go("tools", undefined, -1);
    else if (phase === "steps") {
      if (step > 0) go("steps", step - 1, -1);
      else go("parts", undefined, -1);
    } else if (phase === "done") go("steps", steps.length - 1, -1);
  }, [phase, step, steps.length, go]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (help || overview || askKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (phase !== "steps" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
        // a focused button or link answers its own Enter; holding a key shouldn't race through steps
        if ((t?.tagName === "BUTTON" || t?.tagName === "A") && (e.key === " " || e.key === "Enter")) return;
        if (e.repeat) return;
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (!e.repeat) back();
      } else if (e.key.toLowerCase() === "r") stage.current?.replay();
      else if (e.key === "?") setHelp({});
      else if (e.key.toLowerCase() === "o") setOverview(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, next, back, help, overview, askKey]);

  // the phone's back gesture steps back through the guide instead of leaving it
  const nav = useRef({ phase, back });
  useEffect(() => {
    nav.current = { phase, back };
  });
  const guard = useRef(false);
  const [pops, setPops] = useState(0);
  useEffect(() => {
    if (phase === "cover" || guard.current) return;
    history.pushState({ bygga: "step" }, "");
    guard.current = true;
  }, [phase, pops]);
  useEffect(() => {
    const onPop = () => {
      if (!guard.current) return;
      guard.current = false;
      if (nav.current.phase === "cover") return;
      nav.current.back();
      setPops((n) => n + 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /* ---------- voice ---------- */

  const said = useRef("");
  const micRef = useRef<Mic>("off");
  const live = useRef({ next, back, step, voiceOn, asking: false });
  useEffect(() => {
    live.current = { next, back, step, voiceOn, asking: !!askKey };
  });
  useEffect(() => voice.subscribe(setSpeaking), []);
  useEffect(() => () => voice.stop(), []);
  useEffect(() => {
    voice.rate = slow ? 0.9 : 1;
  }, [slow]);

  // runs inside the tap or key press, so the browser lets it play sound
  const startVoice = useCallback(() => {
    voice.unlock();
    // read now, not from the render: a key saved a moment ago counts
    const listen = micSupported() && !!getUserKey();
    if (listen) primeListening();
    track("voice_on", { product: plan.spec.name, listen });
    setVoiceOn(true);
    setOffer(false);
    setPref("voice", true);
    said.current = String(step);
    voice.say([LINES.on, ...stepLines(plan, step)]).then((ok) => {
      if (!ok) return;
      // by now the mic has either started or been refused, so the tip matches what works
      const m = micRef.current;
      voice.say([listen && (m === "on" || m === "asking" || m === "off") ? LINES.sayNext : LINES.tapNext]);
    });
  }, [plan, step]);

  // with no key yet, turning the voice on first says what a key adds; once skipped, it just reads for the rest of the visit
  const turnOnVoice = useCallback(() => {
    if (getUserKey() || !micSupported() || skippedKey()) return startVoice();
    // still inside the tap: Safari lets sound start later only if it was unlocked here
    voice.unlock();
    primeListening();
    setAskKey({ why: "voice", then: "voice" });
    voice.readable(stepLines(plan, step)).then(setReadable);
  }, [startVoice, plan, step]);

  const stopVoice = useCallback((confirm = false) => {
    setVoiceOn(false);
    setPref("voice", false);
    if (confirm) voice.say([LINES.off]);
    else voice.stop();
  }, []);

  // read each step as it comes up, and line up the next one
  useEffect(() => {
    if (!voiceOn) return;
    if (phase === "done") {
      if (said.current === "done") return;
      const t = setTimeout(() => {
        said.current = "done";
        voice.say([builtLine(plan)]);
      }, 700);
      return () => clearTimeout(t);
    }
    if (phase !== "steps" || said.current === String(step)) return;
    const t = setTimeout(() => {
      said.current = String(step);
      voice.say(stepLines(plan, step));
    }, 250);
    if (step + 1 < steps.length) voice.prefetch(stepLines(plan, step + 1));
    return () => clearTimeout(t);
  }, [voiceOn, phase, step, plan, steps.length]);

  const run = (intent: Intent) => {
    haptic(10);
    if (intent.kind !== "next") playTick();
    switch (intent.kind) {
      case "next":
        // quiet at once, so it's plain she heard
        voice.stop();
        setHelp(null);
        setOverview(false);
        next();
        break;
      case "back":
        if (step === 0) voice.say([LINES.first]);
        else {
          voice.stop();
          back();
        }
        break;
      case "repeat":
        stage.current?.replay();
        voice.say(stepLines(plan, step));
        break;
      case "replay":
        stage.current?.replay();
        break;
      case "stop":
        voice.stop();
        break;
      case "needs": {
        const tools = toolsLine(plan, step);
        voice.say([needsLine(plan, step) ?? LINES.nothing, ...(tools ? [tools] : [])]);
        break;
      }
      case "where":
        voice.say([whereLine(step, steps.length)]);
        break;
      case "slower":
        setSlow(true);
        voice.rate = 0.9;
        voice.say([LINES.slower]);
        break;
      case "faster":
        setSlow(false);
        voice.rate = 1;
        voice.say([LINES.normal]);
        break;
      case "help":
        voice.stop();
        setHelp({});
        break;
      case "commands":
        voice.say([LINES.commands]);
        break;
      case "off":
        stopVoice(true);
        break;
      case "goto": {
        const n = intent.step === -1 ? steps.length : intent.step;
        if (n >= 1 && n <= steps.length && n - 1 !== step) {
          voice.stop();
          go("steps", n - 1, n - 1 > step ? 1 : -1);
        }
        break;
      }
      case "ask":
        if (!ai) voice.say([LINES.noAnswer]);
        else {
          voice.say([LINES.checking]);
          setHelp((h) => ({ ...h, ask: intent.text, at: Date.now() }));
        }
        break;
    }
  };

  const { mic, heard } = useListener(
    voiceOn && phase === "steps" && canListen,
    `${key}#${listenTry}`,
    (text, seg) => {
      // nothing acts while the key modal is open
      if (askKey) return null;
      // what's left of her in the mic is set aside by when she said it; then "next" anywhere moves on
      const intent = hearIntent(text, seg, voice.linesBetween(seg.start, seg.end), voice.busy || voice.spokeBetween(seg.start, seg.end));
      if (!intent) return null;
      run(intent);
      return intent.kind === "next" ? "next" : text.trim().replace(/[.!?]+$/, "");
    },
    () => voice.busy,
  );

  useEffect(() => {
    micRef.current = mic;
  }, [mic]);

  const speakAnswer = useCallback((text: string) => {
    if (live.current.voiceOn) voice.say(spokenAnswer(text));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== "v" || e.metaKey || e.ctrlKey || e.repeat || phase !== "steps" || help || overview || askKey || t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;
      // the key field opens focused: the "v" mustn't land in it
      e.preventDefault();
      if (voiceOn) stopVoice();
      else turnOnVoice();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, help, overview, askKey, voiceOn, turnOnVoice, stopVoice]);

  // headphone buttons and the lock screen: next track, previous track
  useEffect(() => {
    if (!voiceOn || phase !== "steps") return;
    return mediaSession(
      { title: `Step ${step + 1} of ${steps.length}`, artist: plan.spec.name },
      {
        next: () => !live.current.asking && live.current.next(),
        back: () => !live.current.asking && live.current.back(),
        play: () => voice.say(stepLines(plan, live.current.step)),
        pause: () => voice.stop(),
      },
    );
  }, [voiceOn, phase, step, steps.length, plan]);

  useEffect(() => {
    const s = plan.spec;
    // the cover keeps the page's own title; steps and the end say where you are
    document.title =
      phase === "steps" ? `Step ${step + 1} of ${steps.length}, ${s.name} | Bygga` : phase === "done" ? `Built: ${s.name} | Bygga` : `${s.name} ${s.variant.toLowerCase()}: assembly step by step | Bygga`;
  }, [phase, step, steps.length, plan.spec]);

  const mode: StageMode = useMemo(() => {
    if (phase === "cover") return introPlayed || resume ? { kind: "assembled", turntable: true, dims: true } : { kind: "intro", dims: true };
    if (phase === "tools" || phase === "done") return { kind: "assembled", turntable: true };
    if (phase === "parts") return { kind: "layout" };
    return { kind: "step", index: step };
  }, [phase, step, introPlayed, resume]);

  const highlight = hl ?? (hover3d ? [hover3d] : null);
  const cur = steps[step];
  const contents = phase === "steps" ? stepContents(plan, step) : null;

  const jump = (p: Phase) => {
    if (p === "steps") go("steps", Math.min(maxStep, steps.length - 1), PHASES.indexOf(p) >= PHASES.indexOf(phase) ? 1 : -1);
    else go(p, undefined, PHASES.indexOf(p) >= PHASES.indexOf(phase) ? 1 : -1);
  };

  return (
    <div className="guide" data-phase={phase} data-voice={voiceOn ? "on" : undefined}>
      <header className="topbar">
        <Link href="/" className="home-btn" aria-label="Bygga home">
          <LogoMark size={34} />
        </Link>
        <div className="tb-title">
          <b>{plan.spec.name}</b>
          <span>{plan.spec.variant}</span>
        </div>
        <Stepper phase={phase} step={step} total={steps.length} reached={reached} onJump={jump} />
        <div className="tb-actions">
          {phase === "steps" && (
            <button className="icon-btn" onClick={() => setOverview(true)} aria-label="All steps" data-tip="All steps">
              <IGrid />
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => {
              setSound(!sound);
              setSoundState(!sound);
            }}
            aria-pressed={sound}
            aria-label={sound ? "Sound on" : "Sound off"}
            data-tip={sound ? "Sound on" : "Sound off"}
          >
            {sound ? <ISound /> : <ISoundOff />}
          </button>
          {phase === "steps" && (
            <button className={"voice-btn" + (voiceOn ? " on" : "")} onClick={() => (voiceOn ? stopVoice() : turnOnVoice())} aria-pressed={voiceOn} aria-label={voiceOn ? "Turn voice off" : "Turn voice on"} data-tip="Voice (V)">
              <IMic size={18} />
              <span>{voiceOn ? "Voice on" : "Voice"}</span>
            </button>
          )}
          <Feedback ctx={{ slug: plan.spec.slug ?? slug, name: plan.spec.name, variant: plan.spec.variant, phase, step: phase === "steps" ? step + 1 : undefined }} />
          <button className="icon-btn" onClick={() => setHelp({})} aria-label="Help" data-tip="Help">
            <IHelp />
          </button>
        </div>
      </header>

      <main className="guide-main">
        <section className="sheet" aria-label="Assembly drawing">
          <StageView
            plan={plan}
            mode={mode}
            highlight={highlight}
            paused={paused}
            speed={slow ? 0.5 : 1}
            options={{ callout: true, interactive: true }}
            onReady={(h) => (stage.current = h)}
            onIntroDone={() => setIntroPlayed(true)}
            onHover={setHover3d}
            onUserView={setMoved}
          />

          {phase === "steps" && cur && (
            <div className="corner" aria-hidden="true">
              <div className="num-wrap">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={step}
                    className="big-n"
                    initial={{ y: 46 * dir, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -46 * dir, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  >
                    {step + 1}
                  </motion.span>
                </AnimatePresence>
                {cur.repeat && cur.repeat > 1 && <span className="corner-repeat">{cur.repeat}&times;</span>}
              </div>
              {contents && contents.hardware.length > 0 && (
                <motion.div key={"hw" + step} className="hw-box" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.35 }}>
                  {contents.hardware.slice(0, 4).map(({ type, count }) => (
                    <span key={type.id} className={"hw-box-item" + (highlight?.includes(type.id) ? " lit" : "")}>
                      <HwArt kind={type.kind} len={type.len} dia={type.dia} fit={40} />
                      <b>{count}&times;</b>
                    </span>
                  ))}
                </motion.div>
              )}
            </div>
          )}

          <AnimatePresence>
            {stamp > 0 && phase === "steps" && (
              <motion.span
                key={stamp}
                className="stamp"
                initial={{ scale: 0.3, opacity: 0, rotate: -20 }}
                animate={{ scale: [0.3, 1.12, 1], opacity: [0, 1, 1, 0], rotate: 0 }}
                transition={{ duration: 0.85, times: [0, 0.35, 0.6, 1] }}
              >
                <ICheck size={34} strokeWidth={3} />
              </motion.span>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {toast && (
              <motion.div key={toast.id} className="toast" initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}>
                <Figure pose="cheer" size={40} />
                <span>{toast.text}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {phase === "steps" && (
            <div className="stage-ctl">
              <button className="icon-btn float" onClick={() => stage.current?.replay()} aria-label="Replay animation" data-tip="Replay (R)">
                <IReplay />
              </button>
              <button className="icon-btn float" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play" : "Pause"} data-tip={paused ? "Play" : "Pause"}>
                {paused ? <IPlay /> : <IPause />}
              </button>
              <button className={"pill-btn float" + (slow ? " on" : "")} onClick={() => setSlow(!slow)} aria-pressed={slow}>
                Slow
              </button>
              <AnimatePresence>
                {moved && (
                  <motion.button initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="pill-btn float" onClick={() => stage.current?.resetView()}>
                    <IRotate size={15} /> Reset view
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          )}
          {phase === "steps" && step === 0 && !moved && <span className="drag-hint">Drag to turn it around</span>}
          {phase === "parts" && <span className="sheet-caption">Lay your panels out like this</span>}
          {voiceOn && phase === "steps" && (
            <div className="listening" role="status">
              <span className={"eq" + (speaking ? " on" : "")} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="listening-text">
                {!canListen && mounted && micSupported()
                  ? "Reading aloud"
                  : mic === "refused"
                    ? "OpenRouter turned your key away"
                    : mic === "credits"
                      ? "Your OpenRouter credit ran out"
                      : heard
                  ? `Heard “${heard}”`
                  : mic === "on"
                    ? "Say “next” when you're ready"
                    : mic === "paused"
                      ? "Tap anywhere to keep listening"
                      : mic === "asking"
                        ? "Allow the microphone, then say “next”"
                        : mic === "denied"
                          ? "Mic is blocked. Tap done to move on"
                          : mic === "busy"
                            ? "Another app has the mic. Tap done to move on"
                            : mic === "nomic"
                              ? "No microphone found. Tap done to move on"
                              : mic === "offline"
                                ? "Can't listen right now. Tap done to move on"
                                : mic === "unsupported" || !canListen
                                  ? "Reading aloud. Tap done to move on"
                                  : "Turning on the mic"}
              </span>
              {((!canListen && mounted && micSupported()) || mic === "refused" || mic === "credits") && (
                <button
                  className="listening-fix"
                  onClick={() => {
                    primeListening();
                    setAskKey(mic === "refused" ? { why: "key", trouble: "key" } : mic === "credits" ? { why: "key", trouble: "credits" } : { why: "voice", then: "tip" });
                  }}
                >
                  {mic === "credits" ? "Top up" : mic === "refused" ? "Fix key" : "Turn on “next”"}
                </button>
              )}
            </div>
          )}
          {(via === "ai" || via === "scan") && phase === "cover" && (
            <span className="sheet-caption ai">
              <ISparkle size={15} /> {via === "scan" ? "Made from your manual with OpenRouter" : "Drafted with OpenRouter"}
            </span>
          )}
        </section>

        <aside className="panel">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={phase}
              className="panel-inner"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {phase === "cover" && (
                <CoverPanel
                  plan={plan}
                  via={via}
                  resume={resume}
                  built={built}
                  onStart={() => {
                    setMissing(new Set());
                    setStartedAt(Date.now());
                    setDoneAt(undefined);
                    setMaxStep(0);
                    setReached(0);
                    setSeen([]);
                    setFinish(null);
                    clock.current = { at: Date.now(), ms: 0, live: true };
                    go("tools");
                  }}
                  onReview={() => go("steps", 0)}
                  onOwnSteps={onOwnSteps}
                  onResume={() => {
                    if (!resume) return;
                    if (resume.phase === "steps") go("steps", Math.min(resume.step, steps.length - 1));
                    else go(resume.phase === "cover" ? "tools" : resume.phase);
                  }}
                />
              )}
              {phase === "tools" && (
                <ToolsPanel
                  plan={plan}
                  onNext={(have: ToolId[]) => {
                    setTools(have);
                    next();
                  }}
                  onBack={back}
                />
              )}
              {phase === "parts" && (
                <PartsPanel
                  plan={plan}
                  missing={missing}
                  onToggle={(id) => setMissing((s) => toggle(s, id))}
                  onNext={next}
                  onBack={back}
                  onHover={setHl}
                  onMissingHelp={() => setHelp({ missing: true })}
                />
              )}
              {phase === "steps" && (
                <StepPanel
                  plan={plan}
                  index={step}
                  dir={dir}
                  onNext={next}
                  onBack={back}
                  onHover={setHl}
                  offer={!voiceOn && offer && (step === 0 || usedVoice) ? { again: usedVoice, listen: canListen || (mounted && micSupported() && !skippedKey()), onStart: turnOnVoice, onDismiss: () => setOffer(false) } : null}
                />
              )}
              {phase === "done" && <DonePanel plan={plan} slug={slug} finish={finish} onReview={back} />}
            </motion.div>
          </AnimatePresence>
        </aside>
      </main>

      {phase === "done" && <Confetti />}
      <p className="sr-only" aria-live="polite">
        {phase === "steps" ? `Step ${step + 1} of ${steps.length}. ${cur?.title ?? ""}. ${cur?.detail ?? ""}` : phase === "done" ? `You built ${plan.spec.name}.` : ""}
      </p>

      <AnimatePresence>
        {help && (
          <HelpSheet
            plan={plan}
            index={phase === "steps" ? step : -1}
            ai={ai}
            focusMissing={help.missing}
            ask={help.ask}
            askId={help.at}
            onAnswer={voiceOn ? speakAnswer : undefined}
            onAddKey={(why, trouble) => setAskKey({ why, trouble })}
            onShow={setHl}
            onGoto={(i) => {
              setHelp(null);
              if (phase !== "steps" || i !== step) go("steps", i, phase !== "steps" || i > step ? 1 : -1);
            }}
            onClose={() => setHelp(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {askKey && (
          <KeyModal
            why={askKey.why}
            trouble={askKey.trouble}
            skip={askKey.then === "voice" && readable ? "Just read it aloud" : undefined}
            onSkip={() => {
              setAskKey(null);
              skipKey();
              startVoice();
            }}
            onClose={() => {
              if (askKey.trouble) setListenTry((n) => n + 1);
              setAskKey(null);
            }}
            onGesture={() => {
              if (!voiceOn) voice.unlock();
              primeListening();
            }}
            onSaved={() => {
              const then = askKey.then;
              setAskKey(null);
              if (then === "voice") startVoice();
              // already reading aloud: now it listens too, and says so when it isn't mid-line
              else if (then === "tip" && !voice.speaking) voice.say([LINES.sayNext]);
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {overview && (
          <Overview
            plan={plan}
            current={step}
            doneUpTo={maxStep}
            onPick={(i) => {
              setOverview(false);
              go("steps", i, i >= step ? 1 : -1);
            }}
            onClose={() => setOverview(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const PHASES: Phase[] = ["cover", "tools", "parts", "steps", "done"];

/** "Just read it aloud" holds for the rest of the visit, so turning the voice on again doesn't ask again. */
const SKIP = "bygga:key-skip";
function skippedKey() {
  try {
    return sessionStorage.getItem(SKIP) === "1";
  } catch {
    return false;
  }
}
function skipKey() {
  try {
    sessionStorage.setItem(SKIP, "1");
  } catch {
    /* storage blocked */
  }
}

function toggle(s: Set<string>, id: string) {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

/** Where you are: Tools, Parts, Build, Done. Earlier phases can be revisited. */
function Stepper({ phase, step, total, reached, onJump }: { phase: Phase; step: number; total: number; reached: number; onJump: (p: Phase) => void }) {
  const items: { id: Phase; label: string }[] = [
    { id: "tools", label: "Tools" },
    { id: "parts", label: "Parts" },
    { id: "steps", label: "Build" },
    { id: "done", label: "Done" },
  ];
  const cur = PHASES.indexOf(phase);
  return (
    <nav className="stepper" aria-label="Progress">
      {items.map((it) => {
        const idx = PHASES.indexOf(it.id);
        const state = idx < cur ? "done" : idx === cur ? "now" : "next";
        const can = idx <= reached && idx !== cur && it.id !== "done";
        const building = it.id === "steps" && phase === "steps";
        return (
          <button key={it.id} className={"stp " + state} disabled={!can} onClick={() => onJump(it.id)} aria-current={state === "now" ? "step" : undefined}>
            {it.label}
            {building && (
              <span className="stp-n">
                {step + 1}/{total}
              </span>
            )}
            {state === "now" && (
              <span className="stp-line" aria-hidden="true">
                <motion.i initial={false} animate={{ scaleX: building ? (step + 1) / total : 1 }} transition={{ type: "spring", stiffness: 160, damping: 26 }} />
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
