// NoAI - generisk regel-motor.
//
// Selektorerne til nye platforme kommer fra en datafil vi selv ejer og henter hver
// 6. time, i stedet for at vaere kode. En ny platform bliver saaledes en JSON-linje
// der er live paa seks timer - og en KNAEKKET selektor kan rettes paa seks timer i
// stedet for de uger en butiksopdatering tager. Det er samme leverance-vej som
// noed-kontakten allerede bruger.
//
// GRAENSEN, og den er absolut: selektorer er DATA. Intet i en regel udfoeres
// nogensinde som kode - ingen udtryk, ingen funktioner, intet eval. Handlingerne
// er et lukket ordforraad paa to ting: saet en klasse, og saet en tekst. Alt andet
// ville vaere fjernhostet kode, og det er doedsdoemt ved anmeldelse - med rette.
//
// Og teksten er OGSAA lukket: reglen baerer en noegle, og ordene bor her i den
// anmeldte build. En kapret spejl-fil kunne ellers skrive hvad som helst paa
// enhver understoettet side - og "Verified human-made" er den farlige retning.

(() => {
  "use strict";

  const MAX_REGLER = 40;
  const MAX_KORT = 400;          // maerknings-loft pr. regel pr. gennemloeb
  const MAX_KORT_IALT = 1500;    // loft for hvor mange noder ÉT gennemloeb maa roere i alt
  const PULS_MS = 1500;

  // Det lukkede ordforraad. Noeglen i reglen -> teksten paa siden. Nye etiketter
  // er en kodeaendring med anmeldelse, og det er meningen.
  //
  // Lagt an til _locales: samme noegle, oversat tekst. chrome.i18n.getMessage
  // slaas op foerst (den svarer tomt uden _locales), og tabellen her er
  // engelsk reserve. Noeglerne SKAL matche REGEL_ETIKETTER i background.js -
  // check.mjs haandhaever det.
  const TEKSTER = {
    "platform-ai":       "labelled AI by the platform",
    "platform-possible": "possibly AI — platform label",
    "reported-ai":       "reported as AI",
    "possibly-ai":       "possibly AI",
  };
  function tekst(noegle) {
    try {
      const t = chrome.i18n.getMessage("rule_" + noegle.replace(/-/g, "_"));
      if (t) return t;
    } catch (e) { /* ingen _locales endnu */ }
    return TEKSTER[noegle];
  }

  let regler = null;
  let doed = false;
  let puls = 0;
  let obs = null;
  let meldt = null;                  // sidst meldte liste af brudte regler, som streng
  const kasserede = new Map();       // regel-id -> grund, regler vi har opgivet paa denne side

  const erDoed = (m) => /context invalidated|Extension context/i.test(m || "");
  const send = (msg) => new Promise((svar) => {
    if (doed) return svar(null);
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        const f = chrome.runtime.lastError;
        if (f) { if (erDoed(f.message)) luk(); return svar(null); }
        svar(r);
      });
    } catch (e) { if (erDoed(e && e.message)) luk(); svar(null); }
  });

  // Universelle og naesten universelle beholder-selektorer afvises FOER de
  // koeres. querySelectorAll koerer til ende foer noget loft kan gribe ind, og
  // med "*" som beholder er det hele DOM'en - ved hver mutation og hvert 1,5 s.
  // MAX_KORT alene beskyttede kun maerkningen, ikke opslaget.
  //   afvist: "*" som sidste led, et sidste led der kun er en pseudoklasse
  //   (":not(.ad)"), og noegne tagnavne der findes i tusindvis paa enhver side.
  const BREDE_TAGS = new Set(["html", "body", "div", "span", "a", "p", "li", "ul", "ol",
    "img", "section", "article", "main", "header", "footer", "nav", "aside", "button",
    "td", "tr", "th", "table", "tbody", "svg", "path", "i", "b", "em", "strong", "label",
    "input", "figure", "picture", "video", "source", "h1", "h2", "h3", "h4", "h5", "h6"]);
  function forBred(sel) {
    for (const del of sel.split(",")) {
      const led = del.trim().split(/[\s>+~]+/).filter(Boolean);
      const sidste = led[led.length - 1] || "";
      if (!sidste || sidste[0] === ":") return true;
      if (sidste[0] === "*" && sidste[1] !== "=") return true;
      if (/^[a-zA-Z][\w-]*$/.test(sidste) && BREDE_TAGS.has(sidste.toLowerCase())) return true;
    }
    return false;
  }

  // En regel skal se praecis saadan ud. Alt andet ignoreres - en fremtidig
  // regelfil maa aldrig kunne faa en gammel klient til at goere noget uventet.
  function gyldig(r) {
    return r && typeof r.id === "string"
      && typeof r.container === "string" && r.container.length < 200 && !forBred(r.container)
      && typeof r.signal === "string" && r.signal.length < 200
      && (r.tier === "block" || r.tier === "warn")
      && typeof r.label === "string" && Object.prototype.hasOwnProperty.call(TEKSTER, r.label);
  }

  // En regel der fejler, fejler ikke igen om 1,5 s: den kasseres for denne side
  // og meldes. Foerste udgave broed ud af kort-loekken og lod reglen staa, saa en
  // ugyldig signal-selektor kastede for evigt - én gang pr. kort pr. gennemloeb.
  function kasser(r, grund) {
    kasserede.set(r.id, grund);
    regler = regler.filter((x) => x !== r);
  }

  // Taelling som paa de to andre sider: distinkte noder pr. sti, aldrig en sum
  // over gennemloeb. Noden selv er identiteten - reglerne er generiske og kender
  // ikke sidens eget id-format.
  let sidsteSti = "";
  let sete = new WeakSet();
  let sideTotal = 0, sideFlagede = 0;
  let ventende = { flagged: 0, total: 0 };
  let taelTimer = 0;

  function taelOp(poster) {
    if (location.pathname !== sidsteSti) {
      sidsteSti = location.pathname;
      sete = new WeakSet(); sideTotal = 0; sideFlagede = 0;
    }
    let nyF = 0, nyT = 0;
    for (const { kort, flaget } of poster) {
      if (sete.has(kort)) continue;
      sete.add(kort); nyT++; sideTotal++;
      if (flaget) { nyF++; sideFlagede++; }
    }
    if (!nyT && !nyF) return;
    ventende.flagged += nyF; ventende.total += nyT;
    clearTimeout(taelTimer);
    taelTimer = setTimeout(() => {
      const v = ventende;
      ventende = { flagged: 0, total: 0 };
      send({ type: "tally", site: "rules:" + location.hostname, flagged: v.flagged, total: v.total,
             pageFlagged: sideFlagede, pageTotal: sideTotal });
    }, 1500);
  }

  function anvend() {
    if (doed || !regler) return;
    let kortIalt = 0;
    const talte = [];
    for (const r of [...regler]) {
      let kort;
      try { kort = document.querySelectorAll(r.container); }
      catch (e) { kasser(r, "container"); continue; }        // ugyldig selektor
      kortIalt += kort.length;
      // Ser smal ud, rammer alt: en beholder der matcher over loftet er ikke en
      // kortliste men en bred selektor - og den koster hele DOM'en pr. gennemloeb.
      if (kort.length > MAX_KORT_IALT) { kasser(r, "too-broad"); continue; }
      let n = 0;
      let signalDoed = false;
      for (const k of kort) {
        if (n++ >= MAX_KORT) break;
        let traf;
        try { traf = !!k.querySelector(r.signal); }
        catch (e) { signalDoed = true; break; }
        const oensket = traf ? r.tier : "";
        talte.push({ kort: k, flaget: traf });
        if (k.getAttribute("data-noai-rule") === oensket) continue;
        k.setAttribute("data-noai-rule", oensket);
        k.classList.toggle("noai-rule-block", traf && r.tier === "block");
        k.classList.toggle("noai-rule-warn", traf && r.tier === "warn");
        const gammel = k.querySelector(".noai-rule-mark");
        if (traf && !gammel) {
          const m = document.createElement("span");
          m.className = "noai-rule-mark";
          m.textContent = tekst(r.label);        // vores egen tekst, aldrig filens
          k.appendChild(m);
        } else if (!traf && gammel) { gammel.remove(); }
      }
      if (signalDoed) kasser(r, "signal");
      if (kortIalt > MAX_KORT_IALT) break;      // gennemloebets budget er brugt
    }
    taelOp(talte);
    // Selvtest. Meldes: regler vi har maattet kassere, og - findes der regler for
    // siden men ingen af deres beholdere - alle regler: saa har platformen aendret
    // sig, og det skal siges hoejt frem for at filtrere ingenting.
    const brudte = [...kasserede.keys()];
    if (regler.length && kortIalt === 0) brudte.push(...regler.map((r) => r.id));
    const n = brudte.join(",");
    if (n !== meldt) {
      meldt = n;
      send({ type: "selectors", site: "rules:" + location.hostname, broken: brudte });
    }
  }

  // Fjern alle vores spor. Slukkes motoren (kontakt, noed-kontakt, tom regelfil),
  // maa maerkerne ikke blive staaende som om intet var sket.
  function ryd() {
    for (const k of document.querySelectorAll("[data-noai-rule]")) {
      k.removeAttribute("data-noai-rule");
      k.classList.remove("noai-rule-block", "noai-rule-warn");
      const m = k.querySelector(".noai-rule-mark");
      if (m) m.remove();
    }
  }

  let planlagt = false;
  function planlaeg() {
    if (doed || planlagt) return;
    planlagt = true;
    const koer = () => { planlagt = false; anvend(); };
    if (document.hidden) setTimeout(koer, 400); else requestAnimationFrame(koer);
  }

  // Én observer og én puls ad gangen. Foerste udgave lavede en ny observer ved
  // hvert start() og koblede aldrig den gamle fra - og start() kaldes igen ved
  // hver indstillingsaendring.
  function stop() {
    if (obs) { obs.disconnect(); obs = null; }
    if (puls) { clearInterval(puls); puls = 0; }
    regler = null;
  }
  function luk() { doed = true; stop(); }

  let startNr = 0;
  async function start() {
    stop();
    const mit = ++startNr;
    const s = await send({ type: "rules", host: location.hostname });
    if (doed || mit !== startNr) return;       // et nyere start() har overhalet os
    if (!s || !Array.isArray(s.rules)) return;
    regler = s.rules.filter(gyldig).slice(0, MAX_REGLER);
    kasserede.clear();
    meldt = null;
    if (!regler.length) { ryd(); return; }
    obs = new MutationObserver(planlaeg);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    planlaeg();
    puls = setInterval(() => { if (!doed) anvend(); }, PULS_MS);
  }

  chrome.storage.onChanged.addListener((c, o) => {
    if (doed || o !== "local") return;
    // rulesData SKAL med: det er dén noegle en rettet selektor kommer ind ad.
    // Uden den naaede en rettelse aldrig en aaben fane, og hele pointen med
    // motoren - reparation paa seks timer - gjaldt kun nye faner.
    if (c.rules || c.rulesData || c.enabled || c.killSwitch) start();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
