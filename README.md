# NoAI — AI Content Filter

A Chrome extension that dims what community-maintained lists have **reported** as
AI-generated — tracks on the Spotify web player, and videos on YouTube. On
Spotify it can optionally skip them too.

It never guesses. NoAI has no AI detector and never will: it shows you what
other people have reported, with the confidence they reported it at, and lets
you overrule any of it.

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

## YouTube

Two tiers, kept apart deliberately:

- **Reported** — dimmed, marked `reported as AI`. Hidden instead, if you prefer.
- **Possibly** — left fully visible, marked `possibly AI`. Never dimmed.

The upstream list keeps those two apart and so do we; merging them would assert
a confidence nobody has. Videos with no channel link — ads, sponsored cards —
are never touched.

A channel's own page is covered too: the cards there do not repeat the channel
link, so the handle is read from the URL instead.

## Content Credentials, everywhere else

Off by default; turning it on asks for permission to run on every site.

Some tools write a **Content Credential** into the image file itself, declaring
how it was made. Where that declaration says AI, NoAI marks the image — on any
site, not just the two above.

This is the whole philosophy in one feature: NoAI has no AI detector and never
will. It reads what the file says about itself, and says so in those words —
*declared by the file*, not *proven*.

**Expect few marks, and expect none at all in the obvious places.** A Content
Credential only survives if nobody re-encodes the file, and almost everyone does.
Google Images serves stripped proxy thumbnails — we measured a search for
"pictures made with ai": of 268 images, 177 were inline data URIs and 78 were
Google's own re-encoded thumbnails, none carrying any credential or even EXIF.
Instagram, X and Facebook strip them too. The feature works where the original
file reaches you: a photographer's own site, a news outlet that preserves
provenance, a direct link to the file. Signature verification would need a full
C2PA library and a certificate chain, and a forged claim that something **is**
AI is not an attack anyone has reason to mount.

## Site rules

Off by default; shares the same optional site permission as Content Credentials.

A growing number of platforms label AI content themselves. Rather than shipping a
code change and waiting on store review for each one, NoAI reads **site rules** from
the same file it already fetches every six hours. A new platform becomes one JSON
entry that goes live in six hours — and a broken selector can be fixed just as fast,
instead of waiting weeks for an update to be approved.

**Rules are data, never code.** This is the line the whole design depends on:

- A rule is four strings: which hosts, which container, which signal element, and a
  label *key*. Nothing else is read. The words on screen are not in the rule: the
  key selects one of a handful of labels the extension itself ships, so a fetched
  file can choose between our phrasings but never write its own.
- The only two actions are: add a class, and add a text label. There is no
  expression language, no callback, no script.
- Nothing fetched is ever evaluated. `JSON.parse` and nothing else.
- Rules that do not match the exact expected shape are discarded, not interpreted.

This is the same posture as an ad blocker's filter lists, and for the same reason:
selectors change often, and a release cycle is the wrong tool for keeping up.

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
