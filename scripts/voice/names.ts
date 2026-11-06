/**
 * How the voice says product names. Kokoro reads "Malm" like an English word,
 * so each name gets a phonetic spelling (Kokoro's [word](/ipa/) markup) the way
 * an English speaker in an IKEA store would say it.
 *
 *   npm run voice:names            spell every catalog name that has no spelling yet
 *   npm run voice:names -- --check say a sample both ways and score what Whisper hears
 *   npm run voice:names -- --prune keep a spelling only where Whisper hears the name clearly better with it
 *   add --only MALM,KALLAX to any of these to work on just those names
 *
 * Spellings live in src/lib/voice/names.ts and are applied only when a line is
 * rendered (src/lib/voice/tts.ts), so clip names and the on-screen text don't change.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PRODUCTS } from "@/lib/catalog";
import { spokenName } from "@/lib/voice/script";
import { forTTS, speak } from "@/lib/voice/tts";

const FILE = path.resolve(import.meta.dirname, "../../src/lib/voice/names.ts");
const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) throw new Error("OPENROUTER_API_KEY is not set");
const args = process.argv.slice(2);
const names: Record<string, string> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8").replace(/^[^{]*/, "").replace(/;\s*$/, "")) : {};
const save = () =>
  writeFileSync(FILE, `/** How the voice says product names, as Kokoro phonemes. Written by scripts/voice/names.ts. */\nexport const NAMES: Record<string, string> = ${JSON.stringify(Object.fromEntries(Object.entries(names).sort()), null, 1)};\n`);

// Kokoro's American English phonemes (misaki), so a spelling never contains a sound it can't make
const OK = /^[ˈˌabdefhijklmnpstuvwzæðŋɑɐɔəɛɜɪʊʌɡɹʃʒθʤʧᵊᵻɚAIOWYː ]+$/;

const PROMPT = `You write how IKEA product names are said out loud in an American IKEA store: the familiar, slightly Swedish pronunciation an English speaker would use (MALM is "mahlm", POÄNG is "poh-ENG", IDÅSEN is "ee-DOH-sen", KALLAX is "KAH-lahks", HEMNES is "HEM-ness", BILLY is "BILL-ee").
Write each in IPA using ONLY these symbols: ˈ ˌ a b d e f h i j k l m n p s t u v w z æ ð ŋ ɑ ɐ ɔ ə ɛ ɜ ɪ ʊ ʌ ɡ ɹ ʃ ʒ θ ʤ ʧ ɚ ː and the diphthongs A (as in day), I (as in my), O (as in go), W (as in now), Y (as in boy). Put ˈ before the stressed syllable.
Reply with JSON only: {"NAME": "ipa", ...} for every name given.`;

// models often write plain letters for these sounds; Kokoro only knows the IPA ones
const PLAIN: Record<string, string> = { g: "ɡ", r: "ɹ", c: "k", x: "ks", o: "O", y: "i", "ʏ": "ɪ", "ʉ": "u", "ø": "ɜ", "œ": "ɜ", "ɒ": "ɑ", q: "k", "ʁ": "ɹ", "ɾ": "ɹ", "ɐ": "ɐ" };
function tidy(raw: string, name: string) {
  let t = raw.trim().replace(/^\/|\/$/g, "").replace(/[.'’]/g, "");
  t = [...t].map((ch) => PLAIN[ch] ?? ch).join("");
  // one word stays one word, so the voice doesn't pause inside a name
  if (!name.includes(" ")) t = t.replace(/\s+/g, "");
  // a stress mark in front makes Kokoro say a sound before the name
  return t.replace(/^[ˈˌ]+/, "");
}

async function ask(list: string[]): Promise<Record<string, string>> {
  for (let tries = 0; ; tries++) {
    try {
      return await askOnce(list);
    } catch (e) {
      if (tries >= 2) throw e;
    }
  }
}

async function askOnce(list: string[]) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      reasoning_effort: "medium",
      response_format: { type: "json_object" },
      max_tokens: 8000,
      temperature: 0.2,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: list.join("\n") },
      ],
    }),
  });
  if (!r.ok) throw new Error(`chat ${r.status}`);
  const text: string = (await r.json()).choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, string>;
}

async function transcribe(buf: ArrayBuffer) {
  const input_audio = { data: Buffer.from(buf).toString("base64"), format: "mp3" };
  const r = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/whisper-large-v3", input_audio }),
  });
  if (!r.ok) throw new Error(`whisper ${r.status}`);
  return String((await r.json()).text ?? "");
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
function sim(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length, 1);
}

async function main() {
  const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",").map(fold)) : null;
  const all = [...new Set(PRODUCTS.map((p) => spokenName(p.name)))].filter((n) => !only || only.has(fold(n)));
  if (args.includes("--prune")) {
    const queue = all.filter((n) => names[n]);
    let kept = 0, dropped = 0;
    const one = async (n: string) => {
      const line = `Your ${n} is built.`;
      const [a, b] = await Promise.all([speak(line, key!), speak(forTTS(line), key!)]);
      const [ha, hb] = await Promise.all([transcribe(a), transcribe(b)]);
      const word = (h: string) => fold(h.replace(/^\W*your\s+/i, "").replace(/\s+is built.*$/i, ""));
      const sa = sim(fold(n), word(ha)), sb = sim(fold(n), word(hb));
      if (sb >= sa + 0.15) kept++;
      else {
        delete names[n];
        dropped++;
      }
    };
    const work = [...queue];
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let n = work.shift(); n; n = work.shift()) await one(n).catch(() => {});
    }));
    save();
    console.log(`kept ${kept} spellings, dropped ${dropped}`);
    return;
  }
  if (args.includes("--check")) {
    const sample = all.filter((n) => names[n]).slice(0, Number(args[args.indexOf("--check") + 1]) || 30);
    let plain = 0, spelled = 0;
    for (const n of sample) {
      const line = `Your ${n} is built.`;
      const [a, b] = await Promise.all([speak(line, key!), speak(forTTS(line), key!)]);
      const [ha, hb] = await Promise.all([transcribe(a), transcribe(b)]);
      const word = (h: string) => fold(h.replace(/^\W*your\s+/i, "").replace(/\s+is built.*$/i, ""));
      const sa = sim(fold(n), word(ha)), sb = sim(fold(n), word(hb));
      plain += sa;
      spelled += sb;
      console.log(`${n.padEnd(12)} plain "${word(ha)}" ${sa.toFixed(2)}   spelled "${word(hb)}" ${sb.toFixed(2)}   ${names[n]}`);
    }
    console.log(`average likeness to the written name: plain ${(plain / sample.length).toFixed(2)}, spelled ${(spelled / sample.length).toFixed(2)}`);
    return;
  }
  const todo = all.filter((n) => !names[n]);
  console.log(`${all.length} names, ${todo.length} to spell`);
  for (let i = 0; i < todo.length; i += 40) {
    const got = await ask(todo.slice(i, i + 40).map((n) => n.toUpperCase()));
    for (const [k, v] of Object.entries(got)) {
      const n = todo.find((x) => x.toUpperCase() === k.toUpperCase());
      const ipa = tidy(String(v), n ?? k);
      if (n && OK.test(ipa)) names[n] = ipa;
      else if (n) console.log(`  skipped ${n}: ${ipa}`);
    }
    save();
    console.log(`${Math.min(i + 40, todo.length)}/${todo.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
