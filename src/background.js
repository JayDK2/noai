// NoAI - service worker.
// Ejer blokerings-listen, opdateringen, og afgoerelsen om en fane MAA skippe.
//
// To ting bor her og ikke i indholds-scriptet, med vilje:
//  1) Lokalitet. Spotify web afspiller fra et LOESREVET medieelement - der er
//     nul <audio>/<video> i dokumentet, ogsaa midt under afspilning (maalt).
//     Siden kan altsaa ikke selv se om lyden kommer ud HER eller paa en
//     Connect-enhed. Det kan browseren: tab.audible.
//  2) Leder-valg mellem flere Spotify-faner. Samme spoergsmaal, samme svar.

const MIRROR_URL = "https://raw.githubusercontent.com/JayDK2/noai/main/blocklist.json";
const MIRROR_YT  = "https://raw.githubusercontent.com/JayDK2/noai/main/youtube.json";
const ALARM = "noai-refresh";
const REFRESH_MIN = 360;             // 6 timer
const HENT_TIMEOUT = 30000;
const MAX_BYTES = 4 * 1024 * 1024;   // loft: en kapret kilde maa ikke kunne sprage hukommelsen
const MIN_IDS = 1000;                // krympe-vaern, nedre gulv
const SHRINK_FLOOR = 0.8;            // krympe-vaern, relativt til nuvaerende
const MAX_UGYLDIGE = 0.02;           // andel daarlige id er vi accepterer og smider vaek
const ID_RE = /^[A-Za-z0-9]{22}$/;

// Funktion, ikke konstant: en delt default ville blive muteret af stats-taelleren
// og forurene alle senere laesninger i workerens levetid.
const standard = () => ({
  enabled: true,
  skip: false,          // auto-skip er OPT-IN. Standarden graatoner kun.
  hide: false,          // graaton (false) vs skjul (true)
  allowlist: [],        // kunstner-id er brugeren aldrig vil filtrere
  allowNames: {},       // id -> navn, kun saa listen er laeselig i popup en
  c2pa: false,          // billed-scanning kraever <all_urls> - brugeren taender selv
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
  let registreret = false;
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

// compositeWith... INDEHOLDER trainedAlgorithmicMedia som delstreng, saa den skal
// proeves foerst - ellers er den anden post doed kode, og vi taber en skelnen
// specifikationen giver os gratis: "helt genereret" er ikke det samme som
// "indeholder AI-elementer", og brugeren bryder sig om forskellen.
const AI_KOMPOSIT = "compositeWithTrainedAlgorithmicMedia";
const AI_HELT = "trainedAlgorithmicMedia";

async function c2paTjek(url) {
  if (c2paCache.has(url)) return c2paCache.get(url);
  let dom = "none";
  let fejlede = false;
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
      if (buf.byteLength <= C2PA_BYTES * 2) {
        const tekst = new TextDecoder("latin1").decode(new Uint8Array(buf));
        if (tekst.includes("jumdc2pa")) {
          dom = tekst.includes(AI_KOMPOSIT) ? "ai-composite"
              : tekst.includes(AI_HELT) ? "ai"
              : tekst.includes("digitalCapture") ? "camera" : "credentials";
        }
      }
    }
  } catch (e) { fejlede = true; }
  // En 429, en timeout eller et 403 (hotlink-vaern, udloebne signerede URL er) maa
  // IKKE cementeres som "ingen credentials" for workerens levetid. Vi cacher kun
  // rigtige svar.
  if (!fejlede) {
    if (c2paCache.size >= C2PA_CACHE_MAX) c2paCache.delete(c2paCache.keys().next().value);
    c2paCache.set(url, dom);
  }
  return dom;
}

const get = (k) => chrome.storage.local.get(k);
const set = (o) => chrome.storage.local.set(o);

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
  catch (e) { throw new Error("ikke gyldig JSON (fejlside serveret som 200?)"); }
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
  catch (e) { throw new Error("ikke gyldig JSON"); }
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

