"use strict";
/**
 * User asset import: file, folder, or ZIP.
 *
 * This is the PERMANENT, primary asset workflow. The development ingestor is a
 * temporary convenience layered beside it; this module is what the plugin is
 * actually for, and it works with no network and no ingestor present.
 *
 * Imports default to `developmentOnly: false` and `source: "user-import"`,
 * because the plugin must never assume a file came from the internet.
 */

const fs = require("fs");
const path = require("path");

const { ingestBuffer, ingestInPlace } = require("../library/ingest");
const { auditArchive } = require("./zip-audit");
const { extractEntry } = require("../util/zip");
const { kindOf, extOf, isExecutable } = require("../util/formats");
const { walk } = require("../scanner/scan");

/** Import a single file. Archives are unpacked; everything else is copied. */
function importFile(db, filePath, opts = {}) {
  const {
    developmentOnly = false,
    source = "user-import",
    copy = true,
    hints = {},
    meta = {},
  } = opts;

  if (!fs.existsSync(filePath)) return { ok: false, error: `not found: ${filePath}` };

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return { ok: false, error: "not a file" };

  const filename = path.basename(filePath);

  if (isExecutable(filename)) {
    return { ok: false, error: "executables are never imported", filename };
  }

  const ext = extOf(filename);
  if (ext === ".zip") {
    return importArchive(db, filePath, opts);
  }

  if (!kindOf(filename)) {
    return { ok: false, error: `unsupported format: ${ext || "(none)"}`, filename };
  }

  // Copying into the library is the default so the library is self-contained and
  // portable. Importing in place is offered for users who keep a curated tree
  // they do not want reorganised.
  if (!copy) {
    const result = ingestInPlace(db, filePath, { developmentOnly, source, hints, meta });
    return { ok: !result.error && !result.skipped, ...result };
  }

  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const result = ingestBuffer(db, {
    bytes, filename, developmentOnly, source, hints, meta,
    author: opts.author, license: opts.license, licenseUrl: opts.licenseUrl,
    sourceUrl: opts.sourceUrl,
  });

  return { ok: !result.quarantined, ...result };
}

/** Import every recognised file in a folder tree. */
function importFolder(db, folderPath, opts = {}) {
  if (!fs.existsSync(folderPath)) return { ok: false, error: `not found: ${folderPath}` };
  if (!fs.statSync(folderPath).isDirectory()) return { ok: false, error: "not a folder" };

  const stats = {
    ok: true, imported: 0, duplicates: 0, skipped: 0,
    quarantined: 0, archives: 0, errors: 0, assets: [],
  };

  for (const file of walk(folderPath)) {
    const name = path.basename(file);
    const ext = extOf(name);

    if (isExecutable(name)) { stats.skipped++; continue; }

    if (ext === ".zip") {
      const archive = importArchive(db, file, opts);
      stats.archives++;
      if (archive.ok) {
        stats.imported += archive.imported || 0;
        stats.duplicates += archive.duplicates || 0;
        if (archive.assets) stats.assets.push(...archive.assets);
      } else {
        stats.quarantined++;
      }
      continue;
    }

    if (!kindOf(name)) { stats.skipped++; continue; }

    let result;
    try {
      result = importFile(db, file, opts);
    } catch (e) {
      stats.errors++;
      continue;
    }

    if (result.quarantined) stats.quarantined++;
    else if (result.duplicate) stats.duplicates++;
    else if (result.asset) { stats.imported++; stats.assets.push(result.asset); }
    else stats.skipped++;

    if (opts.onProgress) opts.onProgress({ ...stats, file });
  }

  return stats;
}

/**
 * Import a ZIP: audit first, extract only what the audit accepted, and never
 * write anything if the audit refused the archive.
 */
function importArchive(db, archivePath, opts = {}) {
  const {
    developmentOnly = false,
    source = "user-import",
    hints = {},
    meta = {},
  } = opts;

  const bytes = new Uint8Array(fs.readFileSync(archivePath));
  const audit = auditArchive(bytes);
  const archiveName = path.basename(archivePath);

  if (!audit.ok) {
    // The archive itself is quarantined so the user can see exactly what was
    // refused and why, rather than the import silently doing nothing.
    const { quarantine } = require("../library/ingest");
    const q = quarantine(db, archiveName, bytes, audit.reasons.join("; "), { source, developmentOnly });
    return {
      ok: false, quarantined: true, archive: archiveName,
      reasons: audit.reasons, rejected: audit.rejected, quarantinePath: q.path,
    };
  }

  const stats = {
    ok: true, archive: archiveName, imported: 0, duplicates: 0,
    quarantined: 0, skipped: audit.rejected.length, assets: [],
    rejected: audit.rejected, stats: audit.stats,
  };

  for (const entry of audit.entries) {
    let data;
    try {
      data = extractEntry(bytes, entry);
    } catch (e) {
      stats.skipped++;
      continue;
    }

    // Folder structure inside the archive is real categorisation evidence —
    // packs ship as SFX/Whoosh/... — so it is passed through as the path hint.
    const innerPath = entry.safePath;
    const entryName = innerPath.split("/").pop();

    const result = ingestBuffer(db, {
      bytes: data,
      filename: entryName,
      developmentOnly,
      source,
      hints: Object.keys(hints).length ? hints : inferHintsFromArchivePath(innerPath, archiveName),
      meta: { ...meta, sourceTags: [...(meta.sourceTags || []), ...archiveTags(archiveName)] },
      author: opts.author,
      license: opts.license,
      licenseUrl: opts.licenseUrl,
      sourceUrl: opts.sourceUrl,
    });

    if (result.quarantined) stats.quarantined++;
    else if (result.duplicate) stats.duplicates++;
    else if (result.asset) { stats.imported++; stats.assets.push(result.asset); }
  }

  return stats;
}

/**
 * Use the path inside the archive as categorisation evidence.
 * Returns hints only when the archive path is genuinely informative; otherwise
 * the normal inference on the filename does the work.
 */
function inferHintsFromArchivePath(innerPath, archiveName) {
  const { categorize } = require("../scanner/categorize");
  const segments = innerPath.split("/");
  if (segments.length < 2) return {};

  // Categorise as if the archive interior were a library tree.
  const guess = categorize(innerPath);
  if (guess.categorySource === "folder" && guess.confidence >= 0.8) {
    return { type: guess.type, category: guess.category, subcategory: guess.subcategory };
  }
  return {};
}

function archiveTags(archiveName) {
  return String(archiveName)
    .replace(/\.[^.]+$/, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter((t) => t.length > 2)
    .map((t) => t.toLowerCase());
}

/** Dispatch on what the path actually is. */
function importPath(db, target, opts = {}) {
  if (!fs.existsSync(target)) return { ok: false, error: `not found: ${target}` };
  const stat = fs.statSync(target);
  if (stat.isDirectory()) return importFolder(db, target, opts);
  if (extOf(target) === ".zip") return importArchive(db, target, opts);
  return importFile(db, target, opts);
}

module.exports = { importFile, importFolder, importArchive, importPath, archiveTags };
