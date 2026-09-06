#!/usr/bin/env python3
"""Minimal markdown -> HTML for NoAI's public policy pages.

Ikke en generel konverter - kun de konstruktioner vi faktisk bruger.
En kunstner der googler sit eget navn skal kunne laese det her uden at
installere noget, saa siden skal vaere selvstaendig og hurtig.
"""
import html, re, sys
from pathlib import Path

def inline(t):
    t = html.escape(t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', t)
    t = re.sub(r"(?<![\">/=])\b(https?://[^\s<)]+)", r'<a href="\1">\1</a>', t)
    return t

def konverter(md):
    ud, i, linjer = [], 0, md.split("\n")
    while i < len(linjer):
        l = linjer[i]
        if not l.strip():
            i += 1; continue
        if l.startswith("|") and i + 1 < len(linjer) and set(linjer[i+1].replace("|","").strip()) <= set("-: "):
            hoved = [c.strip() for c in l.strip("|").split("|")]
            i += 2
            raekker = []
            while i < len(linjer) and linjer[i].startswith("|"):
                raekker.append([c.strip() for c in linjer[i].strip("|").split("|")]); i += 1
            ud.append("<table><thead><tr>" + "".join("<th>%s</th>" % inline(c) for c in hoved) +
                      "</tr></thead><tbody>" +
                      "".join("<tr>" + "".join("<td>%s</td>" % inline(c) for c in r) + "</tr>" for r in raekker) +
                      "</tbody></table>")
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", l)
        if m:
            n = len(m.group(1))
            ud.append("<h%d>%s</h%d>" % (n, inline(m.group(2)), n)); i += 1; continue
        if l.strip() == "---":
            ud.append("<hr>"); i += 1; continue
        if l.startswith("- ") or l.startswith("* "):
            punkter = []
            while i < len(linjer) and (linjer[i].startswith("- ") or linjer[i].startswith("* ")
                                       or linjer[i].startswith("  ")):
                if linjer[i].startswith(("- ", "* ")): punkter.append(linjer[i][2:])
                elif punkter: punkter[-1] += " " + linjer[i].strip()
                i += 1
            ud.append("<ul>" + "".join("<li>%s</li>" % inline(p) for p in punkter) + "</ul>")
            continue
        if l.startswith("> "):
            blok = []
            while i < len(linjer) and linjer[i].startswith(">"):
                blok.append(linjer[i].lstrip("> ")); i += 1
            ud.append("<blockquote>%s</blockquote>" % inline(" ".join(blok)))
            continue
        afsnit = []
        while i < len(linjer) and linjer[i].strip() and not re.match(r"^(#{1,4} |[-*] |\||>|---$)", linjer[i]):
            afsnit.append(linjer[i]); i += 1
        ud.append("<p>%s</p>" % inline(" ".join(afsnit)))
    return "\n".join(ud)

STIL = """
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0c0c0d; color: #d8d7d5;
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 6rem; }
h1 { font-size: 1.6rem; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 .3rem; }
h1 span { color: #d9b25f; }
h2 { font-size: 1.15rem; margin: 2.6rem 0 .6rem; padding-top: 1.4rem;
  border-top: 1px solid #1e1e20; letter-spacing: .02em; }
h3 { font-size: 1rem; margin: 1.8rem 0 .4rem; color: #cfcecc; }
p, li { color: #b9b8b6; }
strong { color: #eceae8; }
a { color: #d9b25f; }
code { font: .9em ui-monospace, SFMono-Regular, Menlo, monospace; color: #cdb98a; }
ul { padding-left: 1.15rem; }
li { margin: .3rem 0; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: .93rem; }
th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #1e1e20; vertical-align: top; }
th { color: #8d8c8a; font-weight: 600; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; }
blockquote { margin: 1rem 0; padding: .6rem 1rem; border-left: 2px solid #d9b25f;
  background: #131314; color: #c6c4c2; }
hr { border: 0; border-top: 1px solid #1e1e20; margin: 2.5rem 0; }
footer { margin-top: 3rem; padding-top: 1.2rem; border-top: 1px solid #1e1e20;
  font-size: .85rem; color: #6f6e6c; }
"""

if __name__ == "__main__":
    md = Path(sys.argv[1]).read_text()
    krop = konverter(md)
    titel = "NoAI — Privacy"
    Path(sys.argv[2]).write_text(
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '<title>%s</title>\n<style>%s</style>\n</head>\n<body>\n<main>\n%s\n'
        '<footer>NoAI is a browser extension that dims content reported as AI-generated. '
        'Source, filter lists and retraction files: '
        '<a href="https://github.com/JayDK2/noai">github.com/JayDK2/noai</a>. '
        'Contact: <a href="mailto:noAI@h1tmakers.com">noAI@h1tmakers.com</a>.</footer>\n'
        '</main>\n</body>\n</html>\n' % (titel, STIL, krop))
    print("skrevet:", sys.argv[2])
