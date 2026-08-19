"use strict";
/**
 * Recursive library scanner.
 *
 * Walks a folder tree, indexes everything it recognises, and reports what it
 * skipped and why. Runs against the DevelopmentLibrary, the permanent Library,
 * or any folder the user points at — an existing pack collection on disk is a
 * first-class scan target, and usually a better test corpus than anything
 * downloadable.
 *
 * Scanning never moves or modifies files. The layout on disk belongs to the user.
 */

const fs = require("fs");
const path = require("path");

const { paths } = require("../library/paths");
const { ingestInPlace } = require("../library/ingest");
const { kindOf, isExecutable } = require("../util/formats");

/** Folders that are never worth walking into. */
const SKIP_DIRS = new Set([
  ".git", ".svn", "node_modules", "__macosx", ".ds_store", "$recycle.bin",
  "system volume information", ".sun-cache", "cache", "quarantine",
]);

/**
 * Depth-first walk yielding file paths.
 * Iterative rather than recursive so a pathological tree cannot blow the stack,
 * and symlinked directories are not followed — a self-referential link would
 * otherwise loop forever.
 */
function* walk(root, { maxDepth = 24 } = {}) {
  const stack = [{ dir: root, depth: 0 }];

  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue; // unreadable directory: skip rather than abort the whole scan
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        if (entry.name.startsWith(".")) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile()) {
        if (entry.name.startsWith(".")) continue;
        yield full;
      }
    }
  }
}

/**
 * Scan one or more roots into the database.
 *
 * @param {AssetDatabase} db
 * @param {object} opts
 *   roots            absolute paths; defaults to both libraries
 *   developmentOnly  force the flag; inferred from the path when omitted
 *   thumbnails       generate thumbnails (slow on first run)
 *   onProgress       ({ scanned, indexed, file }) => void
 *   prune            remove records whose file no longer exists
 */
function scanLibrary(db, opts = {}) {
  const {
    roots = [paths.library, paths.developmentLibrary],
    thumbnails = true,
    onProgress = null,
    prune = true,
    source,
  } = opts;

  const started = Date.now();
  const stats = {
    scanned: 0,
    indexed: 0,
    duplicates: 0,
    skipped: 0,
    errors: 0,
    pruned: 0,
    bytes: 0,
    skippedReasons: {},
    byType: {},
  };

  const seenIds = new Set();

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;

    for (const file of walk(root)) {
      stats.scanned++;

      const name = path.basename(file);
      if (!kindOf(name) || isExecutable(name)) {
        stats.skipped++;
        const reason = isExecutable(name) ? "executable" : "unrecognised format";
        stats.skippedReasons[reason] = (stats.skippedReasons[reason] || 0) + 1;
        continue;
      }

      let result;
      try {
        result = ingestInPlace(db, file, {
          developmentOnly: opts.developmentOnly,
          thumbnails,
          source,
        });
      } catch (e) {
        stats.errors++;
        continue;
      }

      if (result.error) {
        stats.errors++;
      } else if (result.skipped) {
        stats.skipped++;
        stats.skippedReasons[result.reason] = (stats.skippedReasons[result.reason] || 0) + 1;
      } else {
        stats.indexed++;
        stats.bytes += result.asset.bytes || 0;
        stats.byType[result.asset.type] = (stats.byType[result.asset.type] || 0) + 1;
        seenIds.add(result.asset.id);
        if (result.duplicate) stats.duplicates++;
      }

      if (onProgress && stats.scanned % 25 === 0) {
        onProgress({ ...stats, file });
      }
    }
  }

  // Records whose file has been deleted outside the plugin become stale. Only
  // prune what this scan actually covered, so scanning one folder cannot wipe
  // records belonging to another.
  if (prune) {
    const coveredRoots = roots.map((r) => path.resolve(r));
    for (const asset of db.all()) {
      if (!asset.file) continue;
      const abs = path.join(paths.root, asset.file.split("/").join(path.sep));
      const covered = coveredRoots.some((r) => path.resolve(abs).startsWith(r));
      if (!covered) continue;
      if (!fs.existsSync(abs)) {
        db.remove(asset.id);
        stats.pruned++;
      }
    }
  }

  stats.elapsedMs = Date.now() - started;
  return stats;
}

/**
 * Rebuild the index from scratch. Used when the database is corrupt or after a
 * taxonomy change that should reclassify everything.
 *
 * User-owned data (favourites, collections, ratings, manual corrections) is
 * carried across, because losing it would be far worse than a stale category.
 */
function rebuildIndex(db, opts = {}) {
  const preserved = new Map();
  for (const asset of db.all()) {
    preserved.set(asset.sha256 || asset.id, {
      favorite: asset.favorite,
      collections: asset.collections,
      rating: asset.rating,
      notes: asset.notes,
      useCount: asset.useCount,
      lastUsedAt: asset.lastUsedAt,
      userCorrected: asset.userCorrected,
      type: asset.type,
      category: asset.category,
      subcategory: asset.subcategory,
    });
  }

  db.assets.clear();
  db.rebuildIndexes();

  const stats = scanLibrary(db, { ...opts, prune: false });

  for (const asset of db.all()) {
    const saved = preserved.get(asset.sha256) || preserved.get(asset.id);
    if (!saved) continue;
    Object.assign(asset, {
      favorite: saved.favorite,
      collections: saved.collections,
      rating: saved.rating,
      notes: saved.notes,
      useCount: saved.useCount,
      lastUsedAt: saved.lastUsedAt,
    });
    if (saved.userCorrected) {
      asset.userCorrected = true;
      asset.type = saved.type;
      asset.category = saved.category;
      asset.subcategory = saved.subcategory;
    }
  }

  stats.restored = preserved.size;
  return stats;
}

module.exports = { scanLibrary, rebuildIndex, walk, SKIP_DIRS };
