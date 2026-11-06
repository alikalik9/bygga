import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { GITHUB_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy and terms | Bygga",
  description: "What Bygga keeps, what it sends where, and the terms for using the guides.",
  alternates: { canonical: "/privacy" },
};

export default function Privacy() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="legal">
        <h1>Privacy and terms</h1>
        <p className="lead">Short version: no accounts, no cookies, no ads, and nothing sold. Here is exactly what goes where. Last updated October 27, 2026.</p>

        <h2>On your device</h2>
        <ul>
          <li>Your build progress, which step you are on, and settings like the voice, saved in your browser&apos;s local storage.</li>
          <li>Your own OpenRouter key, if you add one. Every AI feature runs on it, so it is sent with those requests and used for them only. It is never stored or logged on our side.</li>
          <li>Guides and voice clips you have opened, kept by the browser so they work offline.</li>
        </ul>
        <p>Clearing this site&apos;s data in your browser deletes all of it.</p>

        <h2>What reaches our server</h2>
        <ul>
          <li>The product name you search for, to find or draft its guide.</li>
          <li>Questions and photos you send from the help panel, and photos of a box label you search with. Photos are resized in your browser first, which also removes location data.</li>
          <li>The text of a voice line that has no recording yet, to record it.</li>
          <li>While the voice is on, short bits of sound from your mic each time someone talks, so it can hear you say &ldquo;next&rdquo;. They are turned into text, and Bygga keeps neither.</li>
          <li>Feedback you send, from the Feedback button or &ldquo;This step doesn&apos;t match my box&rdquo;: what you write, the product and step you were on, and your browser and device type (&ldquo;Safari on iPhone&rdquo;). An email address goes with it only if you type one, so we can reply. It&apos;s kept in our feedback database until we&apos;ve dealt with it.</li>
          <li>Your IP address, held in memory for a few minutes to stop abuse, then dropped.</li>
        </ul>

        <h2>Who else sees it</h2>
        <ul>
          <li>
            <b>OpenRouter</b> (United States) turns searches, questions and photos into answers, records voice lines, and turns what the mic hears into text, all on your own key. See their{" "}
            <a href="https://openrouter.ai/privacy" target="_blank" rel="noreferrer">
              privacy policy
            </a>
            .
          </li>
          <li>
            <b>Vercel</b> hosts the site and counts visits without cookies: the page, the referring site, your country or city, and your browser. See their{" "}
            <a href="https://vercel.com/docs/analytics/privacy-policy" target="_blank" rel="noreferrer">
              analytics privacy notes
            </a>
            .
          </li>
          <li>
            <b>Plausible</b> (European Union) also counts visits without cookies or personal data: the page, the referring site, your country and your browser. See their{" "}
            <a href="https://plausible.io/data-policy" target="_blank" rel="noreferrer">
              data policy
            </a>
            .
          </li>
          <li>
            <b>Upstash</b> stores the feedback you send, in a database run for us through Vercel. See their{" "}
            <a href="https://upstash.com/trust/privacy.pdf" target="_blank" rel="noreferrer">
              privacy policy
            </a>
            .
          </li>
        </ul>

        <h2>Terms of use</h2>
        <ul>
          <li>Bygga is free and comes as it is, with no warranty. The guides are generated drawings, not IKEA&apos;s instructions, and some are drafted by AI. Always check each step against the paper manual in the box.</li>
          <li>You build at your own risk. Take care with heavy parts and get a second person when a step says so. Fix tall furniture to the wall with the fittings that come with it.</li>
          <li>Bygga is an independent, unofficial project. It is not affiliated with, sponsored or endorsed by Inter IKEA Systems B.V. or any IKEA company. IKEA and IKEA product names are trademarks of their owners, used here only to say which product a guide is for.</li>
        </ul>

        <h2>Questions</h2>
        <p>
          Open an issue on{" "}
          <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer">
            GitHub
          </a>{" "}
          and we&apos;ll answer there.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
