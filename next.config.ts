import type { NextConfig } from "next";

/*
 * Everything the site loads comes from itself: scripts, fonts (next/font), the voice clips and analytics
 * (Plausible is proxied under /pl, see the rewrites below).
 * Inline scripts stay allowed because the pages are prerendered and can't carry a per-request nonce.
 */
const CSP = [
  "default-src 'self'",
  // dev adds eval for fast refresh and Vercel Analytics' debug script, which production serves from the site itself
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval' https://va.vercel-scripts.com"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const SECURITY = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // the camera reads box labels, the microphone hears "next"; nothing else
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // AGENTS.md is ours (it keeps the same advice, without the dashes the managed block brings)
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  // the share cards read their fonts and drawings from disk
  outputFileTracingIncludes: {
    "/opengraph-image": ["./src/lib/og/*.woff", "./public/og/hero-bygga.png", "./public/og/hero-paper.png"],
    "/twitter-image": ["./src/lib/og/*.woff", "./public/og/hero-bygga.png", "./public/og/hero-paper.png"],
    "/build/*/opengraph-image*": ["./src/lib/og/*.woff", "./public/og/*.png"],
    "/build/*/twitter-image*": ["./src/lib/og/*.woff", "./public/og/*.png"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY,
      },
      {
        // share cards only change on deploy: let the CDN keep them, so a viral link renders each card once
        source: "/:path(opengraph-image|twitter-image)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400" },
          // Next sets its own Cache-Control on dynamic images; Vercel's CDN reads this one first
          { key: "Vercel-CDN-Cache-Control", value: "max-age=31536000, stale-while-revalidate=86400" },
        ],
      },
      {
        source: "/build/:slug/:img(opengraph-image|twitter-image)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400" },
          // Next sets its own Cache-Control on dynamic images; Vercel's CDN reads this one first
          { key: "Vercel-CDN-Cache-Control", value: "max-age=31536000, stale-while-revalidate=86400" },
        ],
      },
      {
        // the service worker itself must never be stale
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
      {
        // clips are named after their text, so a file only changes when it is re-recorded
        source: "/voice/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }],
      },
      {
        // the list of clips changes with every recording, so it is checked often
        source: "/voice/:voice/manifest.json",
        headers: [{ key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=3600" }],
      },
    ];
  },
  async rewrites() {
    // Plausible's script and its event endpoint, served from our own domain
    return [
      { source: "/pl/script.js", destination: "https://plausible.io/js/script.js" },
      { source: "/pl/event", destination: "https://plausible.io/api/event" },
    ];
  },
  async redirects() {
    // only when the scanner is turned off: old links land on the search instead
    return process.env.NEXT_PUBLIC_SCAN === "0" ? [{ source: "/scan", destination: "/", permanent: false }] : [];
  },
};

export default nextConfig;
