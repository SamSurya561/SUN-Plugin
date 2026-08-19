# Sun Plugin — Development Asset Sources

> **Status:** Research report, revision 1 — 2026-08-19
> **Scope:** Temporary *development-only* asset acquisition. Nothing in this document
> describes a core dependency of Sun Plugin. The Development Asset Ingestor is a
> removable subsystem (see `docs/DEVELOPMENT-ASSET-PLAN.md`, section "Removability").

---

## 0. How to read this document

Every source is classified with the vocabulary required by the spec:

| Tag | Meaning |
|---|---|
| `FREE` | No payment required |
| `PUBLIC DOMAIN` | CC0 / PD / expired copyright |
| `OPEN LICENSE` | CC-BY, CC-BY-SA, MIT, Apache-2.0, GPL, etc. |
| `API AVAILABLE` | Documented, official, machine-readable endpoint |
| `MANUAL DOWNLOAD` | A human must click through the site |
| `AUTOMATION POSSIBLE` | Automated fetch is permitted by the terms of the source |
| `AUTOMATION NOT AVAILABLE` | Terms forbid it, or no mechanism exists without circumvention |
| `LICENSE UNKNOWN` | Per-asset license is not machine-determinable |

**Hard rule enforced in code:** the ingestor refuses to auto-download from any source
tagged `AUTOMATION NOT AVAILABLE` or `LICENSE UNKNOWN`. Those sources are reduced to
`OPEN SOURCE PAGE` → `DOWNLOAD MANUALLY` → `IMPORT INTO TOOLKIT`.

---

## 1. Headline finding (read this before anything else)

**There is no legitimate bulk-download source for `.mogrt` files, Premiere `.prfpset`
presets, or caption/title templates.**

This is not a technical obstacle that better engineering solves. Every large free
MOGRT library (Mixkit, Motion Array, Enchanted Media, the Envato free tier, AEJuice
free packs) distributes under a **proprietary "free license"**, not CC0 or CC-BY.
Those licenses grant a human a personal-use download. They do not grant automated
retrieval, and several explicitly prohibit systematic copying. The Pexels terms are
the clearest statement of the pattern: bulk, large-scale or systematic copying of
content is strictly prohibited without explicit permission.

So a scrape-everything approach fails on category coverage no matter how it is built.
The categories where open bulk acquisition genuinely works are **audio, images,
public-domain video, and text-format data (LUTs)**. Everything else comes from one of
three places:

1. **Manual download then import** — the human clicks, the toolkit ingests. Legal, slow.
2. **Procedural generation** — we author the file. Legal, unlimited, and for `.cube`
   LUTs it produces *genuinely usable output*, not a placeholder.
3. **The existing owned library** — packs already licensed and already on disk.

Note: `C:\Users\SURYA\Documents\AEJuice` already exists on this machine. That is a
real, already-licensed asset library and is a better test corpus than anything
downloadable. The Local Scanner treats it as a first-class import target.

---

## 2. Recommended sources, tier 1 (automation permitted, license machine-readable)

### 2.1 Openverse

- **URL:** `https://api.openverse.org/v1/` — docs `https://docs.openverse.org/`
- **Categories:** SFX, music, ambience, images, backgrounds, textures, grain plates
- **Obtained via:** Official REST API. `GET /v1/images/?q=&license=cc0` and
  `/v1/audio/`. Anonymous access is rate-limited; a free client-credentials key
  raises the limit.
- **License:** Per-result and machine-readable (`license`, `license_version`,
  `license_url`, `attribution`). Filterable to `cc0` / `pdm` exactly.
- **Automation:** `AUTOMATION POSSIBLE`. This is an open API run by WordPress/Creative
  Commons explicitly for programmatic reuse. Aggregates 800M+ works from Flickr,
  Wikimedia, Europeana, Jamendo, Freesound and others.
- **Tags:** `FREE` `PUBLIC DOMAIN` `OPEN LICENSE` `API AVAILABLE` `AUTOMATION POSSIBLE`
- **Status:** **Enabled.** Primary discovery surface. Filter locked to `cc0,pdm,by`.
- **Notes:** Because it aggregates, one asset can appear twice from two providers.
  The content-hash dedupe in the scanner matters here.

### 2.2 Internet Archive

- **URL:** `https://archive.org` — metadata `https://archive.org/metadata/{id}` —
  search `https://archive.org/services/search/v1/scrape`
- **Categories:** Film grain, film burns, light leaks, public-domain footage,
  backgrounds, ambience, archival music, the Prelinger collection
- **Obtained via:** Scrape/AdvancedSearch API for discovery, then `/metadata/{id}` for
  the file manifest, then direct `https://archive.org/download/{id}/{file}` for bytes.
