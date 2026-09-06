# NoAI — privacy

Two very different things are described here. The first is about **you, the
user**. The second is about **the artists named in the filter list**, who are
not users of this extension and never agreed to be on it. They have rights
too, and the second half explains how to exercise them.

## 1. If you use NoAI

**Nothing about you leaves your browser. There is no account, no analytics, no
telemetry, no error reporting.**

NoAI stores, only on your own device, using the browser's extension storage:

- your settings (filter on/off, auto-skip on/off, dim or hide)
- your allowlist — artists you have told it never to filter
- a count of how many tracks were skipped
- a copy of the filter list

None of it is transmitted anywhere, and it is deleted when you uninstall the
extension.

**One network request exists.** Every six hours NoAI downloads an updated copy
of its filter list from a static file hosted on GitHub. This is a one-way
download of a public data file. No information about you, your account, your
listening or your browsing is sent with it. The file contains no executable
code; it is parsed as data and used only for lookups. As with any web request,
GitHub's servers receive your IP address. We receive nothing and store nothing.

NoAI does not detect, block, mute, or skip advertisements.

NoAI is not affiliated with, endorsed by, or connected to Spotify.

## 2. If you are an artist on the list

### What is processed, and on what basis

NoAI distributes a list of artist names and Spotify artist identifiers that
community-maintained sources have **reported** as producing AI-generated music.
Artist names are personal data where the artist is an identifiable natural
person.

- **Controller:** an individual, reachable at the address below. Identity disclosed on request to a data subject or a supervisory authority.
- **Contact:** noAI@h1tmakers.com
- **Source of the data:** the list is not compiled by us. It comes from
  [CennoxX/spotify-ai-blocker](https://github.com/CennoxX/spotify-ai-blocker)
  (MIT), which accepts public submissions. See [ATTRIBUTION.md](ATTRIBUTION.md).
- **Purpose:** to let listeners who do not want AI-generated music see which
  tracks have been reported as such, and optionally skip them.
- **Lawful basis:** legitimate interests, GDPR Art. 6(1)(f). Our assessment of
  that balance is published in full in [LIA.md](LIA.md) — including the reasons
  it could be decided the other way.
- **Retention:** entries are carried only for as long as they appear in the
  upstream source and are not on our retraction list.

### These lists are reports, not findings

They are hand-curated by volunteers from public submissions. They contain
mistakes. NoAI is built on that assumption rather than against it:

- the default is to **dim** flagged tracks, not hide them
- **auto-skip is off** unless the user turns it on
- every user can permanently allowlist any artist
- the wording is always "reported as AI-generated", never "confirmed"

### Your rights

You can ask us to **remove you from the list** (rectification, Art. 16, and
erasure, Art. 17), or **object to the processing** (Art. 21). Write to
noAI@h1tmakers.com or open an issue at https://github.com/JayDK2/noai/issues.

We will remove you. We will not ask you to prove anything or argue the point.
Removals are added to a retraction list we control, and propagate to every
installation within six hours. We do not depend on the upstream source acting.

Please also consider asking the upstream source to correct its own copy, since
other projects use it — but that is not a condition for us removing you.

### Art. 14 notice

We obtained this data from a public third-party source, not from you. Notifying
each of the thousands of people named individually is not possible with the
information we hold — no contact details are included in the source data. Under
Art. 14(5)(b) we therefore make this information publicly available instead,
which is what this page is. It is published at a public URL, linked from the
Chrome Web Store listing and from the extension itself, so that it can be found
without installing anything.

You have the right to complain to a supervisory authority. In Denmark that is
Datatilsynet, https://www.datatilsynet.dk.
