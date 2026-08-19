# Sun Plugin — Development Asset Plan

> Companion to `docs/DEVELOPMENT-ASSET-SOURCES.md`.
> Revision 1 — 2026-08-19.

---

## 1. The one architectural principle

> **The core application must not care where an asset came from.**

Everything below exists to protect that sentence. An asset is a row in the database
with a file beside it. Whether that file arrived from Openverse, from a generator,
from a ZIP the user downloaded, or from a pack the user bought in 2023 changes exactly
one thing: the value of its `source` field. No other code branches on it.

The practical test: **deleting `src/dev-ingestor/` entirely must leave a working
plugin.** That is enforced by a lint rule, not by good intentions (section 9).

---

## 2. Layer map

```
                       SUN PLUGIN CORE
                              |
              +---------------+---------------+
              |                               |
        LOCAL LIBRARY                DEVELOPMENT INGESTOR
     (permanent, offline)              (temporary, removable)
              |                               |
              |                    +----------+----------+
              |                    |                     |
              |              ONLINE SOURCES        USER SOURCES
              |                    |                     |
              |               DISCOVERY               IMPORT
              |                    |                     |
              +--------------------+---------------------+
                                   |
                            ASSET DATABASE
```

Dependency direction is **one-way and enforced**:

- `core/` may not import anything from `dev-ingestor/`.
- `dev-ingestor/` may import from `core/`.
- `adapters/` (Premiere host bridges) may import from `core/` only.

---

## 3. Directory layout

```
Sun Plugin/
├── manifest.json                 UXP manifest (v5)
├── CSXS/manifest.xml             CEP fallback manifest
├── config/
│   ├── development-sources.json  the source registry
│   └── categories.json           the category taxonomy (core, permanent)
├── docs/
├── assets/branding/              SUN logo + icon set
├── src/
│   ├── core/                     PERMANENT — never depends on dev-ingestor
│   │   ├── db/                   asset database, index, query
│   │   ├── library/              paths, collections, favorites, replace, migrate
│   │   ├── scanner/              local scan, hash, categorize, tag, thumbs
│   │   ├── importer/             user import: file / folder / zip
│   │   └── util/                 safe filenames, hashing, format detection
│   ├── dev-ingestor/             REMOVABLE — the whole subsystem
│   │   ├── registry.js           loads + validates development-sources.json
│   │   ├── adapters/             one adapter per source
│   │   ├── queue/                download queue
│   │   └── generator/            synthetic asset generation
│   ├── adapters/
│   │   ├── uxp/                  Premiere 25.6+ UXP bridge
│   │   └── cep/                  ExtendScript bridge (until Sept 2026)
│   └── ui/                       panel
└── tools/                        node CLIs for development
```

The library itself never lives here:

```
Documents/Sun Plugin/
├── DevelopmentLibrary/     <- temporary, deletable, developmentOnly: true
│   ├── MOGRT/  SFX/  Music/  Transitions/  LUTs/  Presets/
│   ├── Captions/  Overlays/  Effects/  Guides/  Templates/
├── Library/                <- the permanent personal library
├── db/sun-assets.json      <- the index
└── cache/thumbs/           <- generated thumbnails and previews
```

---

## 4. Source adapter architecture

One interface, many implementations. No god-scraper.

```js
class AssetSourceAdapter {
  async search(query, opts)          // -> DiscoveryResult[]
  async getMetadata(ref)             // -> raw source metadata
  getAssetPage(ref)                  // -> human-facing URL (always available)
  async getDownloadInformation(ref)  // -> { url, size, filename } | null
  async verifyLicense(ref)           // -> { allowed, spdx, url, attribution }
  async download(ref, destDir)       // -> { path, bytes, sha256 }
  normalizeMetadata(raw)             // -> AssetManifest
}
```

Contract rules every adapter obeys:

1. `verifyLicense()` runs **before** `download()`. Always. The queue enforces it;
   an adapter cannot opt out.
2. If `automationAllowed` is false for the source, `download()` throws
   `ManualOnlySourceError` and the UI falls back to `getAssetPage()`.
