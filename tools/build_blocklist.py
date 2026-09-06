#!/usr/bin/env python3
"""Bygger den indbagte froe-liste til NoAI.

Kun CennoxX hentes: Soul Over AI's datafil har ikke rykket sig siden 2026-02-16
og dens id'er ligger i CennoxX' liste alligevel. Den krediteres, men hentes ikke.
Zoundhub roeres ikke (ingen licens, og den er en opslags-tjeneste, ikke et datasaet).

Froe-listen er KUN et koldstart-fallback. Naar extensionen henter frisk liste,
ERSTATTER den her - den flettes aldrig ind, ellers kan ingen komme af listen igen.
"""
import json, re, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

KILDE = "https://raw.githubusercontent.com/CennoxX/spotify-ai-blocker/main/SpotifyAiArtists.csv"
UD = Path(__file__).resolve().parent.parent / "blocklist.json"
ID = re.compile(r"^[A-Za-z0-9]{22}$")

def hent(url):
    # curl frem for urllib: IPv6-ruten til GitHub timer ud i pythons TLS-handshake
    r = subprocess.run(["/usr/bin/curl", "-4", "-fsSL", "--max-time", "90",
                        "-A", "noai-build", url], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("curl %d: %s" % (r.returncode, r.stderr.decode()[:200]))
    return r.stdout.decode("utf-8", "replace")

def main():
    csv = hent(KILDE)
    ids = sorted({l.rsplit(",", 1)[1].strip() for l in csv.splitlines()[1:] if "," in l})
    ids = [i for i in ids if ID.match(i)]
    if len(ids) < 1000:
        print("kun %d id'er - for lidt, afbryder" % len(ids), file=sys.stderr)
        return 1
    UD.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "CennoxX/spotify-ai-blocker",
        "count": len(ids),
        "ids": ids,
    }, separators=(",", ":")))
    print("%s: %d id'er, %d bytes" % (UD, len(ids), UD.stat().st_size))
    return 0

if __name__ == "__main__":
    sys.exit(main())
