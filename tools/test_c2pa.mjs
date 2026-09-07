// Test af C2PA-laeseren mod rigtige, spec-korrekte filer.
// Den her fejltype - "vi laeser ét bit ud af en struktur der siger noget andet" -
// kan kun fanges mod ægte filer. Derfor fixtures, ikke mock.
//
// Oven i fixtures: en haandfuld SYNTETISKE varianter bygget af de ægte filer, én
// pr. fejl der er fundet i læseren. Hver af dem gav et pænt, forkert svar i
// stedet for en fejl - og det er den ene fejltype fixtures alene ikke fanger,
// fordi c2patool skriver pæne filer.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROD = join(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.self = globalThis;
const kode = readFileSync(join(ROD, "src/c2pa.js"), "utf8");
new Function(kode)();
const { analyser, analyserLager, cbor, findStore, C2PA_LAGER_UUID } = globalThis.NoAIC2PA;

const C2PA_BYTES = 262144;   // samme foerste trin som background.js henter

// kaster: true = laeseren SKAL kaste. Aldrig "ingen", aldrig et paent, forkert svar.
const FORVENTET = {
  "ren.jpg":        { har: false },
  "ai.jpg":         { har: true, dom: "ai" },
  "kamera.jpg":     { har: true, dom: "camera" },
  "komposit.jpg":   { har: true, dom: "ai-composite" },
  "ingrediens.jpg": { har: true, dom: "camera", ingrediensAI: true, afledtAfAI: true },
  // over 256 KB, manifestet alene: to-trins-hentningens anden gren
  "stor.jpg":       { har: true, dom: "ai" },
  // skaaret over midt i manifest-lageret
  "afkortet.jpg":   { kaster: true },
  // den raa scanning, to beholdere
  "ai.png":         { har: true, dom: "ai" },
  "ai.webp":        { har: true, dom: "ai" },
  // aabnet fra et AI-billede (parentOf), intet eget kildekrav
  "afledt.jpg":     { har: true, dom: "ai-derived", ingrediensAI: true, afledtAfAI: true },
  // AI-billede sat ind som del (componentOf), intet eget kildekrav
  "komponent.jpg":  { har: true, dom: "ai-composite", ingrediensAI: true, medAIKomponent: true },
};

let fejl = 0;
const ok = (m) => console.log("  ok: " + m);
const nej = (m) => { fejl++; console.error("  FEJL " + m); };

