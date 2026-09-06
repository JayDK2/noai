#!/usr/bin/env python3
"""Bygger den indbagte froe-liste over YouTube-kanaler til NoAI.

Kilde: Override92/AiSList (CC BY-NC 4.0) - se ATTRIBUTION.md.
Froe-listen er KUN et koldstart-fallback; ved koersel ERSTATTER den hentede
liste denne, saa en kanal der er fjernet hos kilden ogsaa forsvinder her.
"""
import json, re, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

BASE = "https://raw.githubusercontent.com/Override92/AiSList/main/AiSList/"
UD = Path(__file__).resolve().parent.parent / "youtube.json"

def normaliser(h):
    h = unquote(h.strip()).lower()
    if not h.startswith("@") or len(h) < 2 or len(h) > 70:
        return None
    if re.search(r"[\s/?#&]", h):
        return None
    return h

def hent(navn):
    r = subprocess.run(["/usr/bin/curl", "-4", "-fsSL", "--max-time", "90",
                        "-A", "noai-build", BASE + navn], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("curl %d for %s" % (r.returncode, navn))
    ud = set()
    for line in r.stdout.decode("utf-8", "replace").splitlines():
        if line.strip().startswith("!"):
            continue
        n = normaliser(line)
        if n:
            ud.add(n)
    return sorted(ud)

def main():
    block, warn = hent("aislist_blocklist.txt"), hent("aislist_warnlist.txt")
    # Kilden har kanaler paa BEGGE lister (3 ved sidste maaling). Det mildeste
    # niveau skal vinde: staar en kanal paa warn, maa den ikke ogsaa graatones.
    overlap = set(block) & set(warn)
    if overlap:
        print("%d kanal(er) paa begge lister - beholdes kun som warn: %s"
              % (len(overlap), ", ".join(sorted(overlap)[:5])), file=sys.stderr)
        block = [h for h in block if h not in overlap]
    if len(block) < 1000:
        print("kun %d kanaler - afbryder" % len(block), file=sys.stderr)
        return 1
    UD.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Override92/AiSList",
        "license": "CC BY-NC 4.0",
        "count": len(block) + len(warn),
        "block": block,
        "warn": warn,
    }, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print("%s: %d blok + %d advarsel, %d bytes" % (UD, len(block), len(warn), UD.stat().st_size))
    return 0

if __name__ == "__main__":
    sys.exit(main())
