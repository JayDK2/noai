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
//
// Én regel gælder hele filen: en struktur vi ikke kan læse færdig KASTER. Den
// svarer aldrig med noget der ligner et svar. Kalderen fanger og siger
// "credentials" - hverken "ingen" eller "AI" - og det er det ærlige svar på en
// fil vi ikke fik hele vejen igennem. Den anden vej rundt gik det fire gange:
// en vagt der ikke kunne fyre, og et pænt, forkert svar i stedet for en fejl.

(() => {
  "use strict";

  const AI_HELT = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
  const AI_KOMPOSIT = "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia";
  const KAMERA = "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture";

  // JUMBF-UUID'et for et C2PA manifest-lager: ASCII "c2pa" efterfulgt af det
  // faste JUMBF-suffiks. Det er DET vi leder efter - ikke fire tilfældige byte.
  const C2PA_LAGER_UUID = "6332706100110010800000aa00389b71";

  // --- CBOR ---------------------------------------------------------------
  // Kun det manifestet faktisk bruger. En fuld CBOR-implementation er unoedvendig
  // og ville vaere mere kode at tage fejl i.
  //
  // Hver eneste læsning er grænsetjekket. Første udgave læste ud over bufferen
  // og fik `undefined`, som blev til 0 og "" og tomme maps - et map der lovede
  // to par med bufferen sluttende midtvejs gav {"0":0,"a":1}. Kalderens
  // fejlsti håndterer en exception rigtigt, så at kaste ER det rigtige svar.

  function cbor(b, s = { i: 0 }, dybde = 0) {
    if (dybde > 64) throw new RangeError("CBOR: for dybt indlejret");
    const kraev = (n) => {
      if (s.i + n > b.length) throw new RangeError("CBOR: afkortet ved byte " + s.i + " (" + b.length + " byte i alt)");
    };
    kraev(1);
    const byte = b[s.i++];
    const major = byte >> 5, ekstra = byte & 31;
    const laes = (n) => { kraev(n); let v = 0; for (let k = 0; k < n; k++) v = v * 256 + b[s.i++]; return v; };
    let laengde;
    if (ekstra < 24) laengde = ekstra;
    else if (ekstra === 24) laengde = laes(1);
    else if (ekstra === 25) laengde = laes(2);
    else if (ekstra === 26) laengde = laes(4);
    else if (ekstra === 27) laengde = laes(8);
    else if (ekstra === 31) laengde = -1;          // ubestemt laengde (eller break)
    else throw new RangeError("CBOR: reserveret laengdekode " + ekstra);
    if (laengde < 0 && major < 2) throw new RangeError("CBOR: ubestemt laengde paa et heltal");
    if (laengde < 0 && major === 7) throw new RangeError("CBOR: loes break-byte");

    const barn = () => cbor(b, s, dybde + 1);
    // Ubestemt laengde: laes til break-byten 0xff. Slutter bufferen foer den
    // kommer, er strukturen afkortet - ikke faerdig.
    const tilBreak = (hver) => {
      for (;;) { kraev(1); if (b[s.i] === 0xff) { s.i++; return; } hver(); }
    };

    switch (major) {
      case 0: return laengde;
      case 1: return -1 - laengde;
      case 2: {                                     // byte-streng
        if (laengde < 0) { const d = []; tilBreak(() => d.push(barn())); return d; }
        kraev(laengde);
        const v = b.subarray(s.i, s.i + laengde); s.i += laengde; return v;
      }
      case 3: {                                     // tekst
        if (laengde < 0) { let t = ""; tilBreak(() => { t += barn(); }); return t; }
        kraev(laengde);
        const v = new TextDecoder("utf-8").decode(b.subarray(s.i, s.i + laengde));
        s.i += laengde; return v;
      }
      case 4: {                                     // array
        const ud = [];
        if (laengde < 0) { tilBreak(() => ud.push(barn())); return ud; }
        for (let k = 0; k < laengde; k++) ud.push(barn());
        return ud;
      }
      case 5: {                                     // map
        // Uden prototype: en noegle ved navn __proto__ i en fremmed fil maa
        // ikke kunne aendre hvad vi senere laeser ud af objektet.
        const ud = Object.create(null);
        if (laengde < 0) { tilBreak(() => { const n = barn(); ud[n] = barn(); }); return ud; }
        for (let k = 0; k < laengde; k++) { const n = barn(); ud[n] = barn(); }
        return ud;
      }
      case 6: return barn();                        // tag - indholdet er det interessante
      case 7:
        if (ekstra === 20) return false;
        if (ekstra === 21) return true;
        if (ekstra === 22) return null;
        if (ekstra === 23) return undefined;
        return null;                                // simple vaerdier og flydende tal - bytene er allerede laest
      default: return null;
    }
  }

  // --- JUMBF-bokse --------------------------------------------------------
  // [4 byte laengde][4 byte type][indhold]. En 'jumb' er en superboks der
  // indeholder en 'jumd'-beskrivelse plus indhold.

  const type = (b, o) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
  const u32 = (b, o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
  const hex = (b, o, n) => {
    let s = "";
    for (let k = 0; k < n; k++) s += (b[o + k] < 16 ? "0" : "") + b[o + k].toString(16);
    return s;
  };

  // Boksens hoved: LBox (4), TBox (4), og XLBox (8) hvis LBox er 1. LBox 0 betyder
  // "resten af forælderen". Returnerer null hvis der ikke er plads til et hoved.
  function boksHoved(b, o, slut) {
    if (o + 8 > slut) return null;
    let laengde = u32(b, o);
    let hoved = 8;
    if (laengde === 1) {
      if (o + 16 > slut) return null;
      hoved = 16;
      laengde = Number(new DataView(b.buffer, b.byteOffset + o + 8, 8).getBigUint64(0));
    } else if (laengde === 0) laengde = slut - o;
    return { hoved, laengde, type: type(b, o) };
  }

  function bokse(b, start, slut, dybde = 0) {
    const ud = [];
    let o = start;
    while (o + 8 <= slut) {
      if (dybde >= 12) throw new RangeError("JUMBF: for dybt indlejret");
      const h = boksHoved(b, o, slut);
      if (!h) throw new RangeError("JUMBF: bokshoved skaaret over ved byte " + o);
      if (h.laengde < h.hoved) throw new RangeError("JUMBF: ugyldig bokslaengde " + h.laengde);
      // En boks der raekker ud over sin forælder er ikke "den sidste boks" - den
      // er AFKORTET. Første udgave brød stille ud af løkken her, og en fil skåret
      // over midt i manifest-lageret blev derfor til "ingen credentials".
      if (o + h.laengde > slut)
        throw new RangeError("JUMBF: boksen '" + h.type + "' raekker " + (o + h.laengde - slut) +
                             " byte ud over bufferen - afkortet fil?");
      const boks = { type: h.type, start: o + h.hoved, slut: o + h.laengde };
      if (h.type === "jumb") boks.boern = bokse(b, boks.start, boks.slut, dybde + 1);
      ud.push(boks);
      o += h.laengde;
    }
    return ud;
  }

  // jumd-boksens indhold er: 16 byte type-UUID, 1 byte toggles, og DEREFTER de
  // valgfrie felter i fast raekkefoelge: etiket (bit 1, nul-termineret tekst),
  // ID (bit 2, 4 byte), signatur (bit 3, 32 byte), privat boks (bit 4).
  //
  // Toggles-byten SKAL laeses. Er etiket-bitten ikke sat, er byte 17 og frem et
  // ID eller en signatur, og at laese det som tekst giver et "navn" der bare
  // tilfaeldigvis ikke ligner c2pa.claim. Første udgave laeste desuden den
  // sidste nul-terminerede streng i boksen og fik derfor halen i stedet for navnet.
  function beskrivelse(jumb, b) {
    const jumd = (jumb.boern || []).find((x) => x.type === "jumd");
    if (!jumd || jumd.slut - jumd.start < 17) return null;
    const toggles = b[jumd.start + 16];
    let label = null;
    if (toggles & 2) {
      let i = jumd.start + 17;
      while (i < jumd.slut && b[i] !== 0) i++;
      if (i >= jumd.slut) throw new RangeError("JUMBF: jumd-etiket uden nul-terminering");
      const s = new TextDecoder("utf-8").decode(b.subarray(jumd.start + 17, i));
      label = /^[\x20-\x7e]+$/.test(s) ? s : null;
    }
    return { uuid: hex(b, jumd.start, 16), label };
  }
  const etiket = (jumb, b) => { const d = beskrivelse(jumb, b); return d ? d.label : null; };

  // --- find manifest-lageret i filen --------------------------------------
  // JPEG gemmer det i APP11-segmenter der SKAL saettes sammen i raekkefoelge;
  // et stort manifest er delt over mange. Andre formater har det som en boks.

  function findStore(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xff && b[1] === 0xd8) {
      // Hvert APP11-segment: 'JP', 2 byte boks-instans (En), 4 byte pakke-sekvens
      // (Z), og saa JUMBF. Segmenter grupperes paa INSTANS: en fil kan baere to
      // JUMBF-bokse (lageret og fx en leverandoerboks), og deres pakker maa ikke
      // flettes ind i én buffer. Inden for en instans sorteres paa Z.
      //
      // FAELDE: hvert segment gentager boksens LBox+TBox (8 byte, 16 med XLBox),
      // fordi de beskriver HELE boksen, ikke stumpen. Limer man dem sammen som de
      // er, bliver alt efter foerste segment forskudt - og saa forsvinder det
      // aktive manifest, mens ingredienserne ser fine ud. Kun instansens FOERSTE
      // pakke beholder hovedet - "foerste" maalt paa Z, ikke paa om Z er 1:
      // spec'en siger 1-baseret, men en 0-baseret skriver skal ikke koste os
      // de otte byte.
      const vedInstans = new Map();
      let o = 2;
      while (o + 4 <= b.length) {
        if (b[o] !== 0xff) { o++; continue; }
        const m = b[o + 1];
        if (m === 0xff) { o++; continue; }                        // fyld-byte foer markoer
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
        if (m === 0xda || m === 0xd9) break;                       // billeddata / slut
        const len = (b[o + 2] << 8) | b[o + 3];
        if (len < 2) throw new RangeError("JPEG: ugyldig segmentlaengde " + len);
        const segSlut = o + 2 + len;
        if (segSlut > b.length) {
          // Segmentet er skaaret over. Har vi allerede set JUMBF, kan lageret
          // vaere ufuldstaendigt - det er ikke et svar, det er en afkortet fil.
          if (vedInstans.size) throw new RangeError("JPEG: APP-segment afkortet midt i manifest-lageret");
          break;
        }
        if (m === 0xeb && len >= 2 + 16 && b[o + 4] === 0x4a && b[o + 5] === 0x50) {
          const p = o + 4;
          const instans = (b[p + 2] << 8) | b[p + 3];
          const seq = u32(b, p + 4);
          const hoved = u32(b, p + 8) === 1 ? 16 : 8;
          let liste = vedInstans.get(instans);
          if (!liste) { liste = []; vedInstans.set(instans, liste); }
          liste.push({ seq, hoved, data: b.subarray(p + 8, segSlut) });
        }
        o = segSlut;
      }
      if (!vedInstans.size) return null;
      const stykker = [];
      for (const instans of [...vedInstans.keys()].sort((x, y) => x - y)) {
        const liste = vedInstans.get(instans).sort((x, y) => x.seq - y.seq);
        liste.forEach((d, k) => stykker.push(k === 0 ? d.data : d.data.subarray(d.hoved)));
      }
      const ud = new Uint8Array(stykker.reduce((n, d) => n + d.length, 0));
      let k = 0;
      for (const d of stykker) { ud.set(d, k); k += d.length; }
      return ud;
    }

    // Ikke-JPEG (PNG caBX, WebP C2PA, BMFF uuid m.fl.): find lagerets jumb-boks
    // ved at scanne. Fire ASCII-byte er ikke bevis - i en komprimeret fil paa
    // nogle megabyte dukker "jumb" op ved et tilfaelde omkring hver tusinde gang,
    // og foerste udgave tog det foerste traef og saa aldrig videre. Kraev derfor
    // en plausibel bokslaengde OG en jumd-boks lige efter med lagerets UUID.
    // Ellers scannes videre.
    for (let i = 0; i + 8 <= b.length; i++) {
      if (b[i + 4] !== 0x6a || b[i + 5] !== 0x75 || b[i + 6] !== 0x6d || b[i + 7] !== 0x62) continue;
      if (u32(b, i) === 0) continue;                               // "resten af filen" giver ingen mening her
      const h = boksHoved(b, i, b.length);
      if (!h || h.laengde < h.hoved + 8 + 17) continue;
      const j = i + h.hoved;                                       // foerste barn skal vaere jumd
      if (j + 8 + 17 > b.length || type(b, j) !== "jumd") continue;
      if (u32(b, j) < 8 + 17 || hex(b, j + 8, 16) !== C2PA_LAGER_UUID) continue;
      if (i + h.laengde > b.length)
        throw new RangeError("JUMBF: manifest-lageret raekker " + (i + h.laengde - b.length) +
                             " byte ud over bufferen - afkortet fil?");
      return b.subarray(i, i + h.laengde);
    }
    return null;
  }

  // --- tolkning -----------------------------------------------------------

  function laesManifest(jumb, b) {
    const ud = { label: etiket(jumb, b), generator: null, actions: [], ingredients: [], harKrav: false };
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
          // Kaster ved afkortet CBOR. Det maa den: en paastand vi ikke kunne
          // laese faerdig skal ikke blive til "ingen paastand".
          const v = cbor(b.subarray(c.start, c.slut));
          if (an.startsWith("c2pa.actions")) {
            for (const act of (v && v.actions) || []) {
              ud.actions.push({ action: act.action || null,
                                digitalSourceType: act.digitalSourceType || null,
                                softwareAgent: typeof act.softwareAgent === "string" ? act.softwareAgent : null });
            }
          } else if (an.startsWith("c2pa.ingredient")) {
            // v3 hedder noeglerne activeManifest og dc:title; v1/v2 c2pa_manifest
            // og title. Første udgave kendte kun de gamle, saa henvisningen til
            // ingrediensens manifest var altid null paa alt c2patool skriver i dag.
            const henv = v && (v.activeManifest || v.c2pa_manifest);
            ud.ingredients.push({ title: (v && (v["dc:title"] || v.title)) || null,
                                  relationship: v && v.relationship || null,
                                  manifest: (henv && typeof henv.url === "string") ? henv.url : null });
          }
        }
      } else if (navn.startsWith("c2pa.claim")) {
        // Det er kravet der goer en jumb til et manifest. En superboks uden
        // c2pa.claim* (leverandoerboks, fyld, databoks) er ikke et manifest,
        // uanset hvor i lageret den staar.
        ud.harKrav = true;
        if (indhold) {
          const c = cbor(b.subarray(indhold.start, indhold.slut));
          ud.generator = (c && (c.claim_generator ||
            (Array.isArray(c.claim_generator_info) && c.claim_generator_info[0] &&
             c.claim_generator_info[0].name))) || null;
        }
      }
    }
    return ud;
  }

  const erAI = (m) => !!m && m.actions.some((a) =>
    a.digitalSourceType === AI_HELT || a.digitalSourceType === AI_KOMPOSIT);

  // Tolker et faerdigt manifest-lager (bytene fra findStore). Adskilt fra
  // analyser saa testen kan bygge lagre med fyld og leverandoerbokse uden at
  // skulle skrive gyldige JPEG-segmenter foerst.
  function analyserLager(store) {
    const top = bokse(store, 0, store.length);
    // Lageret er den jumb hvis jumd baerer C2PA-lagerets UUID - ikke bare den
    // foerste jumb. Baerer filen to JUMBF-bokse, maa en leverandoerboks ikke
    // tages for lageret fordi den kom foerst.
    const rod = top.find((x) => x.type === "jumb" && (beskrivelse(x, store) || {}).uuid === C2PA_LAGER_UUID);
    if (!rod) return { har: false };
    const manifester = (rod.boern || [])
      .filter((x) => x.type === "jumb")
      .map((m) => laesManifest(m, store))
      .filter((m) => m.harKrav);
    if (!manifester.length) return { har: true, manifester: [], dom: "credentials" };

    // Det AKTIVE manifest er det sidste MANIFEST i lageret - ikke den sidste
    // boks. Første udgave tog den sidste jumb, saa en efterfoelgende leverandoer-
    // boks eller fyld blev "det aktive manifest" med nul handlinger, og en fil
    // der faktisk erklaerede AI fik dommen "credentials".
    const aktivt = manifester[manifester.length - 1];
    const kilder = aktivt.actions.map((a) => a.digitalSourceType).filter(Boolean);
    const egetKrav = kilder.includes(AI_KOMPOSIT) ? "ai-composite"
                   : kilder.includes(AI_HELT) ? "ai"
                   : kilder.includes(KAMERA) ? "camera"
                   : null;

    // Ingredienser slaas op paa deres manifest-URL (self#jumbf=/c2pa/<label>/...),
    // og relationen afgoer hvad AI i ingrediensen BETYDER for billedet:
    //   parentOf    = billedet er afledt af ingrediensen (aabnet, redigeret, gemt)
    //   componentOf = ingrediensen er sat ind i billedet som en del
    // Det er praecis den skelnen laeseren findes for, og foerste udgave fladede
    // den ud til én boolean.
    const vedLabel = manifester.filter((m) => m.label);
    const ingrediensManifest = (ing) => {
      const u = ing.manifest || "";
      return vedLabel.find((m) => u.includes(m.label)) || null;
    };
    let afledtAfAI = false, medAIKomponent = false;
    for (const ing of aktivt.ingredients) {
      if (!erAI(ingrediensManifest(ing))) continue;
      if (ing.relationship === "parentOf") afledtAfAI = true;
      else medAIKomponent = true;                   // componentOf, og ukendte relationer
    }
    // Reserve for ingredienser hvis manifest-URL ikke kunne slaas op: AI et sted
    // i kaeden er stadig AI i en ingrediens, bare uden kendt relation.
    const ingrediensAI = afledtAfAI || medAIKomponent || manifester.slice(0, -1).some(erAI);

    // Billedets EGET krav vinder altid. Siger det selv "kamera", er det kamera,
    // og ingrediensen rapporteres ved siden af. Siger det ingenting om kilden,
    // taler ingrediensens relation: afledt af et AI-billede er AI-afledt,
    // en AI-del sat ind er "indeholder AI".
    const dom = egetKrav ? egetKrav
              : afledtAfAI ? "ai-derived"
              : medAIKomponent ? "ai-composite"
              : "credentials";

    return { har: true, dom, ingrediensAI, afledtAfAI, medAIKomponent, aktivt, manifester,
             kaede: manifester.map((m) => ({ label: m.label, generator: m.generator,
                                             actions: m.actions.map((a) => a.action) })) };
  }

  function analyser(buf) {
    const store = findStore(buf);
    if (!store) return { har: false };
    return analyserLager(store);
  }

  self.NoAIC2PA = { analyser, analyserLager, cbor, bokse, findStore, C2PA_LAGER_UUID };
})();
