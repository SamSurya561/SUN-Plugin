"use strict";
/**
 * The single path by which any file becomes an asset.
 *
 * Scanning, user import and development downloads all funnel through here, so
 * validation, hashing, duplicate detection, categorisation, tagging, thumbnail
 * generation and indexing happen identically no matter the origin. A file that
 * arrived from Openverse and a file the user dragged in are indistinguishable to
 * everything downstream, which is the architectural promise the whole plugin
 * rests on.
 *
 * Order matters: validate, then promote, then index. A file is never visible in
 * the library before it has passed validation.
 */

const fs = require("fs");
const path = require("path");

const { paths, rootFor, ensureDir, toRelative, isInsideLibrary } = require("./paths");
const { safeSegment, uniqueName } = require("../util/safe-name");
const { verifyContent, kindOf, extOf, isExecutable } = require("../util/formats");
const { sha256, shortId } = require("../util/hash");
const { categorize, targetFolder } = require("../scanner/categorize");
const { generateTags } = require("../scanner/tags");
const { generateThumbnail } = require("../scanner/thumbnails");
const { readWAVInfo } = require("../util/wav");

/** Stable, readable asset id: <scope>-<type>-<slug>-<hash8>. */
function makeAssetId(classification, name, hashHex, developmentOnly) {
  const scope = developmentOnly ? "dev" : "lib";
  const slug = String(name)
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "asset";
  return `${scope}-${classification.type}-${slug}-${shortId(hashHex, 8)}`;
}

/** Extra facts worth recording that are cheap to read from the file itself. */
function probe(absolutePath, bytes) {
  const ext = extOf(absolutePath);
  if (ext === ".wav" && bytes) {
    const info = readWAVInfo(bytes);
    if (info) return { duration: info.duration, channels: info.channels, sampleRate: info.sampleRate };
  }
  return {};
}

/**
 * Validate bytes destined for the library.
 * Returns { ok, reason }. Callers quarantine on failure; they never write anyway.
 */
function validate(filename, bytes, { maxBytes = 2 * 1024 * 1024 * 1024 } = {}) {
  if (!bytes || bytes.length === 0) return { ok: false, reason: "empty file" };
  if (bytes.length > maxBytes) return { ok: false, reason: "file exceeds size limit" };
  if (isExecutable(filename)) return { ok: false, reason: "executable file type" };

  const content = verifyContent(filename, bytes);
  if (!content.ok) return { ok: false, reason: content.reason };

  return { ok: true, reason: null, detected: content.detected };
}

/** Move a validated file into quarantine and record why. */
function quarantine(db, filename, bytes, reason, meta = {}) {
  ensureDir(paths.quarantine);
  const safe = uniqueName(filename, (n) => fs.existsSync(path.join(paths.quarantine, n)));
  const dest = path.join(paths.quarantine, safe);
  if (bytes) fs.writeFileSync(dest, bytes);

  const hashHex = bytes ? sha256(bytes) : shortId(String(Date.now()), 16);
  const asset = {
    id: `quarantine-${shortId(hashHex, 12)}`,
    name: filename,
    type: "unknown",
    category: "quarantined",
    file: toRelative(dest),
    source: meta.source || "unknown",
    sourceUrl: meta.sourceUrl || null,
    developmentOnly: meta.developmentOnly !== false,
    sha256: hashHex,
    bytes: bytes ? bytes.length : 0,
    quarantined: true,
    quarantineReason: reason,
  };

  if (db) db.upsert(asset);
  return { quarantined: true, reason, path: dest, asset };
}

/**
 * Ingest a buffer: validate, file it under the right folder, index it.
 *
 * @param {AssetDatabase} db
 * @param {object} opts
 *   bytes            Uint8Array
 *   filename         suggested name (untrusted)
 *   developmentOnly  which library it belongs to
 *   source           "user-import" | "synthetic" | a source id
 *   sourceUrl, author, license, licenseUrl, attribution
 *   hints            { type, category, subcategory } to override inference
 *   meta             { title, description, sourceTags }
 *   syntheticFixture flag for non-functional fixtures
 */
