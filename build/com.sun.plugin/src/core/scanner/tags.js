"use strict";
/**
 * Deterministic tag extraction.
 *
 * Tags come from the filename, the folder path, the classification, and the
 * source metadata, expanded through a synonym table. No model in the loop: the
 * same file always produces the same tags, which matters because tags are what
 * search runs against and a shifting tag set makes search feel broken.
 */

const path = require("path");
const { taxonomy, normalize } = require("./categorize");

/** Structural library root folders that carry no descriptive meaning. */
const LIBRARY_ROOTS = new Set(["library", "developmentlibrary"]);

/** Source labels too generic to be useful as tags. */
const GENERIC_SOURCES = new Set(["local-scan", "unknown", "user-import"]);

/** Tokens that carry no search value on their own. */
function stopwords() {
  return new Set((taxonomy().stopwords || []).map((s) => s.toLowerCase()));
}

function synonyms() {
  return taxonomy().tagSynonyms || {};
}

/**
 * Split a filename into meaningful words.
 * Handles snake_case, kebab-case, camelCase, and trailing sequence numbers.
 */
function words(text) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Build the tag list for an asset.
 *
 * @param {string} relativePath
 * @param {object} classification - result of categorize()
 * @param {object} meta - { source, author, title, description, sourceTags }
 */
function generateTags(relativePath, classification = {}, meta = {}) {
  const stop = stopwords();
  const syn = synonyms();
  const tags = new Set();

  const add = (raw) => {
    const t = String(raw || "").toLowerCase().trim();
    if (!t) return;
    if (t.length < 2) return;
    if (stop.has(t)) return;
    if (/^v\d+$/.test(t)) return;     // "v2"
    // Digit-leading tokens are almost always sequence numbers or resolution
    // fragments ("001", "1920x"). The exceptions are real format vocabulary,
    // which editors do search for.
    if (/^\d/.test(t) && !/^\d+(mm|k|bit|fps|s|hz)$/.test(t)) return;
    tags.add(t);
  };

  const rel = String(relativePath || "").split(path.sep).join("/");
  let segments = rel.split("/").filter(Boolean);

  // The library root folder is structural, not descriptive. Without this every
  // development asset picks up "development" and "library" as tags, which then
  // match every search for either word.
  if (segments.length > 1 && LIBRARY_ROOTS.has(segments[0].toLowerCase())) {
    segments = segments.slice(1);
  }

  const filename = segments.length ? segments[segments.length - 1] : rel;
  const base = filename.replace(/\.[^.]+$/, "");
  const folders = segments.slice(0, -1);

  // Filename words.
  for (const w of words(base)) add(w);

  // Folder words. The library root folders are structural, not descriptive, so
  // they are added via the classification instead of verbatim.
  for (const folder of folders) {
    for (const w of words(folder)) add(w);
  }

  // Classification.
  if (classification.type) add(classification.type);
  if (classification.category) for (const w of words(classification.category)) add(w);
  if (classification.subcategory) for (const w of words(classification.subcategory)) add(w);

  // Source-provided tags and free text.
  if (Array.isArray(meta.sourceTags)) for (const t of meta.sourceTags) for (const w of words(t)) add(w);
  if (meta.title) for (const w of words(meta.title)) add(w);
  if (meta.author) add(normalize(meta.author).replace(/\s+/g, "-"));
  if (meta.source && !GENERIC_SOURCES.has(meta.source)) add(meta.source);

  // Description contributes only its first words; whole paragraphs would swamp
  // the tag set and make every asset match every query.
  if (meta.description) {
    for (const w of words(meta.description).slice(0, 12)) add(w);
  }

  // Synonym expansion, one level only so tags stay predictable.
  for (const tag of [...tags]) {
    const extra = syn[tag];
    if (extra) for (const e of extra) add(e);
  }

  return [...tags].sort();
}

module.exports = { generateTags, words };