const laes = (fil) => {
  const buf = readFileSync(join(ROD, "test/fixtures", fil));
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const somAB = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

function tjek(navn, u8, vent) {
  let r, e = null;
  try { r = analyser(somAB(u8)); } catch (x) { e = x; }
  if (vent.kaster) {
    if (e) ok(navn + " -> kaster (" + e.message + ")");
    else nej(navn + ": ventede et kast, fik " + JSON.stringify({ har: r.har, dom: r.dom }));
    return;
  }
  if (e) { nej(navn + ": kastede uventet: " + e.message); return; }
  const fik = { har: r.har };
  if (r.har) {
    fik.dom = r.dom;
    for (const k of ["ingrediensAI", "afledtAfAI", "medAIKomponent"])
      if (vent[k] !== undefined) fik[k] = !!r[k];
  }
  if (JSON.stringify(fik) === JSON.stringify(vent))
    ok(navn + " -> " + JSON.stringify(fik) + (r.aktivt && r.aktivt.generator ? "  [" + r.aktivt.generator + "]" : ""));
  else nej(navn + ": ventede " + JSON.stringify(vent) + ", fik " + JSON.stringify(fik));
}

console.log("fixtures:");
for (const [fil, vent] of Object.entries(FORVENTET)) {
  if (!existsSync(join(ROD, "test/fixtures", fil))) { nej(fil + " mangler (tools/lav_fixtures.py)"); continue; }
  tjek(fil, laes(fil), vent);
}

// --- syntetiske varianter ------------------------------------------------
console.log("syntetiske varianter:");

const enc = new TextEncoder();
const u32be = (n) => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
const u32 = (b, o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
const boks = (type, indhold) => new Uint8Array([...u32be(8 + indhold.length), ...enc.encode(type), ...indhold]);
const hexByte = (h) => h.match(/../g).map((x) => parseInt(x, 16));
const sammen = (...dele) => {
  const ud = new Uint8Array(dele.reduce((n, d) => n + d.length, 0));
  let k = 0; for (const d of dele) { ud.set(d, k); k += d.length; }
  return ud;
};
// En jumb med en jumd: UUID, toggles, og hvad der nu foelger.
const jumb = (uuidHex, toggles, hale) => boks("jumb", boks("jumd", [...hexByte(uuidHex), toggles, ...hale]));
const FREMMED_UUID = "00112233445566778899aabbccddeeff";

// Alle APP-segmenter foer billeddata: {start, slut, markoer}
function segmenter(b) {
  const ud = [];
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) { o++; continue; }
    const m = b[o + 1];
    if (m === 0xff) { o++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
    if (m === 0xda || m === 0xd9) break;
    const len = (b[o + 2] << 8) | b[o + 3];
    ud.push({ start: o, slut: o + 2 + len, markoer: m });
    o += 2 + len;
  }
  return ud;
}
const app11 = (instans, seq, indhold) => new Uint8Array([0xff, 0xeb,
  ...[(2 + 8 + indhold.length) >> 8 & 255, (2 + 8 + indhold.length) & 255],
  0x4a, 0x50, instans >> 8 & 255, instans & 255, ...u32be(seq), ...indhold]);

const ai = laes("ai.jpg");

// 1. 0-baseret pakke-sekvens. Spec'en siger Z starter paa 1; en skriver der
//    starter paa 0 maa ikke koste det foerste segments LBox/TBox.
{
  const b = new Uint8Array(ai);
  let n = 0;
  for (const s of segmenter(b)) {
    if (s.markoer !== 0xeb) continue;
    const p = s.start + 4;
    const z = u32(b, p + 4);
    if (z < 1) { nej("ai.jpg: ventede 1-baseret Z i fixturen"); break; }
    b.set(u32be(z - 1), p + 4); n++;
  }
  tjek("ai.jpg med 0-baseret Z (" + n + " segmenter)", b, { har: true, dom: "ai" });
}

// 2. To JUMBF-bokse i samme fil, flettet: en fremmed boks (instans 7) FOER
//    lageret. Uden gruppering paa instans flettes dens pakke ind i lagerets.
{
  const fremmed = jumb(FREMMED_UUID, 3, [...enc.encode("vendor"), 0, 1, 2, 3, 4]);
  const b = sammen(ai.subarray(0, 2), app11(7, 1, fremmed), ai.subarray(2));
  tjek("ai.jpg med fremmed JUMBF-boks foran", b, { har: true, dom: "ai" });
}

// 3. Fremmed superboks SIDST i lageret. Det aktive manifest er det sidste
//    MANIFEST, ikke den sidste boks - en leverandoerboks eller fyld bagerst maa
//    ikke blive "det aktive manifest" med nul handlinger.
const lager = new Uint8Array(findStore(somAB(ai)));
if (u32(lager, 0) === 1) nej("ai.jpg: lageret bruger XLBox - testen antager 4-byte LBox");
{
  const hale = jumb(FREMMED_UUID, 3, [...enc.encode("vendor"), 0]);
  const b = sammen(lager, hale);
  b.set(u32be(lager.length + hale.length), 0);
  const r = analyserLager(b);
  if (r.har && r.dom === "ai") ok("fremmed boks sidst i lageret -> ai");
  else nej("fremmed boks sidst i lageret: fik " + JSON.stringify({ har: r.har, dom: r.dom }));
}

// 4. Toggles-byten. En boks sidst i lageret UDEN etiket-bit, men med en
//    signatur hvis byte tilfaeldigvis staver "c2pa.claim.v2". Laeses byte 17+
//    blindt som etiket, bliver den boks et manifest - og det aktive.
{
  const falskKrav = jumb(FREMMED_UUID, 8 /* kun signatur */, [...enc.encode("c2pa.claim.v2"), 0, ...new Array(18).fill(0)]);
  const ydre = boks("jumb", sammen(boks("jumd", [...hexByte("6332706d00110010800000aa00389b71"), 3, ...enc.encode("urn:c2pa:fake"), 0]), falskKrav));
  const b = sammen(lager, ydre);
  b.set(u32be(lager.length + ydre.length), 0);
  const r = analyserLager(b);
  if (r.har && r.dom === "ai") ok("falsk c2pa.claim i signatur-feltet (toggles uden etiket) -> ai");
  else nej("falsk c2pa.claim i signatur-feltet: fik " + JSON.stringify({ har: r.har, dom: r.dom }));
}

// 5. Raa scanning: et tilfaeldigt "jumb" FOER det rigtige lager. Foerste udgave
//    tog det foerste traef og saa aldrig videre.
{
  const png = laes("ai.png");
  const stoej = new Uint8Array([...u32be(32), ...enc.encode("jumb"), ...new Array(24).fill(0x41)]);
  tjek("ai.png med tilfaeldigt 'jumb' foran", sammen(stoej, png), { har: true, dom: "ai" });
  // ... og et der ligner endnu mere: rigtig laengde, jumd, men forkert UUID.
  const naesten = jumb(FREMMED_UUID, 3, [...enc.encode("c2pa"), 0]);
  tjek("ai.png med fremmed JUMBF-boks foran", sammen(naesten, png), { har: true, dom: "ai" });
}

// 6. To-trins-hentningen: de foerste 256 KB af en fil hvis manifest er stoerre.
//    Det trin SKAL kaste - saa siger baggrunden "credentials" indtil hele filen
//    er hentet, i stedet for at cache "ingen".
tjek("stor.jpg, foerste " + C2PA_BYTES + " byte", laes("stor.jpg").subarray(0, C2PA_BYTES), { kaster: true });

// 7. CBOR med graensetjek. Et map der lover to par med bufferen sluttende
//    midtvejs gav {"0":0,"a":1}. Nu kaster det.
for (const [navn, bytes] of [
  ["map afkortet midt i andet par", [0xa2, 0x00, 0x00, 0x61, 0x61]],
  ["tekst laengere end bufferen", [0x65, 0x61, 0x62]],
  ["ubestemt array uden break", [0x9f, 0x01, 0x02]],
  ["reserveret laengdekode", [0x1c]],
  ["tom buffer", []],
]) {
  try { const v = cbor(new Uint8Array(bytes)); nej("cbor " + navn + ": ventede et kast, fik " + JSON.stringify(v)); }
  catch (e) { ok("cbor " + navn + " -> kaster"); }
}
{
  const v = cbor(new Uint8Array([0xa2, 0x61, 0x61, 0x01, 0x61, 0x62, 0x82, 0xf5, 0xf4]));
  if (v.a === 1 && Array.isArray(v.b) && v.b[0] === true && v.b[1] === false) ok("cbor gyldigt map laeses stadig");
  else nej("cbor gyldigt map: fik " + JSON.stringify(v));
}

// 8. Lager-UUID'et er det vi kender.
if (C2PA_LAGER_UUID === "6332706100110010800000aa00389b71") ok("lager-UUID = c2pa + JUMBF-suffiks");
else nej("lager-UUID er aendret: " + C2PA_LAGER_UUID);

console.log(fejl ? "\n" + fejl + " fejl" : "\nalle fixtures og varianter korrekt");
process.exit(fejl ? 1 : 0);
