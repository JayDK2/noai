#!/usr/bin/env node
// Statisk kontrol af NoAI. Ikke daekning - én bestemt fejltype.
//
// Fire gange har vi sendt en vagt af sted der ikke KUNNE fyre, og hver gang blev
// den fundet fordi et menneske laeste koden linje for linje. Den luksus forsvinder
// naar der er brugere. Det her fanger dem paa et sekund.
//
// Den dyreste af dem: SEL.bar blev brugt og aldrig defineret. closest(undefined)
// bliver til closest("undefined") - et gyldigt selektor-udtryk der bare aldrig
// rammer noget - saa den fejlede tavst i stedet for at kaste.
//
// Det ESLint kan (no-undef, ubrugte variabler, skygger) ligger i eslint.config.mjs.
// Her staar det ESLint IKKE kan: sammenhaenge paa tvaers af filer og datafiler.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROD = join(dirname(fileURLToPath(import.meta.url)), "..");
let fejl = 0;
const nej = (m) => { console.error("  FEJL: " + m); fejl++; };
const ja = (m) => console.log("  ok: " + m);

// 1. Alle SEL.x der bruges skal vaere defineret
for (const fil of ["src/content.js", "src/content-youtube.js", "src/content-c2pa.js"]) {
  const sti = join(ROD, fil);
  if (!existsSync(sti)) { nej(fil + " findes ikke"); continue; }
  const kode = readFileSync(sti, "utf8");
  const blok = /const SEL = \{([\s\S]*?)\n {2}\};/.exec(kode);
  if (!blok) { ja(fil + ": ingen SEL-blok"); continue; }
  const defineret = new Set([...blok[1].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map((m) => m[1]));
  const brugt = new Set([...kode.matchAll(/\bSEL\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]));
  const mangler = [...brugt].filter((k) => !defineret.has(k));
  if (mangler.length) nej(fil + ": SEL." + mangler.join(", SEL.") + " bruges men defineres aldrig");
  else ja(fil + ": alle " + brugt.size + " SEL-opslag er defineret");
}

// 2. Manifestet skal vaere gyldigt, og hver fil det peger paa skal findes
const mf = JSON.parse(readFileSync(join(ROD, "manifest.json"), "utf8"));
const stier = [
  ...Object.values(mf.icons || {}),
  ...Object.values((mf.action || {}).default_icon || {}),
  (mf.action || {}).default_popup,
  (mf.background || {}).service_worker,
  ...(mf.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
].filter(Boolean);
const savn = [...new Set(stier)].filter((p) => !existsSync(join(ROD, p)));
if (savn.length) nej("manifestet peger paa filer der ikke findes: " + savn.join(", "));
else ja("manifest: alle " + new Set(stier).size + " filhenvisninger findes");

// 2b. Hver vaert manifestet naevner skal ogsaa vaere en vaert scriptet KAN noget
// paa. m.youtube.com stod i manifestet i maaneder, og KORT kendte kun
// desktop-renderere - scriptet koerte og gjorde ingenting.
for (const c of mf.content_scripts || []) {
  for (const m of c.matches || []) {
    if (/m\.youtube\.com/.test(m)) nej("manifest: " + m + " - mobil-YouTube understoettes ikke af content-youtube.js");
  }
}

// 3. Datafilerne skal vaere gyldige, og de to YouTube-niveauer maa ikke overlappe
const bl = JSON.parse(readFileSync(join(ROD, "blocklist.json"), "utf8"));
if (!Array.isArray(bl.ids) || bl.ids.length < 1000) nej("blocklist.json: for faa id'er");
else if (bl.ids.some((i) => !/^[A-Za-z0-9]{22}$/.test(i))) nej("blocklist.json: ugyldige id'er");
else ja("blocklist.json: " + bl.ids.length + " gyldige id'er");

const yt = JSON.parse(readFileSync(join(ROD, "youtube.json"), "utf8"));
const b = new Set(yt.block), w = new Set(yt.warn);
const overlap = [...b].filter((h) => w.has(h));
if (overlap.length) nej("youtube.json: " + overlap.length + " kanal(er) paa BEGGE niveauer - block ville vinde og graatone noget kilden kun kalder muligt: " + overlap.slice(0,3).join(", "));
else ja("youtube.json: " + b.size + " blok + " + w.size + " advarsel, intet overlap");
if (yt.count !== b.size + w.size) nej("youtube.json: count-feltet er " + yt.count + ", skulle vaere " + (b.size + w.size));

// 3a. Etiket-ordforraadet: reglen baerer en NOEGLE, teksten bor i content-rules.js
// (TEKSTER), og background.js validerer mod REGEL_ETIKETTER. De to lister skal
// vaere ens - ellers godkender baggrunden en noegle siden ikke kan vise, og
// maerket bliver "undefined".
const regelKode = readFileSync(join(ROD, "src/content-rules.js"), "utf8");
const bgKode = readFileSync(join(ROD, "src/background.js"), "utf8");
const teksterBlok = /const TEKSTER = \{([\s\S]*?)\n {2}\};/.exec(regelKode);
const etiketterBlok = /const REGEL_ETIKETTER = \[([^\]]*)\]/.exec(bgKode);
const noegler = new Set(teksterBlok ? [...teksterBlok[1].matchAll(/"([a-z0-9-]+)":/g)].map((m) => m[1]) : []);
const etiketter = new Set(etiketterBlok ? [...etiketterBlok[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]) : []);
if (!teksterBlok || !etiketterBlok) nej("kunne ikke finde TEKSTER (content-rules.js) eller REGEL_ETIKETTER (background.js)");
else {
  const kunSide = [...noegler].filter((k) => !etiketter.has(k));
  const kunBg = [...etiketter].filter((k) => !noegler.has(k));
  if (kunSide.length || kunBg.length)
    nej("etiket-ordforraadet er ude af trit: kun i content-rules.js: [" + kunSide.join(", ") +
        "], kun i background.js: [" + kunBg.join(", ") + "]");
  else ja("etiket-ordforraad: " + noegler.size + " noegler, ens i content-rules.js og background.js");
}

// 3b. Regelfilen: selektorer er data, men de skal stadig vaere velformede - og
// etiketten skal vaere en noegle fra ordforraadet, ikke fri tekst.
const rl = JSON.parse(readFileSync(join(ROD, "rules.json"), "utf8"));
if (rl.schema !== 1) nej("rules.json: ukendt schema " + rl.schema);
else if (!Array.isArray(rl.rules)) nej("rules.json: mangler rules-array");
else {
  const VAERT = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  const daarlige = rl.rules.filter((r) => !(r && typeof r.id === "string" &&
    Array.isArray(r.hosts) && r.hosts.length &&
    r.hosts.every((h) => typeof h === "string" && VAERT.test(h)) &&
    typeof r.container === "string" && typeof r.signal === "string" &&
    (r.tier === "block" || r.tier === "warn") && noegler.has(r.label)));
  if (daarlige.length) nej("rules.json: " + daarlige.length + " ugyldige regler");
  else ja("rules.json: " + rl.rules.length + " regler, alle velformede");
}

// 3c. Hver tilladelse skal vaere forklaret i butiks-teksten, og hver funktion der
// gemmer noget om brugeren skal staa i privatlivspolitikken. Dokumenterne er nu
// tre gange faldet bagud for produktet, og det er en fejltype en maskine kan fange.
const listing = readFileSync(join(ROD, "store/listing.md"), "utf8");
const privacy = readFileSync(join(ROD, "PRIVACY.md"), "utf8");
const alleTilladelser = [...(mf.permissions || []),
                         ...(mf.optional_permissions || []),
                         ...(mf.optional_host_permissions || [])];
const uforklarede = alleTilladelser.filter((p) => !listing.includes(p));
if (uforklarede.length) nej("tilladelser uden forklaring i store/listing.md: " + uforklarede.join(", "));
else ja("alle " + alleTilladelser.length + " tilladelser er forklaret i butiks-teksten");

// notifications skal vaere VALGFRI. Den bedes om foerst naar brugeren saetter
// noget paa overvaagning; produktets hele pointe er at bede om naesten intet.
if ((mf.permissions || []).includes("notifications")) nej("manifest: notifications skal staa i optional_permissions, ikke permissions");
else if (!(mf.optional_permissions || []).includes("notifications")) nej("manifest: notifications mangler i optional_permissions");
else ja("manifest: notifications er valgfri");

const skalNaevnes = { watchlist: "watchlist", tally: "flagged-content counts",
                      allowlist: "allowlist", notifications: "notification" };
const glemte = Object.entries(skalNaevnes)
  .filter(([, tekst]) => !privacy.toLowerCase().includes(tekst.toLowerCase()))
  .map(([n]) => n);
if (glemte.length) nej("gemte data der ikke er beskrevet i PRIVACY.md: " + glemte.join(", "));
else ja("alt gemt om brugeren er beskrevet i privatlivspolitikken");

// 3d. Alt popup en gemmer via setOption skal baggrunden faktisk TAGE IMOD.
// "watchlist" blev sendt i maaneder og smidt vaek i stilhed: overvaagningen
// virkede aldrig, og ingen fejl blev logget.
const popupKode = readFileSync(join(ROD, "src/popup.js"), "utf8");
const ytKode = readFileSync(join(ROD, "src/content-youtube.js"), "utf8");
const sendte = new Set([...(popupKode + ytKode).matchAll(/type: "setOption", key: "([a-zA-Z]+)"/g)].map((m) => m[1]));
const tilladtBlok = /const tilladt = \[([^\]]*)\]/.exec(bgKode);
const modtagne = new Set(tilladtBlok ? [...tilladtBlok[1].matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]) : []);
const smidtVaek = [...sendte].filter((k) => !modtagne.has(k));
if (!tilladtBlok) nej("kunne ikke finde setOption-listen (tilladt) i background.js");
else if (smidtVaek.length) nej("setOption-noegler der sendes men ikke modtages i background.js: " + smidtVaek.join(", "));
else ja("setOption: alle " + sendte.size + " sendte noegler modtages i baggrunden");

// 4. Popup ens id'er skal matche dem scriptet slaar op
const html = readFileSync(join(ROD, "src/popup.html"), "utf8");
const slaaOp = new Set([...popupKode.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));
const findes = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const tabt = [...slaaOp].filter((i) => !findes.has(i));
if (tabt.length) nej("popup.js slaar op paa id'er der ikke findes i popup.html: " + tabt.join(", "));
else ja("popup: alle " + slaaOp.size + " id-opslag findes i markup'en");

console.log(fejl ? "\n" + fejl + " fejl" : "\nalt vel");
process.exit(fejl ? 1 : 0);
