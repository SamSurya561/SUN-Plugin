# Sun Plugin

An asset library and workflow toolkit for Adobe Premiere Pro. Original
implementation; the workflow ideas are informed by tools like Mister Horse,
Animation Composer, Film Impact and AEJuice, but no proprietary code, assets or
branding are used.

```
  MOGRTs · SFX · LUTs · Transitions · Overlays · Presets · Captions · Guides
  search · favourites · collections · preview · import · Premiere integration
```

---

## The architectural promise

> **The core does not care where an asset came from.**

An asset is a row in a database with a file beside it. Whether that file arrived
from an online source, from the built-in generator, from a ZIP you downloaded, or
from a pack you bought in 2023 changes exactly one field: `source`. Nothing else
branches on it.

The practical consequence: **deleting `src/dev-ingestor/` leaves a fully working
plugin.** That is enforced by `tools/check-boundaries.js` and proved by a test
that copies the tree, deletes the subsystem, and runs the core against it.

---

## Quick start

```bash
node tools/sun.js init        # create the library folders
node tools/sun.js generate    # build the development corpus (~790 assets, ~110 MB)
node tools/sun.js stats       # see what you have
node tools/sun.js search whoosh --limit 5
```

Preview the panel in a browser:

```bash
node tools/preview-server.js
```

Run the tests:

```bash
npm test
```

---

## Layout

```
manifest.json              UXP manifest (development — declares source domains)
manifest.production.json   UXP manifest (production — NO network permission)
config/
  categories.json          the asset taxonomy (core, permanent)
  development-sources.json the source registry (development only)
docs/
  DEVELOPMENT-ASSET-SOURCES.md   source research + platform constraints
  DEVELOPMENT-ASSET-PLAN.md      architecture and build plan
src/
  index.js                 bootstrap — the only file that may reference the ingestor
  core/                    PERMANENT. No network I/O anywhere in here.
    db/                    asset database, index, query, facets
    library/               paths, ingest, collections, replace, migrate
    scanner/               scan, categorize, tag, thumbnails
    importer/              user import, ZIP audit
    util/                  hashing, formats, safe names, png, wav, zip, font
  dev-ingestor/            REMOVABLE. Delete this and everything still works.
    registry.js            loads and validates config/development-sources.json
    adapters/              one adapter per source
    queue/                 download queue + safety guards
    generator/             procedural asset generation
  adapters/                Premiere host bridges (UXP and CEP)
  ui/                      the panel
assets/branding/           SUN mark: SVG sources and rasterised icons
tools/                     CLI, tests, boundary check, branding, preview server
```

The library itself lives outside the plugin, so the shipped bundle stays small
however large the corpus grows:

```
Documents/Sun Plugin/
  Library/              your permanent, owned assets
  DevelopmentLibrary/   the temporary test corpus — deletable at any time
  db/sun-assets.json    the index
  cache/thumbs/         generated thumbnails
  quarantine/           anything that failed validation
```

---

## What the generator actually produces

Everything below is generated locally, is CC0, and needs no network.

| Category | Count | Real or fixture |
|---|---:|---|
| SFX (whoosh, impact, riser, downer, UI, ambience, glitch, transition, foley) | 526 | **Real** 48 kHz 16-bit WAV, synthesised |
| LUTs (10 families) | 50 | **Real** `.cube`, load and grade in Lumetri |
| Overlays (grain, burns, leaks, dust, bokeh) | 64 | **Real** PNG with alpha |
| Backgrounds (gradient, abstract) | 36 | **Real** PNG |
| Guides (safe areas, thirds, social crops) | 11 | **Real** PNG |
| Captions | 14 | **Real** `.srt` / `.vtt` |
| MOGRT | 50 | **Fixture** — valid ZIP container, no AE composition |
| Presets | 29 | **Fixture** — documented XML, not the proprietary binary |
| Transitions | 8 | **Fixture** |

Fixtures are flagged `syntheticFixture: true` and show a purple `FIXTURE` badge.
They exercise scanning, hashing, categorisation, thumbnails, indexing, search,
favourites, collections and the virtualised grid — everything except opening the
template itself. Real MOGRTs come from the manual-import path. See
`docs/DEVELOPMENT-ASSET-SOURCES.md` section 1 for why no bulk source exists.

For UI scale testing without media:

```bash
node tools/sun.js stress --count 12000
node tools/sun.js purge-dev --yes
```

---

## The development asset ingestor

A **temporary, removable** subsystem for populating a test library. It will be
deleted once the library is replaced with personally owned assets.

What it will not do, enforced in `src/dev-ingestor/queue/guards.js` rather than
left to adapter authors: bypass authentication, paywalls, DRM, CAPTCHAs or
anti-bot systems; defeat download restrictions; download from a source classified
`LICENSE UNKNOWN` or `AUTOMATION NOT AVAILABLE`; or execute anything it downloads.

When a source forbids automation the answer is not a cleverer scraper. It is:

```
OPEN SOURCE PAGE  ->  you download it  ->  IMPORT INTO TOOLKIT
```

Sources (full classification in `docs/DEVELOPMENT-ASSET-SOURCES.md`):

| Source | Access | Automation | Default |
|---|---|---|---|
| Procedural generator | local | yes | on |
| Openverse | API | yes | on |
| Internet Archive | API | yes, PD-marked items only | on |
| Wikimedia Commons | API | yes, UA policy enforced | on |
| GitHub | API | yes, allowlisted SPDX only | on |
| Freesound | API | with your own OAuth | off |
| Pixabay | API | throttled, capped, cached | off |
| Direct URL | direct | with a declared licence | on |
| Mixkit, Motion Array, Pexels, … | manual | **no** | link-out only |

---

## Replacing development assets with your own

```
Development asset  ->  Replace File  ->  your own asset
```

**The asset id is preserved.** Favourites, collections, recents, ratings, notes
and any workflow referencing the asset keep working, because none of them ever
referred to the file — they referred to the id. `source` becomes `user-import`
and `developmentOnly` becomes `false`.

To move a whole library:

```bash
node tools/sun.js export my-library.json   # metadata only, no media
node tools/sun.js purge-dev --yes          # delete the development corpus
# then import your own assets and re-bind the metadata by hash, filename or name
```

---

## Platform notes

- UXP shipped in **Premiere Pro 25.6**; ExtendScript is supported through
  **September 2026**, so both bridges exist behind one `PremiereAdapter`
  interface.
- **Drag-and-drop from a panel to the timeline is not exposed** to CEP or UXP
  panels. The interaction is *select, then insert at playhead*. Host limitation,
  not a design choice.
- `localFileSystem` is requested as `"request"`, not `"fullAccess"`: you pick the
  library folder once and a persistent token keeps it.
- Every network domain must be allowlisted in `manifest.json`. The boundary
  check verifies the manifest and the source registry agree; the production
  manifest ships that list **empty**.

## Offline

With the network unplugged: search, browse, preview, thumbnails, favourites,
collections, tags, metadata editing, import, MOGRT insertion, SFX placement, LUT
application, presets, transitions and guides all work. Nothing in `src/core/`
performs network I/O, and the index is a local file.
