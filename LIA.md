# Legitimate interests assessment

Required because NoAI processes personal data under GDPR Art. 6(1)(f). Written
before publication, kept current, and published rather than filed — an
assessment nobody can read is not much of a safeguard.

**Two datasets with different consequences, so two assessments.** Merging them
into one abstract argument would be weaker evidence than two concrete ones.

Last revised when the YouTube dataset and Content Credentials were added.

---

## A. Spotify artist identifiers

### A1. Purpose test — is there a legitimate interest?

Yes. A growing share of music on streaming platforms is machine-generated, and
listeners have no way to filter it: Spotify ships labels on some AI content but
no setting that acts on them. Wanting to know what you are listening to is a
legitimate interest, and it is shared by the users who install this — it is not
merely our own. No payment, no advertising, no data collection.

### A2. Necessity test — is the processing necessary?

Yes, and the shipped implementation is the minimum that works.

**We ship identifiers only.** `blocklist.json` contains 7,685 Spotify artist
IDs and **no names**. Names appear on a user's screen only because Spotify's own
pages put them there. Filtering cannot be done with less than an identifier, so
this is the floor: Art. 5(1)(c) data minimisation is satisfied not as an
aspiration but as a fact about the artifact.

*(An earlier draft of this assessment argued that names had to ship so users
could read their allowlist. They do not: the extension reads names off the page
at the moment it needs them. That draft described a design we did not build, and
this section is corrected to describe the one we did.)*

### A3. Balancing test — do the artists' rights override it?

**Against us:**

- The claim is a statement of fact, not opinion, and it is unflattering.
- The source is volunteer-curated and imperfect. Soul Over AI's own published
  data recorded no disclosure of AI use for 70 % of its entries and full
  disclosure for 1.5 %. That gradient does not survive into the identifier-only
  list we consume, so we cannot express confidence per artist — a real weakness,
  and the reason the wording never claims more than "reported".
- Artists did not consent and would not expect it.
- Being filtered out of a listener's results has economic consequence.

**For us:**

- The data is already public; the upstream lists are open repositories.
- The default action is the mildest available: dimmed, still visible, still
  playable. Nothing is skipped unless the user deliberately turns skipping on.
- Any user can override any entry permanently.
- We hold no names.
- Removal on request is unconditional, needs no proof, is implemented in a
  retraction list under our own control, and reaches all installations within
  six hours without the upstream maintainer's cooperation.
- No profiling, no automated decision with legal effect, no combination with
  other data.
- **Anyone can check their own status without contacting us and without trusting
  us.** The extension answers "is this artist on a list, and which tier" from the
  copy already on the user's machine. A safeguard that costs the data subject
  nothing and requires no cooperation from the controller is worth more than one
  that depends on us answering an email, and it sits alongside — not instead of —
  the right of access.

**Conclusion:** not overridden — but only because of the safeguards. Remove
dim-by-default, or the allowlist, or unconditional removal, and it tips. They
are not features that can be traded later for a better-performing filter.

---

## B. YouTube channel handles

### B1. Purpose test

The same interest, on the platform where machine-generated content has grown
fastest. Same non-commercial posture.

### B2. Necessity test

A handle is the only identifier YouTube exposes in its own markup, so filtering
cannot be done with less. As with Spotify, this is the floor rather than a
choice. 22,014 handles: 21,075 blocklist, 939 warnlist.

A handle is pseudonymous, but it singles out an account and is usually linkable
to a person. Some belong to companies, which GDPR does not cover — we cannot
cheaply tell which, and guessing wrong is the expensive direction, so **all
entries are treated as personal data.**

### B3. Balancing test

**Two things make this balance easier than the Spotify one:**

- **The consequence is milder.** A dimmed video in a feed is still there and
  still clickable. A viewer scrolls past it. That is less economically
  consequential than filtering an artist out of someone's music library.
- **The confidence gradient survives here, and it is expressed in the
  architecture.** The source keeps a high-confidence blocklist and a
  medium-confidence warnlist apart, and so do we: the 939 warnlist channels are
  **never dimmed and never hidden** — they carry a small marker and nothing
  else. Where the two lists disagree, the milder tier wins. This is
  proportionality built into the product rather than promised in a document, and
  it is the single strongest argument in this assessment.

**One thing makes it harder:** the inclusion criteria are more subjective than
for music. The source lists channels that "heavily rely on automation with
minimal human creativity" or "mass-produce content using AI tools". Those are
editorial judgements, not verifiable facts. Our "reported, never confirmed"
wording therefore carries more weight here than on the Spotify side, and the
warn tier does real work.

**Conclusion:** not overridden. The two-tier treatment is load-bearing. If it
were ever collapsed into one, this assessment would have to be redone and would
probably come out differently for the 939.

---

## C. Content Credentials

**No assessment needed, and it is worth saying why.** This feature processes no
personal data about anyone. It reads what a file declares about itself. There is
no data subject, no accusation by any person, nothing to retract. It is the only
signal in the product that is not somebody's opinion about somebody else.

---

## D. Art. 35 screening — is a DPIA required?

Recorded because "we never considered it" is the losing answer.

| Art. 35(3) trigger | Present? |
|---|---|
| Systematic and extensive automated evaluation of personal aspects, with legal or similarly significant effects | **No.** No profiling of individuals. Dimming a track or video is not a legal or similarly significant effect. |
| Large-scale processing of Art. 9 special-category data | **No.** "Reported as using AI" is none of the exhaustive Art. 9 categories. |
| Systematic monitoring of a publicly accessible area on a large scale | **No.** Nothing is monitored; a static list is redistributed. |

**Conclusion: no DPIA required.** The scale — roughly 29,000 data subjects — is
what makes recording this screening worthwhile despite none of the triggers
being met. **Reassess if** user-submitted reporting is ever built, since that
would make us the originator of the accusations rather than a redistributor.

---

## D2. Site rules

The extension contains a mechanism for marking content that a platform has itself
labelled AI, driven by selectors delivered as data. Two constraints keep it inside
this assessment rather than opening a new one:

- **The hosts are fixed in the reviewed build.** A rule may only supply selectors
  for a site already named in the shipped code; a rule naming any other host is
  discarded. The delivered file cannot extend the extension to a new platform.
- **It marks a platform's own declaration.** No person is named and no list of
  individuals is involved, so there is no new category of data subject.

If either constraint is ever relaxed — particularly if hosts become data — this
assessment must be re-run, because the extension would then be able to act on
sites and content that were never assessed.

## E. Review triggers

Reassess if: a default becomes hide or auto-skip; either two-tier treatment is
collapsed; a source is added that is not open and correctable; user-submitted
reporting is built; the volume of removal requests suggests a systematic
accuracy problem; or a supervisory authority takes a view.
