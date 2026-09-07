# Chrome Web Store listing

**Name:** NoAI — AI Content Filter

**Short description** (must match actual default behaviour — the default dims,
it does not remove):

> Dims tracks and videos reported as AI-generated on Spotify Web and YouTube, and marks images whose own file declares they were made with AI.

**Permission justifications**

- `storage` — Stores your settings, your allowlist and the filter list on your own device. Nothing is transmitted.
- `alarms` — Schedules the six-hourly filter-list update. A service worker cannot keep a timer alive without it.
- `host_permissions` (raw.githubusercontent.com, one repository path) — Used to download a plain-text data file (a list of artist identifiers) so the filter list stays current. The file contains no executable code. It is parsed with JSON.parse and used only as lookup data. The extension never evaluates, injects, or executes downloaded content.

**Single purpose:** one filter for content reported or declared as AI-generated,
applied where the user browses. That formulation survives all three signals;
"two surfaces" did not, and a self-contradicting single-purpose claim gets
resolved against you.

**Data collection: YES — this must be declared. Do not certify "none".**

Chrome Web Store defines "handling" user data as collecting, transmitting, using
OR sharing it, and requires disclosure "even when data is processed or stored
locally on a user's device and is not transmitted to external servers". Their
definition of *web browsing activity* covers "the domains or URLs the browser
interacts with". The Content Credentials feature reads image URLs on pages the
user visits, so it handles web browsing activity — locally, but that is beside
the point for disclosure.

On the privacy tab:
- Tick **web browsing activity**.
- Certify: not sold to third parties; not used for any purpose unrelated to the
  single purpose; not used for creditworthiness or lending.

Limited Use permits this only for "a user-facing feature described prominently
in the Product's Chrome Web Store page", so the description below is not
optional — it is what makes the feature permissible.

**Prominent description — must appear in the store listing:**

> **Content Credentials (optional, off by default).** If you turn this on, NoAI
> asks permission to run on the sites you visit and reads the first 256 KB of
> images there to check whether the file itself declares it was AI-generated.
> This happens entirely on your device — no image, URL, or page address is ever
> sent anywhere, and there is no server. Turning the feature off removes the
> permission again.

Also disclose the six-hourly list download: it reveals the user's IP to GitHub,
as any web request does.

**Do not:** put "Spotify" in the extension name; repeat "Spotify" across
localised descriptions (Blockify was removed for keyword density); use Spotify
green (#1DB954), circles or wave motifs in the icon.

## Permissions added after 0.3

- `scripting` — Used only to register the image-scanning content script after the
  user grants the optional site permission, and to unregister it when they turn
  the feature off. It injects one bundled script; nothing is downloaded or evaluated.
- `<all_urls>` is an **optional** permission, not requested at install. The default
  installation asks only for Spotify Web and YouTube. The user grants site access
  from the popup when enabling Content Credentials, and revoking it switches the
  feature off automatically.

Single purpose is unchanged: one filter for content reported or declared as
AI-generated, applied where the user browses.

## Privacy policy URL (required field)

https://h1tmakers.com/noai/privacy.html

Hosted as a plain web page on a domain the author controls, not as a file in the
repository. A markdown blob in a git repo is technically public but not findable:
an artist searching for their own name will never land on it, and Art. 14(5)(b)
asks for information the data subject can actually reach. The repository copy
remains the source the page is generated from.

## Site rules — what a reviewer needs to know

The extension fetches `rules.json` from the same repository path as its filter lists.
A rule contains only: a list of hostnames, a CSS container selector, a CSS signal
selector, a tier, and a label *key*. The key selects one of four label strings
bundled in the extension; the fetched file cannot supply its own text.

**This is data, not remotely hosted code.** The extension never evaluates fetched
content. It calls `JSON.parse`, discards anything that does not match the exact
expected shape, and the only operations a rule can cause are `classList.toggle` and
setting `textContent` on an element the extension creates. There is no expression
language, no callbacks, no dynamic import, no `eval`, no `new Function`.

The purpose is the same as an ad blocker's filter lists: platform selectors change
frequently, and a two-week review cycle is the wrong mechanism for keeping a
cosmetic filter working. It also lets a broken selector be fixed in hours rather
than weeks, which is a user-protection measure as much as a convenience.

The feature is off by default and requires the user to grant site access.

## Permissions — complete list as of 0.8.1

- `storage` — Settings, allowlist, watchlist and the filter lists, on the user's own device. Nothing is transmitted.
- `alarms` — Schedules the six-hourly filter-list update. A service worker cannot keep a timer alive without it.
- `scripting` — Registers the image-scanning content script after the user grants the optional site permission, and unregisters it when they turn the feature off. It injects one bundled script; nothing is downloaded or evaluated.
- `contextMenus` — Adds two right-click entries on a track or channel link: allowlist it, or report a mistake. No page content is read and nothing is transmitted.
- `notifications` (**optional**, in `optional_permissions`) — Not requested at install. Asked for the first time the user puts an artist or channel on their watchlist. Shows a local notification when a watched entry is added to or removed from a filter list. Generated on the device from the list already downloaded; no server is involved and nothing is sent.
- `host_permissions` (one repository path on raw.githubusercontent.com) — Downloads the filter lists. Plain data, parsed with JSON.parse, never evaluated.
- `optional_host_permissions` (`<all_urls>`) — **Not requested at install.** Granted by the user from the popup when they enable Content Credentials, and removed when they turn it off. Used to read the first 256 KB of images to see whether the file itself declares AI generation.

**Single purpose, one formulation covering every surface:** one filter for content
reported or declared as AI-generated, applied where the user browses. The lists,
the image check and the counters all serve that one job; the watchlist and the
right-click entries are how a user corrects and follows it.

## Site rules — not enabled in this release

The build contains a mechanism for marking content a platform has labelled AI
itself, driven by selectors delivered as data. **It is inert in this release:** the
list of sites it may run on is fixed in this build and is empty, so it fetches
nothing, registers no content script, and shows no control. A delivered rule can
never introduce a site — a rule naming a host that is not in the shipped list is
discarded exactly like a malformed one. Selectors change; the scope does not.
