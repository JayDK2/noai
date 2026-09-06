# Chrome Web Store listing

**Name:** NoAI — AI Content Filter

**Short description** (must match actual default behaviour — the default dims,
it does not remove):

> Dims tracks and videos reported as AI-generated on Spotify Web and YouTube, and marks images that declare AI in their own file.

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

## Privacy policy URL (required field)

https://h1tmakers.com/noai/privacy.html

Hosted as a plain web page on a domain the author controls, not as a file in the
repository. A markdown blob in a git repo is technically public but not findable:
an artist searching for their own name will never land on it, and Art. 14(5)(b)
asks for information the data subject can actually reach. The repository copy
remains the source the page is generated from.
