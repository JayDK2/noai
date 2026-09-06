# Chrome Web Store listing

**Name:** NoAI — AI Music Filter

**Short description** (must match actual default behaviour — the default dims,
it does not remove):

> Dims or filters tracks reported as AI-generated on the Spotify web player, using a community-maintained list.

**Permission justifications**

- `storage` — Stores your settings, your allowlist and the filter list on your own device. Nothing is transmitted.
- `alarms` — Schedules the six-hourly filter-list update. A service worker cannot keep a timer alive without it.
- `host_permissions` (raw.githubusercontent.com, one repository path) — Used to download a plain-text data file (a list of artist identifiers) so the filter list stays current. The file contains no executable code. It is parsed with JSON.parse and used only as lookup data. The extension never evaluates, injects, or executes downloaded content.

**Single purpose:** One filter, applied at two surfaces — the track listings and
the player. Nothing else.

**Data collection:** None. Complete the privacy tab affirming no collection.
Note the six-hourly download in the privacy policy: it discloses the user's IP
to GitHub, as any web request does.

**Do not:** put "Spotify" in the extension name; repeat "Spotify" across
localised descriptions (Blockify was removed for keyword density); use Spotify
green (#1DB954), circles or wave motifs in the icon.

## Added in 0.4.0

- `scripting` — Used only to register the image-scanning content script after the
  user grants the optional site permission, and to unregister it when they turn
  the feature off. It injects one bundled script; nothing is downloaded or evaluated.
- `<all_urls>` is an **optional** permission, not requested at install. The default
  installation asks only for Spotify Web and YouTube. The user grants site access
  from the popup when enabling Content Credentials, and revoking it switches the
  feature off automatically.

Single purpose is unchanged: one filter for content reported or declared as
AI-generated, applied where the user browses.
