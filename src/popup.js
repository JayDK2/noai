// NoAI - popup.
const send = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));
const $ = (id) => document.getElementById(id);

let state = null;

const DAG = 86400000;

const DAGE = (iso) => {
  const t = Date.parse(iso || "");
  return t ? Math.floor((Date.now() - t) / DAG) : null;
};

function advarsel() {
  // Raekkefoelge efter alvor. En knaekket selektor er vaerst: saa virker filteret
  // ikke, og uden denne besked ville brugeren aldrig faa det at vide.
  // NB: pr. site. Med én faelles noegle slettede en sund YouTube-fane en levende
  // Spotify-fejlmelding, og vagten sagde stort set altid "alt vel".
  // En taendt kontakt uden adgang er en tavs inaktiv funktion. Sig det.
  if ((state.c2pa || state.rules) && !state.sideAdgang)
    return "Site access has been withdrawn, so " +
           (state.c2pa && state.rules ? "Content Credentials and site rules are"
            : state.c2pa ? "Content Credentials is" : "site rules are") +
           " not running. Switch the setting off and on again to restore it.";
  if (state.killSwitch && state.killSwitch.active)
    return "Filtering is paused remotely because the list source has a problem" +
           (state.killSwitch.reason ? ": " + state.killSwitch.reason : "") +
           ". It resumes automatically when the problem is fixed.";
  const st = state.selectorTrouble || {};
  const dele = [];
  if (st.spotify) dele.push("Spotify (" + st.spotify.broken.join(", ") + ")");
  if (st.youtube) dele.push("YouTube (" + st.youtube.broken.join(", ") + ")");
  // Regel-siderne melder under "rules:<vaert>" - én noegle pr. vaert.
  for (const [k, v] of Object.entries(st))
    if (k.startsWith("rules:") && v && Array.isArray(v.broken))
      dele.push(k.slice(6) + " (" + v.broken.join(", ") + ")");
  if (dele.length)
    return "The page layout has changed on " + dele.join(" and ") +
           ". Filtering may be incomplete. Please report this.";
  if (state.skipStopped)
    return "Stopped after " + state.skipStopped.after +
           " skips in a row. Use the player once to resume.";
  // En roed alarm i seks timer for ét forbigaaende netvaerksudfald er stoej, og
  // stoej laerer folk at ignorere vagten. Sig hvad der faktisk gaelder: mislykkedes
  // forsoeget, men er listen frisk, er intet galt endnu.
  if (state.lastError) {
    const d = DAGE(state.listMeta.generated_at);
    if (d !== null && d <= 2)
      return "Last update attempt failed (" + state.lastError.msg +
             "). The list is from " + state.listMeta.generated_at.slice(0, 10) +
             " and is still current; it will try again shortly.";
    return "List update failed (" + state.lastError.msg + "). Still using the last good copy" +
           (d !== null ? ", now " + d + " days old" : "") + ".";
  }
  if (state.ytError)
    return "YouTube list update failed (" + state.ytError.msg + "). Still using the last good copy.";
  // Regelfilen var den ene fejlkilde popup en ikke viste.
  if (state.rulesAvailable && state.rulesError)
    return "Site rules update failed (" + state.rulesError.msg + "). Still using the last good copy.";
  // Alle lister der hentes af en planlagt robot overvaages. GitHub slukker
  // planlagte robotter efter 60 dages stilhed, og saa er en gammel dato det
  // eneste synlige tegn. Regelfilen er kun med naar motoren er aktiv.
  const lister = [["Spotify", state.listMeta], ["YouTube", state.ytMeta || {}]];
  if (state.rulesAvailable && state.rulesMeta) lister.push(["site rules", state.rulesMeta]);
  for (const [navn, meta] of lister) {
    const d = DAGE(meta.generated_at);
    if (d !== null && d > 14)
      return "The " + navn + " list has not been updated in " + d +
             " days. It may have stopped refreshing.";
  }
  return null;
}

