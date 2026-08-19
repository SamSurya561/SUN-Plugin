"use strict";
/**
 * Library migration.
 *
 * Export the organisation without the files, then re-bind it onto a folder of
 * personally owned assets. This is how months of tagging, favouriting and
 * collecting survive the swap from the development corpus to the real library.
 *
 * Matching runs strongest-evidence-first and never guesses silently: anything
 * it cannot match with confidence is reported for the user to resolve, because
 * a wrong auto-match quietly attaches someone's careful organisation to the
 * wrong file.
 */

const fs = require("fs");
const path = require("path");

const { paths, toAbsolute } = require("./paths");
const { ingestInPlace } = require("./ingest");
const { walk } = require("../scanner/scan");
const { sha256File } = require("../util/hash");
const { kindOf } = require("../util/formats");

const EXPORT_VERSION = 1;

/* ------------------------------------------------------------------ export */

/**
 * Export metadata only. No media, so the file stays small and is safe to keep
 * in version control or move between machines.
 */
function exportMetadata(db, opts = {}) {
  const { developmentOnly, includeQuarantined = false } = opts;

  const assets = db.all()
    .filter((a) => includeQuarantined || !a.quarantined)
    .filter((a) => developmentOnly === undefined || a.developmentOnly === developmentOnly)
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      category: a.category,
      subcategory: a.subcategory,
      // The filename is kept as a matching hint, the full path deliberately is not.
      filename: a.file ? a.file.split("/").pop() : null,
      sha256: a.sha256,
      bytes: a.bytes,
      duration: a.duration,
      tags: a.tags,
      favorite: a.favorite,
      collections: a.collections,
      rating: a.rating,
      notes: a.notes,
      useCount: a.useCount,
      lastUsedAt: a.lastUsedAt,
      userCorrected: a.userCorrected,
      source: a.source,
      license: a.license,
      developmentOnly: a.developmentOnly,
    }));

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    generator: "Sun Plugin",
    counts: {
      assets: assets.length,
      favorites: assets.filter((a) => a.favorite).length,
      collections: db.collections.size,
    },
    collections: [...db.collections.values()],
    assets,
  };
}

function writeExport(db, filePath, opts = {}) {
  const doc = exportMetadata(db, opts);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), "utf8");
  return { path: filePath, ...doc.counts };
}

/* ------------------------------------------------------------------ import */

function normalizeName(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Token overlap, 0..1. Used only as the last and weakest matching signal. */
function similarity(a, b) {
  const A = new Set(normalizeName(a).split(" ").filter(Boolean));
  const B = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.max(A.size, B.size);
}

/**
 * Import a metadata export and bind it onto a folder of real assets.
 *
 * @param {AssetDatabase} db
 * @param {object} doc            a document produced by exportMetadata()
 * @param {string} assetsRoot     folder of the user's own files
 * @param {object} opts
 *   scanFirst      index assetsRoot before matching (default true)
 *   minSimilarity  threshold for fuzzy name matching (default 0.6)
 *   dryRun         report what would happen without writing
 */
async function importLibrary(db, doc, assetsRoot, opts = {}) {
  const { scanFirst = true, minSimilarity = 0.6, dryRun = false, thumbnails = true } = opts;

  if (!doc || doc.version !== EXPORT_VERSION) {
    return { ok: false, error: `unsupported export version: ${doc && doc.version}` };
  }
  if (!fs.existsSync(assetsRoot)) {
    return { ok: false, error: `assets folder not found: ${assetsRoot}` };
  }

  // Bring the user's files into the database first, so they exist to match against.
  const indexed = [];
  if (scanFirst) {
    for (const file of walk(assetsRoot)) {
      if (!kindOf(path.basename(file))) continue;
      const result = ingestInPlace(db, file, {
        developmentOnly: false,
        source: "user-import",
        thumbnails,
      });
      if (result.asset) indexed.push(result.asset);
    }
  }

  const candidates = indexed.length
    ? indexed
    : db.all().filter((a) => !a.developmentOnly && !a.quarantined);

  const byHash = new Map();
  const byFilename = new Map();
  for (const a of candidates) {
    if (a.sha256) byHash.set(a.sha256, a);
    if (a.file) {
      const base = a.file.split("/").pop().toLowerCase();
      if (!byFilename.has(base)) byFilename.set(base, a);
    }
  }

  const used = new Set();
  const report = { matched: [], unmatched: [], collectionsCreated: 0, method: {} };

  for (const record of doc.assets) {
    let match = null;
    let method = null;

    // 1. Content hash — identical bytes, unambiguous.
    if (record.sha256 && byHash.has(record.sha256)) {
      const c = byHash.get(record.sha256);
      if (!used.has(c.id)) { match = c; method = "hash"; }
    }

    // 2. Exact filename.
    if (!match && record.filename) {
      const c = byFilename.get(record.filename.toLowerCase());
      if (c && !used.has(c.id)) { match = c; method = "filename"; }
    }

    // 3. Fuzzy name, constrained to the same type so a title never binds to a
    //    sound effect just because the words happen to overlap.
    if (!match && record.name) {
      let best = null;
      let bestScore = minSimilarity;
      for (const c of candidates) {
        if (used.has(c.id)) continue;
        if (record.type && c.type !== record.type) continue;
        const score = Math.max(
          similarity(record.name, c.name),
          record.filename ? similarity(record.filename, c.file ? c.file.split("/").pop() : "") : 0
        );
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (best) { match = best; method = `name (${bestScore.toFixed(2)})`; }
    }

    if (!match) {
      report.unmatched.push({ id: record.id, name: record.name, type: record.type });
      continue;
    }

    used.add(match.id);
    report.method[method] = (report.method[method] || 0) + 1;
    report.matched.push({ from: record.id, to: match.id, name: match.name, method });

    if (dryRun) continue;

    db.deindexAsset(match);
    match.favorite = record.favorite || match.favorite;
    match.rating = record.rating || match.rating;
    match.notes = record.notes || match.notes;
    match.useCount = Math.max(match.useCount || 0, record.useCount || 0);
    match.lastUsedAt = record.lastUsedAt || match.lastUsedAt;
    match.collections = [...new Set([...(match.collections || []), ...(record.collections || [])])];
    match.tags = [...new Set([...(match.tags || []), ...(record.tags || [])])].sort();
    if (record.userCorrected) {
      match.type = record.type;
      match.category = record.category;
      match.subcategory = record.subcategory;
      match.userCorrected = true;
    }
    match.updatedAt = new Date().toISOString();
    db.indexAsset(match);
    db.dirty = true;
  }

  if (!dryRun) {
    for (const c of doc.collections || []) {
      if (!db.collections.has(c.name)) {
        db.collections.set(c.name, { ...c });
        report.collectionsCreated++;
      }
    }
  }

  return {
    ok: true,
    scanned: indexed.length,
    total: doc.assets.length,
    matchedCount: report.matched.length,
    unmatchedCount: report.unmatched.length,
    ...report,
  };
}

function readExport(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

module.exports = {
  exportMetadata,
  writeExport,
  importLibrary,
  readExport,
  similarity,
  EXPORT_VERSION,
};
