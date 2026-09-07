// Test af C2PA-laeseren mod rigtige, spec-korrekte filer.
// Den her fejltype - "vi laeser ét bit ud af en struktur der siger noget andet" -
// kan kun fanges mod ægte filer. Derfor fixtures, ikke mock.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROD = join(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.self = globalThis;
const kode = readFileSync(join(ROD, "src/c2pa.js"), "utf8");
new Function(kode)();
const { analyser } = globalThis.NoAIC2PA;

const FORVENTET = {
  "ren.jpg":       { har: false },
  "ai.jpg":        { har: true, dom: "ai" },
  "kamera.jpg":    { har: true, dom: "camera" },
  "komposit.jpg":  { har: true, dom: "ai-composite" },
  "ingrediens.jpg":{ har: true, dom: "camera", ingrediensAI: true },
};

let fejl = 0;
for (const [fil, vent] of Object.entries(FORVENTET)) {
  const sti = join(ROD, "test/fixtures", fil);
  if (!existsSync(sti)) { console.log("  spring over (mangler): " + fil); continue; }
  const buf = readFileSync(sti);
  const r = analyser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const fik = { har: r.har };
  if (r.har) { fik.dom = r.dom; if (vent.ingrediensAI !== undefined) fik.ingrediensAI = !!r.ingrediensAI; }
  const ok = JSON.stringify(fik) === JSON.stringify(vent);
  if (!ok) { fejl++; console.error("  FEJL " + fil + ": ventede " + JSON.stringify(vent) + ", fik " + JSON.stringify(fik)); }
  else console.log("  ok: " + fil + " -> " + JSON.stringify(fik) + (r.aktivt && r.aktivt.generator ? "  [" + r.aktivt.generator + "]" : ""));
}
console.log(fejl ? "\n" + fejl + " fejl" : "\nalle fixtures korrekt");
process.exit(fejl ? 1 : 0);