- **License:** Per item. Collections such as `prelinger` and items marked
  `publicdomain` / `CC0` are safe, but **many items are `LICENSE UNKNOWN`**. The
  ingestor filters on the `licenseurl` / `rights` metadata field, never on the
  collection name alone.
- **Automation:** `AUTOMATION POSSIBLE` for PD-marked items, with polite throttling.
  Sorted paging caps at 10,000 results; use the scrape cursor beyond that.
- **Tags:** `FREE` `PUBLIC DOMAIN` `API AVAILABLE` `AUTOMATION POSSIBLE`
- **Status:** **Enabled**, restricted to items with an explicit PD/CC0/CC-BY rights field.
- **Notes:** Best single source for authentic film-burn, grain and leak plates,
  because real scanned public-domain film is exactly that material.

### 2.3 Wikimedia Commons

- **URL:** `https://commons.wikimedia.org/w/api.php`
- **Categories:** Backgrounds, textures, images, PD video, some SFX
- **Obtained via:** MediaWiki Action API
  (`action=query&generator=search&prop=imageinfo`). `extmetadata` carries
  `LicenseShortName`, `UsageTerms`, `Artist`, `Credit`.
- **License:** Machine-readable per file. Filter to PD / CC0 / CC-BY.
- **Automation:** `AUTOMATION POSSIBLE`, **conditional on** sending a descriptive
  `User-Agent` naming the app and a contact address, per the Wikimedia UA policy. A
  generic or absent UA is a policy violation and gets blocked.
- **Tags:** `FREE` `PUBLIC DOMAIN` `OPEN LICENSE` `API AVAILABLE` `AUTOMATION POSSIBLE`
- **Status:** **Enabled**, UA string mandatory and enforced by the adapter.

### 2.4 GitHub (open-license repositories)

- **URL:** `https://api.github.com`
- **Categories:** LUTs (`.cube`), SFX packs, overlay sets, tooling, format references
- **Obtained via:** REST API — repo search, `GET /repos/{o}/{r}/license`,
  `GET /repos/{o}/{r}/git/trees/{sha}?recursive=1`, then raw blob download.
- **License:** Repo-level SPDX id from the license endpoint. **Reject anything the API
  reports as `NOASSERTION`** — that is `LICENSE UNKNOWN`.
