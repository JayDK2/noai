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
  const st = state.selectorTrouble;
  if (st && (st.spotify || st.youtube)) {
    const dele = [];
    if (st.spotify) dele.push("Spotify (" + st.spotify.broken.join(", ") + ")");
    if (st.youtube) dele.push("YouTube (" + st.youtube.broken.join(", ") + ")");
    return "The page layout has changed on " + dele.join(" and ") +
           ". Filtering may be incomplete. Please report this.";
  }
  if (state.skipStopped)
    return "Stopped after " + state.skipStopped.after +
           " skips in a row. Use the player once to resume.";
  if (state.lastError)
    return "List update failed (" + state.lastError.msg + "). Still using the last good copy.";
  if (state.ytError)
    return "YouTube list update failed (" + state.ytError.msg + "). Still using the last good copy.";
  // Begge lister overvaages. GitHub slukker planlagte robotter efter 60 dages
  // stilhed, og saa er en gammel dato det eneste synlige tegn.
  for (const [navn, meta] of [["Spotify", state.listMeta], ["YouTube", state.ytMeta || {}]]) {
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
  $("skip").checked = state.skip;
  $("hide").checked = state.hide;
  $("s-skipped").textContent = (state.stats && state.stats.skipped) || 0;
  const ialt = state.listMeta.count + ((state.ytMeta && state.ytMeta.count) || 0);
  $("s-count").textContent = ialt.toLocaleString("en-US");

  // Datoen paa DATAEN, ikke paa hentningen. Viser vi "i dag" fordi hentningen
  // lykkedes mod en frossen fil, lyver vi om hvor frisk listen er.
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
$("c2pa").addEventListener("change", async (e) => {
  if (e.target.checked) {
    let fik = false;
    try { fik = await chrome.permissions.request({ origins: ["<all_urls>"] }); }
    catch (err) { fik = false; }
    if (!fik) { e.target.checked = false; return; }
  } else {
    try { await chrome.permissions.remove({ origins: ["<all_urls>"] }); } catch (err) {}
  }
  await send({ type: "setOption", key: "c2pa", value: e.target.checked });
  indlaes();
});

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
