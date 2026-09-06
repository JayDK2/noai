// NoAI - YouTube. Graatoner videoer fra kanaler som faelleslister har indberettet
// som AI-genereret indhold, og saetter et diskret maerke paa dem der kun er MISTAENKT.
//
// To niveauer, med vilje:
//   block  = hoej tillid  -> graatones (eller skjules, hvis brugeren vil det)
//   warn   = middel tillid -> KUN et maerke. Aldrig graatoning, aldrig skjul.
// Kilden (AiSList) foerer selv de to lister adskilt, og at mase dem sammen ville
// give en sikkerhed hverken de eller vi har.

(() => {
  "use strict";

  // Kort-typerne paa forside, soegning, sidebar og kanalsider. Reklamer har intet
  // kanallink og bliver derfor aldrig ramt - det er en gratis afgraensning.
  const KORT = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-playlist-renderer",
    "yt-lockup-view-model",
  ].join(",");

  const PULS_MS = 1200;

  let state = null;
  let doed = false;
  let puls = 0;
  let obs = null;
  let svigtMeldt = null;

  function luk() {
    doed = true;
    if (puls) clearInterval(puls);
    if (obs) obs.disconnect();
    document.removeEventListener("visibilitychange", planlaeg);
  }
  const erDoed = (m) => /context invalidated|Extension context/i.test(m || "");

  const send = (msg) => new Promise((svar) => {
    if (doed) return svar(null);
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        const fejl = chrome.runtime.lastError;
        if (fejl) { if (erDoed(fejl.message)) luk(); return svar(null); }
        svar(r);
      });
    } catch (e) { if (erDoed(e && e.message)) luk(); svar(null); }
  });

  // YouTube skriver haandtag procentkodede i sine links (/@LangweiligeW%C3%A4hrung),
  // og listen er afkodet. Begge sider skal til samme normalform, ellers matcher
  // ingen af de 386 ikke-latinske kanaler nogensinde.
  const normaliser = (raa) => {
    if (!raa || !raa.startsWith("@")) return null;
    try { return decodeURIComponent(raa).toLowerCase(); }
    catch (e) { return raa.toLowerCase(); }
  };

  // Paa en kanalside gentager kortene IKKE kanalens eget link - praecis samme
  // faelde som Spotifys artist-sider. Uden dette ville en blokeret kanals egen
  // side vaere det ene sted filteret ikke virkede.
  function sideHaandtag() {
    return normaliser((location.pathname.split("/")[1] || ""));
  }

  function haandtag(node) {
    const a = node.querySelector('a[href^="/@"]');
    if (a) return normaliser((a.getAttribute("href") || "").split(/[/?#]/)[1] || "");
    return sideHaandtag();
  }

  function rens() {
    if (!state || !state.enabled) return;
    const kort = document.querySelectorAll(KORT);
    if (!kort.length) return;
    let medLink = 0;
    const paaSiden = sideHaandtag();
    for (const k of kort) {
      const h = haandtag(k);
      if (!h) continue;                       // reklame eller kort uden kanal
      if (k.querySelector('a[href^="/@"]')) medLink++;   // kun rigtige links taeller
      const tilladt = state.allow.has(h);
      const niveau = tilladt ? "" : state.block.has(h) ? "block" : state.warn.has(h) ? "warn" : "";
      const skjul = niveau === "block" && state.hide;
      const oensket = niveau ? (skjul ? "hidden" : niveau) : "";
      const mrk = k.querySelector(".noai-yt-mark");
      if (k.getAttribute("data-noai") === oensket && (!niveau || mrk)) continue;
      k.setAttribute("data-noai", oensket);
      k.classList.toggle("noai-yt-block", niveau === "block" && !skjul);
      k.classList.toggle("noai-yt-warn", niveau === "warn");
      k.classList.toggle("noai-yt-hidden", skjul);
      if (niveau && !mrk) {
        const m = document.createElement("span");
        m.className = "noai-yt-mark";
        // Ordlyden skiller de to niveauer ad. "Reported" er en paastand fra andre,
        // ikke en konstatering fra os - og warn-niveauet siger tydeligt at det er
        // mindre sikkert end block.
        m.textContent = niveau === "block" ? "reported as AI" : "possibly AI";
        k.appendChild(m);
      } else if (!niveau && mrk) { mrk.remove(); }
    }
    // Selvtest: findes der kort, men ingen af dem har et kanallink, er selektoren
    // knaekket - og saa filtrerer vi lydloest ingenting.
    const brudt = kort.length > 4 && medLink === 0 && !paaSiden;
    if (brudt !== svigtMeldt) {
      svigtMeldt = brudt;
      send({ type: "selectors", broken: brudt ? ["youtube-channel-link"] : [] });
    }
  }

  let planlagt = false;
  function planlaeg() {
    if (doed || planlagt) return;
    planlagt = true;
    const koer = () => { planlagt = false; rens(); };
    // rAF fyrer ikke i en skjult fane - samme faelde som paa Spotify-siden.
    if (document.hidden) setTimeout(koer, 300);
    else requestAnimationFrame(koer);
  }

  async function hentState() {
    const s = await send({ type: "ytState" });
    if (!s) return;
    state = {
      enabled: s.enabled, hide: s.hide,
      block: new Set(s.block), warn: new Set(s.warn),
      allow: new Set((s.allowlist || []).filter((x) => x.startsWith("@"))),
    };
    planlaeg();
  }

  chrome.storage.onChanged.addListener((c, omraade) => {
    if (doed) return;
    if (omraade === "local" && (c.enabled || c.hide || c.allowlist || c.ytlist)) hentState();
  });

  document.addEventListener("visibilitychange", planlaeg);
  obs = new MutationObserver(planlaeg);

  function start() {
    obs.observe(document.body, { childList: true, subtree: true });
    hentState();
    // YouTube er en enkeltsides-app: indhold skiftes ud uden genindlaesning, og
    // observeren alene kan gaa glip af det.
    puls = setInterval(() => { if (!doed) rens(); }, PULS_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
