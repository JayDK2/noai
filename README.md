# NoAI — AI Music Filter

A Chrome extension for the Spotify **web player** that dims tracks which
community-maintained lists have reported as AI-generated, and can optionally
skip them.

It reads only what Spotify has already drawn on screen. No page scripts are
hooked, no tokens are read, no private API is called, no account changes are
made, and nothing about you is sent anywhere.

## What it does

- **Dims** flagged tracks in playlists, search results, album and artist pages,
  with the label "flagged by community list". Hiding is available but not the
  default.
- **Auto-skip** (off by default) skips a flagged track shortly after it starts.
  There is about a second of audio first — see *Known limits*.
- **Allowlist** — mark any artist as never-filter. It applies to both dimming
  and skipping.

## Known limits

Honest ones, because they are the reason for the defaults:

- **The lists are reports, not detection.** They are hand-curated from public
  submissions and contain mistakes. New AI acts pass until someone reports them,
  and an AI track released under a real artist's name is invisible to any list.
- **About a second of audio plays before a skip.** Spotify's web player streams
  from a media element that is never inserted into the page, so an extension
  cannot reach it to duck the volume. Reaching it would mean injecting into the
  page's own JavaScript, which we will not do.
- **Skipping only acts on the tab that is making sound**, so it never touches
  playback on your phone, speaker or car.
- **Spotify Free limits skips** to roughly six per hour. Auto-skip is
  effectively a Premium feature.
- **The mini-player (picture-in-picture) is not covered.** Spotify moves the
  player UI into a separate document that extensions cannot see.
- **Fifteen skips in a row and it stops** and says so, rather than running away
  through an AI radio station. Touch the player to resume.

## Sources and licences

See [ATTRIBUTION.md](ATTRIBUTION.md). Licence texts in [`LICENSES/`](LICENSES/).

## For artists

If you are on the list and should not be, see [PRIVACY.md](PRIVACY.md#2-if-you-are-an-artist-on-the-list).
We remove on request, without conditions, and the removal reaches every
installation within six hours. Our reasoning for processing this data at all is
published in [LIA.md](LIA.md).

## Build

```
python3 tools/build_blocklist.py      # rebuilds the bundled seed list
```

The seed is a cold-start fallback only. At runtime the fetched list **replaces**
it — it is never merged, because merging would make the bundled copy a floor
that nobody could ever be removed from.

## Not affiliated with Spotify

This extension does not detect, block, mute, or skip advertisements.
