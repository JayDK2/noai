// NoAI - service worker.
// Ejer blokerings-listen, opdateringen, og afgoerelsen om en fane MAA skippe.
//
// To ting bor her og ikke i indholds-scriptet, med vilje:
//  1) Lokalitet. Spotify web afspiller fra et LOESREVET medieelement - der er
//     nul <audio>/<video> i dokumentet, ogsaa midt under afspilning (maalt).
//     Siden kan altsaa ikke selv se om lyden kommer ud HER eller paa en
//     Connect-enhed. Det kan browseren: tab.audible.
//  2) Leder-valg mellem flere Spotify-faner. Samme spoergsmaal, samme svar.

importScripts("/src/c2pa.js");

const MIRROR_URL = "https://raw.githubusercontent.com/JayDK2/noai/main/blocklist.json";
const MIRROR_YT  = "https://raw.githubusercontent.com/JayDK2/noai/main/youtube.json";
const MIRROR_REGLER = "https://raw.githubusercontent.com/JayDK2/noai/main/rules.json";
const ALARM = "noai-refresh";
const REFRESH_MIN = 360;             // 6 timer
const HENT_TIMEOUT = 30000;
const MAX_BYTES = 4 * 1024 * 1024;   // loft: en kapret kilde maa ikke kunne sprage hukommelsen
const MIN_IDS = 1000;                // krympe-vaern, nedre gulv
const SHRINK_FLOOR = 0.8;            // krympe-vaern, relativt til nuvaerende
const MAX_UGYLDIGE = 0.02;           // andel daarlige id er vi accepterer og smider vaek
const ID_RE = /^[A-Za-z0-9]{22}$/;

const get = (k) => chrome.storage.local.get(k);
const set = (o) => chrome.storage.local.set(o);

// Funktion, ikke konstant: en delt default ville blive muteret af stats-taelleren
// og forurene alle senere laesninger i workerens levetid.
const standard = () => ({
  enabled: true,
  skip: false,          // auto-skip er OPT-IN. Standarden graatoner kun.
  hide: false,          // graaton (false) vs skjul (true)
  allowlist: [],        // kunstner-id er brugeren aldrig vil filtrere
  allowNames: {},       // id -> navn, kun saa listen er laeselig i popup en
  c2pa: false,          // billed-scanning kraever <all_urls> - brugeren taender selv
  rules: false,         // site-regler fra mirroren - samme tilladelse, eget valg
  stats: { skipped: 0 },
  watchlist: [],        // [{kind:"spotify"|"youtube", id, label}] - hold oeje med en post
  tally: {},            // dag -> {flagged, total} pr. site. Kun lokalt, kun til brugeren selv.
});

// --- Content Credentials (C2PA) -------------------------------------------
// Vi laeser billedets EGEN erklaering, ikke et gaet. Manifestet ligger som JUMBF
// i filen, og de noegler vi skal bruge staar som ren tekst i bytene (verificeret
// mod en spec-korrekt fil signeret med c2patool). Vi validerer IKKE signaturen:
// det kraever et helt bibliotek og en certifikatkaede, og en forfalsket erklaering
// om at noget ER AI er ikke et angreb nogen har interesse i at udfoere.

// Billed-scanning kraever adgang til alle websites. Den tilladelse beder vi IKKE
// om ved installation - den er valgfri, brugeren giver den fra popup en, og
// indholds-scriptet registreres foerst derefter. En standardinstallation af NoAI
// beder altsaa kun om adgang til Spotify og YouTube.
// --- noed-kontakt ---------------------------------------------------------
// Omdoeber Spotify eller YouTube én krog saa filteret pludselig flager ALT, har vi
// ellers ingen maade at stoppe det paa: en Web Store-opdatering tager dage, og
// imens ser hver bruger hele sit bibliotek graatone. Vi henter allerede en fil vi
// selv ejer hver sjette time - saa den fil kan ogsaa baere et stopsignal.
//
// Kontakten SLUKKER kun. Den kan ikke taende noget, ikke aendre adfaerd og ikke
// naa andet end den ene tilstand. Det er med vilje: en fjernstyret kontakt der kan
// mere end at slaa fra, er en angrebsflade.

async function noedKontakt(liste) {
  const stop = liste && liste.disabled === true;
  const { killSwitch } = await get("killSwitch");
  const var_ = !!(killSwitch && killSwitch.active);
  if (stop === var_) return;
  await set({ killSwitch: stop ? { active: true, at: Date.now(), reason: String(liste.disabled_reason || "") } : null });
}

const C2PA_SCRIPT_ID = "noai-c2pa";

async function opdatérC2paScript() {
  const { c2pa } = await get("c2pa");
  const harLov = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  const skalKoere = !!c2pa && harLov;
  let registreret;
  try {
    const nu = await chrome.scripting.getRegisteredContentScripts({ ids: [C2PA_SCRIPT_ID] });
    registreret = nu.length > 0;
  } catch (e) { registreret = false; }
  try {
    if (skalKoere && !registreret) {
      await chrome.scripting.registerContentScripts([{
        id: C2PA_SCRIPT_ID,
        matches: ["http://*/*", "https://*/*"],
        js: ["src/content-c2pa.js"],
        css: ["src/content-c2pa.css"],
        runAt: "document_idle",
      }]);
    } else if (!skalKoere && registreret) {
      await chrome.scripting.unregisterContentScripts({ ids: [C2PA_SCRIPT_ID] });
    }
  } catch (e) { /* en fejlet registrering maa ikke vaelte resten */ }
  return skalKoere;
}

