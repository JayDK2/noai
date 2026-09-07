#!/usr/bin/env python3
"""Bygger de C2PA-fixtures der dækker den nyeste og farligste kode i læseren.

De fem oprindelige fixtures (ren, ai, kamera, komposit, ingrediens) er alle JPEG
og alle under 256 KB. Det betyder at to-trins-hentningen, den rå scanning for
ikke-JPEG og afkortnings-stien - præcis de tre steder fejlene sidst sad - ikke var
dækket af en eneste test. Dette script laver resten:

  stor.jpg      AI-krav, manifestet er ALENE over 256 KB (fyld-påstand), så de
                første 256 KB ender midt i lageret. Første trin af hentningen SKAL
                kaste, hele filen SKAL sige "ai".
  afkortet.jpg  stor.jpg skåret over midt i manifest-lageret. Læseren SKAL kaste -
                aldrig "ingen", aldrig et pænt, forkert svar.
  ai.png        AI-krav i PNG (caBX-chunk) - den rå scanning.
  ai.webp       AI-krav i WebP (C2PA-chunk) - den rå scanning, anden beholder.
  afledt.jpg    Åbnet fra ai.jpg som FORÆLDER (parentOf), intet eget kildekrav.
                Læseren skal sige "ai-derived": afledt af et AI-erklæret billede.
  komponent.jpg Kamera-billede med ai.jpg sat ind som DEL (componentOf), intet
                eget kildekrav. Læseren skal sige "ai-composite".

Kræver c2patool og Pillow. De fem oprindelige fixtures regenereres ikke - deres
signaturer ville ændre sig, og de er facit.

    python3 tools/lav_fixtures.py
"""
import json
import os
import subprocess
import sys
import tempfile

ROD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FIX = os.path.join(ROD, "test", "fixtures")
AI = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow mangler: pip3 install Pillow")


def flade(px, farve):
    """Et ensfarvet billede: komprimerer til næsten ingenting, så fixturen er
    manifestet og ikke pixels."""
    return Image.new("RGB", (px, px), farve)


# Uden miniaturer. c2patool lægger ellers en miniature i hvert manifest, og for
# PNG og WebP blev den 300 KB-1,4 MB for et 96×96-billede. Miniaturen siger
# intet om det læseren tester.
INDSTILLINGER = {"builder": {"thumbnail": {"enabled": False}}}


def c2pa(kilde, manifest, ud, forældre=None):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(manifest, f)
        sti = f.name
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(INDSTILLINGER, f)
        indst = f.name
    try:
        cmd = ["c2patool", kilde, "-m", sti, "-o", ud, "-f", "--settings", indst]
        if forældre:
            cmd += ["-p", forældre]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode:
            sys.exit("c2patool fejlede for %s:\n%s\n%s" % (ud, r.stdout, r.stderr))
    finally:
        os.unlink(sti)
        os.unlink(indst)
    print("  %-14s %7d byte" % (os.path.basename(ud), os.path.getsize(ud)))


def manifest(actions, ekstra=None, dele=None):
    m = {
        "claim_generator_info": [{"name": "NoAI fixtures", "version": "1.0"}],
        "assertions": [{"label": "c2pa.actions", "data": {"actions": actions}}] + (ekstra or []),
    }
    if dele:
        # ingredient_paths: filerne læses ind som ingredienser MED deres eget
        # manifest, og relationen er componentOf som standard (forælderen sættes
        # med -p). Stierne opløses relativt til manifest-filen, så: absolutte.
        # ("ingredients" med "path" accepteres i stilhed og lægger et TOMT
        # manifest ind - det var første forsøg, og fixturen sagde "credentials".)
        m["ingredient_paths"] = [os.path.abspath(p) for p in dele]
    return m


def main():
    os.makedirs(FIX, exist_ok=True)
    tmp = tempfile.mkdtemp()
    ai_jpg = os.path.join(FIX, "ai.jpg")
    kamera_jpg = os.path.join(FIX, "kamera.jpg")
    if not (os.path.exists(ai_jpg) and os.path.exists(kamera_jpg)):
        sys.exit("ai.jpg og kamera.jpg skal findes i forvejen - de er facit")

    # Kilder uden credentials
    lille = os.path.join(tmp, "lille.png")
    flade(96, (40, 80, 120)).save(lille)
    lille_webp = os.path.join(tmp, "lille.webp")
    flade(96, (120, 80, 40)).save(lille_webp, "WEBP", quality=80)
    mellem = os.path.join(tmp, "mellem.jpg")
    flade(160, (80, 120, 40)).save(mellem, "JPEG", quality=85)

    print("fixtures:")
    # stor.jpg: manifestet ALENE over 256 KB. Fyldet er en egen påstand, som
    # læseren ignorerer - men den skubber slutningen af lageret forbi de 256 KB
    # første trin henter, så det trin SKAL ende med et kast.
    fyld = [{"label": "com.noai.fyld", "data": {"note": "fyld saa manifestet er over 256 KB",
                                                  "fyld": "x" * (300 * 1024)}}]
    c2pa(mellem, manifest([{"action": "c2pa.created", "digitalSourceType": AI}], fyld),
         os.path.join(FIX, "stor.jpg"))

    # afkortet.jpg: stor.jpg skåret over ved 200 KB - inde i manifest-lageret,
    # længe før billeddata.
    with open(os.path.join(FIX, "stor.jpg"), "rb") as f:
        stor = f.read()
    with open(os.path.join(FIX, "afkortet.jpg"), "wb") as f:
        f.write(stor[:200 * 1024])
    print("  %-14s %7d byte" % ("afkortet.jpg", 200 * 1024))

    c2pa(lille, manifest([{"action": "c2pa.created", "digitalSourceType": AI}]),
         os.path.join(FIX, "ai.png"))
    c2pa(lille_webp, manifest([{"action": "c2pa.created", "digitalSourceType": AI}]),
         os.path.join(FIX, "ai.webp"))

    # afledt.jpg: ai.jpg åbnet som forælder og gemt igen. Intet eget kildekrav -
    # kun c2pa.opened - så det er relationen der bærer betydningen.
    c2pa(ai_jpg, manifest([{"action": "c2pa.opened"}]),
         os.path.join(FIX, "afledt.jpg"), forældre=ai_jpg)

    # komponent.jpg: kamera.jpg med ai.jpg som DEL. Intet eget kildekrav.
    c2pa(kamera_jpg, manifest([{"action": "c2pa.opened"}, {"action": "c2pa.placed"}], dele=[ai_jpg]),
         os.path.join(FIX, "komponent.jpg"), forældre=kamera_jpg)


if __name__ == "__main__":
    main()
