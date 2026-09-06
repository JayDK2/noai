// NoAI - indholds-script paa open.spotify.com.
// To opgaver: graaton flagede numre i lister, og (hvis brugeren har taendt for det)
// skip flagede numre naar de begynder at spille.
//
// Alt herinde er isolated world. Vi laeser kun det Spotify selv har tegnet paa
// skaermen - vi hooker ikke ind i sidens JavaScript, laeser ingen tokens og
// kalder intet privat API.

(() => {
  "use strict";

  const SEL = {
    widget: '[data-testid^="now-playing-widget"]',      // v2-varianten findes - praefiks!
    widgetArtist: '[data-testid="context-item-info-artist"]',
    trackLink: '[data-testid="context-item-link"]',
    skip: '[data-testid="control-button-skip-forward"]',
    repeat: '[data-testid="control-button-repeat"]',
    row: '[data-testid="tracklist-row"]',
    placeholder: '[data-testid="tracklist-row-placeholder"]',
  };

  const SKIP_LOFT = 15;        // sammenhaengende skip foer vi stopper og siger til
  const SKIP_FORSOEG = 3;      // klik-knappen er throttlet 100 ms - stol aldrig paa klikket
  const SKIP_PAUSE = 200;

  let state = null;            // {enabled, skip, hide, allowlist, ids:Set}
  let sidsteSpor = "";
  let iGang = false;
  let sammenhaengende = 0;
  let selektorSvigt = { widget: false, rows: false };

  const artistId = (href) => {
    const m = /^\/artist\/([A-Za-z0-9]{22})/.exec(href || "");
    return m ? m[1] : null;
  };

  const flaget = (ids) =>
    state && state.enabled && ids.some((i) => state.ids.has(i) && !state.allow.has(i));

  // --- kunstnere paa nummeret der spiller -----------------------------------

  function widgetKunstnere() {
    const w = document.querySelector(SEL.widget);
    if (!w) { selektorSvigt.widget = true; return null; }
    selektorSvigt.widget = false;
    let led = [...w.querySelectorAll(SEL.widgetArtist)];
    if (!led.length) led = [...w.querySelectorAll('a[href^="/artist/"]')];
    return [...new Set(led.map((a) => artistId(a.getAttribute("href"))).filter(Boolean))];
  }

  // Widgetens "context-item-link" peger paa ALBUMMET, ikke paa sporet (maalt).
  // Der er altsaa intet spor-id i DOM'en. Titel + kunstner raekker fint: vi skal
  // kun kunne se NAAR nummeret skifter, ikke slaa noget op paa id'et.
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

  const spiller = () => {
    const b = document.querySelector('[data-testid="control-button-playpause"]');
    return !!b && /pause/i.test(b.getAttribute("aria-label") || "");
  };

  const gentagEt = () => {
    const b = document.querySelector(SEL.repeat);
    // "Disable repeat one" staar paa knappen NAAR gentag-et er slaaet til
    return !!b && /repeat one/i.test(b.getAttribute("aria-label") || "") &&
           /disable/i.test(b.getAttribute("aria-label") || "");
  };

  // --- skip ------------------------------------------------------------------

  const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));
  const sov = (ms) => new Promise((r) => setTimeout(r, ms));

  async function proevSkip(fraSpor) {
    const knap = document.querySelector(SEL.skip);
    if (!knap) return "no-button";
    // disabled daekker BAADE tom koe og opbrugt gratis-kvote - de kan ikke skelnes
    // fra DOM'en. Saa: goer ingenting. At pause en gratis-brugers musik er vaerre
    // end at lade ét nummer spille.
    if (knap.disabled) return "unavailable";
    if (gentagEt()) return "repeat-one";     // ellers lander skippet paa samme nummer = evig loekke

    for (let i = 0; i < SKIP_FORSOEG; i++) {
      knap.click();
      await sov(SKIP_PAUSE + i * 150);
      if (sporId() !== fraSpor) return "ok";
    }
    // samme id efter flere forsoeg: enten et nummer der staar to gange i traek,
    // eller en knap der ikke virker. Begge dele: giv op, loop ikke videre.
    return "unchanged";
  }

  async function vurderSpor() {
    if (iGang || !state || !state.enabled) return;
    // Vurder foerst naar der FAKTISK spiller noget. Ellers saetter vi sidsteSpor
    // paa et nummer der bare ligger klar, og saa sker der intet naar brugeren
    // trykker play - det var praecis fejlen paa artist-siden.
    if (!spiller()) return;
    const id = sporId();
    if (!id) return;
    if (id === sidsteSpor) return;
    sidsteSpor = id;

    if (erPodcast()) return;                  // podcasts/lydboeger har ingen kunstnere
    const ids = widgetKunstnere();
    // Popup'en laeser "hvem spiller lige nu" HERFRA. Alternativet var
    // chrome.scripting fra popup'en, og det koster to tilladelser vi ikke vil have.
    if (ids && ids.length) {
      const w = document.querySelector(SEL.widget);
      const navne = w ? [...w.querySelectorAll(SEL.widgetArtist)].map((a) => a.textContent.trim()) : [];
      chrome.storage.local.set({ nowPlaying: { ids, names: navne } });
    }
    if (!ids || !ids.length) return;          // lokale filer og reklamer: ingen id'er = lad vaere
    if (!flaget(ids)) { sammenhaengende = 0; return; }
    if (!state.skip) return;                  // brugeren har ikke taendt auto-skip

    if (sammenhaengende >= SKIP_LOFT) {
      // Boblen staar 6 sekunder - i en baggrundsfane ser man den aldrig. Derfor
      // ogsaa en tilstand popup'en kan vise: et standset filter maa ikke ligne
      // et oedelagt filter.
      chrome.storage.local.set({ skipStopped: { at: Date.now(), after: SKIP_LOFT } });
      vis("NoAI stopped skipping after " + SKIP_LOFT + " tracks in a row");
      return;
    }

    const lov = await send({ type: "maySkip" });
    if (!lov || !lov.ok) return;

    iGang = true;
    try {
      const r = await proevSkip(id);
      if (r === "ok") { sammenhaengende++; send({ type: "skipped", ms: 0 }); }
    } finally { iGang = false; }
  }

  let bobleTimer = 0;
  function vis(tekst) {
    let b = document.getElementById("noai-toast");
    if (!b) {
      b = document.createElement("div");
      b.id = "noai-toast";
      document.body.appendChild(b);
    }
    b.textContent = tekst;
    b.classList.add("noai-vis");
    clearTimeout(bobleTimer);
    bobleTimer = setTimeout(() => b.classList.remove("noai-vis"), 6000);
  }

  // --- lister ----------------------------------------------------------------
  // Raekker unmountes og genskabes ved scroll (maalt: 0 af 24 stemplede noder
  // overlevede en lang scroll), saa stempling er nytteloest. Vi vurderer forfra
  // paa hver aendring - derfor skal arbejdet pr. raekke vaere minimalt.

  function sideKunstner() {
    const m = /^\/artist\/([A-Za-z0-9]{22})/.exec(location.pathname);
    return m ? m[1] : null;   // artist-sidens raekker har INGEN kunstner-links
  }

  function rensRaekker() {
    const raekker = document.querySelectorAll(SEL.row);
    if (!raekker.length) return;
    selektorSvigt.rows = false;
    const sideId = sideKunstner();
    for (const r of raekker) {
      if (r.matches(SEL.placeholder)) continue;
      let ids = [...r.querySelectorAll('a[href^="/artist/"]')]
        .map((a) => artistId(a.getAttribute("href"))).filter(Boolean);
      if (!ids.length && sideId) ids = [sideId];
      const skalFlages = ids.length && flaget(ids);
      if (skalFlages === r.classList.contains("noai-flagged")) continue;   // ingen aendring
      r.classList.toggle("noai-flagged", skalFlages);
      r.classList.toggle("noai-hidden", skalFlages && state.hide);
      let mrk = r.querySelector(".noai-mark");
      if (skalFlages && !mrk) {
        mrk = document.createElement("span");
        mrk.className = "noai-mark";
        mrk.textContent = "flagged by community list";   // rigtig tekst, ikke kun farve
        r.appendChild(mrk);
      } else if (!skalFlages && mrk) { mrk.remove(); }
    }
  }

  let planlagt = false;
  const planlaeg = () => {
    if (planlagt) return;
    planlagt = true;
    const koer = () => { planlagt = false; rensRaekker(); vurderSpor(); };
    // requestAnimationFrame fyrer ALDRIG i en skjult fane - og en musikafspiller
    // ligger netop i baggrunden. Maalt paa Spotify: document.hidden = true,
    // rAF ikke fyret efter 1,2 s. Uden denne gren staar hele udvidelsen stille
    // praecis naar den bruges.
    if (document.hidden) setTimeout(koer, 250);
    else requestAnimationFrame(koer);
  };

  // --- opstart ---------------------------------------------------------------

  async function hentState() {
    const s = await send({ type: "state" });
    if (!s) return;
    state = {
      enabled: s.enabled, skip: s.skip, hide: s.hide,
      ids: new Set(s.ids), allow: new Set(s.allowlist || []),
    };
    planlaeg();
  }

  chrome.storage.onChanged.addListener((c, omraade) => {
    if (omraade === "local" && (c.enabled || c.skip || c.hide || c.allowlist || c.blocklist))
      hentState();
  });

  // Nulstil skip-loftet naar BRUGEREN selv roerer afspilleren. isTrusted er
  // afgoerende: vores eget knap-klik i proevSkip bobler op til samme lytter, og
  // uden filteret nulstiller hvert skip taelleren - saa ville loftet aldrig
  // kunne slaa til, og en AI-radiostation kunne skippe i det uendelige.
  const brugerRoerte = (e) => {
    if (!e.isTrusted) return;
    if (sammenhaengende) chrome.storage.local.remove("skipStopped");
    sammenhaengende = 0;
  };
  document.addEventListener("click", brugerRoerte, true);
  document.addEventListener("keydown", brugerRoerte, true);

  document.addEventListener("visibilitychange", planlaeg);

  const obs = new MutationObserver(planlaeg);
  const start = () => {
    const rod = document.querySelector("main") || document.body;
    obs.observe(rod, { childList: true, subtree: true });   // ingen attributes: 682 poster pr. 25 raekker
    hentState();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  // Puls. To grunde til at den skal vaere her og ikke kun en observer:
  //  - SPA-navigation skifter pathname uden genindlaesning
  //  - nu-spiller-bjaelken findes ikke altid endnu naar scriptet starter, saa
  //    observeren paa den kan gaa tabt. Sporskift maa ALDRIG kunne overses.
  let sidsteSti = location.pathname;
  let barObserveret = false;
  setInterval(() => {
    if (location.pathname !== sidsteSti) { sidsteSti = location.pathname; planlaeg(); }
    if (!barObserveret) {
      const bar = document.querySelector('[data-testid="now-playing-bar"]');
      if (bar) { obs.observe(bar, { childList: true, subtree: true, characterData: true }); barObserveret = true; }
    }
    vurderSpor();
  }, 900);
})();
