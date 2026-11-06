<p align="center">
  <a href="https://www.usebygga.com"><img alt="Bygga" src="docs/img/og.png"></a>
</p>

<h1 align="center">Bygga</h1>

<p align="center">Type the name or article number on an IKEA box and follow every assembly step in 3D, drawn like the paper manual and read out loud. <a href="https://www.usebygga.com">usebygga.com</a></p>

## Tech stack

- Next.js 16 (App Router, Cache Components), React 19 and TypeScript, plain CSS with Motion, no UI kit
- A three.js line-art stage (`src/engine`) and a parametric plan generator (`src/lib/plan`) that draw 1,171 IKEA products (2,180 sizes, UK and US ranges) offline, built from IKEA's public listings (`scripts/ikea`)
- A hands-free voice: 1,476 pre-recorded Kokoro clips that play with no key, and Whisper on OpenRouter listening for "next" through an echo-cancelled mic (`/api/listen`, `hearIntent` in `src/lib/voice/commands.ts`)
- [OpenRouter](https://openrouter.ai/) on each visitor's own key (`src/components/KeyModal.tsx`): drafts for products we don't have, photo lookup, and a help chat that answers with drawings of the exact panel, fitting or step
- A manual scanner (`/scan`) for furniture from any brand: drop photos or a whole PDF (up to 24 pages, rendered in the browser) and Claude on OpenRouter reads every page, then plans an exact 3D build
- Share cards drawn by the same engine (`scripts/og/render.mjs`), an A4 print view, and a service worker so opened guides work with no signal
- Tests: `npm run voice:check` replays 283 recorded listening runs, and `npm run ikea:check` tests every catalog row

## Cloning & running

1. Clone: `git clone https://github.com/Nutlope/bygga.git && cd bygga && npm install`
2. Run: `npm run dev`, open http://localhost:3000 and type `BISSA`
3. Jump to a step: http://localhost:3000/build/malm-3-drawers?step=12, or print the guide at `/build/malm-3-drawers/print`
4. See every build you've finished, side by side at true scale: http://localhost:3000/builds
5. Try the AI parts: `cp .env.example .env.local`, set `OPENROUTER_API_KEY`, then paste `bygga-dev-mock-key-000000` into the app's key box. The server swaps in your `OPENROUTER_API_KEY`, and only `npm run dev` accepts the mock key.
6. Scan any brand's paper manual at `/scan`: drop photos or a PDF, up to 24 pages. Set `NEXT_PUBLIC_SCAN=0` to hide the scanner.
7. Replay the listening tests after touching the voice: `npm run voice:check`
8. Rebuild the catalog when IKEA's listings change: `npm run ikea:fetch && npm run ikea:build && npm run ikea:check`
9. Before pushing: `npm run lint && npm run build`

## Roadmap

- [ ] teach the generator the last odd shapes in `scripts/ikea/skips.ts`: three-cornered shelves, corner combinations, PAX widths that don't split into frames
- [ ] give the voice more languages than English
- [ ] test the manual scanner on a stack of real manuals and tighten its page reading
- We don't mirror IKEA's PDF manuals, on purpose. Every guide is generated, and each cover links to the official manual on ikea.com.

## License

MIT, see [LICENSE](LICENSE). Bygga is not affiliated with IKEA: IKEA and its product names are trademarks of Inter IKEA Systems B.V., and the license grants no rights in them (see [NOTICE](NOTICE)).
