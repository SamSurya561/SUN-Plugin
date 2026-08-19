"use strict";
/**
 * Stress-test data generator.
 *
 * Purpose: prove the Asset Browser holds up at scale — virtualisation, search,
 * sorting, filtering, pagination, facet counts, favourites — without writing
 * thousands of real media files to disk.
 *
 * These records are metadata-only by design. They carry `stressTest: true` and
 * `developmentOnly: true`, share one thumbnail per type rather than generating
 * thousands, and have no `file`, so nothing can accidentally treat one as a real
 * asset or try to place it on a timeline.
 *
 * Purge them with: sun.js purge-dev --yes
 */

const fs = require("fs");
const path = require("path");

const { paths, ensureDir, toRelative } = require("../../core/library/paths");
const { Canvas } = require("../../core/util/png");
const { drawTextCentered } = require("../../core/util/bitmap-font");
const { colorFor, THUMB_W, THUMB_H } = require("../../core/scanner/thumbnails");
const { mulberry32 } = require("./audio");

/** Vocabulary that produces plausible names and searchable tags. */
const VOCAB = {
  type: [
    { type: "mogrt", categories: ["titles", "lower-thirds", "captions", "kinetic-typography", "social", "callouts"] },
    { type: "sfx", categories: ["whoosh", "impact", "riser", "downer", "ui", "ambience", "foley", "glitch"] },
    { type: "transition", categories: ["whip", "zoom", "glitch", "light", "film", "shape", "dissolve"] },
    { type: "lut", categories: ["cinematic", "film-emulation", "teal-orange", "vintage", "warm", "cool", "monochrome"] },
    { type: "overlay", categories: ["film-burn", "light-leak", "film-grain", "dust", "bokeh", "lens-flare", "vhs"] },
    { type: "preset", categories: ["motion", "effect", "audio", "text", "speed"] },
    { type: "background", categories: ["gradient", "abstract", "texture", "loop"] },
    { type: "caption", categories: ["subtitle", "styled", "karaoke"] },
    { type: "music", categories: ["cinematic", "ambient", "upbeat", "lofi", "tension"] },
    { type: "guide", categories: ["safe-area", "composition", "social-crop"] },
  ],
  adjective: [
    "Cinematic", "Minimal", "Bold", "Soft", "Heavy", "Fast", "Slow", "Warm", "Cool",
    "Dark", "Bright", "Clean", "Rough", "Smooth", "Deep", "Sharp", "Wide", "Tight",
    "Modern", "Retro", "Analog", "Digital", "Organic", "Dynamic", "Subtle", "Extreme",
  ],
  noun: [
    "Reveal", "Motion", "Pulse", "Wave", "Flash", "Drift", "Burst", "Shift",
    "Fade", "Sweep", "Ripple", "Echo", "Bloom", "Streak", "Fold", "Slide",
    "Bounce", "Snap", "Glow", "Shatter", "Spiral", "Cascade",
  ],
  pack: [
    "Essentials", "Pro Pack", "Studio", "Volume One", "Volume Two", "Collection",
    "Toolkit", "Series", "Bundle", "Set",
  ],
  license: ["CC0-1.0", "CC-BY-4.0", "MIT", "PDM-1.0"],
  author: ["Test Author A", "Test Author B", "Test Studio", "Sun Generator", null],
};

const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

/** One shared thumbnail per type keeps 5000 records from writing 5000 PNGs. */
function ensureTypeThumbnails(types) {
  ensureDir(paths.thumbs);
  const map = new Map();

  for (const type of types) {
    const filename = `stress-type-${type}.png`;
    const full = path.join(paths.thumbs, filename);

    if (!fs.existsSync(full)) {
      const [r, g, b] = colorFor(type);
      const c = new Canvas(THUMB_W, THUMB_H);
      c.shade((nx, ny) => [
        Math.round(24 + r * 0.12 * (1 - ny * 0.5)),
        Math.round(25 + g * 0.12 * (1 - ny * 0.5)),
        Math.round(29 + b * 0.12 * (1 - ny * 0.5)),
        255,
      ]);
      c.rect(0, 0, THUMB_W, 3, r, g, b, 0.9);
      drawTextCentered(c, type.toUpperCase(), 0, THUMB_W, 50, [r, g, b, 1], 2, 1);
      drawTextCentered(c, "STRESS TEST RECORD", 0, THUMB_W, 78, [110, 112, 120, 1], 1, 1);
      fs.writeFileSync(full, c.toPNG());
    }

    map.set(type, toRelative(full));
  }

  return map;
}

/**
 * Create `count` metadata-only assets.
 * Seeded, so the same count always produces the same corpus and a test that
 * fails is reproducible.
 */
function generateStressAssets(db, count = 1000, opts = {}) {
  const started = Date.now();
  const rnd = mulberry32(opts.seed || 0x5c0f9107);

  const types = VOCAB.type.map((t) => t.type);
  const thumbs = opts.thumbnails === false ? new Map() : ensureTypeThumbnails(types);

  let created = 0;
  const byType = {};

  for (let i = 0; i < count; i++) {
    const spec = pick(rnd, VOCAB.type);
    const category = pick(rnd, spec.categories);
    const adjective = pick(rnd, VOCAB.adjective);
    const noun = pick(rnd, VOCAB.noun);
    const packName = pick(rnd, VOCAB.pack);

    const name = `${adjective} ${noun} ${String(i % 999 + 1).padStart(3, "0")}`;
    const tags = [
      spec.type, category, adjective.toLowerCase(), noun.toLowerCase(),
      packName.toLowerCase().split(" ")[0], "stress", "test",
    ];

    // Spread the timestamps so date sorting has something to sort.
    const daysAgo = Math.floor(rnd() * 400);
    const added = new Date(Date.now() - daysAgo * 86400000).toISOString();

    const asset = {
      id: `stress-${spec.type}-${String(i).padStart(6, "0")}`,
      name,
      type: spec.type,
      category,
      subcategory: rnd() > 0.4 ? adjective.toLowerCase() : null,
      file: null,                     // deliberately absent: nothing to place
      thumbnail: thumbs.get(spec.type) || null,
      preview: null,
      source: "stress-test",
      sourceUrl: null,
      author: pick(rnd, VOCAB.author),
      license: pick(rnd, VOCAB.license),
      licenseUrl: null,
      developmentOnly: true,
      stressTest: true,
      sha256: null,
      bytes: Math.floor(rnd() * 40 * 1024 * 1024),
      duration: spec.type === "sfx" || spec.type === "music" ? Number((rnd() * 30).toFixed(2)) : null,
      tags: [...new Set(tags)].sort(),
      favorite: rnd() > 0.92,
      rating: Math.floor(rnd() * 6),
      useCount: Math.floor(rnd() * rnd() * 40),
      addedAt: added,
      downloadedAt: added,
      categorySource: "stress",
      categoryConfidence: 1,
    };

    db.upsert(asset);
    created++;
    byType[spec.type] = (byType[spec.type] || 0) + 1;

    if (opts.onProgress && created % 500 === 0) opts.onProgress({ created, count });
  }

  return { created, byType, elapsedMs: Date.now() - started };
}

/** Remove every stress-test record. Files are never involved. */
function purgeStressAssets(db) {
  let removed = 0;
  for (const asset of db.all()) {
    if (asset.stressTest || asset.source === "stress-test") {
      db.remove(asset.id);
      removed++;
    }
  }
  return { removed };
}

module.exports = { generateStressAssets, purgeStressAssets, VOCAB };
