// NoAI - C2PA-laeser.
//
// Erstatter byte-soegningen efter "trainedAlgorithmicMedia". Den var god nok til
// at svare ja/nej, men den kan ikke skelne manifestets EGEN paastand fra en
// ingrediens: et fotografi hvor én AI-genereret ting er sat ind baerer markoeren
// i en ingrediens, mens billedets eget krav siger "kamera". Byte-soegningen
// kalder det AI. Det er den ene situation hvor vores ordlyd bliver forkert og
// ikke bare upraecis.
//
// Vi validerer stadig IKKE signaturen. Det kraever en certifikatkaede og hoerer
// til naeste skridt - se README. Ordlyden lover derfor stadig kun "declared".

(() => {
  "use strict";

  const AI_HELT = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
  const AI_KOMPOSIT = "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia";
  const KAMERA = "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture";

  // --- CBOR ---------------------------------------------------------------
  // Kun det manifestet faktisk bruger. En fuld CBOR-implementation er unoedvendig
  // og ville vaere mere kode at tage fejl i.

  function cbor(b, s = { i: 0 }) {
    const byte = b[s.i++];
    const major = byte >> 5, ekstra = byte & 31;
    const laes = (n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + b[s.i++]; return v; };
    let laengde;
    if (ekstra < 24) laengde = ekstra;
    else if (ekstra === 24) laengde = b[s.i++];
    else if (ekstra === 25) laengde = laes(2);
    else if (ekstra === 26) laengde = laes(4);
    else if (ekstra === 27) laengde = laes(8);
    else if (ekstra === 31) laengde = -1;          // ubestemt laengde
    else laengde = 0;

    switch (major) {
      case 0: return laengde;
      case 1: return -1 - laengde;
      case 2: {                                     // byte-streng
        if (laengde < 0) { const d = []; while (b[s.i] !== 0xff) d.push(cbor(b, s)); s.i++; return d; }
        const v = b.subarray(s.i, s.i + laengde); s.i += laengde; return v;
      }
      case 3: {                                     // tekst
        if (laengde < 0) { let t = ""; while (b[s.i] !== 0xff) t += cbor(b, s); s.i++; return t; }
        const v = new TextDecoder("utf-8").decode(b.subarray(s.i, s.i + laengde));
        s.i += laengde; return v;
      }
      case 4: {                                     // array
        const ud = [];
        if (laengde < 0) { while (b[s.i] !== 0xff) ud.push(cbor(b, s)); s.i++; return ud; }
        for (let k = 0; k < laengde; k++) ud.push(cbor(b, s));
        return ud;
      }
      case 5: {                                     // map
        const ud = {};
        if (laengde < 0) { while (b[s.i] !== 0xff) { const n = cbor(b, s); ud[n] = cbor(b, s); } s.i++; return ud; }
        for (let k = 0; k < laengde; k++) { const n = cbor(b, s); ud[n] = cbor(b, s); }
        return ud;
      }
      case 6: return cbor(b, s);                    // tag - indholdet er det interessante
      case 7:
        if (ekstra === 20) return false;
        if (ekstra === 21) return true;
        if (ekstra === 22) return null;
        if (ekstra === 23) return undefined;
        return null;
      default: return null;
    }
  }

  // --- JUMBF-bokse --------------------------------------------------------
  // [4 byte laengde][4 byte type][indhold]. En 'jumb' er en superboks der
  // indeholder en 'jumd'-beskrivelse plus indhold.

  const type = (b, o) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
  const u32 = (b, o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;

  function bokse(b, start, slut, dybde = 0) {
    const ud = [];
    let o = start;
    while (o + 8 <= slut && dybde < 12) {
      let laengde = u32(b, o);
      const t = type(b, o);
      let hoved = 8;
      if (laengde === 1) { hoved = 16; laengde = Number(new DataView(b.buffer, b.byteOffset + o + 8, 8).getBigUint64(0)); }
      else if (laengde === 0) laengde = slut - o;
      if (laengde < hoved || o + laengde > slut) break;
      const boks = { type: t, start: o + hoved, slut: o + laengde };
      if (t === "jumb") boks.boern = bokse(b, boks.start, boks.slut, dybde + 1);
      ud.push(boks);
      o += laengde;
    }
    return ud;
  }

  // jumd-boksens indhold er: 16 byte type-UUID, 1 byte flag, derefter etiketten
  // som nul-termineret tekst - og EFTER den kan der staa mere (signaturhash m.m.).
  // Foerste udgave laeste den sidste nul-terminerede streng i boksen og fik derfor
  // fat i halen i stedet for navnet, saa intet manifest kunne genkendes.
  function etiket(jumb, b) {
    const jumd = (jumb.boern || []).find((x) => x.type === "jumd");
    if (!jumd) return null;
    const del = b.subarray(jumd.start, jumd.slut);
    if (del.length < 18) return null;
    let i = 17;
    while (i < del.length && del[i] !== 0) i++;
    const s = new TextDecoder("utf-8").decode(del.subarray(17, i));
    return /^[\x20-\x7e]+$/.test(s) && s.length ? s : null;
  }

  // --- find manifest-lageret i filen --------------------------------------
  // JPEG gemmer det i APP11-segmenter der SKAL saettes sammen i raekkefoelge;
  // et stort manifest er delt over mange. Andre formater har det som en boks.

  function findStore(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xff && b[1] === 0xd8) {
      const dele = [];
      let o = 2;
      while (o + 4 < b.length) {
        if (b[o] !== 0xff) { o++; continue; }
        const m = b[o + 1];
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
        if (m === 0xda) break;                       // billeddata begynder
        const len = (b[o + 2] << 8) | b[o + 3];
        if (len < 2) break;
        if (m === 0xeb) {                            // APP11
          const p = o + 4;
          // 'JP' + 2 byte boks-instans + 4 byte pakke-sekvens, derefter JUMBF.
          // FAELDE: hvert segment gentager boksens LBox+TBox (8 byte), fordi de
          // beskriver HELE boksen, ikke stumpen. Limer man dem sammen som de er,
          // bliver alt efter foerste segment forskudt - og saa forsvinder det
          // aktive manifest, mens ingredienserne ser fine ud. Kun det foerste
          // segment maa beholde de otte byte.
          if (b[p] === 0x4a && b[p + 1] === 0x50) {
            const seq = u32(b, p + 4);
            const nyttelast = seq === 1 ? p + 8 : p + 16;
            dele.push({ seq, data: b.subarray(nyttelast, o + 2 + len) });
          }
        }
        o += 2 + len;
      }
      if (!dele.length) return null;
      dele.sort((x, y) => x.seq - y.seq);
      const ialt = dele.reduce((n, d) => n + d.data.length, 0);
      const ud = new Uint8Array(ialt);
      let k = 0;
      for (const d of dele) { ud.set(d.data, k); k += d.data.length; }
      return ud;
    }
    // ikke-JPEG: find den yderste jumb-boks
    for (let i = 0; i + 8 < b.length; i++) {
      if (b[i + 4] === 0x6a && b[i + 5] === 0x75 && b[i + 6] === 0x6d && b[i + 7] === 0x62) {
        return b.subarray(i);
      }
    }
    return null;
  }

  // --- tolkning -----------------------------------------------------------

  function laesManifest(jumb, b) {
    const ud = { label: etiket(jumb, b), generator: null, actions: [], ingredients: [] };
    for (const barn of jumb.boern || []) {
      if (barn.type !== "jumb") continue;
      const navn = etiket(barn, b) || "";
      const indhold = (barn.boern || []).find((x) => x.type === "cbor" || x.type === "json" || x.type === "bidb");
      if (navn === "c2pa.assertions") {
        for (const a of barn.boern || []) {
          if (a.type !== "jumb") continue;
          const an = etiket(a, b) || "";
          const c = (a.boern || []).find((x) => x.type === "cbor");
          if (!c) continue;
          let v;
          try { v = cbor(b.subarray(c.start, c.slut)); } catch (e) { continue; }
          if (an.startsWith("c2pa.actions")) {
            for (const act of (v && v.actions) || []) {
              ud.actions.push({ action: act.action || null,
                                digitalSourceType: act.digitalSourceType || null,
                                softwareAgent: typeof act.softwareAgent === "string" ? act.softwareAgent : null });
            }
          } else if (an.startsWith("c2pa.ingredient")) {
            ud.ingredients.push({ title: v && v.title || null,
                                  relationship: v && v.relationship || null,
                                  manifest: v && v.c2pa_manifest && v.c2pa_manifest.url || null });
          }
        }
      } else if (navn.startsWith("c2pa.claim") && indhold) {
        try {
          const c = cbor(b.subarray(indhold.start, indhold.slut));
          ud.generator = (c && (c.claim_generator ||
            (Array.isArray(c.claim_generator_info) && c.claim_generator_info[0] &&
             c.claim_generator_info[0].name))) || null;
        } catch (e) {}
      }
    }
    return ud;
  }

  function analyser(buf) {
    const store = findStore(buf);
    if (!store) return { har: false };
    const top = bokse(store, 0, store.length);
    const rod = top.find((x) => x.type === "jumb");
    if (!rod) return { har: false };
    const manifester = (rod.boern || []).filter((x) => x.type === "jumb").map((m) => laesManifest(m, store));
    if (!manifester.length) return { har: true, manifester: [], dom: "credentials" };

    // Det AKTIVE manifest er det sidste i lageret. Ingredienser staar foer det.
    const aktivt = manifester[manifester.length - 1];
    const kilder = aktivt.actions.map((a) => a.digitalSourceType).filter(Boolean);
    const dom = kilder.includes(AI_KOMPOSIT) ? "ai-composite"
              : kilder.includes(AI_HELT) ? "ai"
              : kilder.includes(KAMERA) ? "camera"
              : "credentials";

    // AI i en INGREDIENS er ikke det samme som at billedet selv er AI. Vi siger
    // det som to forskellige ting frem for at flade dem sammen.
    const ingrediensAI = manifester.slice(0, -1).some((m) =>
      m.actions.some((a) => a.digitalSourceType === AI_HELT || a.digitalSourceType === AI_KOMPOSIT));

    return { har: true, dom, ingrediensAI, aktivt, manifester,
             kaede: manifester.map((m) => ({ label: m.label, generator: m.generator,
                                             actions: m.actions.map((a) => a.action) })) };
  }

  self.NoAIC2PA = { analyser, cbor, bokse, findStore };
})();
