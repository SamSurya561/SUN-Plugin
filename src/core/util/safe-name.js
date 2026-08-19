"use strict";
/**
 * Safe filename handling.
 *
 * Filenames arriving from remote sources, ZIP entries, or Content-Disposition
 * headers are hostile input. Nothing anywhere in Sun Plugin writes a path that
 * has not been through here first.
 *
 * Control characters are tested by code point rather than by a regex literal,
 * so this file stays pure printable ASCII and survives any editor or transport.
 */

// Windows reserved device names. Creating "CON.wav" is a real failure mode.
const RESERVED = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

const NUL = String.fromCharCode(0);
const ILLEGAL_PUNCT = "<>:\"/\\|?*";

const MAX_BASE = 96;   // leave room for a dedupe suffix and the extension
const MAX_TOTAL = 160; // stay far below MAX_PATH once joined to a library root

/** Illegal on Windows: the punctuation set, C0 controls, and DEL. */
function isIllegalChar(ch) {
  const code = ch.charCodeAt(0);
  if (code < 0x20 || code === 0x7f) return true;
  return ILLEGAL_PUNCT.indexOf(ch) !== -1;
}

function stripIllegal(input) {
  let out = "";
  for (const ch of input) out += isIllegalChar(ch) ? "-" : ch;
  return out;
}

/**
 * Reduce an arbitrary string to a single safe path segment.
 * Never returns "", ".", "..", or a reserved device name.
 */
function safeSegment(input, fallback = "asset") {
  let name = String(input == null ? "" : input);

  // Strip any directory component: a remote "filename" may be "../../evil.exe".
  name = name.replace(/[\\/]+/g, "/").split("/").pop() || "";

  name = stripIllegal(name)
    .replace(/\s+/g, " ")
    .trim()
    // Windows silently strips trailing dots and spaces; do it explicitly so the
    // name on disk is the name we recorded in the database.
    .replace(/[. ]+$/g, "");

  // "." and ".." survive the filters above but are not names.
  if (name === "" || name === "." || name === "..") name = fallback;

  const dot = name.lastIndexOf(".");
  let base = dot > 0 ? name.slice(0, dot) : name;
  let ext = dot > 0 ? name.slice(dot).toLowerCase() : "";

  // A reserved name is reserved with or without an extension.
  if (RESERVED.has(base.toLowerCase())) base = "_" + base;

  if (base.length > MAX_BASE) base = base.slice(0, MAX_BASE).replace(/[. ]+$/g, "");
  if (base === "") base = fallback;
  if (ext.length > 24) ext = ext.slice(0, 24); // ".tar.gz.backup.whatever"

  let out = base + ext;
  if (out.length > MAX_TOTAL) out = base.slice(0, MAX_TOTAL - ext.length) + ext;
  return out;
}

/**
 * Validate a relative path from an archive entry.
 * Returns { ok, path, reason }; ok:false means quarantine the archive.
 */
function safeRelativePath(input) {
  const raw = String(input == null ? "" : input).replace(/\\/g, "/");

  if (raw === "") return { ok: false, path: null, reason: "empty entry path" };
  if (raw.startsWith("/")) return { ok: false, path: null, reason: "absolute path" };
  if (/^[a-zA-Z]:/.test(raw)) return { ok: false, path: null, reason: "drive-letter path" };
  if (raw.indexOf(NUL) !== -1) return { ok: false, path: null, reason: "null byte in path" };

  const parts = raw.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) {
    return { ok: false, path: null, reason: "path traversal" };
  }
  if (parts.length === 0) return { ok: false, path: null, reason: "no path component" };
  if (parts.length > 24) return { ok: false, path: null, reason: "excessive nesting" };

  return { ok: true, path: parts.map((p) => safeSegment(p)).join("/"), reason: null };
}

/**
 * Resolve a collision by inserting " (2)", " (3)" ... before the extension.
 * `exists` is a predicate so this works against a real FS, a Set, or a mock.
 */
function uniqueName(desired, exists) {
  const name = safeSegment(desired);
  if (!exists(name)) return name;

  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";

  for (let n = 2; n < 10000; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

/** Pull a filename out of a Content-Disposition header, safely. */
function filenameFromContentDisposition(header) {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return safeSegment(decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")));
    } catch (e) {
      /* malformed percent-encoding: fall through to the plain form */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? safeSegment(plain[1]) : null;
}

/** Derive a filename from a URL when the server offered none. */
function filenameFromUrl(url, fallback = "download") {
  try {
    const u = new URL(String(url));
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ? safeSegment(decodeURIComponent(last), fallback) : safeSegment(fallback);
  } catch (e) {
    return safeSegment(fallback);
  }
}

module.exports = {
  safeSegment,
  safeRelativePath,
  uniqueName,
  filenameFromContentDisposition,
  filenameFromUrl,
  isIllegalChar,
  RESERVED,
  MAX_BASE,
  MAX_TOTAL,
};
