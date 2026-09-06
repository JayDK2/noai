// NoAI - popup.
const send = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));
const $ = (id) => document.getElementById(id);

let state = null;

function tegn() {
  $("enabled").checked = state.enabled;
  $("skip").checked = state.skip;
  $("hide").checked = state.hide;
  $("s-skipped").textContent = (state.stats && state.stats.skipped) || 0;
  $("s-count").textContent = state.listMeta.count.toLocaleString("en-US");

  // Datoen paa DATAEN, ikke paa hentningen. Viser vi "i dag" fordi hentningen
  // lykkedes mod en frossen fil, lyver vi om hvor frisk listen er.
  const d = state.listMeta.generated_at;
  $("m-date").textContent = d ? new Date(d).toISOString().slice(0, 10) : "unknown";
  $("m-source").textContent = state.listMeta.source || "bundled";

  const w = $("warn");
  if (state.skipStopped) {
    w.hidden = false;
    w.textContent = "Stopped after " + state.skipStopped.after +
      " skips in a row. Use the player once to resume.";
  } else if (state.lastError) {
    w.hidden = false;
    w.textContent = "List update failed (" + state.lastError.msg +
      "). Still using the last good copy.";
  } else { w.hidden = true; }

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