3. `getAssetPage()` is the only method that must never fail. Link-out is the universal
   fallback for every source in every state.
4. Adapters never execute downloaded content, and never follow a redirect to a
   different host without re-checking the domain allowlist.

Implementations: `OpenverseAdapter`, `InternetArchiveAdapter`, `WikimediaAdapter`,
`GitHubAdapter`, `FreesoundAdapter`, `PixabayAdapter`, `SyntheticAdapter`,
`DirectUrlAdapter`, `ManualSourceAdapter`.

### Acquisition types supported

| Type | Mechanism | Adapter |
|---|---|---|
| 1 | Official API | Openverse, Freesound, Pixabay, GitHub |
| 2 | Public download endpoint | Internet Archive, Wikimedia |
| 3 | Direct downloadable file | `DirectUrlAdapter` |
| 4 | Creator download page | `ManualSourceAdapter` (link-out) |
| 5 | GitHub repository | `GitHubAdapter` |
| 6 | User-provided URL | `DirectUrlAdapter` |
| 7 | Manual import | core importer, not an adapter at all |
| 8 | Browser-assisted discovery | `ManualSourceAdapter` + import watch folder |

---

## 5. What the ingestor will never do

Enforced in `queue/guards.js`, not left to adapter authors:

- No auth, paywall, DRM, CAPTCHA or anti-bot bypass.
- No credential harvesting or user impersonation.
- No access to private files.
- No exploitation of site vulnerabilities.
- No execution of downloaded code, ever — not scripts, not installers, not binaries.
- No download from a source tagged `LICENSE UNKNOWN` or `AUTOMATION NOT AVAILABLE`.

When a source blocks automation, the correct behaviour is to **stop automating that
source** and surface `OPEN SOURCE PAGE`. Not to retry harder.

---

## 6. Safety pipeline

Every byte that enters the library passes through this, regardless of adapter:

```
 fetch -> temp staging
   |
   +-- 1. safe filename      strip traversal, illegal Windows chars,
   |                         reserved device names (CON, PRN, AUX, NUL,
   |                         COM1-9, LPT1-9), length cap, dedupe suffix
   +-- 2. exists + size      non-zero, matches Content-Length if given
   +-- 3. extension allow    against the known-format table
   +-- 4. magic bytes        header must agree with the extension
   +-- 5. sha256             content hash, computed once, reused for dedupe
   +-- 6. zip audit          if archive: per-entry path + type + ratio checks
   +-- 7. quarantine         anything failing 3-6 goes to quarantine/, never library/
   |
 promote to library -> generate thumb/preview -> index
```

Indexing happens **only after** validation succeeds. A quarantined file is recorded in
the database as quarantined so the user can see why, but is never surfaced as an asset.

### ZIP handling

Permitted inside an archive: `.mogrt .prfpset .cube .look .wav .mp3 .aiff .flac .ogg
.mp4 .mov .mkv .webm .png .jpg .jpeg .webp .gif .srt .vtt .json .txt .md`.

Rejected, and the whole archive is quarantined: `.exe .dll .bat .cmd .com .msi .scr
.ps1 .vbs .vbe .js .jse .wsf .wsh .jar .sh .app .pkg .dmg .lnk .reg .cpl .hta`.

Also rejected: absolute paths, `..` traversal, symlinks, entries over the per-entry
size cap, and archives whose uncompressed-to-compressed ratio exceeds 200:1 (zip bomb).

Note `.mogrt` is itself a ZIP, so the audit recurses one level and no further.

---

## 7. Asset manifest

Every asset, from every origin, gets the same record:

