"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { articleNo, articlesReady, loadArticles, searchCatalog, slugify, matchCatalog } from "@/lib/search";
import Drawing from "../Drawing";
import { keyHeaders } from "@/lib/userKey";
import { IArrowRight, ICamera, ISearch, ISparkle } from "../art/Icons";
import KeyModal, { type KeyTrouble } from "../KeyModal";

const EXAMPLES = ["KALLAX", "MALM 3 drawers", "802.758.87", "BILLY bookcase", "LACK side table", "HEMNES chest", "IDÅSEN desk"];

export default function Search({ ai, autoFocus }: { ai: boolean; autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const [sel, setSel] = useState(0);
  const [ph, setPh] = useState("");
  const [reading, setReading] = useState(false);
  const [msg, setMsg] = useState("");
  // photo search runs on the person's own key: without one, the camera asks for it first
  const [askKey, setAskKey] = useState<KeyTrouble | "" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);

  // typewriter placeholder
  useEffect(() => {
    if (q) return;
    let i = 0, c = 0, del = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const w = EXAMPLES[i % EXAMPLES.length];
      if (!del) {
        c++;
        setPh(w.slice(0, c));
        if (c >= w.length) {
          del = true;
          t = setTimeout(tick, 1600);
          return;
        }
        t = setTimeout(tick, 70 + Math.random() * 60);
      } else {
        c--;
        setPh(w.slice(0, c));
        if (c <= 0) {
          del = false;
          i++;
          t = setTimeout(tick, 300);
          return;
        }
        t = setTimeout(tick, 32);
      }
    };
    t = setTimeout(tick, 600);
    return () => clearTimeout(t);
  }, [q]);

  // article numbers live in their own chunk: fetch it once someone types a few digits
  const [articles, setArticles] = useState(articlesReady);
  const digits = /\d{3}/.test(q);
  useEffect(() => {
    if (digits && !articles) loadArticles().then(() => setArticles(true));
  }, [digits, articles]);
  const hits = useMemo(() => (q.trim() ? searchCatalog(q, 6) : []), [q, articles]); // eslint-disable-line react-hooks/exhaustive-deps
  const exact = useMemo(() => (q.trim() ? matchCatalog(q) : null), [q, articles]); // eslint-disable-line react-hooks/exhaustive-deps
  const showAi = q.trim().length >= 2 && !exact;
  const rows = hits.length + (showAi ? 1 : 0);

  async function go(target?: string) {
    const text = (target ?? q).trim();
    if (!text) {
      input.current?.focus();
      return;
    }
    if (articleNo(text)) await loadArticles().catch(() => {});
    const m = matchCatalog(text);
    if (m?.slug) router.push(`/build/${m.slug}`);
    else router.push(`/build/${slugify(text)}?q=${encodeURIComponent(text)}`);
  }

  function choose(i: number) {
    if (i < hits.length) router.push(`/build/${hits[i].entry.slug}`);
    else go();
  }

  async function onPhoto(f: File) {
    setReading(true);
    setMsg("");
    try {
      const img = await shrink(f);
      const r = await fetch("/api/identify", { method: "POST", headers: { "Content-Type": "application/json", ...keyHeaders() }, body: JSON.stringify({ image: img }) });
      const j = await r.json();
      if (r.status === 401 || r.status === 402) {
        setAskKey(r.status === 401 ? "key" : "credits");
        return;
      }
      if (!r.ok) throw new Error(j.error);
      if (j.name) {
        setQ(j.query || j.name);
        setMsg(`Found ${j.name}${j.variant ? `, ${j.variant}` : ""}`);
        setTimeout(() => go(j.query || j.name), 650);
      } else setMsg("Couldn't read a name. Try a closer photo of the label.");
    } catch {
      setMsg("Couldn't read that photo. Try again or type the name.");
    } finally {
      setReading(false);
    }
  }

  const open = focus && q.trim().length > 0 && rows > 0;

  return (
    <div className={"search" + (open ? " open" : "")}>
      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (open && sel < rows) choose(sel);
          else go();
        }}
      >
        <ISearch size={24} className="search-ico" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => (s + 1) % rows);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => (s - 1 + rows) % rows);
            } else if (e.key === "Escape") input.current?.blur();
          }}
          placeholder={reading ? "Reading your photo" : ph ? `Try ${ph}` : "Product name"}
          aria-label="Product name from your box"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          enterKeyHint="go"
        />
        <button type="button" className={"cam-btn" + (reading ? " busy" : "")} onClick={() => (ai ? file.current?.click() : setAskKey(""))} aria-label="Search with a photo of the box label" title="Snap the box label">
          <ICamera size={22} />
        </button>
        <button type="submit" className="go-btn" aria-label="Find assembly steps">
          <IArrowRight size={22} strokeWidth={2.4} />
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onPhoto(f);
          }}
        />
      </form>
      <AnimatePresence>{msg && <motion.p className="search-msg" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{msg}</motion.p>}</AnimatePresence>
      <AnimatePresence>
        {askKey !== null && (
          <KeyModal
            why="photo"
            trouble={askKey || null}
            onClose={() => setAskKey(null)}
            onSaved={() => {
              setAskKey(null);
              setMsg("Key saved. Tap the camera to snap the label.");
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.ul className="suggest" role="listbox" initial={{ opacity: 0, y: -6, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {hits.map((h, i) => (
              <SuggestRow key={h.entry.slug} slug={h.entry.slug} name={h.entry.name} variant={h.entry.variant} minutes={h.entry.minutes} active={i === sel} onPick={() => choose(i)} onHover={() => setSel(i)} />
            ))}
            {showAi && (
              <li role="option" aria-selected={sel === hits.length} className={"suggest-row ai" + (sel === hits.length ? " active" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => go()} onMouseEnter={() => setSel(hits.length)}>
                <span className="s-ai">
                  <ISparkle size={22} />
                </span>
                <span className="s-text">
                  <b>Find &ldquo;{q.trim()}&rdquo;</b>
                  <span>{ai ? "OpenRouter will work out the steps" : "Pick what it looks like, we'll do the rest"}</span>
                </span>
                <IArrowRight size={18} />
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function SuggestRow({ slug, name, variant, minutes, active, onPick, onHover }: { slug: string; name: string; variant: string; minutes: number; active: boolean; onPick: () => void; onHover: () => void }) {
  return (
    <li role="option" aria-selected={active} className={"suggest-row" + (active ? " active" : "")} onMouseDown={(e) => e.preventDefault()} onClick={onPick} onMouseEnter={onHover}>
      <Drawing name={slug} w={112} h={84} className="s-thumb" eager />
      <span className="s-text">
        <b>{name}</b>
        <span>{variant}</span>
      </span>
      <span className="s-min">{minutes} min</span>
    </li>
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
    const k = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
