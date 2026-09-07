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

  // Kanalsider viser OGSAA hylder med andre kanalers indhold (udvalgte kanaler,
  // playlister med fremmede videoer). Reserven maa kun gaelde kanalens eget gitter,
  // ellers graatoner vi uskyldige videoer med teksten "reported as AI".
  const EGET_GITTER = "ytd-rich-grid-renderer, ytd-item-section-renderer, #contents.ytd-rich-grid-renderer";

  function haandtag(node, a) {
    const link = a !== undefined ? a : node.querySelector('a[href^="/@"]');
    if (link) return normaliser((link.getAttribute("href") || "").split(/[/?#]/)[1] || "");
    const side = sideHaandtag();
    if (!side) return null;
    return node.closest(EGET_GITTER) ? side : null;
  }

  // Samme princip som paa Spotify-siden: hoejeste sete vaerdi pr. sti, ikke summen.
  let sidsteSti = "";
  let hoejest = { flagged: 0, total: 0 };
  let taelTimer = 0;

  function taelOp(flagged, total) {
    if (location.pathname !== sidsteSti) {
      sidsteSti = location.pathname;
      hoejest = { flagged: 0, total: 0 };
    }
    const nyF = Math.max(flagged, hoejest.flagged) - hoejest.flagged;
    const nyT = Math.max(total, hoejest.total) - hoejest.total;
    if (!nyT && !nyF) return;
    hoejest = { flagged: Math.max(flagged, hoejest.flagged), total: Math.max(total, hoejest.total) };
    clearTimeout(taelTimer);
    taelTimer = setTimeout(() => send({ type: "tally", site: "youtube", flagged: nyF, total: nyT }), 1500);
  }

  function rens() {
    if (!state) return;
    if (!state.enabled) {
      // Ryd op frem for at returnere. Ellers ville en fjernstyret standsning
      // efterlade alle maerker staaende paa siden, som om intet var sket.
      for (const k of document.querySelectorAll("[data-noai]")) {
        k.removeAttribute("data-noai");
        k.classList.remove("noai-yt-block", "noai-yt-warn", "noai-yt-hidden");
        const m = k.querySelector(".noai-yt-mark");
        if (m) m.remove();
      }
      return;
    }
    const kort = document.querySelectorAll(KORT);
    if (!kort.length) return;
    let medLink = 0;
    const paaSiden = sideHaandtag();
    for (const k of kort) {
      const link = k.querySelector('a[href^="/@"]');   // hentes én gang, bruges to
      const h = haandtag(k, link);
      if (!h) continue;                       // reklame eller kort uden kanal
      if (link) medLink++;                    // kun rigtige links taeller
      const tilladt = state.allow.has(h);
      // WARN vinder ved konflikt. Kilden har 3 kanaler paa begge lister, og lod vi
      // block vinde, ville vi graatone kanaler som kilden kun vurderer "muligt" -
      // praecis den sammenmasning af tvivl som to-niveau-modellen findes for.
      const niveau = tilladt ? "" : state.warn.has(h) ? "warn" : state.block.has(h) ? "block" : "";
      const skjul = niveau === "block" && state.hide;
      const oensket = niveau ? (skjul ? "hidden" : niveau) : "";
      const mrk = k.querySelector(".noai-yt-mark");
      if (k.getAttribute("data-noai") === oensket && (!niveau || mrk)) continue;
      k.setAttribute("data-noai", oensket);
      k.classList.toggle("noai-yt-block", niveau === "block" && !skjul);
      k.classList.toggle("noai-yt-warn", niveau === "warn");
      k.classList.toggle("noai-yt-hidden", skjul);
      if (niveau && !mrk) {
        const m = document.createElement("button");
        m.className = "noai-yt-mark";
        m.type = "button";
        // Ordlyden skiller de to niveauer ad. "Reported" er en paastand fra andre,
        // ikke en konstatering fra os - og warn-niveauet siger tydeligt at det er
        // mindre sikkert end block.
        m.textContent = niveau === "block" ? "reported as AI" : "possibly AI";
        // Maerket ER udvejen. Uden den kunne en bruger ikke tillade en kanal paa
        // YouTube overhovedet - popup ens "Add current" laeser kun Spotify - og med
        // 21.000 kanaler fra en faellesliste ER der falske positive. Eneste alternativ
        // ville vaere at slukke hele funktionen.
        m.title = "Reported by a community list. Click to never filter " + h + " again.";
        // Gem hvad brugeren ser flaget lige nu, saa popup ens indberetning kan
        // udfyldes med det. Uden det kan en bruger ikke vide HVAD der skal skrives -
        // og saa er berigtigelsen kun reel i robotten, ikke i produktet.
        chrome.storage.local.set({ senestFlaget: { kilde: "youtube", id: h, niveau } });
        m.addEventListener("click", async (e) => {
          e.preventDefault(); e.stopPropagation();
          const s2 = await send({ type: "ytState" });
          if (!s2) return;
          const liste = new Set(s2.allowlist || []);
          liste.add(h);
          await send({ type: "setOption", key: "allowlist", value: [...liste] });
        });
        k.appendChild(m);
      } else if (!niveau && mrk) { mrk.remove(); }
    }
    taelOp(
      [...kort].filter((k) => k.classList.contains("noai-yt-block") ||
                              k.classList.contains("noai-yt-warn") ||
                              k.classList.contains("noai-yt-hidden")).length,
      [...kort].filter((k) => k.querySelector('a[href^="/@"]') || sideHaandtag()).length);
    // Selvtest: findes der kort, men ingen af dem har et kanallink, er selektoren
    // knaekket - og saa filtrerer vi lydloest ingenting.
    // paaSiden daekker praecis de tre tilfaelde rigtigt:
    //  - almindelig side med kort men ingen links -> paaSiden er null -> alarm (rigtigt)
    //  - kanalside hvor haandtaget parser  -> filtreringen virker      -> tavshed (rigtigt)
    //  - kanalside hvor haandtaget IKKE parser -> paaSiden er null     -> alarm (rigtigt)
    // Uden den fyrede alarmen paa hver eneste kanalside. En falsk alarm er vaerre
    // end en blind vinkel: den laerer brugeren at ignorere vagten.
    const brudt = kort.length > 8 && medLink === 0 && !paaSiden;
    if (brudt !== svigtMeldt) {
      svigtMeldt = brudt;
      send({ type: "selectors", site: "youtube", broken: brudt ? ["youtube-channel-link"] : [] });
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
    if (omraade === "local" &&
        (c.enabled || c.hide || c.allowlist || c.ytlist || c.killSwitch)) hentState();
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
