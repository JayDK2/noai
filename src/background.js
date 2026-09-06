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
const ALARM = "noai-refresh";
const REFRESH_MIN = 360;             // 6 timer
const MAX_BYTES = 4 * 1024 * 1024;   // loft: en kapret kilde maa ikke kunne sprage hukommelsen
const MIN_IDS = 1000;                // krympe-vaern, nedre gulv
const SHRINK_FLOOR = 0.8;            // krympe-vaern, relativt til nuvaerende
const ID_RE = /^[A-Za-z0-9]{22}$/;

const STANDARD = {
  enabled: true,
  skip: false,          // auto-skip er OPT-IN. Standarden graatoner kun.
  hide: false,          // graaton (false) vs skjul (true)
  allowlist: [],        // kunstner-id'er brugeren aldrig vil filtrere
  allowNames: {},       // id -> navn, kun saa listen er laeselig i popup'en
  stats: { skipped: 0, msSaved: 0 },
};

const get = (k) => chrome.storage.local.get(k);
const set = (o) => chrome.storage.local.set(o);

async function indstillinger() {
  const s = await get(Object.keys(STANDARD));
  return { ...STANDARD, ...s };
}

// --- listen ---------------------------------------------------------------

async function laesFroe() {
  const r = await fetch(chrome.runtime.getURL("blocklist.json"));
  return await r.json();
}

async function sikrListe() {
  const { blocklist } = await get("blocklist");
  if (blocklist && Array.isArray(blocklist.ids) && blocklist.ids.length) return blocklist;
  const froe = await laesFroe();
  froe.origin = "bundled";
  await set({ blocklist: froe });
  return froe;
}

function validér(tekst, nuvaerendeAntal) {
  if (tekst.length > MAX_BYTES) throw new Error("svar for stort: " + tekst.length + " bytes");
  let data;
  try { data = JSON.parse(tekst); }
  catch (e) { throw new Error("ikke gyldig JSON (fejlside serveret som 200?)"); }
  if (!data || !Array.isArray(data.ids)) throw new Error("mangler ids-array");
  const ids = data.ids.filter((i) => typeof i === "string" && ID_RE.test(i));
  if (ids.length !== data.ids.length) throw new Error("indeholdt ugyldige id'er");
  if (ids.length < MIN_IDS) throw new Error("kun " + ids.length + " id'er");
  if (nuvaerendeAntal && ids.length < nuvaerendeAntal * SHRINK_FLOOR)
    throw new Error("listen krympede fra " + nuvaerendeAntal + " til " + ids.length);
  return { ...data, ids };
}

async function opdatér() {
  const nuvaerende = await sikrListe();
  try {
    const r = await fetch(MIRROR_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const frisk = validér(await r.text(), nuvaerende.ids.length);
    frisk.origin = "mirror";
    frisk.fetched_at = new Date().toISOString();
    // ERSTATTER. Flettes ALDRIG ind i den gamle: goer man det, bliver den
    // indbagte liste et gulv, og en kunstner der er fjernet hos kilden
    // forbliver flaget for evigt. Det braekker retten til berigtigelse.
    await set({ blocklist: frisk, lastError: null });
    return { ok: true, count: frisk.ids.length };
  } catch (e) {
    // beholder sidste gode liste - en fejlet hentning er ikke en tom liste
    await set({ lastError: { when: new Date().toISOString(), msg: String(e.message || e) } });
    return { ok: false, error: String(e.message || e) };
  }
}

// --- maa denne fane skippe? -----------------------------------------------

const LAAS_MS = 2500;   // to Spotify-faner der begge spiller maa ikke skippe hver for sig

async function maaSkippe(sender) {
  const tab = sender && sender.tab;
  if (!tab) return { ok: false, reason: "no-tab" };

  // audible er udefineret hvis vi mangler rettigheder til at se den. Vi gaetter
  // IKKE - saa ville vi kunne skippe musik der spiller paa en anden enhed.
  if (typeof tab.audible !== "boolean") return { ok: false, reason: "audible-unknown" };
  if (!tab.audible) return { ok: false, reason: "not-audible" };
  if (tab.mutedInfo && tab.mutedInfo.muted) return { ok: false, reason: "tab-muted" };

  const { skipLock } = await get("skipLock");
  const nu = Date.now();
  if (skipLock && skipLock.tabId !== tab.id && nu - skipLock.at < LAAS_MS)
    return { ok: false, reason: "another-tab-leads" };
  await set({ skipLock: { tabId: tab.id, at: nu } });
  return { ok: true };
}

// --- beskeder -------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, svar) => {
  (async () => {
    switch (msg && msg.type) {
      case "state": {
        const [i, liste] = [await indstillinger(), await sikrListe()];
        const { lastError, skipStopped } = await get(["lastError", "skipStopped"]);
        svar({ ...i, ids: liste.ids, listMeta: {
          generated_at: liste.generated_at, count: liste.ids.length,
          origin: liste.origin, source: liste.source,
        }, lastError: lastError || null, skipStopped: skipStopped || null });
        break;
      }
      case "maySkip": svar(await maaSkippe(sender)); break;
      case "skipped": {
        const i = await indstillinger();
        i.stats.skipped += 1;
        i.stats.msSaved += Math.max(0, msg.ms | 0);
        await set({ stats: i.stats });
        svar({ ok: true });
        break;
      }
      case "setOption": {
        const tilladt = ["enabled", "skip", "hide", "allowlist", "allowNames"];
        if (tilladt.includes(msg.key)) await set({ [msg.key]: msg.value });
        svar({ ok: true });
        break;
      }
      case "refreshNow": svar(await opdatér()); break;
      default: svar({ ok: false, reason: "unknown" });
    }
  })();
  return true;   // asynkront svar
});

// --- livscyklus -----------------------------------------------------------
// setInterval overlever ikke en MV3 service worker (den rives ned efter ~30 s
// tomgang). chrome.alarms er den eneste der faktisk fyrer.

async function planlaeg() {
  await chrome.alarms.create(ALARM, { periodInMinutes: REFRESH_MIN, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await planlaeg();                       // alarmen foerst - den maa aldrig kunne tabes
  try { await sikrListe(); } catch (e) {
    await set({ lastError: { when: new Date().toISOString(), msg: "seed: " + e.message } });
  }
});
chrome.runtime.onStartup.addListener(async () => {
  await sikrListe();
  await planlaeg();
  // alarmer fyrer ikke mens browseren er lukket - tjek selv om listen er gammel
  const { blocklist } = await get("blocklist");
  const alder = blocklist && blocklist.fetched_at
    ? Date.now() - Date.parse(blocklist.fetched_at) : Infinity;
  if (alder > REFRESH_MIN * 60 * 1000) opdatér();
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) opdatér(); });
