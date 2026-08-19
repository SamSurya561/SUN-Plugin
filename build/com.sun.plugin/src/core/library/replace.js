"use strict";
/**
 * Asset replacement.
 *
 * The mechanism by which the temporary development library becomes the real
 * one, a single asset at a time.
 *
 * The asset ID IS PRESERVED. That is the whole point: favourites, collections,
 * recents, ratings, notes, use counts and any saved workflow that references the
 * asset all keep working, because none of them ever referred to the file — they
 * referred to the id.
 *
 *   Development Asset "Cinematic Title 01"   (source: synthetic, dev: true)
 *        -> Replace File with My_Title.mogrt
 *   Same id, same collections, same favourite  (source: user-import, dev: false)
 */

const fs = require("fs");
const path = require("path");

const { paths, rootFor, ensureDir, toRelative, toAbsolute, isInsideLibrary } = require("./paths");
const { safeSegment, uniqueName } = require("../util/safe-name");
const { validate } = require("./ingest");
const { sha256 } = require("../util/hash");
const { generateThumbnail } = require("../scanner/thumbnails");
const { categorize } = require("../scanner/categorize");
const { generateTags } = require("../scanner/tags");
const { readWAVInfo } = require("../util/wav");

/**
 * Point an existing asset record at a new file.
 *
 * @param {AssetDatabase} db
 * @param {string} id            asset to replace
 * @param {string} newFilePath   absolute path to the replacement
 * @param {object} opts
 *   keepMetadata     keep name/tags/category from the old record (default true)
 *   deleteOld        delete the previous file (default false — never destroy by default)
 *   markPermanent    flip developmentOnly to false (default true)
 *   copy             copy the new file into the library (default true)
 */
function replaceAsset(db, id, newFilePath, opts = {}) {
  const {
    keepMetadata = true,
    deleteOld = false,
    markPermanent = true,
    copy = true,
  } = opts;

  const asset = db.get(id);
  if (!asset) return { ok: false, error: `no asset with id ${id}` };

  if (!fs.existsSync(newFilePath)) {
    return { ok: false, error: `replacement file not found: ${newFilePath}` };
  }

  const stat = fs.statSync(newFilePath);
  if (!stat.isFile()) return { ok: false, error: "replacement is not a file" };

  const sourceName = safeSegment(path.basename(newFilePath));
  const bytes = stat.size <= 96 * 1024 * 1024
    ? new Uint8Array(fs.readFileSync(newFilePath))
    : null;

  if (bytes) {
    const check = validate(sourceName, bytes);
    if (!check.ok) return { ok: false, error: `replacement rejected: ${check.reason}` };
  }

  const previous = {
    file: asset.file,
    sha256: asset.sha256,
    bytes: asset.bytes,
    source: asset.source,
    license: asset.license,
    developmentOnly: asset.developmentOnly,
    replacedAt: new Date().toISOString(),
  };

  const oldAbsolute = asset.file ? toAbsolute(asset.file) : null;
  const nowDevelopment = markPermanent ? false : asset.developmentOnly;

  let destination;
  if (copy) {
    // File it under the same category folder, in the library the asset now
    // belongs to. Moving from DevelopmentLibrary to Library is the normal case.
    const relativeInside = asset.file
      ? asset.file.split("/").slice(1, -1).join("/")
      : "";
    const baseDir = path.join(rootFor(nowDevelopment), relativeInside.split("/").join(path.sep));
    ensureDir(baseDir);

    const finalName = uniqueName(sourceName, (n) => fs.existsSync(path.join(baseDir, n)));
    destination = path.join(baseDir, finalName);

    if (!isInsideLibrary(destination)) {
      return { ok: false, error: "resolved destination escaped the library root" };
    }
    fs.copyFileSync(newFilePath, destination);
  } else {
    destination = path.resolve(newFilePath);
  }

  db.deindexAsset(asset);

  asset.file = copy ? toRelative(destination) : destination;
  asset.sha256 = bytes ? sha256(bytes) : `size-${stat.size}-${stat.mtimeMs}`;
  asset.bytes = stat.size;
  asset.source = opts.source || "user-import";
  asset.sourceUrl = opts.sourceUrl || null;
  asset.license = opts.license || null;
  asset.licenseUrl = opts.licenseUrl || null;
  asset.author = opts.author || null;
  asset.developmentOnly = nowDevelopment;
  asset.syntheticFixture = false;
  asset.replacedFrom = previous;
  asset.updatedAt = previous.replacedAt;

  if (!keepMetadata) {
    const classification = categorize(
      String(asset.file).split("/").slice(1).join("/"),
      asset.userCorrected ? { type: asset.type, category: asset.category, subcategory: asset.subcategory } : {}
    );
    asset.name = sourceName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    if (!asset.userCorrected) {
      asset.type = classification.type;
      asset.category = classification.category;
      asset.subcategory = classification.subcategory;
    }
    asset.tags = generateTags(asset.file, classification, { source: asset.source });
  }

  if (bytes && path.extname(destination).toLowerCase() === ".wav") {
    const info = readWAVInfo(bytes);
    if (info) asset.duration = info.duration;
  }

  try {
    const thumb = generateThumbnail(
      copy ? destination : path.resolve(newFilePath), asset, paths.thumbs);
    asset.thumbnail = toRelative(path.join(paths.thumbs, thumb.filename));
    if (thumb.width) asset.width = thumb.width;
    if (thumb.height) asset.height = thumb.height;
    if (thumb.duration != null) asset.duration = thumb.duration;
  } catch (e) {
    /* keep the old thumbnail rather than dropping the asset */
  }

  db.indexAsset(asset);
  db.dirty = true;

  // Deleting is opt-in and happens last, so a failure anywhere above leaves the
  // original file intact.
  let deleted = false;
  if (deleteOld && oldAbsolute && oldAbsolute !== destination && fs.existsSync(oldAbsolute)) {
    try {
      fs.unlinkSync(oldAbsolute);
      deleted = true;
    } catch (e) {
      deleted = false;
    }
  }

  return {
    ok: true,
    asset,
    previous,
    oldFileDeleted: deleted,
    preservedId: id,
  };
}