```json
{
  "id": "dev-sfx-whoosh-001",
  "name": "Whoosh 001",
  "type": "sfx",
  "category": "audio",
  "subcategory": "whoosh",
  "file": "SFX/Whoosh/whoosh-001.wav",
  "thumbnail": "cache/thumbs/dev-sfx-whoosh-001.png",
  "preview": "cache/previews/dev-sfx-whoosh-001.mp3",
  "source": "openverse",
  "sourceUrl": "https://...",
  "author": "...",
  "license": "CC0-1.0",
  "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
  "attribution": "...",
  "downloadedAt": "2026-08-19T00:00:00.000Z",
  "developmentOnly": true,
  "sha256": "...",
  "bytes": 148238,
  "tags": ["whoosh", "transition", "swoosh", "air"],
  "favorite": false,
  "collections": []
}
```

Origin rules:

| Origin | `source` | `developmentOnly` |
|---|---|---|
| Online ingestor | source id | `true` |
| Synthetic generator | `synthetic` | `true` |
| User import | `user-import` | `false` unless the user ticks the box |
| Replaced dev asset | `user-import` | flipped to `false`, **id preserved** |

---

## 8. Categorization and tagging

Deterministic first. AI enrichment is a later, optional layer that may only *add*
tags, never overwrite.

**Path inference.** `/MOGRT/Cinematic/Titles/x.mogrt` yields type `mogrt`, category
`titles`, subcategory `cinematic`. `/SFX/Whoosh/y.wav` yields type `sfx`, category
`audio`, subcategory `whoosh`. Resolution order: explicit adapter metadata, then folder
path, then filename keywords, then extension default. Every inference records
`categoryConfidence` and `categorySource` so a low-confidence guess can be surfaced for
correction. User corrections are sticky and survive rescans.

**Tag extraction.** Split the filename on `_ - . camelCase digits`, lowercase, drop
stopwords and pure numbers, then union with folder segments, source keywords, and a
synonym table (`whoosh` implies `swoosh, transition, air`; `title` implies `text,
typography`). `Cinematic_Title_Heavy_Reveal.mogrt` yields `cinematic, title, heavy,
reveal, text, typography, motion`.

---

## 9. Removability, and how it is enforced

Production build:

```
core + local library + premiere adapter + asset browser + user import
```

Three mechanisms keep this true:

1. **Lint gate.** `tools/check-boundaries.mjs` fails if any file under `src/core/`
   or `src/adapters/` references `dev-ingestor`. Runs in `npm test`.
2. **Dynamic registration.** The ingestor registers itself into a core-owned
   `featureRegistry` at startup. Core queries the registry; it never imports the
   module. Absent module means absent feature, with no error.
3. **Build flag.** `SUN_DEV_ASSETS=0` drops the directory from the bundle and empties
   `requiredPermissions.network.domains` in the emitted manifest.

Deletion test, part of the test suite: remove `src/dev-ingestor/`, run the core suite,
everything must still pass.

---

## 10. Offline guarantee

With the network unplugged, these must work: search, browse, preview, thumbnails,
favorites, collections, tags, metadata editing, user import, MOGRT insertion, SFX
placement, LUT application, presets, transitions, guides, and every automation.

Nothing in `core/` performs network I/O. There is no lazy remote thumbnail, no remote
font, no telemetry ping, no license check. The index is a local file.

---

## 11. Development Asset Mode

A single setting, default OFF. When ON the panel reveals *Development Asset Tools*:
`Research Sources`, `Scan Sources`, `Discover Assets`, `Download Selected`,
`Import Downloaded Assets`, `Scan Local Library`, `Rebuild Index`.

When OFF, every one of those controls is hidden and the ingestor is not loaded.
Development assets stay visible in the browser but carry a `DEV` badge. Badge colour
is the amber from the Sun palette so it is legible without reading it.

---

## 12. Replace and migrate

**Replace asset.** Point an existing record at a new file. The `id` is preserved, so
favorites, collections, recents, and any workflow referencing it all survive. `source`
becomes `user-import`, `developmentOnly` becomes `false`, and the previous file hash is
kept in `replacedFrom` for audit. This is the mechanism by which the development
library becomes the real library one asset at a time.

**Migrate.** `EXPORT DEVELOPMENT LIBRARY METADATA` writes categories, tags,
collections, favorites and ratings without the files. `IMPORT FINAL LIBRARY` re-binds
that metadata onto a folder of personally owned assets, matching by hash first, then
filename, then fuzzy name, and reporting anything it could not match rather than
guessing.