const C2PA_BYTES = 262144;     // foerste 256 KB - manifestet ligger foran billeddata
const C2PA_CACHE_MAX = 500;
const c2paCache = new Map();

// To trin med vilje: foerst 256 KB for at se OM filen overhovedet baerer et
// manifest (det gaelder de faerreste billeder), og kun ved traef hentes hele filen
// og laeses rigtigt. Ét trin ville enten hente alt for meget eller afskaere store
// manifester midt over.
const C2PA_FULD_MAX = 12 * 1024 * 1024;

async function c2paTjek(url) {
  if (c2paCache.has(url)) return c2paCache.get(url);
  let dom = "none";
  let ekstra = null;
  let fejlede = false;
  // Denne manglede. Anden hentning brugte "afbryd", som kun var erklaeret i TRE
  // ANDRE funktioner - altsaa en ReferenceError, som den ydre catch slugte, saa
  // hvert billede over 256 KB med credentials svarede "ingen". Laeseren koerte
  // dermed aldrig paa netop de filer der oftest baerer et manifest, og fordi
  // fejlen ikke caches blev de 256 KB hentet forgaeves ved hvert gennemsyn.
  const afbryd = new AbortController();
  const ur = setTimeout(() => afbryd.abort(), HENT_TIMEOUT);
  try {
    // force-cache rammer browserens egen cache, saa vi som regel IKKE laver et
    // ekstra netvaerkskald for et billede siden allerede har hentet.
    // credentials: "omit" er eksplicit med vilje. Standarden ("same-origin") ville
    // beskytte os her ved et tilfaelde, og en privatlivspaastand der hviler paa en
    // implicit standard er én omskrivning fra at braekke i stilhed.
    const r = await fetch(url, {
      cache: "force-cache",
      credentials: "omit",
      headers: { Range: "bytes=0-" + (C2PA_BYTES - 1) },
    });
    if (r.ok || r.status === 206) {
      const buf = await r.arrayBuffer();
      const tekst = new TextDecoder("latin1").decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, C2PA_BYTES)));
      if (tekst.includes("jumdc2pa")) {
        // Der ER et manifest. Hent hele filen og laes den rigtigt - byte-soegning
        // kan ikke skelne filens EGET krav fra en ingrediens, og et kamerabillede
        // med én AI-genereret ting indsat ville ellers blive kaldt AI.
        let hel = buf;
        // Svarede serveren 200 i stedet for 206, ignorerede den vores Range og vi
        // har allerede HELE filen. At hente igen ville koste dobbelt baandbredde
        // for ingenting - og den anden hentning rammer alligevel ikke cachen,
        // fordi en gemt 206 ikke kan besvare en fuld foresporgsel.
        const helFilAlleredeHentet = r.status === 200;
        if (!helFilAlleredeHentet && buf.byteLength >= C2PA_BYTES) {
          const r2 = await fetch(url, { cache: "force-cache", credentials: "omit", signal: afbryd.signal });
          if (r2.ok) {
            const b2 = await r2.arrayBuffer();
            if (b2.byteLength <= C2PA_FULD_MAX) hel = b2;
          }
        }
        try {
          const a = self.NoAIC2PA.analyser(hel);
          if (a.har) {
            dom = a.dom;
            ekstra = { ingrediensAI: !!a.ingrediensAI,
                       afledtAfAI: !!a.afledtAfAI,          // forældre-ingrediens erklærer AI
                       medAIKomponent: !!a.medAIKomponent,  // en indsat del erklærer AI
                       generator: (a.aktivt && a.aktivt.generator) || null,
                       kaede: a.kaede || [] };
          } else { dom = "credentials"; }
        } catch (e) {
          // Kan manifestet ikke laeses, siger vi at der ER credentials - ikke at
          // det er AI. Vi gaetter ikke paa noget vi ikke kunne afkode.
          dom = "credentials";
        }
      }
    }
  } catch (e) { fejlede = true; } finally { clearTimeout(ur); }
  // En 429, en timeout eller et 403 (hotlink-vaern, udloebne signerede URL er) maa
  // IKKE cementeres som "ingen credentials" for workerens levetid. Vi cacher kun
  // rigtige svar.
  const svar = { dom, ...(ekstra || {}) };
  if (!fejlede) {
    if (c2paCache.size >= C2PA_CACHE_MAX) c2paCache.delete(c2paCache.keys().next().value);
    c2paCache.set(url, svar);
  }
  return svar;
}

async function indstillinger() {
  const d = standard();
  const s = await get(Object.keys(d));
  return { ...d, ...s, stats: { ...d.stats, ...(s.stats || {}) } };
}

// --- listen ---------------------------------------------------------------

async function sikrListe() {
  const { blocklist } = await get("blocklist");
  if (blocklist && Array.isArray(blocklist.ids) && blocklist.ids.length) return blocklist;
  const r = await fetch(chrome.runtime.getURL("blocklist.json"));
  const froe = await r.json();
  froe.origin = "bundled";
  await set({ blocklist: froe });
  return froe;
}

