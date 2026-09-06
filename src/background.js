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
  stats: { skipped: 0 },
});

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
      await set({ ytlist: frisk, ytError: null });
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
      await set({ blocklist: frisk, lastError: null });
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
        const { lastError, skipStopped, selectorTrouble } = await get(["lastError", "skipStopped", "selectorTrouble"]);
        svar({
          ...i, ids: liste.ids,
          listMeta: { generated_at: liste.generated_at, count: liste.ids.length,
                      origin: liste.origin, source: liste.source },
          lastError: lastError || null,
          skipStopped: skipStopped || null,
          selectorTrouble: selectorTrouble || null,
        });
        break;
      }
      case "ytState": {
        const i = await indstillinger();
        const liste = await sikrYtListe();
        svar({
          enabled: i.enabled, hide: i.hide, allowlist: i.allowlist,
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
        const brudte = Array.isArray(msg.broken) ? msg.broken : [];
        await set({ selectorTrouble: brudte.length ? { at: Date.now(), broken: brudte } : null });
        svar({ ok: true });
        break;
      }
      case "setOption": {
        const tilladt = ["enabled", "skip", "hide", "allowlist", "allowNames"];
        if (tilladt.includes(msg.key)) await set({ [msg.key]: msg.value });
        svar({ ok: true });
        break;
      }
      case "refreshNow": svar({ spotify: await opdatér(), youtube: await opdatérYt() }); break;
      default: svar({ ok: false, reason: "unknown" });
    }
  })();
  return true;   // asynkront svar
});

// --- livscyklus -----------------------------------------------------------
// setInterval overlever ikke en MV3 service worker (den rives ned efter ~30 s
// tomgang). chrome.alarms er den eneste der faktisk fyrer.

const planlaeg = () => chrome.alarms.create(ALARM, { periodInMinutes: REFRESH_MIN, delayInMinutes: 1 });

chrome.runtime.onInstalled.addListener(async () => {
  planlaeg();                       // alarmen foerst - den maa aldrig kunne tabes
  try { await sikrListe(); } catch (e) {
    await set({ lastError: { when: new Date().toISOString(), msg: "seed: " + e.message } });
  }
  try { await sikrYtListe(); } catch (e) {
    await set({ ytError: { when: new Date().toISOString(), msg: "seed: " + e.message } });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  planlaeg();
  await sikrListe();
  await sikrYtListe();
  // alarmer fyrer ikke mens browseren er lukket - tjek selv om listen er gammel
  const { blocklist } = await get("blocklist");
  const alder = blocklist && blocklist.fetched_at
    ? Date.now() - Date.parse(blocklist.fetched_at) : Infinity;
  if (alder > REFRESH_MIN * 60 * 1000) { opdatér(); opdatérYt(); }
});

chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) { opdatér(); opdatérYt(); } });