function ingestBuffer(db, opts) {
  const {
    bytes, developmentOnly = true, source = "unknown",
    hints = {}, meta = {}, syntheticFixture = false,
    thumbnails = true,
  } = opts;

  const filename = safeSegment(opts.filename || "asset");

  const check = validate(filename, bytes);
  if (!check.ok) return quarantine(db, filename, bytes, check.reason, { source, developmentOnly, sourceUrl: opts.sourceUrl });

  const hashHex = sha256(bytes);

  // Duplicate detection happens before anything is written: re-downloading or
  // re-importing the same bytes should update the record, not litter the disk.
  const existing = db ? db.byHash(hashHex).filter((a) => !a.quarantined) : [];
  if (existing.length > 0) {
    return { duplicate: true, asset: existing[0], reason: "identical content already in library" };
  }

  // Classify from the *intended* location, so the folder it lands in and the
  // folder a later rescan reads it from agree.
  const provisional = categorize(filename, hints);
  const folder = targetFolder(provisional);
  const baseDir = path.join(rootFor(developmentOnly), folder.split("/").join(path.sep));
  ensureDir(baseDir);

  const finalName = uniqueName(filename, (n) => fs.existsSync(path.join(baseDir, n)));
  const destination = path.join(baseDir, finalName);

  if (!isInsideLibrary(destination)) {
    return quarantine(db, filename, bytes, "resolved path escaped the library root", { source, developmentOnly });
  }

  fs.writeFileSync(destination, bytes);

  const relative = toRelative(destination);
  const classification = categorize(
    relative.split("/").slice(1).join("/"), // drop the Library/DevelopmentLibrary prefix
    hints
  );

  const displayName = meta.title || finalName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  const id = makeAssetId(classification, displayName, hashHex, developmentOnly);
  const extra = probe(destination, bytes);

  const asset = {
    id,
    name: displayName,
    type: classification.type,
    category: classification.category,
    subcategory: classification.subcategory,
    file: relative,
    source,
    sourceUrl: opts.sourceUrl || null,
    author: opts.author || null,
    license: opts.license || null,
    licenseUrl: opts.licenseUrl || null,
    attribution: opts.attribution || null,
    developmentOnly,
    syntheticFixture,
    sha256: hashHex,
    bytes: bytes.length,
    tags: generateTags(relative, classification, { ...meta, source }),
    categorySource: classification.categorySource,
    categoryConfidence: classification.confidence,
    ...extra,
  };

  if (thumbnails) {
    try {
      const thumb = generateThumbnail(destination, asset, paths.thumbs);
      asset.thumbnail = toRelative(path.join(paths.thumbs, thumb.filename));
      if (thumb.width) asset.width = thumb.width;
      if (thumb.height) asset.height = thumb.height;
      if (thumb.duration != null) asset.duration = thumb.duration;
    } catch (e) {
      // A thumbnail is a convenience; failing to make one must not lose the asset.
      asset.thumbnail = null;
    }
  }

  if (db) db.upsert(asset);
  return { asset, path: destination, duplicate: false };
}

/**
 * Index a file that is already sitting in the library, without moving it.
 * This is what the scanner uses: the user's folder layout is theirs to keep.
 */
function ingestInPlace(db, absolutePath, opts = {}) {
  const { developmentOnly, source = "local-scan", hints = {}, meta = {}, thumbnails = true } = opts;

  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch (e) {
    return { error: "unreadable", path: absolutePath };
  }
  if (!stat.isFile()) return { error: "not a file", path: absolutePath };

  const filename = path.basename(absolutePath);
  if (!kindOf(filename)) return { skipped: true, reason: "unrecognised format", path: absolutePath };
  if (isExecutable(filename)) {
    return { skipped: true, reason: "executable ignored", path: absolutePath };
  }

  // Reading a whole 4GB master to index it is pointless; large media is hashed
  // by a header-plus-size fingerprint instead of full content.
  const LARGE = 96 * 1024 * 1024;
  let bytes = null;
  let hashHex;

  if (stat.size <= LARGE) {
    bytes = new Uint8Array(fs.readFileSync(absolutePath));
    const check = validate(filename, bytes);
    if (!check.ok) {
      return { skipped: true, reason: check.reason, path: absolutePath };
    }
    hashHex = sha256(bytes);
  } else {
    const fd = fs.openSync(absolutePath, "r");
    const head = Buffer.alloc(1024 * 1024);
    fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    // Size is mixed in so two different files sharing a header do not collide.
    hashHex = sha256(new Uint8Array(Buffer.concat([head, Buffer.from(String(stat.size))])));
  }

  const relative = toRelative(absolutePath);
  const withinLibrary = relative.split("/").slice(1).join("/");
  const isDev = developmentOnly !== undefined
    ? developmentOnly
    : relative.startsWith("DevelopmentLibrary/");

  const classification = categorize(withinLibrary || filename, hints);
  const displayName = meta.title || filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  const id = makeAssetId(classification, displayName, hashHex, isDev);

  const duplicates = db ? db.byHash(hashHex).filter((a) => a.id !== id && !a.quarantined) : [];

  const asset = {
    id,
    name: displayName,
    type: classification.type,
    category: classification.category,
    subcategory: classification.subcategory,
    file: relative,
    source: opts.source || (isDev ? "local-scan" : "user-import"),
    sourceUrl: opts.sourceUrl || null,
    author: opts.author || null,
    license: opts.license || null,
    licenseUrl: opts.licenseUrl || null,
    developmentOnly: isDev,
    syntheticFixture: opts.syntheticFixture === true,
    sha256: hashHex,
    bytes: stat.size,
    tags: generateTags(relative, classification, { ...meta, source }),
    categorySource: classification.categorySource,
    categoryConfidence: classification.confidence,
    ...probe(absolutePath, bytes),
  };

  if (thumbnails) {
    try {
      const thumb = generateThumbnail(absolutePath, asset, paths.thumbs);
      asset.thumbnail = toRelative(path.join(paths.thumbs, thumb.filename));
      if (thumb.width) asset.width = thumb.width;
      if (thumb.height) asset.height = thumb.height;
      if (thumb.duration != null) asset.duration = thumb.duration;
    } catch (e) {
      asset.thumbnail = null;
    }
  }

  if (db) db.upsert(asset);
  return { asset, duplicate: duplicates.length > 0, duplicates, path: absolutePath };
}

module.exports = { ingestBuffer, ingestInPlace, validate, quarantine, makeAssetId };