function validér(tekst, nuvaerendeAntal) {
  let data;
  try { data = JSON.parse(tekst); }
  catch (e) { throw new Error("ikke gyldig JSON (fejlside serveret som 200?)", { cause: e }); }
  if (!data || !Array.isArray(data.ids)) throw new Error("mangler ids-array");
  const ids = data.ids.filter((i) => typeof i === "string" && ID_RE.test(i));
  const kasseret = data.ids.length - ids.length;
  // Et enkelt daarligt id maa ikke fryse listen for evigt - men en kilde der pludselig
  // er halvt vroevl skal stoppes. Derfor en ANDEL, ikke nul-tolerance.
  if (data.ids.length && kasseret / data.ids.length > MAX_UGYLDIGE)
    throw new Error(kasseret + " af " + data.ids.length + " id er var ugyldige");
  if (ids.length < MIN_IDS) throw new Error("kun " + ids.length + " id er");
  if (nuvaerendeAntal && ids.length < nuvaerendeAntal * SHRINK_FLOOR)
    throw new Error("listen krympede fra " + nuvaerendeAntal + " til " + ids.length);
  return { ...data, ids, dropped: kasseret };
}

// --- YouTube-listen -------------------------------------------------------
// Samme regler som Spotify-listen: den hentede ERSTATTER den indbagte, sidste
// gode liste beholdes ved fejl, og krympe-vaernet gaelder. Forskellen er de to
// niveauer: block graatones, warn faar kun et maerke.

async function sikrYtListe() {
  const { ytlist } = await get("ytlist");
  if (ytlist && Array.isArray(ytlist.block) && ytlist.block.length) return ytlist;
  const r = await fetch(chrome.runtime.getURL("youtube.json"));
  const froe = await r.json();
  froe.origin = "bundled";
  await set({ ytlist: froe });
  return froe;
}

function validérYt(tekst, nuvaerendeAntal) {
  let data;
  try { data = JSON.parse(tekst); }
  catch (e) { throw new Error("ikke gyldig JSON", { cause: e }); }
  if (!data || !Array.isArray(data.block) || !Array.isArray(data.warn))
    throw new Error("mangler block/warn");
  const rent = (a) => a.filter((h) => typeof h === "string" && h.startsWith("@") && h.length < 71);
  const block = rent(data.block), warn = rent(data.warn);
  if (block.length < MIN_IDS) throw new Error("kun " + block.length + " kanaler");
  if (nuvaerendeAntal && block.length < nuvaerendeAntal * SHRINK_FLOOR)
    throw new Error("listen krympede fra " + nuvaerendeAntal + " til " + block.length);
  return { ...data, block, warn };
}

let henterYt = null;

