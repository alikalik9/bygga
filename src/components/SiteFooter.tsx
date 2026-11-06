import Link from "next/link";
import Logo from "./Logo";
import { Crew } from "./art/Figure";
import { IArrowOut } from "./art/Icons";
import { OpenRouterWordmark } from "./art/OpenRouter";
import { GITHUB_URL, SCAN_ENABLED } from "@/lib/site";

const CREW = [
  { name: "Hassan", handle: "nutlope" },
  { name: "Youssef", handle: "YoussefUIUX" },
];
const x = (handle: string) => `https://x.com/${handle}`;

export default function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="foot-card">
        <div className="foot-brand">
          <Logo size={30} />
          <p>Assembly guides you can turn around, hear out loud and follow with your hands full. Free and open source.</p>
        </div>

        <nav className="foot-cols" aria-label="Footer">
          <div>
            <h2>Build</h2>
            <Link href="/browse">All guides</Link>
            <Link href="/builds">Workshop</Link>
            {SCAN_ENABLED && <Link href="/scan">Scan a manual</Link>}
          </div>
          <div>
            <h2>Project</h2>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              Source code <IArrowOut size={14} />
            </a>
            <a href="https://openrouter.ai/" target="_blank" rel="noreferrer">
              OpenRouter <IArrowOut size={14} />
            </a>
            <Link href="/privacy">Privacy and terms</Link>
          </div>
        </nav>

        <div className="foot-credit">
          <Crew names="Hassan & Youssef" size={128} className="foot-crew" />
          <p className="foot-credit-text">
            Built by{" "}
            <a href={x(CREW[0].handle)} target="_blank" rel="noreferrer">
              {CREW[0].name}
            </a>{" "}
            and{" "}
            <a href={x(CREW[1].handle)} target="_blank" rel="noreferrer">
              {CREW[1].name}
            </a>
          </p>
        </div>
      </div>

      <div className="foot-base">
        <p>Bygga is an independent, unofficial project. It is not affiliated with, sponsored or endorsed by Inter IKEA Systems B.V. or any IKEA company. IKEA and IKEA product names are trademarks of their owners.</p>
        <a className="foot-powered" href="https://openrouter.ai/" target="_blank" rel="noreferrer">
          <span>Powered by</span>
          <OpenRouterWordmark height={19} className="tg-word" />
        </a>
      </div>
    </footer>
  );
}
