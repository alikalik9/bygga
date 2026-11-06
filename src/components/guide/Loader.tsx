"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Figure } from "../art/Figure";
import { ISparkle } from "../art/Icons";

/** Shown while OpenRouter works out an unknown product: a flat pack box opening, panels peeking out. */
export default function Loader({ query, ai }: { query: string; ai: boolean }) {
  const lines = [`Looking up ${query.toUpperCase()}`, "Reading the measurements", "Sorting the hardware", "Counting the fittings", "Drawing the steps"];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(lines.length - 1, x + 1)), 1700);
    return () => clearInterval(t);
  }, [lines.length]);
  return (
    <div className="loader">
      <div className="loader-art">
        <svg viewBox="0 0 260 190" width="260" height="190" aria-hidden="true">
          <g className="ld-panels">
            <path className="p1" d="M92 96 l40 -78 l14 6 l-40 78 z" fill="#fff" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
            <path className="p2" d="M120 98 l18 -84 l15 3 l-18 84 z" fill="var(--accent-soft)" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
            <path className="p3" d="M146 100 l-6 -76 l15 -1 l6 76 z" fill="#fff" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
          </g>
          <path d="M40 92 L130 120 L220 92 L220 160 L130 188 L40 160 Z" fill="#fff" stroke="var(--ink)" strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M130 120 V188" stroke="var(--ink)" strokeWidth="2.2" />
          <path d="M40 92 L130 66 L220 92" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
          <path className="flap-l" d="M40 92 L130 120 L106 140 L16 112 Z" fill="#f1efe9" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
          <path className="flap-r" d="M220 92 L130 120 L154 140 L244 112 Z" fill="#f1efe9" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M70 150 l26 8 M70 158 l18 5.5" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
        </svg>
        <div className="loader-fig">
          <Figure pose="read" size={92} />
        </div>
      </div>
      <div className="loader-text" aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.p key={i} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
            {lines[i]}
          </motion.p>
        </AnimatePresence>
        <div className="loader-bar">
          <span style={{ width: `${((i + 1) / lines.length) * 100}%` }} />
        </div>
        {ai && (
          <span className="ai-badge quiet">
            <ISparkle size={15} /> Thinking with OpenRouter
          </span>
        )}
      </div>
    </div>
  );
}
