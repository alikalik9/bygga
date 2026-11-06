/**
 * Pre-records every line the hands-free voice can say for the offline catalog.
 *
 *   npm run voice -- --dry      list what would be recorded and the cost
 *   npm run voice               record missing clips (needs OPENROUTER_API_KEY)
 *   npm run voice -- --only 10  record just the first few, to check the sound
 *   npm run voice -- --recheck  re-run the transcript check on the log, no recording
 *
 * The voice is TTS in src/lib/voice/tts.ts, on OpenRouter. Clips are named by
 * clipId(text), so only new or changed lines are recorded. Each clip is
 * loudness-matched, trimmed, then transcribed with Whisper on OpenRouter and
 * re-recorded if it doesn't say what the script says.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PRODUCTS, toSpec } from "@/lib/catalog";
import { buildPlan } from "@/lib/plan";
import { KIND_LABELS } from "@/lib/products";
import { specForKind } from "@/lib/search";
import { SAMPLE_SCAN } from "@/lib/scan/sample";
import type { Plan } from "@/lib/types";
import { LINES, VOICE_DIR, builtLine, clipId, numWords, stepLines, whereLine } from "@/lib/voice/script";
import { TTS, forTTS, speak } from "@/lib/voice/tts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "public", VOICE_DIR);
const LOG = path.join(import.meta.dirname, "clips.json");
const USD_PER_1K = TTS.usdPer1K;
// nothing added to the text: delivery tags on short lines push a voice into a whisper
const DIRECTION = "";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const maxUsd = Number(args[args.indexOf("--max-usd") + 1]) || 6;
const only = Number(args[args.indexOf("--only") + 1]) || Infinity;

/* ---------- collect ---------- */

function plans(): Plan[] {
  const out: Plan[] = [];
  for (const e of PRODUCTS) out.push(buildPlan(toSpec(e)));
  for (const k of KIND_LABELS) out.push(buildPlan({ ...specForKind(k.kind, "X"), slug: "kind-" + k.kind }));
  out.push(buildPlan({ ...SAMPLE_SCAN, slug: "scan-sample" }));
  return out;
}

function collect() {
  const lines = new Set<string>(Object.values(LINES));
  for (const p of plans()) {
    const n = p.steps.length;
    for (let i = 0; i < n; i++) {
      for (const l of stepLines(p, i)) lines.add(l);
      lines.add(whereLine(i, n));
    }
    lines.add(builtLine(p));
  }
  return [...lines].map((text) => ({ id: clipId(text), text }));
}

/* ---------- render ---------- */

const env = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

async function render(text: string): Promise<Buffer> {
  return Buffer.from(await speak(DIRECTION + forTTS(text), env("OPENROUTER_API_KEY")));
}

/** Trim silence, fade the edges, match loudness (two passes), mono 64 kbps mp3. */
function finish(raw: string, out: string) {
  const trim = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,afade=t=in:d=0.02,areverse,afade=t=in:d=0.01";
  const log = execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "${raw}" -af "${trim},loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json" -f null - 2>&1`], { encoding: "utf8" });
  const m = JSON.parse(log.slice(log.lastIndexOf("{"), log.lastIndexOf("}") + 1));
  const ln = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", `${trim},${ln},aresample=44100`, "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", out]);
  return Math.round(Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" })) * 1000);
}

/* ---------- check ---------- */

const CONTRACT: [RegExp, string][] = [
  [/\b(\w+)'ll\b/g, "$1 will"],
  [/\b(\w+)'re\b/g, "$1 are"],
  [/\bcan't\b/g, "can not"],
  [/\bcannot\b/g, "can not"],
  [/\bdon't\b/g, "do not"],
  [/\bisn't\b/g, "is not"],
  [/\baren't\b/g, "are not"],
  [/\b(it|that|one|there|what|here)'s\b/g, "$1 is"],
  [/\bok\b/g, "okay"],
];

function words(s: string) {
  let t = s.toLowerCase().replace(/[’`]/g, "'");
  for (const [re, to] of CONTRACT) t = t.replace(re, to);
  t = t.replace(/\d+/g, (d) => " " + numWords(Number(d)) + " ");
  return t
    .replace(/[^a-z' ]+/g, " ")
    .replace(/'/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function distance(a: string[], b: string[]) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

async function transcribe(file: string) {
  const input_audio = { data: readFileSync(file).toString("base64"), format: "mp3" };
  const r = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("OPENROUTER_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/whisper-large-v3", input_audio }),
  });
  if (!r.ok) throw new Error(`whisper ${r.status}`);
  return String((await r.json()).text ?? "");
}

