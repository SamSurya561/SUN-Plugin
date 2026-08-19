"use strict";
/**
 * Archive safety audit.
 *
 * Runs on the central directory only — no decompression — so it is safe against
 * a hostile archive, and it decides accept/quarantine before a single byte is
 * written to disk.
 *
 * Sun Plugin never executes anything from an imported pack. Not installers, not
 * scripts, not "run this first" helpers. An archive containing one is refused
 * whole rather than partially extracted, because a pack that ships an executable
 * is not a pack we want to be selective about.
 */

const { listEntries } = require("../util/zip");
const { safeRelativePath } = require("../util/safe-name");
const { archiveEntryAllowed, isExecutable, extOf } = require("../util/formats");

/** An entry larger than this is refused outright. */
const MAX_ENTRY_BYTES = 4 * 1024 * 1024 * 1024;
/** Total uncompressed size ceiling. */
const MAX_TOTAL_BYTES = 16 * 1024 * 1024 * 1024;
/** Compression ratio above this is a zip bomb. */
const MAX_RATIO = 200;
/** More entries than this is not an asset pack. */
const MAX_ENTRIES = 20000;

/**
 * @returns {{ ok, entries, rejected, reasons, stats }}
 *   ok:false  quarantine the whole archive
 *   entries   the entries that are safe to extract
 */
function auditArchive(bytes, { allowNested = true } = {}) {
  const listed = listEntries(bytes);
  if (!listed.ok) {
    return { ok: false, entries: [], rejected: [], reasons: [listed.error], stats: null };
  }

  const reasons = [];
  const accepted = [];
  const rejected = [];

  let totalUncompressed = 0;
  let totalCompressed = 0;

  if (listed.entries.length > MAX_ENTRIES) {
    return {
      ok: false, entries: [], rejected: [],
      reasons: [`archive contains ${listed.entries.length} entries (limit ${MAX_ENTRIES})`],
      stats: null,
    };
  }

  for (const entry of listed.entries) {
    const note = (reason) => {
      rejected.push({ name: entry.name, reason });
      if (!reasons.includes(reason)) reasons.push(reason);
    };

    if (entry.isDirectory) continue;

    if (entry.isSymlink) {
      // A symlink inside an archive is an escape primitive, never a legitimate
      // part of an asset pack.
      return { ok: false, entries: [], rejected: [{ name: entry.name, reason: "symlink" }],
        reasons: ["archive contains a symlink"], stats: null };
    }

    if (entry.isEncrypted) {
      return { ok: false, entries: [], rejected: [{ name: entry.name, reason: "encrypted" }],
        reasons: ["archive is encrypted"], stats: null };
    }

    const safe = safeRelativePath(entry.name);
    if (!safe.ok) {
      // Traversal is an attack, not a mistake: refuse the archive.
      return { ok: false, entries: [], rejected: [{ name: entry.name, reason: safe.reason }],
        reasons: [`unsafe entry path: ${safe.reason}`], stats: null };
    }

    if (isExecutable(entry.name)) {
      return {
        ok: false, entries: [], rejected: [{ name: entry.name, reason: "executable" }],
        reasons: [`archive contains an executable: ${entry.name}`], stats: null,
      };
    }

    if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
      note(`entry exceeds size limit: ${entry.name}`);
      continue;
    }

    // Zip-bomb check, per entry. Tiny entries are exempt because their ratio is
    // meaningless and legitimately huge for, say, an empty padded file.
    if (entry.compressedSize > 64 && entry.uncompressedSize / entry.compressedSize > MAX_RATIO) {
      return {
        ok: false, entries: [], rejected: [{ name: entry.name, reason: "compression ratio" }],
        reasons: [`suspicious compression ratio in ${entry.name}`], stats: null,
      };
    }

    totalUncompressed += entry.uncompressedSize;
    totalCompressed += entry.compressedSize;

    if (totalUncompressed > MAX_TOTAL_BYTES) {
      return {
        ok: false, entries: [], rejected: [],
        reasons: ["archive expands beyond the total size limit"], stats: null,
      };
    }

    if (!archiveEntryAllowed(entry.name)) {
      note(`unsupported file type: ${extOf(entry.name) || entry.name}`);
      continue;
    }

    accepted.push({ ...entry, safePath: safe.path, nested: extOf(entry.name) === ".mogrt" });
  }

  const stats = {
    entries: listed.entries.length,
    accepted: accepted.length,
    rejected: rejected.length,
    totalUncompressed,
    totalCompressed,
    ratio: totalCompressed > 0 ? totalUncompressed / totalCompressed : 0,
  };

  if (accepted.length === 0) {
    return { ok: false, entries: [], rejected, reasons: reasons.length ? reasons : ["no usable assets in archive"], stats };
  }

  return { ok: true, entries: accepted, rejected, reasons, stats, allowNested };
}

module.exports = {
  auditArchive,
  MAX_ENTRY_BYTES,
  MAX_TOTAL_BYTES,
  MAX_RATIO,
  MAX_ENTRIES,
};
