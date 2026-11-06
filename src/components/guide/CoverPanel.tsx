"use client";

import Link from "next/link";
import { spellOut } from "@/lib/shorthand";
import type { Plan } from "@/lib/types";
import { buildMinutes, type Progress } from "@/lib/store";
import { floorSpace, totals } from "@/lib/plan/contents";
import { IArrowRight, IBox, ICheck, IClock, IExternal, IPeople, IPerson, IPrint, IRuler, ISparkle, IWrench } from "../art/Icons";
import { Dots } from "./ui";
import { TOOL_INFO } from "../art/Tools";
import { SCAN_ENABLED } from "@/lib/site";

export default function CoverPanel({
  plan,
  via,
  resume,
  built,
  onStart,
  onResume,
  onReview,
  onOwnSteps,
}: {
  plan: Plan;
  via: "catalog" | "ai" | "guess" | "scan";
  resume: Progress | null;
  /** Finished at least once on this device. */
  built?: { at: number; ms?: number; full?: boolean } | null;
  onStart: () => void;
  onResume: () => void;
  onReview: () => void;
  /** A typical build stands in for this product: a key gets it worked out properly. */
  onOwnSteps?: { text: string; act: () => void };
}) {
  const s = plan.spec;
  const t = totals(plan);
  const resumable = resume && (resume.phase !== "cover" || resume.step > 0) && resume.phase !== "done";
  const official = `https://www.ikea.com/search/?q=${encodeURIComponent(s.name)}`;
  const tools = plan.tools.filter((x) => !x.optional && !x.included).map((x) => TOOL_INFO[x.id].name.replace("Phillips ", ""));
  return (
    <div className="pane cover">
      <div className="pane-scroll">
        <header className="pane-head">
          <p className="eyebrow">{s.brand ? `${s.brand}, ${s.category.toLowerCase()}` : s.category}</p>
          <h1 className="product-name">{s.name}</h1>
          <p className="product-variant">{s.variant}</p>
          {built && (
            <p className="built-pill">
              <ICheck size={15} strokeWidth={2.6} />
              Built {new Date(built.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              {(() => {
                const m = buildMinutes(built.ms, built.full, s.minutes);
                return m ? `, in ${fmtMin(m)}` : "";
              })()}
            </p>
          )}
        </header>

        {s.variants && s.variants.length > 1 && (
          <div className="chips sizes" role="list" aria-label="Other sizes">
            {chipLabels(s.variants.map((v) => v.label)).map((label, i) => {
              const v = s.variants![i];
              return (
                <Link key={v.slug} href={`/build/${v.slug}`} className={"chip" + (v.slug === s.slug ? " on" : "")} role="listitem" replace>
                  {label}
                </Link>
              );
            })}
          </div>
        )}

        <dl className="stats">
          <div>
            <dt>
              <IClock size={16} /> Time
            </dt>
            <dd>{fmtMin(s.minutes)}</dd>
          </div>
          <div>
            <dt>{s.people === 2 ? <IPeople size={16} /> : <IPerson size={16} />} People</dt>
            <dd>{s.people === 2 ? "Two" : "One"}</dd>
          </div>
          <div>
            <dt>
              <Dots value={s.difficulty} /> Level
            </dt>
            <dd>{["", "Easy", "Medium", "Patient"][s.difficulty]}</dd>
          </div>
        </dl>

        <h3 className="section-title">Before you start</h3>
        <ul className="prep">
          <li>
            <span className="prep-ico">
              <IRuler size={18} />
            </span>
            <span>
              Clear <b>{floorSpace(plan)}</b> of floor and lay the flattened box down as a mat.
            </span>
          </li>
          <li>
            <span className="prep-ico">
              <IBox size={18} />
            </span>
            <span>
              <b>{t.panels} panels</b> and <b>{t.fittings} fittings</b> in {plan.steps.length} steps.
            </span>
          </li>
          {tools.length > 0 && (
            <li>
              <span className="prep-ico">
                <IWrench size={18} />
              </span>
              <span>
                You&apos;ll want a <b>{tools.join(" and a ").toLowerCase()}</b>.
              </span>
            </li>
          )}
          {t.twoAt.length > 0 && s.people === 1 && (
            <li>
              <span className="prep-ico">
                <IPeople size={18} />
              </span>
              <span>Ask someone to help with step {t.twoAt.slice(0, 2).join(" and ")}.</span>
            </li>
          )}
          {s.watchOut?.slice(0, 2).map((w) => (
            <li key={w}>
              <span className="prep-ico">
                <ISparkle size={18} />
              </span>
              <span>{w}</span>
            </li>
          ))}
        </ul>

        {s.siblings && s.siblings.length > 0 && (
          <>
            <h3 className="section-title">Other {s.name} products</h3>
            <div className="chips">
              {s.siblings.slice(0, 6).map((v) => (
                <Link key={v.slug} href={`/build/${v.slug}`} className="chip ghost">
                  {v.label}
                </Link>
              ))}
            </div>
          </>
        )}

        {via === "scan" ? (
          <div className="callout note">
            <ISparkle size={18} />
            <div>
              <b>{s.custom?.fromCover ? "Drawn from the cover" : "Made from your manual"}</b>
              <span>
                {s.custom?.fromCover
                  ? `OpenRouter only saw the cover, so this is a typical build for this product.${SCAN_ENABLED ? " Scan the inside pages for an exact match." : " Keep the paper manual close."}`
                  : "OpenRouter read your pages and drew each step. Check every step against the paper manual before you fix anything."}
              </span>
              {s.custom?.fromCover && SCAN_ENABLED && (
                <Link href="/scan" className="callout-link">
                  Scan the pages
                </Link>
              )}
            </div>
          </div>
        ) : (
          via !== "catalog" && (
            <div className="callout note">
              <ISparkle size={18} />
              <div>
                <b>{via === "ai" ? "Drafted with OpenRouter" : "A typical build"}</b>
                <span>
                  {via === "ai"
                    ? "Built from what OpenRouter knows about this product. If your box looks different, trust the paper manual."
                    : "We don't know this exact product yet, so this follows a typical build. Keep the paper manual close."}
                </span>
                {via === "guess" && onOwnSteps && (
                  <button className="callout-link plain" onClick={onOwnSteps.act}>
                    {onOwnSteps.text}
                  </button>
                )}
              </div>
            </div>
          )
        )}
        <div className="cover-links">
          {via !== "scan" && (
            <a className="official" href={official} target="_blank" rel="noreferrer">
              Find the manual on ikea.com <IExternal size={15} />
            </a>
          )}
          <Link className="official" href={`/build/${s.slug}/print`}>
            <IPrint size={15} /> Print this guide
          </Link>
        </div>
        <p className="cover-note">Not affiliated with IKEA. Check each step against the paper manual in the box.</p>
      </div>
      <div className="pane-foot">
        {resumable ? (
          <>
            <button className="btn primary big" onClick={onResume}>
              <span>{resume.phase === "steps" ? `Continue at step ${resume.step + 1}` : "Continue"}</span>
              <IArrowRight />
            </button>
            <div className="foot-row center">
              <button className="btn link" onClick={onStart}>
                Start again from the beginning
              </button>
            </div>
          </>
        ) : built ? (
          <>
            <button className="btn primary big" onClick={onStart} autoFocus>
              <span>Build another one</span>
              <IArrowRight />
            </button>
            <div className="foot-row center">
              <button className="btn link" onClick={onReview}>
                Look through the steps
              </button>
            </div>
          </>
        ) : (
          <button className="btn primary big" onClick={onStart} autoFocus>
            <span>Start building</span>
            <IArrowRight />
          </button>
        )}
      </div>
    </div>
  );
}

function shortVariant(l: string) {
  return l
    .replace(/^[^,]+,\s*/, "")
    .replace(/^chest of /i, "")
    .replace(/^drawer unit, /i, "")
    .replace(/^shoe cabinet with /i, "");
}

/** Chip text per variant: the size, plus whatever sets a variant apart from a twin of the same size (sit/stand, 6 drawers, with storage). */
function chipLabels(labels: string[]) {
  const short = labels.map(shortVariant);
  return labels.map((l, i) => {
    const twins = labels.filter((_, j) => short[j] === short[i]).map((t) => t.split(",")[0].split(" "));
    if (twins.length < 2) return tidy(short[i]);
    const words = l.split(",")[0].split(" ");
    let k = 0;
    while (k < words.length && twins.every((t) => t[k] === words[k])) k++;
    const extra = words
      .slice(k)
      .join(" ")
      .replace(/\//g, " and ");
    return tidy(extra && extra !== short[i] ? `${extra}, ${short[i]}` : short[i]);
  });
}


/** IKEA's shorthand spelled out, first letter up. */
function tidy(t: string) {
  const s = spellOut(t)
    // a size never breaks across lines
    .replace(/ × /g, "\u00a0×\u00a0")
    .replace(/(\d) cm\b/g, "$1\u00a0cm");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtMin(m: number) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
