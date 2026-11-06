/**
 * Copies the PDF.js worker into public/ before dev and build, so the scanner
 * can load it from this site and the strict CSP never needs an outside host.
 * The copy is gitignored and refreshed whenever the package changes.
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const to = join(root, "public/pdf.worker.min.mjs");

if (!existsSync(from)) {
  console.error("[pdf-worker] pdfjs-dist is not installed. Run npm install first.");
  process.exit(1);
}

await mkdir(dirname(to), { recursive: true });
if (!existsSync(to) || (await stat(from)).mtimeMs > (await stat(to)).mtimeMs) {
  await copyFile(from, to);
  console.log("[pdf-worker] copied public/pdf.worker.min.mjs");
}