/**
 * Promote a development asset to the permanent library without changing its
 * file — for when a development asset turns out to be one you actually own.
 */
function promoteToPermanent(db, id, opts = {}) {
  const asset = db.get(id);
  if (!asset) return { ok: false, error: `no asset with id ${id}` };
  if (!asset.developmentOnly) return { ok: true, asset, moved: false };

  const oldAbsolute = toAbsolute(asset.file);
  const relativeInside = asset.file.split("/").slice(1).join("/");
  const destination = path.join(paths.library, relativeInside.split("/").join(path.sep));

  ensureDir(path.dirname(destination));
  if (fs.existsSync(oldAbsolute) && opts.move !== false) {
    fs.renameSync(oldAbsolute, destination);
  }

  db.deindexAsset(asset);
  asset.file = toRelative(destination);
  asset.developmentOnly = false;
  asset.syntheticFixture = false;
  asset.source = opts.source || asset.source;
  asset.updatedAt = new Date().toISOString();
  db.indexAsset(asset);
  db.dirty = true;

  return { ok: true, asset, moved: true };
}

/** Remove every development asset and its files. The cleanup at the end. */
function purgeDevelopmentAssets(db, { deleteFiles = true, keepFavorites = false } = {}) {
  const removed = [];
  let bytesFreed = 0;

  for (const asset of db.all()) {
    if (!asset.developmentOnly) continue;
    if (keepFavorites && asset.favorite) continue;

    if (deleteFiles && asset.file) {
      const abs = toAbsolute(asset.file);
      try {
        if (fs.existsSync(abs)) {
          bytesFreed += asset.bytes || 0;
          fs.unlinkSync(abs);
        }
      } catch (e) { /* a locked file must not abort the purge */ }
    }
    if (asset.thumbnail) {
      try {
        const t = toAbsolute(asset.thumbnail);
        if (fs.existsSync(t)) fs.unlinkSync(t);
      } catch (e) { /* ignore */ }
    }

    db.remove(asset.id);
    removed.push(asset.id);
  }

  return { removed: removed.length, bytesFreed, ids: removed };
}

module.exports = { replaceAsset, promoteToPermanent, purgeDevelopmentAssets };