function tegn() {
  $("enabled").checked = state.enabled;
  $("c2pa").checked = !!state.c2pa;
  // Kontakten vises kun naar motoren faktisk har laaste vaerter at arbejde paa.
  const regelRaekke = $("rules").closest(".sw-row");
  if (regelRaekke) regelRaekke.hidden = !state.rulesAvailable;
  $("rules").checked = !!state.rules;
  $("skip").checked = state.skip;
  $("hide").checked = state.hide;
  $("s-skipped").textContent = (state.stats && state.stats.skipped) || 0;
  const ialt = state.listMeta.count + ((state.ytMeta && state.ytMeta.count) || 0);
  $("s-count").textContent = ialt.toLocaleString("en-US");

  // Datoen paa DATAEN, ikke paa hentningen. Viser vi "i dag" fordi hentningen
  // lykkedes mod en frossen fil, lyver vi om hvor frisk listen er.
  // Den lokale taelling. Tallet folk tager et skaermbillede af - og det staerkeste
  // argument for at udvidelsen findes, regnet ud paa brugerens egen maskine.
  const sp = state.sidsteSide;
  $("m-page").textContent = sp && sp.total
    ? sp.flagged + " of " + sp.total + " (" + Math.round(100 * sp.flagged / sp.total) + "%)"
    : "—";
  let f = 0, t = 0;
  for (const dag of Object.values(state.tally || {}))
    for (const v of Object.values(dag)) { f += v.flagged || 0; t += v.total || 0; }
  $("m-30").textContent = t ? f.toLocaleString("en-US") + " of " + t.toLocaleString("en-US") +
    " (" + Math.round(100 * f / t) + "%)" : "—";

  tegnWatch();

  const d = state.listMeta.generated_at;
  $("m-date").textContent = d ? new Date(d).toISOString().slice(0, 10) : "unknown";
  $("m-source").textContent = (state.ytMeta && state.ytMeta.count)
    ? "CennoxX + AiSList" : (state.listMeta.source || "bundled");

  const w = $("warn");
  const tekst = advarsel();
  w.hidden = !tekst;
  w.textContent = tekst || "";

  const ul = $("allow");
  ul.textContent = "";
  const liste = state.allowlist || [];
  $("allow-empty").hidden = liste.length > 0;
  for (const id of liste) {
    const li = document.createElement("li");
    const c = document.createElement("code");
    c.textContent = (state.allowNames && state.allowNames[id]) || id;
    const b = document.createElement("button");
    b.textContent = "Remove";
    b.onclick = async () => {
      await send({ type: "setOption", key: "allowlist", value: liste.filter((x) => x !== id) });
      indlaes();
    };
    li.append(c, b);
    ul.append(li);
  }
}

async function indlaes() { state = await send({ type: "state" }); tegn(); }

// Billed-scanning kraever adgang til alle websites, og den beder vi foerst om her
// - ikke ved installation. Siger brugeren nej i browserens dialog, ruller kontakten
// tilbage i stedet for at staa taendt uden at kunne noget.
// Begge funktioner deler den samme valgfrie adgang til alle websites. Den bedes
// der foerst om her - aldrig ved installation.
async function bedOmAdgang(e, noegle) {
  if (e.target.checked) {
    let fik;
    try { fik = await chrome.permissions.request({ origins: ["<all_urls>"] }); }
    catch (err) { fik = false; }
    if (!fik) { e.target.checked = false; return; }
  }
  await send({ type: "setOption", key: noegle, value: e.target.checked });
  // Adgangen traekkes kun tilbage naar BEGGE er slukket - ellers ville den ene
  // kontakt slaa den anden ihjel.
  if (!e.target.checked) {
    const s = await send({ type: "state" });
    if (s && !s.c2pa && !s.rules) { try { await chrome.permissions.remove({ origins: ["<all_urls>"] }); } catch (err) {} }
  }
  indlaes();
}

$("rules").addEventListener("change", (e) => bedOmAdgang(e, "rules"));

$("c2pa").addEventListener("change", (e) => bedOmAdgang(e, "c2pa"));

for (const k of ["enabled", "skip", "hide"]) {
  $(k).addEventListener("change", async (e) => {
    await send({ type: "setOption", key: k, value: e.target.checked });
    indlaes();
  });
}

// "Add current" laeser kunstneren fra storage (skrevet af indholds-scriptet).
// Tilladelses-listen spaerrer BEGGE veje - graatoning OG skip - ellers er loeftet brudt.
$("add").addEventListener("click", async () => {
  const { nowPlaying } = await chrome.storage.local.get("nowPlaying");
  const ids = (nowPlaying && nowPlaying.ids) || [];
  if (!ids.length) return;
  const navne = { ...(state.allowNames || {}) };
  ids.forEach((id, i) => { navne[id] = ((nowPlaying.names || [])[i] || id); });
  const nu = new Set(state.allowlist || []);
  ids.forEach((i) => nu.add(i));
  await send({ type: "setOption", key: "allowlist", value: [...nu] });
  await send({ type: "setOption", key: "allowNames", value: navne });
  indlaes();
});

indlaes();

