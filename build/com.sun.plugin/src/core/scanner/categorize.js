"use strict";
/**
 * Deterministic categorization.
 *
 * Resolution order, strongest evidence first:
 *   1. explicit metadata supplied by an adapter or by the user
 *   2. the folder path inside the library
 *   3. keywords in the filename
 *   4. the file extension
 *
 * Every result carries `confidence` and `source` so the UI can surface weak
 * guesses for correction instead of quietly filing things wrong. AI enrichment
 * is deliberately absent: it can be layered on later as an additive pass, but
 * the baseline has to be explainable and reproducible.
 */

const fs = require("fs");
const path = require("path");
const { kindOf, extOf } = require("../util/formats");

let TAXONOMY = null;

function taxonomy() {
  if (!TAXONOMY) {
    const file = path.join(__dirname, "..", "..", "..", "config", "categories.json");
    TAXONOMY = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return TAXONOMY;
}

/** Allow tests and the CLI to inject a taxonomy without touching disk. */
function setTaxonomy(t) {
  TAXONOMY = t;
}

function normalize(text) {
  return String(text || "")
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")   // camelCase -> camel Case
    .replace(/([A-Za-z])(\d)/g, "$1 $2")   // Whoosh01 -> Whoosh 01
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Folder name -> type, derived from the taxonomy `folder` fields. */
function folderTypeMap() {
  const map = new Map();
  const t = taxonomy();
  for (const [typeId, def] of Object.entries(t.types)) {
    // "Effects/Backgrounds" registers both the leaf and the full path.
    const parts = def.folder.split("/");
    map.set(parts[parts.length - 1].toLowerCase(), typeId);
    map.set(def.folder.toLowerCase(), typeId);
  }
  // Common aliases people actually use in their own folder trees.
  map.set("mogrts", "mogrt");
  map.set("motion graphics", "mogrt");
  map.set("essential graphics", "mogrt");
  map.set("sound effects", "sfx");
  map.set("sounds", "sfx");
  map.set("audio", "sfx");
  map.set("sfx", "sfx");
  map.set("luts", "lut");
  map.set("lut", "lut");
  map.set("cube", "lut");
  map.set("titles", "mogrt");
  map.set("lower thirds", "mogrt");
  map.set("transitions", "transition");
  map.set("overlays", "overlay");
  map.set("presets", "preset");
  map.set("captions", "caption");
  map.set("subtitles", "caption");
  map.set("guides", "guide");
  map.set("templates", "template");
  map.set("backgrounds", "background");
  map.set("music", "music");
  return map;
}

let FOLDER_MAP = null;
function folderMap() {
  if (!FOLDER_MAP) FOLDER_MAP = folderTypeMap();
  return FOLDER_MAP;
}

/** Find the best subcategory for a piece of text using the hint table. */
function matchSubcategory(text, allowed) {
  const t = taxonomy();
  const haystack = " " + normalize(text) + " ";
  let best = null;
  let bestLen = 0;

  for (const [sub, hints] of Object.entries(t.subcategoryHints || {})) {
    if (allowed && allowed.length && !allowed.includes(sub)) continue;
    for (const hint of hints) {
      const needle = " " + normalize(hint) + " ";
      // Longer hints are more specific: "film grain" should beat "film".
      if (haystack.includes(needle) && hint.length > bestLen) {
        best = sub;
        bestLen = hint.length;
      }
    }
  }
  return best;
}

/** Score each type by how many of its keywords appear in the text. */
function matchTypeByKeywords(text) {
  const t = taxonomy();
  const haystack = " " + normalize(text) + " ";
  let best = null;
  let bestScore = 0;

  for (const [typeId, def] of Object.entries(t.types)) {
    let score = 0;
    for (const kw of def.keywords || []) {
      if (haystack.includes(" " + normalize(kw) + " ")) score += kw.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = typeId;
    }
  }
  return best ? { type: best, score: bestScore } : null;
}

/** Default type for a file kind when nothing else is known. */
const KIND_DEFAULT_TYPE = {
  mogrt: "mogrt",
  lut: "lut",
  colorpreset: "colorpreset",
  preset: "preset",
  caption: "caption",
  audio: "sfx",
  video: "video",
  image: "image",
  project: "template",
  archive: "template",
  data: "template",
};

/**
 * Categorize one file.
 *
 * @param {string} relativePath - path relative to a library root, e.g. "MOGRT/Cinematic/Titles/x.mogrt"
 * @param {object} hints - { type, category, subcategory, tags, sourceCategories }
 * @returns {{type, category, subcategory, confidence, categorySource}}
 */
function categorize(relativePath, hints = {}) {
  const t = taxonomy();
  const rel = String(relativePath || "").split(path.sep).join("/");
  const segments = rel.split("/").filter(Boolean);
  const filename = segments.length ? segments[segments.length - 1] : rel;
  const folders = segments.slice(0, -1);
  const kind = kindOf(filename);

  // 1. Explicit metadata wins outright.
  if (hints.type && t.types[hints.type]) {
    const def = t.types[hints.type];
    const sub = hints.subcategory
      || matchSubcategory(filename + " " + folders.join(" "), def.categories);
    return {
      type: hints.type,
      category: hints.category || sub || def.categories[0] || "general",
      subcategory: hints.subcategory || sub || null,
      confidence: 1,
      categorySource: "explicit",
    };
  }

  // 2. Folder structure. Walk from the root inward and take the FIRST match:
  //    the library is laid out Type/Category/Subcategory, so in
  //    /MOGRT/Cinematic/Titles/ the type is MOGRT and everything below it
  //    describes it. Matching deepest-first would wrongly consume "Titles"
  //    as the type and discard the folders that carry the real detail.
  //    Match the LONGEST folder run, not the first single folder. Several types
  //    live at a nested path — background is "Effects/Backgrounds" — and taking
  //    the first single-segment hit would classify every background as a plain
  //    effect, which then makes the scanner disagree with the writer about where
  //    a file belongs and produces two records for one file.
  const fm = folderMap();
  let type = null;
  let typeFolderIndex = -1;
  let matchedSegments = 0;

  for (let i = 0; i < folders.length; i++) {
    for (let j = folders.length; j > i; j--) {
      const run = folders.slice(i, j).map(normalize).join("/");
      const candidate = fm.get(run);
      if (candidate && (j - i) > matchedSegments) {
        type = candidate;
        typeFolderIndex = j - 1;
        matchedSegments = j - i;
      }
    }
    if (type) break; // earliest position wins once a match is found
  }

  if (type) {
    const def = t.types[type];
    const below = folders.slice(typeFolderIndex + 1);
    const context = below.join(" ") + " " + filename;

    // Folders below the type folder describe category then subcategory.
    let category = null;
    let subcategory = null;

    for (const folder of below) {
      const n = normalize(folder).replace(/\s+/g, "-");
      if (!category && def.categories.includes(n)) category = n;
      else if (!subcategory) subcategory = n;
    }

    // Keyword hints are constrained to this type's own vocabulary. Without the
    // constraint a caption template called "pop-caption" picks up "ui" from the
    // SFX hints and gets filed under Captions/Ui.
    const hinted = matchSubcategory(context, def.categories);
    if (!category && hinted) category = hinted;
    if (!subcategory && hinted && hinted !== category) subcategory = hinted;

    return {
      type,
      category: category || hinted || def.categories[0] || "general",
      subcategory: subcategory || null,
      confidence: below.length ? 0.9 : 0.8,
      categorySource: "folder",
    };
  }

  // 3. Filename keywords.
  const kw = matchTypeByKeywords(filename + " " + folders.join(" "));
  if (kw) {
    const def = t.types[kw.type];
    const sub = matchSubcategory(filename + " " + folders.join(" "), def.categories);
    // A keyword type that contradicts the file kind is weak evidence: a ".wav"
    // named "title whoosh" is an SFX, not a title template.
    const kindOk = !kind || (def.kinds || []).includes(kind);
    if (kindOk) {
      return {
        type: kw.type,
        category: sub || def.categories[0] || "general",
        subcategory: sub || null,
        confidence: 0.6,
        categorySource: "filename",
      };
    }
  }

  // 4. Extension fallback.
  const fallbackType = KIND_DEFAULT_TYPE[kind] || "template";
  const def = t.types[fallbackType] || { categories: [] };
  const sub = matchSubcategory(filename + " " + folders.join(" "), def.categories);

  return {
    type: fallbackType,
    category: sub || def.categories[0] || "general",
    subcategory: sub || null,
    confidence: kind ? 0.4 : 0.2,
    categorySource: kind ? "extension" : "unknown",
  };
}

/** "film-burn" -> "Film Burn", for folder names that a human will read. */
function titleCase(slug) {
  return String(slug)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Where a newly acquired asset of this classification should be filed.
 * Mirrors the read layout exactly — Type/Category/Subcategory — so a rescan of
 * what the ingestor wrote reproduces the same classification.
 */
function targetFolder(classification) {
  const t = taxonomy();
  const def = t.types[classification.type];
  const baseFolder = def ? def.folder : "Templates";
  const parts = [baseFolder];
  const leaf = baseFolder.split("/").pop().toLowerCase();

  // Skip a category that just restates the type folder, so a caption template
  // lands in Captions/Karaoke rather than Captions/Captions/Karaoke.
  const category = classification.category;
  if (category && category !== "general" && titleCase(category).toLowerCase() !== leaf) {
    parts.push(titleCase(category));
  }
  if (classification.subcategory && classification.subcategory !== classification.category) {
    parts.push(titleCase(classification.subcategory));
  }
  return parts.join("/");
}

module.exports = {
  categorize,
  targetFolder,
  matchSubcategory,
  normalize,
  taxonomy,
  setTaxonomy,
  extOf,
};
