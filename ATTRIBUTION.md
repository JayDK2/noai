# Sources

NoAI does not detect AI-generated music. It shows you what community-maintained
lists have reported, and lets you override any of it.

| Source | Licence | Used how |
|---|---|---|
| [CennoxX/spotify-ai-blocker](https://github.com/CennoxX/spotify-ai-blocker) | MIT | The live list. Mirrored here, refreshed every 6 hours. |
| [Soul Over AI](https://souloverai.com) | CC BY 4.0 | Attributed. Not fetched — archived since 2026-02-16, and its identifiers are contained in the set above. |

Full licence texts are in [`LICENSES/`](LICENSES/).

## Not used

**Zoundhub** (Soul Over AI's successor) is deliberately not used. It publishes no
dataset, carries no licence, and works as a per-query lookup service — using it
would mean sending the name of the artist you are listening to, as you listen,
to a third-party server. NoAI sends nothing about you anywhere. Zoundhub's own
documentation also states that it is not a classifier of artists, and NoAI has
no interest in re-asserting a judgement its own source declines to make.

**eye-wave/spotify-ai-blocklist** is not used. It is GPL-3.0 and contributes only
56 identifiers that are not already in the set above.
