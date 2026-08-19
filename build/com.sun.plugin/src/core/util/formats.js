"use strict";
/**
 * Format knowledge: what Sun Plugin recognises, what it refuses, and how to tell
 * whether a file is actually what its extension claims.
 *
 * This module is core and permanent. It knows nothing about where a file came
 * from; a downloaded WAV and a hand-authored WAV are the same thing to it.
 */

/**
 * Extension -> asset kind. The kind is the coarse bucket that drives preview
 * behaviour and Premiere insertion; the fine-grained type/category/subcategory
 * comes from the categorizer.
 */
const KIND_BY_EXT = {
  // Motion graphics templates (a .mogrt is a ZIP container)
  ".mogrt": "mogrt",

  // Premiere / Adobe presets and looks
  ".prfpset": "preset",
  ".epr": "preset",
  ".aep": "project",
  ".prproj": "project",

  // Colour
  ".cube": "lut",
  ".look": "lut",
  ".3dl": "lut",
  ".csp": "lut",
  ".xmp": "colorpreset",

  // Audio
  ".wav": "audio",
  ".mp3": "audio",
  ".aiff": "audio",
  ".aif": "audio",
  ".flac": "audio",
  ".ogg": "audio",
  ".m4a": "audio",

  // Video
  ".mp4": "video",
  ".mov": "video",
  ".mkv": "video",
  ".webm": "video",
  ".avi": "video",
  ".mxf": "video",
  ".prores": "video",

  // Image / overlay / still
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".tif": "image",
  ".tiff": "image",
  ".exr": "image",
  ".svg": "image",

  // Captions
  ".srt": "caption",
  ".vtt": "caption",
  ".ass": "caption",
  ".ssa": "caption",
  ".sbv": "caption",

  // Containers and data
  ".zip": "archive",
  ".json": "data",
  ".txt": "data",
  ".md": "data",
  ".csv": "data",
};

/**
 * Never written into the library. An asset pack containing any of these is
 * quarantined whole; Sun Plugin does not execute or install anything.
 */
const EXECUTABLE_EXT = new Set([
  ".exe", ".dll", ".bat", ".cmd", ".com", ".msi", ".scr", ".cpl", ".hta",
  ".ps1", ".psm1", ".vbs", ".vbe", ".wsf", ".wsh", ".js", ".jse", ".jar",
  ".sh", ".bash", ".zsh", ".app", ".pkg", ".dmg", ".deb", ".rpm",
  ".lnk", ".reg", ".sys", ".drv", ".so", ".dylib", ".bin", ".run",
]);

