import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import HeroStage from "@/components/home/HeroStage";
import { HeroSearch } from "@/components/home/HomeClient";
import Resume from "@/components/home/Resume";
import { Catalog } from "@/components/home/Sections";
import Compare from "@/components/home/Compare";
import { Figure } from "@/components/art/Figure";
import { ToolArt } from "@/components/art/Tools";
import { HwArt } from "@/components/art/Hardware";
import { IArrowOut, IArrowRight, IScan } from "@/components/art/Icons";
import { OpenRouterMark } from "@/components/art/OpenRouter";
import { PRODUCT_COUNT } from "@/lib/search";
import { SCAN_ENABLED } from "@/lib/site";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const QUICK = [
  { slug: "kallax-2x2", label: "KALLAX" },
  { slug: "bissa-shoe-cabinet-2-compartments", label: "BISSA" },
  { slug: "malm-3-drawers", label: "MALM" },
  { slug: "poang-armchair", label: "POÄNG" },
  { slug: "billy-80x202", label: "BILLY" },
];

export default function Home() {
  return (
    <div className="site">
      <SiteHeader />

      <section className="hero">
        <div className="hero-copy">
          <a className="tg-pill" href="https://openrouter.ai/" target="_blank" rel="noreferrer">
            <span className="tg-badge">
              <OpenRouterMark size={16} />
            </span>
            <span className="tg-text">
              Powered by <b>OpenRouter</b>
            </span>
            <IArrowOut size={14} className="tg-go" />
          </a>
          <h1>
            Build IKEA furniture,
            <br />
            step by step.
          </h1>
          <p className="lead">Type the name from the box. Each step plays in 3D and is read out loud, with the parts, screws and tools it needs.</p>
          <HeroSearch />
          <div className="quick">
            <span>Try</span>
            {QUICK.map((q) => (
              <Link key={q.slug} href={`/build/${q.slug}`} className="chip">
                {q.label}
              </Link>
            ))}
          </div>
          <Resume />
          {SCAN_ENABLED && (
            <Link href="/scan" className="scan-link">
              <IScan size={17} />
              <span>
                Not from IKEA? <u>Scan its paper manual</u>
              </span>
            </Link>
          )}
        </div>
        <HeroStage />
      </section>

      <section className="how" id="how">
        <h2 className="sec-title">How it works</h2>
        <ol className="how-steps">
          <li>
            <span className="how-n">1</span>
            <div className="how-art">
              <svg viewBox="0 0 220 150" width="220" height="150" aria-hidden="true">
                <path d="M30 60 L110 84 L190 60 L190 128 L110 150 L30 128 Z" fill="#fff" stroke="var(--ink)" strokeWidth="2.4" strokeLinejoin="round" />
                <path d="M110 84 V150" stroke="var(--ink)" strokeWidth="2.2" />
                <path d="M30 60 L110 38 L190 60" fill="#f2f0eb" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
                <g transform="translate(122 98) skewY(-15)">
                  <rect x="0" y="0" width="56" height="26" rx="3" fill="var(--accent)" stroke="var(--ink)" strokeWidth="2" />
                  <text x="28" y="18" textAnchor="middle" fontSize="12" fontWeight="800" fill="var(--ink)" fontFamily="var(--font)">
                    KALLAX
                  </text>
                </g>
              </svg>
              <span className="how-fig">
                <Figure pose="point" size={84} />
              </span>
            </div>
            <h3>Type the name</h3>
            <p>It&apos;s the big word on the box label, like KALLAX, or the number under it, like 802.758.87. Or snap a photo of it.</p>
          </li>
          <li>
            <span className="how-n">2</span>
            <div className="how-art tools">
              <span style={{ transform: "rotate(-10deg)" }}>
                <ToolArt id="screwdriver" size={82} />
              </span>
              <span style={{ transform: "translateY(-10px)" }}>
                <ToolArt id="hammer" size={88} />
              </span>
              <span style={{ transform: "rotate(8deg)" }}>
                <ToolArt id="allen" size={72} />
              </span>
              <span className="how-hw">
                <HwArt kind="dowel" len={30} dia={8} fit={44} />
                <b>8&times;</b>
              </span>
            </div>
            <h3>Check tools and parts</h3>
            <p>One tap if everything&apos;s there. Missing a piece? We&apos;ll tell you what to do.</p>
          </li>
          <li>
            <span className="how-n">3</span>
            <div className="how-art step">
              <svg viewBox="0 0 200 140" width="200" height="140" aria-hidden="true">
                <path d="M30 96 L120 120 L176 96 L86 72 Z" fill="#fff" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
                <path d="M30 96 V104 L120 128 V120 M120 128 L176 104 V96" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
                <g className="how-drop">
                  <path d="M92 18 L104 22 L104 82 L92 78 Z" fill="var(--accent-soft)" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
                  <path d="M104 22 L150 8 L150 68 L104 82" fill="#fff" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
                  <path d="M92 18 L138 4 L150 8" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
                </g>
                <path d="M70 26 v26 h-7 l11 13 l11 -13 h-7 v-26 z" fill="var(--ink)" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Follow each step</h3>
            <p>Every step plays in 3D, with each screw shown up close. Drag to see any side.</p>
          </li>
        </ol>
      </section>

      <section className="popular" id="popular">
        <div className="sec-head">
          <h2 className="sec-title">Popular builds</h2>
          <Link href="/browse" className="sec-link">
            All {PRODUCT_COUNT.toLocaleString("en-US")} products <IArrowRight size={15} />
          </Link>
        </div>
        <Catalog limit={9} />
      </section>

      <Compare />

      <SiteFooter />
    </div>
  );
}