---

## 13. Build status

| # | Item | State |
|---|---|---|
| 1 | Branding: SUN mark, SVG sources, 15 rasterised icons | done |
| 2 | Core: paths, database, safe filenames, format detection, hashing | done |
| 3 | Core: scanner, categorizer, tagger | done |
| 4 | Core: importer with ZIP audit | done |
| 5 | Ingestor: registry, adapter base, guards | done |
| 6 | Ingestor: nine adapters | done |
| 7 | Ingestor: download queue | done |
| 8 | Ingestor: procedural generator | done |
| 9 | Tools: CLI, tests, boundary check, preview server | done |
| 10 | UXP + production manifests, panel UI | done |
| 11 | Premiere bridges (UXP + CEP) | written, **not run against Premiere** |
| 12 | Virtualised grid at scale | done, verified at 12,788 assets |

### Verified

- **Round trip.** Generate 788 assets, rescan from disk, every asset id
  reproduced exactly, zero duplicates. This is what keeps favourites and
  collections attached across rescans.
- **Live acquisition.** Real downloads from the Internet Archive through the full
  path: discover, verify licence, guard the URL, fetch, validate, categorise,
  hash, thumbnail, index — with licence and attribution recorded.
- **Guards.** Refuses non-https, embedded credentials, undeclared domains,
  prohibited hosts, missing licences, and manual-only sources.
- **Removability.** `src/dev-ingestor/` deleted from a copy of the tree; the core
  starts, imports and searches, and the development mode switches itself off.
- **Scale.** 12,788 assets: index loads in 106 ms, text search 1.2 ms, facets
  6.7 ms, and the grid keeps ~56 cells in the DOM with sub-6 ms scroll jumps.
- **Generators.** Identity LUT is an exact pass-through; SFX are valid 48 kHz
  PCM; PNGs decode; MOGRT fixtures open in .NET `ZipFile`; SRT/VTT match the
  published grammar.

### Not verified

- **The Premiere bridges have not been run inside Premiere Pro.** They are
  written against the documented API surface and the UXP bridge probes for
  methods rather than assuming them, but insertion, LUT assignment and preset
  application need a real host to confirm.
- **The narrow-panel breakpoints** (560 px and 720 px) could not be exercised:
  the preview harness renders at a fixed 980 px regardless of the requested
  viewport. The media queries are standard and will apply in a docked panel, but
  they are untested.
- **Freesound and Pixabay adapters** are written but unexercised, because both
  require the user's own credentials.

### Next

1. Load the plugin in Premiere Pro 25.6+ and confirm the UXP bridge.
2. Confirm MOGRT insertion through the CEP bridge.
3. Connect Freesound (largest CC0 SFX catalogue) with a user OAuth grant.
4. Scan the existing local AEJuice library as a real-asset test corpus.

---

## 14. Success criteria mapped to implementation

| # | Criterion | Where |
|---|---|---|
| 1 | Search web for a category | `registry.js` + adapter `search()` |
| 2 | Discover sources | `config/development-sources.json` |
| 3 | View asset metadata | `normalizeMetadata()` |
| 4 | See source info | manifest `source` / `sourceUrl` |
| 5 | See license info | `verifyLicense()` |
| 6 | Select assets | discovery UI |
| 7 | Download via supported mechanisms | `queue/` |
| 8 | Store locally | `core/library/paths.js` |
| 9 | Auto-categorize | `core/scanner/categorize.js` |
| 10 | Thumbnails and previews | `core/scanner/thumbnails.js` |
| 11 | Index | `core/db/` |
| 12 | Search in plugin | `core/db/query.js` |
| 13 | Favorite | `core/library/favorites.js` |
| 14 | Collections | `core/library/collections.js` |
| 15 | Use in Premiere | `src/adapters/` |
| 16 | Import own assets | `core/importer/` |
| 17 | Replace dev assets | `core/library/replace.js` |
| 18 | Remove the subsystem | section 9 above |