// "Report a mistake" var et link til en TOM formular. En bruger kan ikke vide
// hvilket 22-tegns-id eller hvilket @haandtag der skal naevnes, og en YouTube-kanal
// kunne slet ikke indberettes. Vi udfylder den med det brugeren sidst saa flaget.
async function opdaterRapportLink() {
  const a = document.querySelector('a[href*="/issues"]');
  if (!a) return;
  const { senestFlaget: f } = await chrome.storage.local.get("senestFlaget");
  const base = "https://github.com/JayDK2/noai/issues/new";
  if (!f || !f.id) { a.href = base + "?title=" + encodeURIComponent("Wrongly flagged"); return; }
  const erYt = f.kilde === "youtube";
  const hvem = erYt ? f.id : (f.navn ? f.navn + " (" + f.id + ")" : f.id);
  const krop = [
    "**What is wrongly flagged**",
    "",
    erYt ? "YouTube channel: " + f.id : "Spotify artist: " + hvem,
    erYt ? "Currently on the " + (f.niveau === "warn" ? "warn" : "block") + " list." : "",
    "",
    "**Why it is wrong**",
    "",
    "<!-- A sentence is enough. No proof is required. -->",
    "",
    "---",
    "If you are the artist or channel owner, you can also write to noAI@h1tmakers.com.",
    "We remove on request, without conditions, and it reaches every installation",
    "within six hours. YouTube channels can also ask to be moved from the block list",
    "to the warn list instead of removed entirely.",
  ].join("\n");
  a.href = base + "?title=" + encodeURIComponent("Wrongly flagged: " + hvem) +
           "&body=" + encodeURIComponent(krop);
  // Kort etiket: den lange udgave braekkede bundlinjen over to linjer. Hvad der
  // indberettes staar i selve sagen, ikke paa knappen.
  a.textContent = "Report a mistake";
  a.title = "Pre-filled with " + hvem;
}

opdaterRapportLink();

// --- opslag ----------------------------------------------------------------
// "Staar jeg paa en liste?" Der findes ikke noget sted i verden hvor man kan slaa
// det op i dag. Alt sker lokalt - begge lister ligger allerede paa maskinen.

function tegnWatch() {
  const ul = $("watch");
  ul.textContent = "";
  const liste = state.watchlist || [];
  $("watch-empty").hidden = liste.length > 0;
  for (const w of liste) {
    const li = document.createElement("li");
    const c = document.createElement("code");
    c.textContent = w.label || w.id;
    const b = document.createElement("button");
    b.textContent = "Stop";
    b.onclick = async () => {
      await send({ type: "setOption", key: "watchlist",
                   value: liste.filter((x) => !(x.kind === w.kind && x.id === w.id)) });
      indlaes();
    };
    li.append(c, b);
    ul.append(li);
  }
}

async function slaaOp() {
  const ud = $("q-out");
  const svar = await send({ type: "lookup", query: $("q").value });
  ud.hidden = false;
  ud.textContent = "";
  if (!svar || !svar.ok) {
    ud.textContent = "Not recognised. Paste a Spotify artist link, an ID, or a @handle.";
    return;
  }
  const hvor = svar.kind === "youtube" ? "YouTube" : "Spotify";
  const tekst = svar.tier === "none"
    ? "Not on the " + hvor + " list."
    : svar.tier === "warn"
      ? "On the " + hvor + " warn list — marked only, never dimmed."
      : "On the " + hvor + " block list — dimmed by default.";
  const linje = document.createElement("div");
  linje.className = svar.tier === "none" ? "none" : svar.tier;
  linje.textContent = tekst;
  const kilde = document.createElement("div");
  kilde.style.color = "#8d8c8a";
  kilde.style.marginTop = "3px";
  kilde.textContent = svar.source + (svar.generated_at ? " · " + svar.generated_at.slice(0, 10) : "");
  ud.append(linje, kilde);

  if (svar.tier !== "none") {
    const meld = document.createElement("div");
    meld.style.color = "#8d8c8a";
    meld.style.marginTop = "5px";
    meld.textContent = "If this is wrong, write to noAI@h1tmakers.com — we remove on request, within six hours.";
    ud.append(meld);
  }

  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "Watch this";
  b.onclick = async () => {
    // notifications er en VALGFRI tilladelse og bedes om HER - foerste gang
    // noget saettes paa overvaagning - ikke ved installation. Uden den har en
    // overvaagning ingen udvej, saa et nej betyder ingen overvaagning, sagt hoejt.
    let lov;
    try { lov = await chrome.permissions.request({ permissions: ["notifications"] }); }
    catch (err) { lov = false; }
    if (!lov) {
      b.textContent = "Allow notifications to watch";
      b.title = "Watching only works by notifying you when the list changes.";
      return;
    }
    const liste = (state.watchlist || []).filter((x) => !(x.kind === svar.kind && x.id === svar.id));
    liste.push({ kind: svar.kind, id: svar.id, label: svar.id });
    await send({ type: "setOption", key: "watchlist", value: liste });
    indlaes();
    b.textContent = "Watching";
    b.disabled = true;
  };
  ud.append(b);
}

$("q-go").addEventListener("click", slaaOp);
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") slaaOp(); });