async function meldAendring(kind, foer, efter) {
  const i = await indstillinger();
  const vagt = (i.watchlist || []).filter((w) => w.kind === kind);
  if (!vagt.length) return;
  const gammel = new Set(foer), ny = new Set(efter);
  for (const w of vagt) {
    const var_ = gammel.has(w.id), er = ny.has(w.id);
    if (var_ === er) continue;
    const navn = w.label || w.id;
    try {
      await chrome.notifications.create("noai-" + kind + "-" + w.id + "-" + Date.now(), {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: er ? "Added to a filter list" : "Removed from a filter list",
        message: navn + (er
          ? " has been added to the " + (kind === "youtube" ? "YouTube" : "Spotify") + " list."
          : " is no longer on the " + (kind === "youtube" ? "YouTube" : "Spotify") + " list."),
      });
    } catch (e) { /* notifikationer kan vaere slaaet fra - det maa ikke vaelte opdateringen */ }
  }
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

chrome.runtime.onMessage.addListener((msg, sender, svar) => {
  if (msg && msg.type === "maySkip") { svar(maaSkippe(sender)); return false; }
  (async () => {
    switch (msg && msg.type) {
      case "state": {
        const i = await indstillinger();
        const liste = await sikrListe();
        const { killSwitch } = await get("killSwitch");
        const { lastError, skipStopped, selectorTrouble, ytError } =
          await get(["lastError", "skipStopped", "selectorTrouble", "ytError"]);
        const ytListe = await sikrYtListe();
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
          ytError: ytError || null,
          ytMeta: { generated_at: ytListe.generated_at, source: ytListe.source,
                    count: ytListe.block.length + ytListe.warn.length },
          skipStopped: skipStopped || null,
          selectorTrouble: selectorTrouble || null,
        });
        break;
      }
      case "lookup": svar(await slaaOp(msg.query)); break;
      case "tally": {
        // Ren lokal statistik. Ingen URL er, ingen sidetitler - kun to tal pr. dag
        // pr. site. Den eneste modtager er brugeren selv.
        const i = await indstillinger();
        const dag = new Date().toISOString().slice(0, 10);
        const t = { ...(i.tally || {}) };
        const d = { ...(t[dag] || {}) };
        const site = msg.site === "youtube" ? "youtube" : "spotify";
        const s0 = d[site] || { flagged: 0, total: 0 };
        d[site] = { flagged: s0.flagged + (msg.flagged | 0), total: s0.total + (msg.total | 0) };
        t[dag] = d;
        // hold 30 dage, ikke mere
        for (const k of Object.keys(t).sort().slice(0, -30)) delete t[k];
        await set({ tally: t, sidsteSide: { site, flagged: msg.flagged | 0, total: msg.total | 0 } });
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
        svar({ verdict: await c2paTjek(msg.url) });
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
        const site = msg.site === "youtube" ? "youtube" : "spotify";
        const brudte = Array.isArray(msg.broken) ? msg.broken : [];
        const { selectorTrouble } = await get("selectorTrouble");
        const nu = { ...(selectorTrouble || {}) };
        if (brudte.length) nu[site] = { at: Date.now(), broken: brudte };
        else delete nu[site];
        await set({ selectorTrouble: Object.keys(nu).length ? nu : null });
        svar({ ok: true });
        break;
      }
      case "setOption": {
        const tilladt = ["enabled", "skip", "hide", "allowlist", "allowNames", "c2pa"];
        if (tilladt.includes(msg.key)) await set({ [msg.key]: msg.value });
        if (msg.key === "c2pa") await opdatérC2paScript();
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

chrome.contextMenus.onClicked.addListener(async (info) => {
  const t = tolkLink(info.linkUrl);
  if (!t) return;
  if (info.menuItemId === MENU_TILLAD) {
    const i = await indstillinger();
    const liste = new Set(i.allowlist || []);
    liste.add(t.id);
    await set({ allowlist: [...liste] });
    try {
      await chrome.notifications.create("noai-allow-" + Date.now(), {
        type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Never filtering this again",
        message: t.id + " has been added to your allowlist.",
      });
    } catch (e) {}
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
  await set({ c2pa: false });
  await opdatérC2paScript();
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

chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) { opdatér(); opdatérYt(); } });