- **Automation:** `AUTOMATION POSSIBLE`. Unauthenticated 60 req/h; a user PAT 5000 req/h.
- **Tags:** `FREE` `OPEN LICENSE` `API AVAILABLE` `AUTOMATION POSSIBLE`
- **Status:** **Enabled**, allowlisted SPDX ids only
  (`CC0-1.0`, `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `Unlicense`, `CC-BY-4.0`).
- **Research note:** Searching for LUT repositories returns overwhelmingly
  *generators* (`lutgen-rs`, `lut-maker`, `myLUT`, `smol-cube`, `apply-cube-lut`)
  rather than LUT *collections*. This is the strongest argument for procedural LUT
  generation: the open-source community solved this by generating, not redistributing.

### 2.5 Freesound

- **URL:** `https://freesound.org/docs/api/`
- **Categories:** SFX, whooshes, impacts, risers, downers, UI sounds, ambience
- **Obtained via:** APIv2. Search and metadata work with a **token**; downloading the
  original-quality file requires **OAuth2 as the logged-in user**. Lossy previews are
  retrievable with the token alone.
- **License:** Per sound, filterable — `filter=license:"Creative Commons 0"`.
- **Automation:** `AUTOMATION POSSIBLE` **only under the OAuth grant of the user.**
  That is the user authenticating themselves, not a bypass. With no connected account
  the adapter degrades to preview-only plus open-in-browser.
- **Tags:** `FREE` `PUBLIC DOMAIN` `OPEN LICENSE` `API AVAILABLE` `AUTOMATION POSSIBLE (user-auth)`
- **Status:** **Enabled in registry, disabled until the user supplies credentials.**
- **Notes:** Deepest CC0 SFX catalogue that exists, worth the OAuth setup. Fetching
  originals without a token is a restriction we honour, not one we work around.

### 2.6 Procedural Generator (local, not a website)

- **URL:** n/a — `src/dev-ingestor/generator/`
- **Categories:** LUTs, SFX, overlays, grain, backgrounds, MOGRT-shaped fixtures, presets
- **Obtained via:** We author the files.
- **License:** Ours. Emitted as `CC0-1.0`, `source: "synthetic"`.
- **Automation:** Trivially permitted.
- **Tags:** `FREE` `PUBLIC DOMAIN` `AUTOMATION POSSIBLE`
- **Status:** **Enabled. Primary volume source.**
- **Notes:** `.cube` is a documented plain-text format and `.wav` is a documented
  binary container, so generated output in those two formats is **real and usable in
  Premiere**, not a placeholder. Generated `.mogrt` / `.prfpset` fixtures are
  structurally valid archives for UI and index testing but are **not** functional
  templates; they are flagged `syntheticFixture: true` so they can never be mistaken
  for real ones.

---

## 3. Tier 2, permitted with hard throttling

### 3.1 Pixabay

- **URL:** `https://pixabay.com/api/docs/`
- **Categories:** Video overlays, backgrounds, images, music, SFX
- **License:** Pixabay Content License (not CC0 since 2019). Free commercial use, no
  attribution required; **redistribution of the asset as-is is prohibited.**
- **Automation:** `AUTOMATION POSSIBLE — CONSTRAINED`. The terms state the API is for
  real human requests, **systematic mass download is not allowed**, roughly 100 req per
  60s, responses **must be cached 24h**, and hotlinking is forbidden.
- **Tags:** `FREE` `API AVAILABLE` `AUTOMATION POSSIBLE (throttled)`
- **Status:** **Enabled, hard-capped at 50 assets per category per session**, 24h
  response cache enforced by the adapter, user-initiated per-item selection only. No
  crawl-everything mode is exposed for this source.
- **Redistribution:** **No.** Development-local use only. Never ship.

---

## 4. Tier 3, manual only (`OPEN SOURCE PAGE` → `DOWNLOAD` → `IMPORT`)

These are real, good sources. The toolkit links to them and ingests what the user
downloads. It does not fetch from them.

| Source | Categories | Why manual |
|---|---|---|
| **Mixkit** (mixkit.co) | MOGRT, titles, transitions, SFX, music, stock video | Proprietary Mixkit License. Free to a human, silent on automation, so treated as prohibited. Roughly 442 free Premiere templates. |
| **Motion Array free tier** | MOGRT, transitions, presets, titles | Account required; free-tier terms are per user. |
| **Pexels** | Video overlays, backgrounds, stock footage | Terms **explicitly prohibit** bulk and systematic copying and scraping. `AUTOMATION NOT AVAILABLE`. |
| **Enchanted Media** | MOGRT, lower thirds, logo reveals | Proprietary free license, no API. |
| **Envato Elements free files** | Mixed | Account plus per-item license grant. |
| **AEJuice free packs** | Transitions, overlays, SFX | Installer-delivered; already present locally on this machine. |
| **Adobe Stock free collection** | MOGRT, footage | Adobe account plus per-asset license. |
| **Creator sites, YouTube description packs** | Everything | `LICENSE UNKNOWN` by default. Human judgement required. |

For every row above the ingestor exposes exactly three actions: `OPEN SOURCE PAGE`,
then after the human downloads, `IMPORT FILE / FOLDER / ZIP`.

---

## 5. Explicitly excluded

Not registered, not linkable as a source, not supported:

- Anything requiring a paywall, DRM, CAPTCHA, anti-bot or auth bypass.
- Sites whose robots.txt or terms disallow the access pattern.
- Free-download aggregator and mirror sites redistributing paid packs (Motion Array
  and Envato leak mirrors, free-download template blogs). These redistribute other
  people's licensed work: `LICENSE UNKNOWN` at best, infringing at worst.
- Torrent and direct-download-link aggregators.
- YouTube and Vimeo rips.

---

## 6. Category coverage matrix

Realistic assessment of what each category can be filled with.
`A` = automated source, `G` = generator, `M` = manual import.

| Category | A | G | M | Realistic dev-library plan |
|---|:-:|:-:|:-:|---|
| MOGRT | ✗ | ~ | ✓ | Synthetic fixtures for index/UI scale; real ones hand-imported |
| Titles | ✗ | ~ | ✓ | As MOGRT |
| Lower thirds | ✗ | ~ | ✓ | As MOGRT |
| Captions | ✗ | ✓ | ✓ | Generator emits real `.srt`/`.vtt`; styled templates manual |
| Kinetic typography | ✗ | ~ | ✓ | Manual |
| Transitions | ✗ | ~ | ✓ | Fixtures plus manual; some are only `.prfpset` |
| SFX, whoosh, impact, riser, downer, UI | ✓ | ✓ | ✓ | **Strong.** Freesound plus Openverse plus generator |
| Ambience | ✓ | ✓ | ✓ | Openverse plus Archive.org plus generated noise beds |
| Music | ✓ | ✗ | ✓ | Openverse (Jamendo CC) plus Archive.org |
| LUTs | ~ | ✓ | ✓ | **Generator produces real, working `.cube` files** |
| Color presets | ✗ | ✓ | ✓ | Generated `.cube`; `.prfpset` manual |
| Premiere presets | ✗ | ~ | ✓ | Manual only |
| Overlays | ✓ | ✓ | ✓ | Archive.org PD film plus generated PNG and sequences |
| Film burns | ✓ | ✓ | ✓ | Archive.org PD film scans |
| Light leaks | ~ | ✓ | ✓ | Generated gradients plus PD film |
| Film grain | ✓ | ✓ | ✓ | Archive.org plus generated noise |
| Backgrounds | ✓ | ✓ | ✓ | Openverse and Commons plus generated gradients |
| Motion graphics | ✗ | ~ | ✓ | Manual |
| Video overlays | ~ | ✓ | ✓ | Archive.org plus generated |
| Guides | ✗ | ✓ | ✗ | Generated safe-area, thirds and title-safe overlays |
| Templates | ✗ | ~ | ✓ | Manual |

Reading of this matrix: **the automated web sources realistically fill audio, images
and public-domain video. The generator fills LUTs, guides, captions and bulk scale.
Everything Premiere-template-shaped is a manual-import workflow.** That is the honest
shape of the problem, and the architecture is built around it rather than pretending
otherwise.

---

## 7. Platform research, what the host actually allows

Findings that constrain the ingestor design.

### 7.1 Adobe UXP for Premiere Pro

- UXP extensibility shipped officially in **Premiere Pro 25.6**, and the API is
  approaching CEP/ExtendScript parity. ExtendScript remains supported through
  **September 2026**, so a CEP fallback adapter is still worth having, and the
  `PremiereAdapter` interface is written to serve both.
- Entry point: `app.Project.getActiveProject()`, `project.getActiveSequence()`.
  **All method calls are async; properties are sync.**

### 7.2 Filesystem

- Two APIs: `uxp.storage.localFileSystem` (Entry-based) and `require("fs")`
  (Node-style, path-based).
- `manifest.json` v5 `requiredPermissions.localFileSystem` accepts `"plugin"`
  (sandbox only, the default), `"request"` (picker-mediated), `"fullAccess"`.
- **Design decision: request `"request"`, not `"fullAccess"`.** The user picks the
  DevelopmentLibrary folder once, and we hold a **persistent token** in `localStorage`
  which survives until uninstall. Least privilege, and it avoids the consent friction
  of `fullAccess`.
- `plugin-temp:/` exists but is **transitory and can be cleared at any time**.
  Downloads stage there and must be promoted into the library immediately, never left.
- Even with `fullAccess`, OS policy can still deny a path. Every filesystem call needs
  real error handling, not optimism.

### 7.3 Network

- `fetch`, `XMLHttpRequest` and `WebSocket` are all in UXP global scope.
- `manifest.json` v5 requires **domain allowlisting**:
  `requiredPermissions.network.domains: ["https://api.openverse.org", ...]`.
  **Consequence: a source cannot be added purely at runtime from
  `config/development-sources.json`; its domain must also be in the manifest.** The
  registry validates this and marks unlisted domains as blocked rather than failing
  with an opaque fetch error. The production manifest ships with an **empty** domains
  array.
- Binary download pattern: `fetch` → `arrayBuffer()` → `new Uint8Array()` →
  `file.write(data, { format: formats.binary })`.

### 7.4 MOGRT import

- ExtendScript surface: `isMGT()`, `importMGT()`, `getMGTComponent()`,
  `importMotionGraphicsTemplate()` (imports to a specified track at a specified time).
- UXP equivalents are still filling in, so the adapter abstracts this and the CEP path
  can carry MOGRT insertion while UXP catches up.
- Known gap: **drag-and-drop from a panel to the timeline is not exposed** to CEP or
  UXP panels. The UX must therefore be *select then insert at playhead*, not drag.
  This is a real constraint on the Asset Browser design.

### 7.5 ZIP

- No ZIP support is built into UXP. Handled in-plugin with a bundled pure-JS inflate,
  which is also why ZIP entry validation is ours to enforce (see the ZIP safety section
  of the plan document).

---

## 8. Source registry mapping

Each entry in sections 2 and 3 maps to one record in
`config/development-sources.json` and one adapter class. See
`docs/DEVELOPMENT-ASSET-PLAN.md` section 4.

| Source | Adapter | Enabled by default |
|---|---|---|
| Openverse | `OpenverseAdapter` | yes |
| Internet Archive | `InternetArchiveAdapter` | yes |
| Wikimedia Commons | `WikimediaAdapter` | yes |
| GitHub | `GitHubAdapter` | yes |
| Freesound | `FreesoundAdapter` | no — needs user OAuth |
| Pixabay | `PixabayAdapter` | no — needs user API key |
| Procedural generator | `SyntheticAdapter` | yes |
| Direct URL (user-supplied) | `DirectUrlAdapter` | yes |
| Manual tier-3 sites | `ManualSourceAdapter` | yes (link-out only) |

---

## 9. Revision log

| Date | Change |
|---|---|
| 2026-08-19 | Initial research. Nine sources classified, eight tier-3 manual sources catalogued, UXP platform constraints recorded. |
