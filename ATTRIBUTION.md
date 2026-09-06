# Sources

NoAI does not detect AI-generated music. It shows you what community-maintained
lists have reported, and lets you override any of it.

| Source | Licence | Used how |
|---|---|---|
| [CennoxX/spotify-ai-blocker](https://github.com/CennoxX/spotify-ai-blocker) | MIT | The live list. Mirrored here, refreshed every 6 hours. |
| [Soul Over AI](https://souloverai.com) | CC BY 4.0 | Attributed. Not fetched — archived since 2026-02-16, and its identifiers are contained in the set above. |

Full licence texts are in [`LICENSES/`](LICENSES/).

## YouTube

| Source | Licence | Used how |
|---|---|---|
| [Override92/AiSList](https://github.com/Override92/AiSList) | **CC BY-NC 4.0** | 21,078 channels reported as AI-generated, plus 939 flagged as possible. Mirrored here, refreshed every 6 hours. |

AiSList keeps two tiers and so do we, because collapsing them would assert a
confidence neither they nor we have:

- **blocklist** — high confidence. NoAI dims these videos.
- **warnlist** — medium confidence. NoAI only marks these. Never dimmed, never hidden.

Full attribution, including the modifications we make, is in
[`LICENSES/AiSList-CC-BY-NC-4.0.txt`](LICENSES/AiSList-CC-BY-NC-4.0.txt).

**This is the licence that binds the project's finances.** See the note above.

## Not used

**Zoundhub** (Soul Over AI's successor) is deliberately not used. It publishes no
dataset, carries no licence, and works as a per-query lookup service — using it
would mean sending the name of the artist you are listening to, as you listen,
to a third-party server. NoAI sends nothing about you anywhere. Zoundhub's own
documentation also states that it is not a classifier of artists, and NoAI has
no interest in re-asserting a judgement its own source declines to make.

**eye-wave/spotify-ai-blocklist** is not used. It is GPL-3.0 and contributes only
56 identifiers that are not already in the set above.

## A licence condition, not a preference

NoAI does not accept money — no donation link, no paid tier, no sponsorship.

That is currently a choice, but it becomes binding the moment any data licensed
CC BY-NC is added: "NonCommercial" means "not primarily intended for or directed
towards commercial advantage or monetary compensation" (CC BY-NC 4.0 §1(i)), and
a donation button next to NC-licensed data is genuinely arguable as monetary
compensation. If money ever enters, the NC-licensed data has to come out first.

## The data is not covered by the code licence

The MIT licence in [LICENSE](LICENSE) covers the code in this repository. The
artist identifiers in `blocklist.json` are not ours: they originate from
CennoxX/spotify-ai-blocker under the MIT License, with attribution to Soul Over
AI under CC BY 4.0. Those terms travel with the data regardless of how the code
is licensed. Full texts are in [`LICENSES/`](LICENSES/).