function matches(script: string, heard: string) {
  // names like Kallax or Idåsen come back spelled many ways, so they don't count
  const names = new Set((script.match(/(?<=[a-z,] )[A-Z]\S+/g) ?? []).flatMap(words));
  const all = words(script);
  const a = all.filter((w) => !names.has(w));
  let spare = names.size * 2;
  const b = words(heard).filter((w) => !names.has(w) && (all.includes(w) || spare-- <= 0));
  const err = distance(a, b) / Math.max(1, a.length);
  return { ok: a.length <= 3 ? a.every((w) => b.includes(w)) && b.length <= a.length + 2 : err <= 0.15 && b[0] === a[0], err };
}

/* ---------- main ---------- */

type Entry = { text: string; ms: number; heard: string; ok: boolean; takes: number };

async function main() {
  const all = collect();
  mkdirSync(OUT, { recursive: true });
  const log: Record<string, Entry> = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : {};
  if (args.includes("--recheck")) {
    for (const e of Object.values(log)) e.ok = matches(e.text, e.heard).ok;
    writeFileSync(LOG, JSON.stringify(log, null, 1));
    for (const [id, e] of Object.entries(log)) if (!e.ok) console.log(`listen to ${id}.mp3: "${e.text}" heard "${e.heard}"`);
    return;
  }
  const todo = all.filter((c) => !existsSync(path.join(OUT, c.id + ".mp3"))).slice(0, only);
  const chars = todo.reduce((s, c) => s + c.text.length + DIRECTION.length, 0);
  const usd = (chars / 1000) * USD_PER_1K;
  console.log(`${all.length} lines, ${todo.length} to record, ${chars} characters, about $${usd.toFixed(2)} (plus retakes)`);
  if (dry) {
    for (const c of todo) console.log(c.id, c.text);
    return;
  }
  if (usd > maxUsd) throw new Error(`over budget: $${usd.toFixed(2)} > $${maxUsd} (pass --max-usd)`);

  // outside .next: a build in the meantime would wipe it
  const tmp = path.join(tmpdir(), "bygga-voice");
  mkdirSync(tmp, { recursive: true });
  let spent = 0;
  let done = 0;
  const work = async (c: { id: string; text: string }) => {
    let best: Entry | null = null;
    for (let take = 1; take <= 3; take++) {
      const raw = path.join(tmp, `${c.id}-${take}.mp3`);
      const fin = path.join(tmp, `${c.id}-${take}-fin.mp3`);
      writeFileSync(raw, await render(c.text));
      spent += ((c.text.length + DIRECTION.length) / 1000) * USD_PER_1K;
      const ms = finish(raw, fin);
      const heard = await transcribe(fin);
      const m = matches(c.text, heard);
      const entry = { text: c.text, ms, heard, ok: m.ok, takes: take };
      if (!best || m.ok || (!best.ok && m.err < 1)) {
        best = entry;
        writeFileSync(path.join(tmp, `${c.id}-best.mp3`), readFileSync(fin));
      }
      if (m.ok) break;
    }
    writeFileSync(path.join(OUT, c.id + ".mp3"), readFileSync(path.join(tmp, `${c.id}-best.mp3`)));
    log[c.id] = best!;
    done++;
    if (!best!.ok) console.log(`  check: "${c.text}" heard "${best!.heard}"`);
    if (done % 25 === 0) {
      console.log(`${done}/${todo.length}, $${spent.toFixed(2)}`);
      writeFileSync(LOG, JSON.stringify(log, null, 1));
    }
  };
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        try {
          await work(c);
        } catch (e) {
          console.log(`  failed: "${c.text}": ${(e as Error).message}`);
        }
      }
    }),
  );

  // keep only clips the current script still uses
  const ids = Object.fromEntries(all.filter((c) => log[c.id]).map((c) => [c.id, log[c.id].ms]));
  writeFileSync(LOG, JSON.stringify(Object.fromEntries(Object.entries(log).filter(([id]) => id in ids)), null, 1));
  writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ voice: `${TTS.name} (${TTS.label})`, clips: ids }));
  rmSync(tmp, { recursive: true, force: true });
  const flagged = Object.values(log).filter((e) => !e.ok).length;
  console.log(`done: ${Object.keys(ids).length} clips, ${flagged} to listen to, $${spent.toFixed(2)} spent`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
