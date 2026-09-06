// NoAI - indholds-script paa open.spotify.com.
// Graatoner flagede numre i lister, og skipper dem (hvis brugeren har taendt for det).
//
// Alt herinde er isolated world. Vi laeser kun det Spotify selv har tegnet paa
// skaermen - vi hooker ikke ind i sidens JavaScript, laeser ingen tokens og
// kalder intet privat API.

(() => {
  "use strict";

  const SEL = {
    widget: "[data-testid^=\"now-playing-widget\"]",   // v2-varianten findes - praefiks!
    widgetArtist: "[data-testid=\"context-item-info-artist\"]",
    skip: "[data-testid=\"control-button-skip-forward\"]",
    repeat: "[data-testid=\"control-button-repeat\"]",
    position: "[data-testid=\"playback-position\"]",
    row: "[data-testid=\"tracklist-row\"]",
  };

  const SKIP_LOFT = 15;        // sammenhaengende skip foer vi stopper og siger til
  const SKIP_FORSOEG = 3;
  const SKIP_VINDUE = 1500;    // hvor laenge vi venter paa at nummeret rent faktisk skifter
  const SKIP_PULS = 50;
  const PULS_MS = 900;

  let state = null;
  let sidsteSpor = "";
  let iGang = false;
  let sammenhaengende = 0;
  let doed = false;            // extensionen er blevet genindlaest under os
  let puls = 0;
  let obs = null;
  const svigt = { widget: false, artist: false, skip: false, position: false };
  let sidsteSvigt = null;   // null, ikke "": saa sendes ogsaa den foerste "alt er sundt"-melding

  const sov = (ms) => new Promise((r) => setTimeout(r, ms));

  const artistId = (href) => {
    const m = /^\/artist\/([A-Za-z0-9]{22})/.exec(href || "");
    return m ? m[1] : null;
  };

  const flaget = (ids) =>
    state && state.enabled && ids.some((i) => state.ids.has(i) && !state.allow.has(i));

  // --- beskeder -------------------------------------------------------------
  // Efter en genindlaesning af extensionen kaster sendMessage synkront for evigt.
  // Uden dette ville pulsen spamme fejl hver 900 ms i hver aaben Spotify-fane.

  function luk() {
    doed = true;
    if (puls) clearInterval(puls);
    if (obs) obs.disconnect();
    document.removeEventListener("click", brugerRoerte, true);
    document.removeEventListener("keydown", brugerRoerte, true);
    document.removeEventListener("visibilitychange", planlaeg);
  }

  const erDoed = (m) => /context invalidated|Extension context/i.test(m || "");

  const send = (msg) => new Promise((svar) => {
    if (doed) return svar(null);
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        const fejl = chrome.runtime.lastError;   // SKAL laeses, ellers logger Chrome stoej
        if (fejl) { if (erDoed(fejl.message)) luk(); return svar(null); }
        svar(r);
      });
    } catch (e) {
      if (erDoed(e && e.message)) luk();
      svar(null);
    }
  });

  // --- afspilningstilstand, sprogfrit ---------------------------------------
  // aria-label paa play/pause er OVERSAT (Spotify udkommer paa ~90 sprog), og
  // navigator.mediaSession.playbackState er "none" paa den nuvaerende afspiller
  // (begge dele maalt). Tilbage staar tidsmarkoeren: rykker den sig, spiller der
  // noget. Tal og kolon oversaettes ikke.

  let sidstePos = null, sidstePosTid = 0, spillerNu = false;
  function spiller() {
    const el = document.querySelector(SEL.position);
    svigt.position = !el;
    if (!el) return false;
    const pos = el.textContent.trim();
    const nu = Date.now();
    if (pos !== sidstePos) { sidstePos = pos; sidstePosTid = nu; spillerNu = true; }
    else if (nu - sidstePosTid > 2500) spillerNu = false;
    return spillerNu;
  }

  // aria-checked er "false" | "true" | "mixed" - haardkodet i Spotifys komponent og
  // aldrig oversat. "mixed" = gentag ET nummer.
  // Faelde vi allerede er faldet i: knappens TEKST beskriver den NAESTE handling, saa
  // der staar "Disable repeat" naar gentag-et er slaaet til. Teksten "Disable repeat
  // one" findes ikke - et vaern bygget paa den kunne aldrig udloese.
  const gentagEt = () => {
    const b = document.querySelector(SEL.repeat);
    return !!b && b.getAttribute("aria-checked") === "mixed";
  };

  // --- nummeret der spiller -------------------------------------------------

  function widgetKunstnere() {
    const w = document.querySelector(SEL.widget);
    svigt.widget = !w;
    if (!w) return null;
    let led = [...w.querySelectorAll(SEL.widgetArtist)];
    svigt.artist = led.length === 0;
    if (!led.length) led = [...w.querySelectorAll("a[href^=\"/artist/\"]")];
    return [...new Set(led.map((a) => artistId(a.getAttribute("href"))).filter(Boolean))];
  }

  // Widgetens eget link peger paa ALBUMMET, ikke sporet (maalt) - der findes intet
  // spor-id i DOM en. Titel + kunstner raekker: vi skal kun se NAAR det skifter.
  function sporId() {
    const w = document.querySelector(SEL.widget);
    return w ? (w.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80) : "";
  }

  const erPodcast = () => {
    const w = document.querySelector(SEL.widget);
    if (!w) return false;
    return [...w.querySelectorAll("a[href]")]
      .some((a) => /^\/(show|episode)\//.test(a.getAttribute("href") || ""));
  };

  function nuSpiller(ids) {
    const w = document.querySelector(SEL.widget);
    const navne = w ? [...w.querySelectorAll(SEL.widgetArtist)].map((a) => a.textContent.trim()) : [];
    chrome.storage.local.set({ nowPlaying: ids && ids.length ? { ids, names: navne } : null });
  }

  // --- skip ------------------------------------------------------------------

  async function proevSkip(fraSpor) {
    const knap = document.querySelector(SEL.skip);
    svigt.skip = !knap;
    if (!knap) return "no-button";
    // disabled daekker BAADE tom koe og opbrugt gratis-kvote - de kan ikke skelnes fra
    // DOM en. Saa: goer ingenting. At pause en gratis-brugers musik er vaerre end at
    // lade et enkelt nummer spille.
    if (knap.disabled) return "unavailable";
    if (gentagEt()) return "repeat-one";   // ellers lander skippet paa samme nummer

    for (let i = 0; i < SKIP_FORSOEG; i++) {
      knap.click();
      // ET klik, mange observationer. Tidligere ventede vi 200-500 ms mellem klik -
      // laengere end Spotifys egen 100 ms-throttle - saa hvert genforsoeg blev til et
      // RIGTIGT ekstra skip og kunne koste et uskyldigt nummer.
      const frist = Date.now() + SKIP_VINDUE;
      while (Date.now() < frist) {
        await sov(SKIP_PULS);
        if (sporId() !== fraSpor) return "ok";
      }
    }
    return "unchanged";   // samme nummer to gange i traek, eller en knap der ikke virker
  }

  async function vurderSpor() {
    if (doed || iGang || !state || !state.enabled) return;
    if (!spiller()) return;
    const id = sporId();
    if (!id || id === sidsteSpor) return;

    // sidsteSpor saettes FOERST naar nummeret er faerdigbehandlet. Saetter man det
    // for tidligt, braender man numre paa afgoerelser der kan aendre sig: en fane er
    // ikke hoerbar de foerste sekunder, afspilning flyttes hertil fra telefonen, eller
    // brugeren taender auto-skip midt i nummeret.
    const faerdig = () => { sidsteSpor = id; };

    if (erPodcast()) return faerdig();
    const ids = widgetKunstnere();
    if (!ids) return;                          // widget mangler - selektor-svigt, proev igen
    if (!ids.length) { nuSpiller(null); return faerdig(); }
    nuSpiller(ids);
    if (!flaget(ids)) { sammenhaengende = 0; return faerdig(); }
    if (!state.skip) return faerdig();
    if (sammenhaengende >= SKIP_LOFT) {
      chrome.storage.local.set({ skipStopped: { at: Date.now(), after: SKIP_LOFT } });
      vis("NoAI stopped skipping after " + SKIP_LOFT + " tracks in a row");
      return faerdig();
    }

    const lov = await send({ type: "maySkip" });
    if (!lov) return;
    if (!lov.ok) {
      // "en anden fane foerer" er stabilt for dette nummer; resten kan aendre sig
      if (lov.reason === "another-tab-leads") faerdig();
      return;
    }

    iGang = true;
    try {
      const r = await proevSkip(id);
      if (r === "ok") { sammenhaengende++; send({ type: "skipped" }); }
      faerdig();
    } finally { iGang = false; }
  }

  let bobleTimer = 0;
  function vis(tekst) {
    let b = document.getElementById("noai-toast");
    if (!b) { b = document.createElement("div"); b.id = "noai-toast"; document.body.appendChild(b); }
    b.textContent = tekst;
    b.classList.add("noai-vis");
    clearTimeout(bobleTimer);
    bobleTimer = setTimeout(() => b.classList.remove("noai-vis"), 8000);
  }

  // --- lister ----------------------------------------------------------------
  // Raekker unmountes og genskabes ved scroll (maalt: 0 af 24 staemplede noder
  // overlevede en lang scroll), saa arbejdet pr. raekke skal vaere minimalt.

  function sideKunstner() {
    const m = /^\/artist\/([A-Za-z0-9]{22})/.exec(location.pathname);
    return m ? m[1] : null;   // artist-sidens raekker har INGEN kunstner-links
  }

  function rensRaekker() {
    if (!state) return;
    const raekker = document.querySelectorAll(SEL.row);
    if (!raekker.length) return;
    const sideId = sideKunstner();
    const skjul = !!state.hide;
    for (const r of raekker) {
      let ids = [...r.querySelectorAll("a[href^=\"/artist/\"]")]
        .map((a) => artistId(a.getAttribute("href"))).filter(Boolean);
      if (!ids.length && sideId) ids = [sideId];
      const flag = !!(ids.length && flaget(ids));
      const oensket = flag ? (skjul ? "hidden" : "dim") : "";
      const mrk = r.querySelector(".noai-mark");
      // Sammenlign HELE den oenskede tilstand, ikke kun om raekken er flaget. Ellers
      // slaar et skift mellem graaton og skjul ikke igennem paa raekker der allerede
      // er tegnet, og et maerke som React har fjernet kommer aldrig tilbage.
      if (r.getAttribute("data-noai") === oensket && (!flag || mrk)) continue;
      r.setAttribute("data-noai", oensket);
      r.classList.toggle("noai-flagged", flag);
      r.classList.toggle("noai-hidden", flag && skjul);
      if (flag && !mrk) {
        const m = document.createElement("span");
        m.className = "noai-mark";
        m.textContent = "reported as AI-generated";   // rigtig tekst, ikke kun farve
        r.appendChild(m);
      } else if (!flag && mrk) { mrk.remove(); }
    }
  }

  // --- selektor-selvtest -----------------------------------------------------
  // Spotify omdoeber sine kroge uden varsel, og saa fejler alt HER lydloest.
  // Popup en skal kunne sige det hoejt.

  function rapporterSvigt() {
    const brudte = Object.keys(svigt).filter((k) => svigt[k]);
    const n = brudte.join(",");
    if (n === sidsteSvigt) return;
    sidsteSvigt = n;
    send({ type: "selectors", broken: brudte });
  }

  let planlagt = false;
  function planlaeg() {
    if (doed || planlagt) return;
    planlagt = true;
    const koer = () => { planlagt = false; rensRaekker(); vurderSpor(); };
    // requestAnimationFrame fyrer ALDRIG i en skjult fane - og en musikafspiller
    // ligger netop i baggrunden (maalt: document.hidden = true, rAF ikke fyret efter
    // 1,2 s). Uden denne gren staar hele udvidelsen stille naar den bruges.
    if (document.hidden) setTimeout(koer, 250);
    else requestAnimationFrame(koer);
  }

  // --- opstart ---------------------------------------------------------------

  async function hentState() {
    const s = await send({ type: "state" });
    if (!s) return;
    state = {
      enabled: s.enabled, skip: s.skip, hide: s.hide,
      ids: new Set(s.ids), allow: new Set(s.allowlist || []),
    };
    sidsteSpor = "";   // saa en aendret indstilling faar det nuvaerende nummer vurderet igen
    planlaeg();
  }

  function brugerRoerte(e) {
    // isTrusted er afgoerende: vores eget knap-klik i proevSkip bobler op til samme
    // lytter, og uden filteret nulstiller hvert skip taelleren - saa ville loftet
    // aldrig kunne slaa til, og en AI-radiostation kunne skippe i det uendelige.
    if (!e.isTrusted) return;
    if (sammenhaengende) chrome.storage.local.remove("skipStopped");
    sammenhaengende = 0;
  }

  chrome.storage.onChanged.addListener((c, omraade) => {
    if (doed) return;
    if (omraade === "local" && (c.enabled || c.skip || c.hide || c.allowlist || c.blocklist))
      hentState();
  });

  document.addEventListener("click", brugerRoerte, true);
  document.addEventListener("keydown", brugerRoerte, true);
  document.addEventListener("visibilitychange", planlaeg);

  obs = new MutationObserver(planlaeg);

  let sidsteSti = location.pathname;
  let barObserveret = false;

  function start() {
    const rod = document.querySelector("main") || document.body;
    obs.observe(rod, { childList: true, subtree: true });   // ingen attributes: 682 poster pr. 25 raekker
    hentState();
    // Puls. Nu-spiller-bjaelken findes ikke altid endnu naar scriptet starter, saa en
    // observer alene kan gaa tabt - og sporskift maa aldrig kunne overses.
    // NB: i en skjult fane klemmer browseren timere til >= 1 s, saa den reelle takt
    // er ~1 Hz. En fane der afspiller lyd er undtaget fra den haarde 1/min-throttling.
    puls = setInterval(() => {
      if (doed) return;
      if (location.pathname !== sidsteSti) { sidsteSti = location.pathname; planlaeg(); }
      if (!barObserveret) {
        const bar = document.querySelector("[data-testid=\"now-playing-bar\"]");
        if (bar) { obs.observe(bar, { childList: true, subtree: true, characterData: true }); barObserveret = true; }
      }
      vurderSpor();
      rapporterSvigt();
    }, PULS_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