async function opdatérYt() {
  if (henterYt) return henterYt;
  henterYt = (async () => {
    const nuvaerende = await sikrYtListe();
    const afbryd = new AbortController();
    const ur = setTimeout(() => afbryd.abort(), HENT_TIMEOUT);
    try {
      const r = await fetch(MIRROR_YT, { cache: "no-cache", signal: afbryd.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const tekst = await r.text();
      if (tekst.length > MAX_BYTES) throw new Error("svar for stort");
      const frisk = validérYt(tekst, nuvaerende.block.length);
      frisk.origin = "mirror";
      frisk.fetched_at = new Date().toISOString();
      await meldAendring("youtube", [...nuvaerende.block, ...nuvaerende.warn],
                                    [...frisk.block, ...frisk.warn]);
      await set({ ytlist: frisk, ytError: null });
      await noedKontakt(frisk);
      return { ok: true, count: frisk.block.length + frisk.warn.length };
    } catch (e) {
      await set({ ytError: { when: new Date().toISOString(), msg: String(e.message || e) } });
      return { ok: false, error: String(e.message || e) };
    } finally { clearTimeout(ur); henterYt = null; }
  })();
  return henterYt;
}

let henterNu = null;

async function opdatér() {
  if (henterNu) return henterNu;          // onStartup kan kappes med alarmen
  henterNu = (async () => {
    const nuvaerende = await sikrListe();
    const afbryd = new AbortController();
    const ur = setTimeout(() => afbryd.abort(), HENT_TIMEOUT);
    try {
      const r = await fetch(MIRROR_URL, { cache: "no-cache", signal: afbryd.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const len = Number(r.headers.get("content-length") || 0);
      if (len > MAX_BYTES) throw new Error("svar for stort: " + len + " bytes");
      const tekst = await r.text();
      if (tekst.length > MAX_BYTES) throw new Error("svar for stort");
      const frisk = validér(tekst, nuvaerende.ids.length);
      frisk.origin = "mirror";
      frisk.fetched_at = new Date().toISOString();
      // ERSTATTER. Flettes ALDRIG ind i den gamle: goer man det, bliver den indbagte
      // liste et gulv, og en kunstner der er fjernet hos kilden forbliver flaget for
      // evigt. Det braekker retten til berigtigelse.
      await meldAendring("spotify", nuvaerende.ids, frisk.ids);
      await set({ blocklist: frisk, lastError: null });
      await noedKontakt(frisk);
      return { ok: true, count: frisk.ids.length };
    } catch (e) {
      // beholder sidste gode liste - en fejlet hentning er ikke en tom liste
      await set({ lastError: { when: new Date().toISOString(), msg: String(e.message || e) } });
      return { ok: false, error: String(e.message || e) };
    } finally {
      clearTimeout(ur);
      henterNu = null;
    }
  })();
  return henterNu;
}

// --- site-regler ----------------------------------------------------------
// Selektorer som DATA, hentet fra vores egen mirror. En ny platform bliver en
// JSON-linje der er live paa seks timer; en knaekket selektor kan rettes lige saa
// hurtigt, i stedet for at vente paa en butiksopdatering.
//
// Intet i en regel udfoeres nogensinde som kode. Handlingerne er et lukket
// ordforraad: saet en klasse, saet en tekst. Alt andet ville vaere fjernhostet
// kode og er baade forbudt og en daarlig idé.

const REGEL_MAX = 40;

// LAAST I DEN ANMELDTE BUILD. Den hentede fil maa levere selektorer til disse
// vaerter og ingen andre.
//
// Foerste udgave udledte vaerts-listen af den hentede fil og gav den til
// registerContentScripts. Det er ikke konfiguration: konfiguration vaelger mellem
// adfaerd den anmeldte kode allerede indeholder, mens dét tilfoejede OPRINDELSER
// den anmeldte build aldrig kendte. AdGuard blev afvist fem gange for praecis den
// mekanisme og fjernede til sidst funktionen for at blive godkendt.
//
// Med listen laast beholder vi det vi faktisk ville have - at kunne reparere en
// knaekket selektor paa seks timer i stedet for uger - og mister kun evnen til at
// tilfoeje platforme uden anmeldelse, hvilket er netop dét der faar extensions
// fjernet. Er listen tom, henter og registrerer motoren intet overhovedet.
const REGEL_VAERTER = [];

// Et vaertsnavn skal ogsaa vaere et GYLDIGT vaertsnavn, ikke bare bestaa af
// tilladte tegn: ".." bestaar tegn-tjekket, giver et ugyldigt match-moenster, og
// registerContentScripts kaster - for ALLE vaerter i samme kald. Hver vaert
// registreres derfor for sig, og et navn valideres foer det bruges.
const VAERT_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const gyldigVaert = (h) => typeof h === "string" && h.length <= 253 && VAERT_RE.test(h);

// Det lukkede ordforraad for etiketter. Reglen baerer NOEGLEN; teksten bor i
// content-rules.js (TEKSTER) og skal have praecis disse noegler - check.mjs
// haandhaever det. En hentet fil kan dermed vaelge mellem vores ord, aldrig
// skrive sine egne.
const REGEL_ETIKETTER = ["platform-ai", "platform-possible", "reported-ai", "possibly-ai"];

async function sikrRegler() {
  const { rulesData } = await get("rulesData");
  if (rulesData && Array.isArray(rulesData.rules)) return rulesData;
  let froe = { generated_at: null, schema: 1, rules: [] };
  try {
    const r = await fetch(chrome.runtime.getURL("rules.json"));
    froe = await r.json();
  } catch (e) {}
  froe.origin = "bundled";
  await set({ rulesData: froe });
  return froe;
}

function validérRegler(tekst) {
  const d = JSON.parse(tekst);
  if (!d || !Array.isArray(d.rules)) throw new Error("mangler rules-array");
  if (d.schema !== 1) throw new Error("ukendt schema: " + d.schema);
  const rene = d.rules.filter((r) =>
    r && typeof r.id === "string" && Array.isArray(r.hosts) && r.hosts.length &&
    // Vaerten SKAL staa i den laaste liste. En regel der naevner noget andet
    // kasseres praecis som en misdannet regel - den fortolkes ikke.
    r.hosts.every((h) => gyldigVaert(h) && REGEL_VAERTER.includes(h)) &&
    typeof r.container === "string" && r.container.length < 200 &&
    typeof r.signal === "string" && r.signal.length < 200 &&
    (r.tier === "block" || r.tier === "warn") &&
    REGEL_ETIKETTER.includes(r.label));
  if (rene.length !== d.rules.length) throw new Error("regelfilen indeholdt ugyldige poster");
  return { ...d, rules: rene.slice(0, REGEL_MAX) };
}

let henterRegler = null;

async function opdatérRegler() {
  if (!REGEL_VAERTER.length) return { ok: true, count: 0 };   // intet at hente
  if (henterRegler) return henterRegler;
  henterRegler = (async () => {
    const afbryd = new AbortController();
    const ur = setTimeout(() => afbryd.abort(), HENT_TIMEOUT);
    try {
      const r = await fetch(MIRROR_REGLER, { cache: "no-cache", signal: afbryd.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const tekst = await r.text();
      if (tekst.length > 512 * 1024) throw new Error("regelfil for stor");
      const frisk = validérRegler(tekst);
      frisk.origin = "mirror";
      frisk.fetched_at = new Date().toISOString();
      await set({ rulesData: frisk, rulesError: null });
      await opdatérRegelScript();
      return { ok: true, count: frisk.rules.length };
    } catch (e) {
      await set({ rulesError: { when: new Date().toISOString(), msg: String(e.message || e) } });
      return { ok: false, error: String(e.message || e) };
    } finally { clearTimeout(ur); henterRegler = null; }
  })();
  return henterRegler;
}

const REGEL_SCRIPT_PRAEFIKS = "noai-rules:";

// Én registrering PR. VAERT, og fejl der siges hoejt. Foerste udgave lagde alle
// vaerter i ét kald inde i én slugt try: én misdannet vaert vaeltede hele
// registreringen, ingen vaert fik scriptet, og ingen fik det at vide.
async function opdatérRegelScript() {
  if (!REGEL_VAERTER.length) return false;    // motoren er inaktiv i denne udgave
  const i = await indstillinger();
  const d = await sikrRegler();
  const skalKoere = !!i.rules && d.rules.length > 0;
  let registrerede = [];
  try {
    registrerede = (await chrome.scripting.getRegisteredContentScripts())
      .map((s) => s.id).filter((id) => id.startsWith(REGEL_SCRIPT_PRAEFIKS));
  } catch (e) { /* ingen registreringer at rydde */ }
  const fejl = [];
  try {
    if (registrerede.length) await chrome.scripting.unregisterContentScripts({ ids: registrerede });
  } catch (e) { fejl.push("afregistrering: " + (e && e.message)); }
  if (skalKoere) {
    for (const h of REGEL_VAERTER) {           // ALDRIG fra den hentede fil
      if (!gyldigVaert(h)) { fejl.push(h + ": ugyldigt vaertsnavn"); continue; }
      try {
        await chrome.scripting.registerContentScripts([{
          id: REGEL_SCRIPT_PRAEFIKS + h,
          matches: ["https://" + h + "/*"],    // aldrig http
          js: ["src/content-rules.js"],
          css: ["src/content-rules.css"],
          runAt: "document_idle",
        }]);
      } catch (e) { fejl.push(h + ": " + (e && e.message)); }
    }
  }
  await set({ rulesScriptError: fejl.length ? { when: new Date().toISOString(), msg: fejl.join("; ") } : null });
  return skalKoere && fejl.length < REGEL_VAERTER.length;
}

// --- opslag ---------------------------------------------------------------
// "Staar jeg paa en liste?" Den vigtigste funktion for den der ER paa listen:
// intet sted i verden kan man i dag slaa det op. Alt sker lokalt - vi har begge
// lister i storage i forvejen, saa det er et Set-opslag, ikke et netvaerkskald.

const ID_SPOTIFY = /^[A-Za-z0-9]{22}$/;

function tolkSoegning(raa) {
  const t = String(raa || "").trim();
  if (!t) return null;
  let m = /open\.spotify\.com\/artist\/([A-Za-z0-9]{22})/.exec(t);
  if (m) return { kind: "spotify", id: m[1] };
  if (ID_SPOTIFY.test(t)) return { kind: "spotify", id: t };
  m = /youtube\.com\/(@[^/?#\s]+)/.exec(t);
  if (m) { try { return { kind: "youtube", id: decodeURIComponent(m[1]).toLowerCase() }; }
           catch (e) { return { kind: "youtube", id: m[1].toLowerCase() }; } }
  if (t.startsWith("@")) {
    try { return { kind: "youtube", id: decodeURIComponent(t).toLowerCase() }; }
    catch (e) { return { kind: "youtube", id: t.toLowerCase() }; }
  }
  return null;
}

async function slaaOp(raa) {
  const q = tolkSoegning(raa);
  if (!q) return { ok: false, reason: "unparsed" };
  if (q.kind === "spotify") {
    const l = await sikrListe();
    return { ok: true, kind: "spotify", id: q.id,
             tier: l.ids.includes(q.id) ? "block" : "none",
             source: l.source, generated_at: l.generated_at };
  }
  const l = await sikrYtListe();
  return { ok: true, kind: "youtube", id: q.id,
           tier: l.block.includes(q.id) ? "block" : l.warn.includes(q.id) ? "warn" : "none",
           source: l.source, generated_at: l.generated_at };
}

// --- overvaagning ---------------------------------------------------------
// Ved hver listeopdatering sammenlignes den nye liste med den gamle. Bliver en
// post man holder oeje med tilfoejet eller fjernet, faar man besked. Det er hele
// pointen: man kan ikke selv opdage at man er havnet paa en fremmed liste.

// notifications er en VALGFRI tilladelse, bedt om foerste gang brugeren saetter
// noget paa overvaagning. Uden den er der intet at melde til - og create ville
// kaste. Tjek frem for at fange.
async function maaNotificere() {
  try { return await chrome.permissions.contains({ permissions: ["notifications"] }); }
  catch (e) { return false; }
}

const MELD_ENKELTVIS_MAX = 3;

async function meldAendring(kind, foer, efter) {
  const i = await indstillinger();
  const vagt = (i.watchlist || []).filter((w) => w.kind === kind);
  if (!vagt.length) return;
  const gammel = new Set(foer), ny = new Set(efter);
  const aendrede = [];
  for (const w of vagt) {
    const var_ = gammel.has(w.id), er = ny.has(w.id);
    if (var_ !== er) aendrede.push({ navn: w.label || w.id, id: w.id, er });
  }
  if (!aendrede.length || !(await maaNotificere())) return;
  const liste = kind === "youtube" ? "YouTube" : "Spotify";
  const vis = (id, o) => chrome.notifications.create(id, {
    type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"), ...o,
  });
  try {
    // Faa aendringer: én besked hver. Mange: én samlet. Uden loftet gav en
    // listeopdatering én notifikation pr. post, og id'erne bar Date.now(), saa
    // de hobede sig op i stedet for at erstatte hinanden. Id'et er nu stabilt
    // pr. post: en ny opdatering om samme post erstatter den gamle besked.
    if (aendrede.length <= MELD_ENKELTVIS_MAX) {
      for (const a of aendrede) {
        await vis("noai-" + kind + "-" + a.id, {
          title: a.er ? "Added to a filter list" : "Removed from a filter list",
          message: a.navn + (a.er ? " has been added to the " + liste + " list."
                                  : " is no longer on the " + liste + " list."),
        });
      }
    } else {
      const tilfoejet = aendrede.filter((a) => a.er).length;
      const fjernet = aendrede.length - tilfoejet;
      await vis("noai-" + kind + "-samlet", {
        title: aendrede.length + " of your watched entries changed",
        message: "On the " + liste + " list: " +
          [tilfoejet && tilfoejet + " added", fjernet && fjernet + " removed"].filter(Boolean).join(", ") +
          ". First: " + aendrede.slice(0, 3).map((a) => a.navn).join(", ") + ".",
      });
    }
  } catch (e) { /* notifikationer kan vaere slaaet fra i systemet - det maa ikke vaelte opdateringen */ }
}

// --- maa denne fane skippe? -----------------------------------------------

const LAAS_MS = 2500;
// Laasen bor i en variabel, ikke i storage: et await mellem laesning og skrivning
// giver to faner mulighed for begge at bestaa kontrollen og begge skippe. Workeren
// er enkelttraadet, saa tjek-og-saet uden await er udeleligt.
let laas = null;

function maaSkippe(sender) {
  const tab = sender && sender.tab;
  if (!tab) return { ok: false, reason: "no-tab" };
  // audible er udefineret hvis vi mangler rettigheder til at se den. Vi gaetter IKKE -
  // saa kunne vi skippe musik der spiller paa en anden enhed.
  if (typeof tab.audible !== "boolean") return { ok: false, reason: "audible-unknown" };
  if (!tab.audible) return { ok: false, reason: "not-audible" };
  if (tab.mutedInfo && tab.mutedInfo.muted) return { ok: false, reason: "tab-muted" };

  const nu = Date.now();
  if (laas && laas.tabId !== tab.id && nu - laas.at < LAAS_MS)
    return { ok: false, reason: "another-tab-leads" };
  laas = { tabId: tab.id, at: nu };
  return { ok: true };
}

// --- beskeder -------------------------------------------------------------

// Én noegle pr. side i tally og selectorTrouble. Tre skrivere deler dem: Spotify,
// YouTube og regel-siderne ("rules:<vaert>"). Alt ukendt lander hos Spotify.
const siteNoegle = (raa) =>
  raa === "youtube" ? "youtube"
  : /^rules:[a-z0-9.-]{1,253}$/.test(String(raa || "")) ? raa
  : "spotify";

chrome.runtime.onMessage.addListener((msg, sender, svar) => {
  if (msg && msg.type === "maySkip") { svar(maaSkippe(sender)); return false; }
  (async () => {
    switch (msg && msg.type) {
      case "state": {
        const i = await indstillinger();
        const liste = await sikrListe();
        const { killSwitch } = await get("killSwitch");
        const { lastError, skipStopped, selectorTrouble, ytError, rulesError, rulesScriptError } =
          await get(["lastError", "skipStopped", "selectorTrouble", "ytError", "rulesError", "rulesScriptError"]);
        const ytListe = await sikrYtListe();
        const regelData = REGEL_VAERTER.length ? await sikrRegler() : null;
        svar({
          ...i,
          // En aktiv noed-kontakt slaar filteret fra, uanset brugerens indstilling.
          enabled: i.enabled && !(killSwitch && killSwitch.active),
          killSwitch: killSwitch || null,
          c2pa: !!i.c2pa, ids: liste.ids,
          listMeta: { generated_at: liste.generated_at, count: liste.ids.length,
                      origin: liste.origin, source: liste.source },
          lastError: lastError || null,
          sidsteSide: (await get("sidsteSide")).sidsteSide || null,
          rulesAvailable: REGEL_VAERTER.length > 0,
          // Indstillingen kan staa taendt mens adgangen er vaek - fx hvis brugeren
          // har trukket den tilbage i browserens egne indstillinger. Saa er
          // funktionen inaktiv, og det skal siges, ikke skjules.
          sideAdgang: await chrome.permissions.contains({ origins: ["<all_urls>"] }),
          // En fejlet regel-hentning var usynlig: popup en viste de tre andre
          // fejlkilder og ikke denne.
          rulesError: rulesError || rulesScriptError || null,
          rulesMeta: regelData ? { generated_at: regelData.generated_at, count: regelData.rules.length,
                                   origin: regelData.origin } : null,
          ytError: ytError || null,
          ytMeta: { generated_at: ytListe.generated_at, source: ytListe.source,
                    count: ytListe.block.length + ytListe.warn.length },
          skipStopped: skipStopped || null,
          selectorTrouble: selectorTrouble || null,
        });
        break;
      }
      case "lookup": svar(await slaaOp(msg.query)); break;
      case "rules": {
        const i = await indstillinger();
        const ks = (await get("killSwitch")).killSwitch;
        if (!i.enabled || !i.rules || (ks && ks.active)) { svar({ rules: [] }); break; }
        const d = await sikrRegler();
        const v = String(msg.host || "").toLowerCase();
        svar({ rules: d.rules.filter((r) => r.hosts.some((h) => v === h || v.endsWith("." + h))) });
        break;
      }
      case "tally": {
        // Ren lokal statistik. Ingen URL er, ingen sidetitler - kun to tal pr. dag
        // pr. site. Den eneste modtager er brugeren selv.
        const i = await indstillinger();
        const dag = new Date().toISOString().slice(0, 10);
        const t = { ...(i.tally || {}) };
        const d = { ...(t[dag] || {}) };
        // Tre skrivere deler nu noeglen. Uden "rules:"-grenen ville en knaekket
        // regel skrive i Spotifys plads - og en sund regel-side SLETTE en levende
        // Spotify-fejlmelding. Praecis den fejl vi rettede sidste runde.
        const site = siteNoegle(msg.site);
        const s0 = d[site] || { flagged: 0, total: 0 };
        d[site] = { flagged: s0.flagged + (msg.flagged | 0), total: s0.total + (msg.total | 0) };
        t[dag] = d;
        // hold 30 dage, ikke mere
        for (const k of Object.keys(t).sort().slice(0, -30)) delete t[k];
        // sidsteSide er sidens TOTAL, ikke tilvaeksten. Gemte vi tilvaeksten,
        // ville popup ens "this page" vise den sidste stigning i stedet for hvad
        // brugeren faktisk har set.
        await set({ tally: t, sidsteSide: { site,
          flagged: msg.pageFlagged | 0, total: msg.pageTotal | 0 } });
        svar({ ok: true });
        break;
      }
      case "c2paEnabled": {
        const i = await indstillinger();
        svar({ enabled: !!i.c2pa });
        break;
      }
      case "c2paPermission": {
        svar({ granted: await chrome.permissions.contains({ origins: ["<all_urls>"] }) });
        break;
      }
      case "c2pa": {
        const i = await indstillinger();
        if (!i.c2pa || typeof msg.url !== "string" || !/^https?:/.test(msg.url)) {
          svar({ verdict: "none" });
          break;
        }
        svar(await c2paTjek(msg.url));
        break;
      }
      case "ytState": {
        const i = await indstillinger();
        const liste = await sikrYtListe();
        const { killSwitch: ks } = await get("killSwitch");
        svar({
          enabled: i.enabled && !(ks && ks.active), hide: i.hide, allowlist: i.allowlist,
          block: liste.block, warn: liste.warn,
          meta: { generated_at: liste.generated_at, source: liste.source,
                  origin: liste.origin, count: liste.block.length + liste.warn.length },
        });
        break;
      }
      case "skipped": {
        const i = await indstillinger();
        i.stats.skipped += 1;
        await set({ stats: i.stats });
        svar({ ok: true });
        break;
      }
      case "selectors": {
        // Pr. site. Med én faelles noegle slettede en sund YouTube-fane en levende
        // Spotify-fejlmelding og omvendt - og med begge sider aabne, som er det
        // normale for denne udvidelse, ville vagten stort set altid sige "alt vel".
        // Regel-siderne ("rules:<vaert>") SKAL ogsaa have deres egen plads: uden
        // den landede de i Spotifys, og en sund regel-side slettede en levende
        // Spotify-melding - samme fejl som tally-grenen fik rettet.
        const site = siteNoegle(msg.site);
        const brudte = (Array.isArray(msg.broken) ? msg.broken : [])
          .filter((x) => typeof x === "string" && x.length < 80).slice(0, 40);
        const { selectorTrouble } = await get("selectorTrouble");
        const nu = { ...(selectorTrouble || {}) };
        if (brudte.length) nu[site] = { at: Date.now(), broken: brudte };
        else delete nu[site];
        await set({ selectorTrouble: Object.keys(nu).length ? nu : null });
        svar({ ok: true });
        break;
      }
      case "setOption": {
        // "rules" og "watchlist" MANGLEDE her. Popup ens "Watch this" sendte
        // altsaa noget der blev smidt vaek i stilhed: overvaagningslisten blev
        // aldrig gemt, meldAendring havde aldrig noget at melde, og hele
        // funktionen var doed uden én fejl nogen steder. Praecis den fejltype.
        const tilladt = ["enabled", "skip", "hide", "allowlist", "allowNames", "c2pa", "rules", "watchlist"];
        if (!tilladt.includes(msg.key)) { svar({ ok: false, reason: "unknown-key" }); break; }
        let vaerdi = msg.value;
        if (msg.key === "watchlist") {
          vaerdi = (Array.isArray(vaerdi) ? vaerdi : []).filter((w) => w &&
            (w.kind === "spotify" || w.kind === "youtube") && typeof w.id === "string" && w.id.length < 80)
            .map((w) => ({ kind: w.kind, id: w.id, label: typeof w.label === "string" ? w.label.slice(0, 120) : w.id }))
            .slice(0, 200);
        }
        if (msg.key === "allowlist") {
          vaerdi = (Array.isArray(vaerdi) ? vaerdi : []).filter((x) => typeof x === "string");
          // Navnene foelger listen: et id der forlader allowlist skal ogsaa
          // forlade allowNames, ellers vokser navnetabellen for evigt.
          const { allowNames } = await get("allowNames");
          const behold = new Set(vaerdi);
          const navne = {};
          for (const [id, n] of Object.entries(allowNames || {})) if (behold.has(id)) navne[id] = n;
          await set({ allowlist: vaerdi, allowNames: navne });
        } else {
          await set({ [msg.key]: vaerdi });
        }
        if (msg.key === "c2pa") await opdatérC2paScript();
        if (msg.key === "rules") await opdatérRegelScript();
        svar({ ok: true });
        break;
      }
      case "refreshNow": svar({ spotify: await opdatér(), youtube: await opdatérYt() }); break;
      default: svar({ ok: false, reason: "unknown" });
    }
  })();
  return true;   // asynkront svar
});

// --- hoejreklik -----------------------------------------------------------
// Den korteste vej fra "det her er forkert" til at der sker noget. Uden den skal
// brugeren aabne popup en, forstaa hvad et 22-tegns-id er, og selv finde ud af
// hvad der skal indberettes - altsaa sker der ingenting.

const MENU_TILLAD = "noai-tillad";
const MENU_MELD = "noai-meld";

function tolkLink(url) {
  if (!url) return null;
  let m = /open\.spotify\.com\/artist\/([A-Za-z0-9]{22})/.exec(url);
  if (m) return { kind: "spotify", id: m[1] };
  m = /youtube\.com\/(@[^/?#]+)/.exec(url);
  if (m) {
    try { return { kind: "youtube", id: decodeURIComponent(m[1]).toLowerCase() }; }
    catch (e) { return { kind: "youtube", id: m[1].toLowerCase() }; }
  }
  return null;
}

function byggMenuer() {
  chrome.contextMenus.removeAll(() => {
    const maal = {
      contexts: ["link"],
      targetUrlPatterns: ["*://open.spotify.com/artist/*", "*://*.youtube.com/@*"],
    };
    chrome.contextMenus.create({ id: MENU_TILLAD, title: "NoAI: never filter this", ...maal });
    chrome.contextMenus.create({ id: MENU_MELD, title: "NoAI: report this as a mistake", ...maal });
  });
}

// Navnet bag et Spotify-link. Chrome giver os ikke linkets tekst (linkText er
// Firefox), saa vi spoerger indholds-scriptet i fanen, som kan slaa linket op i
// DOM en. Paa andre sider end open.spotify.com er der intet script - saa id.
async function navnForLink(tab, t) {
  if (t.kind === "youtube") return t.id;              // @haandtaget ER navnet
  if (!tab || typeof tab.id !== "number") return t.id;
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: "artistNavn", id: t.id });
    return (r && typeof r.navn === "string" && r.navn.trim()) || t.id;
  } catch (e) { return t.id; }
}

// Kvittering uden notifikations-tilladelsen: et kort maerke paa ikonet.
let maerkeUr = 0;
async function kvitterPaaIkon(tekst) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: "#3ddc84" });
    await chrome.action.setBadgeText({ text: tekst });
    clearTimeout(maerkeUr);
    maerkeUr = setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
  } catch (e) { /* ikonet er ikke afgoerende */ }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const t = tolkLink(info.linkUrl);
  if (!t) return;
  if (info.menuItemId === MENU_TILLAD) {
    const i = await indstillinger();
    const liste = new Set(i.allowlist || []);
    liste.add(t.id);
    // OGSAA navnet. Foerste udgave skrev kun allowlist, saa poster tilfoejet
    // herfra stod som raa 22-tegns-id'er i praecis den liste brugeren skal
    // kunne laese for at fjerne dem igen.
    const navn = await navnForLink(tab, t);
    const navne = { ...(i.allowNames || {}), [t.id]: navn };
    await set({ allowlist: [...liste], allowNames: navne });
    if (await maaNotificere()) {
      try {
        await chrome.notifications.create("noai-allow-" + t.id, {
          type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: "Never filtering this again",
          message: navn + " has been added to your allowlist.",
        });
      } catch (e) { kvitterPaaIkon("OK"); }
    } else kvitterPaaIkon("OK");
    return;
  }
  if (info.menuItemId === MENU_MELD) {
    const krop = [
      "**What is wrongly flagged**", "",
      (t.kind === "youtube" ? "YouTube channel: " : "Spotify artist: ") + t.id, "",
      "**Why it is wrong**", "",
      "<!-- A sentence is enough. No proof is required. -->", "",
      "---",
      "Artists and channel owners can also write to noAI@h1tmakers.com.",
      "We remove on request, without conditions, within six hours.",
    ].join("\n");
    await chrome.tabs.create({ url: "https://github.com/JayDK2/noai/issues/new?title=" +
      encodeURIComponent("Wrongly flagged: " + t.id) + "&body=" + encodeURIComponent(krop) });
  }
});

// --- livscyklus -----------------------------------------------------------
// setInterval overlever ikke en MV3 service worker (den rives ned efter ~30 s
// tomgang). chrome.alarms er den eneste der faktisk fyrer.

const planlaeg = () => chrome.alarms.create(ALARM, { periodInMinutes: REFRESH_MIN, delayInMinutes: 1 });

chrome.permissions.onRemoved.addListener(async () => {
  // Traekker brugeren adgangen tilbage i browserens egne indstillinger, skal
  // funktionen slukke af sig selv - ikke staa og fejle i det stille.
  await set({ c2pa: false, rules: false });
  await opdatérC2paScript();
  await opdatérRegelScript();
});

chrome.runtime.onInstalled.addListener(async () => {
  planlaeg();
  byggMenuer();
  await opdatérC2paScript();                       // alarmen foerst - den maa aldrig kunne tabes
  try { await sikrListe(); } catch (e) {
    await set({ lastError: { when: new Date().toISOString(), msg: "seed: " + e.message } });
  }
  try { await sikrYtListe(); } catch (e) {
    await set({ ytError: { when: new Date().toISOString(), msg: "seed: " + e.message } });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  planlaeg();
  byggMenuer();
  await opdatérC2paScript();
  await sikrListe();
  await sikrYtListe();
  // alarmer fyrer ikke mens browseren er lukket - tjek selv om listen er gammel
  const { blocklist } = await get("blocklist");
  const alder = blocklist && blocklist.fetched_at
    ? Date.now() - Date.parse(blocklist.fetched_at) : Infinity;
  if (alder > REFRESH_MIN * 60 * 1000) { opdatér(); opdatérYt(); }
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) { opdatér(); opdatérYt(); opdatérRegler(); }
});