/** Magic-byte signatures, checked against the claimed extension. */
const SIGNATURES = [
  { kind: "png",  ext: [".png"],  offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { kind: "jpeg", ext: [".jpg", ".jpeg"], offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { kind: "gif",  ext: [".gif"],  offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { kind: "zip",  ext: [".zip", ".mogrt", ".prfpset", ".aep"], offset: 0, bytes: [0x50, 0x4b] },
  { kind: "riff", ext: [".wav", ".avi", ".webp"], offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  { kind: "flac", ext: [".flac"], offset: 0, bytes: [0x66, 0x4c, 0x61, 0x43] },
  { kind: "ogg",  ext: [".ogg"],  offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] },
  { kind: "aiff", ext: [".aiff", ".aif"], offset: 0, bytes: [0x46, 0x4f, 0x52, 0x4d] },
  { kind: "mp4",  ext: [".mp4", ".mov", ".m4a"], offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  { kind: "mkv",  ext: [".mkv", ".webm"], offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { kind: "exe",  ext: [".exe", ".dll", ".scr", ".sys"], offset: 0, bytes: [0x4d, 0x5a] },
  { kind: "elf",  ext: [], offset: 0, bytes: [0x7f, 0x45, 0x4c, 0x46] },
];

/** Formats whose content is text and therefore has no reliable magic bytes. */
const TEXT_EXT = new Set([
  ".cube", ".3dl", ".csp", ".srt", ".vtt", ".ass", ".ssa", ".sbv",
  ".json", ".txt", ".md", ".csv", ".svg", ".xmp",
]);

/**
 * Kinds that may legitimately arrive as either binary or text.
 *
 * Preset and project formats are the awkward case: Adobe ships some as ZIP
 * containers and some as plain XML, and third-party tools emit both. Requiring
 * a binary signature rejects the XML variants; treating them as always-text
 * rejects the ZIP ones. So: try the signature first, and fall back to a
 * text-plausibility check only for these kinds. Media kinds get no such
 * fallback, because a "video" with no signature is broken, not textual.
 */
const TEXT_TOLERANT_KINDS = new Set(["preset", "colorpreset", "project", "lut", "caption", "data"]);

function extOf(filename) {
  const name = String(filename || "");
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function kindOf(filename) {
  return KIND_BY_EXT[extOf(filename)] || null;
}

function isKnownAssetFile(filename) {
  return kindOf(filename) !== null;
}

function isExecutable(filename) {
  return EXECUTABLE_EXT.has(extOf(filename));
}

/** MP3 has two valid starts: an ID3 tag, or a raw frame sync. */
function looksLikeMp3(bytes) {
  if (bytes.length < 3) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true; // "ID3"
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;                        // frame sync
}

/**
 * Is this buffer plausibly text?
 * Samples the head rather than the whole file: a 40MB caption file is still
 * decided by its first half-kilobyte, and reading it all to find out is waste.
 */
function looksLikeText(bytes) {
  const sample = bytes.subarray ? bytes.subarray(0, 512) : bytes.slice(0, 512);
  let controls = 0;

  for (let i = 0; i < sample.length; i++) {
    const c = sample[i];
    if (c === 0) return { ok: false, reason: "null byte in a text format" };
    // Tab, LF, CR are the legitimate control characters in text.
    if (c < 9 || (c > 13 && c < 32)) controls++;
  }

  if (sample.length && controls / sample.length > 0.1) {
    return { ok: false, reason: "binary content in a text format" };
  }
  return { ok: true, reason: null };
}

function matches(bytes, sig) {
  if (bytes.length < sig.offset + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    if (bytes[sig.offset + i] !== sig.bytes[i]) return false;
  }
  return true;
}

/** Identify a buffer by its magic bytes alone. Returns a kind string or null. */
function detectSignature(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const sig of SIGNATURES) {
    if (matches(b, sig)) return sig.kind;
  }
  if (looksLikeMp3(b)) return "mp3";
  return null;
}

/**
 * Does the content agree with the extension?
 *
 * Returns { ok, detected, reason }. A mismatch is a quarantine trigger: the
 * classic case is an ".mp4" that is really a PE executable.
 */
function verifyContent(filename, bytes) {
  const ext = extOf(filename);
  const detected = detectSignature(bytes);

  if (isExecutable(filename)) {
    return { ok: false, detected, reason: "executable extension" };
  }
  if (detected === "exe" || detected === "elf") {
    return { ok: false, detected, reason: "executable content behind a media extension" };
  }
  if (!KIND_BY_EXT[ext]) {
    return { ok: false, detected, reason: "unrecognised extension " + (ext || "(none)") };
  }

  // Text formats: sanity-check that it is not binary rather than matching magic.
  if (TEXT_EXT.has(ext)) {
    const text = looksLikeText(bytes);
    if (!text.ok) return { ok: false, detected, reason: text.reason };
    return { ok: true, detected: "text", reason: null };
  }

  if (!detected) {
    // No signature: acceptable only where the format genuinely has both a
    // binary and a text form (Adobe presets and project files, mainly).
    if (TEXT_TOLERANT_KINDS.has(KIND_BY_EXT[ext])) {
      const text = looksLikeText(bytes);
      if (text.ok) return { ok: true, detected: "text", reason: null };
      return { ok: false, detected: null, reason: text.reason };
    }
    return { ok: false, detected: null, reason: "no recognisable signature" };
  }

  const sig = SIGNATURES.find((s) => s.kind === detected);
  const allowed = detected === "mp3" ? [".mp3"] : (sig ? sig.ext : []);
  if (!allowed.includes(ext)) {
    return { ok: false, detected, reason: `content is ${detected} but extension is ${ext}` };
  }

  return { ok: true, detected, reason: null };
}

/** Extensions permitted inside an imported archive. */
function archiveEntryAllowed(filename) {
  const ext = extOf(filename);
  if (isExecutable(filename)) return false;
  if (ext === "") return false;
  return Boolean(KIND_BY_EXT[ext]);
}

module.exports = {
  KIND_BY_EXT,
  EXECUTABLE_EXT,
  TEXT_EXT,
  extOf,
  kindOf,
  isKnownAssetFile,
  isExecutable,
  detectSignature,
  verifyContent,
  archiveEntryAllowed,
};
