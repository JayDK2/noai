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

(() => {
  "use strict";

  const MAX_REGLER = 40;
  const MAX_KORT = 400;          // loft pr. gennemloeb, saa en daarlig regel ikke fryser siden
  const PULS_MS = 1500;

  let regler = null;
  let doed = false;
  let puls = 0;
  let meldt = null;

  const erDoed = (m) => /context invalidated|Extension context/i.test(m || "");
  const send = (msg) => new Promise((svar) => {
    if (doed) return svar(null);
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        const f = chrome.runtime.lastError;
        if (f) { if (erDoed(f.message)) doed = true; return svar(null); }
        svar(r);
      });
    } catch (e) { if (erDoed(e && e.message)) doed = true; svar(null); }
  });

  // En regel skal se praecis saadan ud. Alt andet ignoreres - en fremtidig
  // regelfil maa aldrig kunne faa en gammel klient til at goere noget uventet.
  function gyldig(r) {
    return r && typeof r.id === "string"
      && typeof r.container === "string" && r.container.length < 200
      && typeof r.signal === "string" && r.signal.length < 200
      && (r.tier === "block" || r.tier === "warn")
      && typeof r.label === "string" && r.label.length < 80;
  }

  function anvend() {
    if (doed || !regler || !regler.length) return;
    let ramte = 0, kortIalt = 0;
    for (const r of regler) {
      let kort;
      try { kort = document.querySelectorAll(r.container); }
      catch (e) { continue; }                    // ugyldig selektor: spring reglen over
      kortIalt += kort.length;
      let n = 0;
      for (const k of kort) {
        if (n++ > MAX_KORT) break;
        let traf;
        try { traf = !!k.querySelector(r.signal); }
        catch (e) { break; }
        const oensket = traf ? r.tier : "";
        if (k.getAttribute("data-noai-rule") === oensket) { if (traf) ramte++; continue; }
        k.setAttribute("data-noai-rule", oensket);
        k.classList.toggle("noai-rule-block", traf && r.tier === "block");
        k.classList.toggle("noai-rule-warn", traf && r.tier === "warn");
        const gammel = k.querySelector(".noai-rule-mark");
        if (traf && !gammel) {
          const m = document.createElement("span");
          m.className = "noai-rule-mark";
          m.textContent = r.label;               // ren tekst, aldrig markup
          k.appendChild(m);
          ramte++;
        } else if (!traf && gammel) { gammel.remove(); }
        else if (traf) ramte++;
      }
    }
    // Selvtest: findes der regler for siden, men ingen af deres beholdere findes,
    // har platformen aendret sig. Sig det hoejt frem for at filtrere ingenting.
    const brudt = regler.length > 0 && kortIalt === 0;
    if (brudt !== meldt) {
      meldt = brudt;
      send({ type: "selectors", site: "rules:" + location.hostname,
             broken: brudt ? regler.map((r) => r.id) : [] });
    }
  }

  let planlagt = false;
  function planlaeg() {
    if (doed || planlagt) return;
    planlagt = true;
    const koer = () => { planlagt = false; anvend(); };
    if (document.hidden) setTimeout(koer, 400); else requestAnimationFrame(koer);
  }

  async function start() {
    const s = await send({ type: "rules", host: location.hostname });
    if (!s || !Array.isArray(s.rules)) return;
    regler = s.rules.filter(gyldig).slice(0, MAX_REGLER);
    if (!regler.length) return;
    new MutationObserver(planlaeg).observe(document.documentElement,
      { childList: true, subtree: true });
    planlaeg();
    puls = setInterval(() => { if (!doed) anvend(); }, PULS_MS);
  }

  chrome.storage.onChanged.addListener((c, o) => {
    if (o === "local" && (c.rules || c.enabled || c.killSwitch) && !doed) {
      if (puls) clearInterval(puls);
      regler = null;
      start();
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
