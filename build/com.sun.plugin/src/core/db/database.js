"use strict";
/**
 * The asset database.
 *
 * One record shape for every asset, whatever its origin. `source` is a label,
 * never a branch: no query, sort, or render path in the core asks "did this come
 * from the internet?". That is what makes the development ingestor removable and
 * what lets a development asset be replaced by an owned one without breaking any
 * reference to it.
 *
 * Storage is a single JSON document. At the scale this plugin targets (tens of
 * thousands of assets) that loads in well under a second and keeps the library
 * trivially portable, inspectable and diffable. Queries run against in-memory
 * indexes rebuilt on load.
 */

const fs = require("fs");
const path = require("path");
const { paths, ensureDir } = require("../library/paths");

const SCHEMA_VERSION = 1;

/** Fields a filesystem scan cannot re-derive, and so must never overwrite with null. */
const PROVENANCE_FIELDS = [
  "license", "licenseUrl", "author", "attribution", "sourceUrl", "downloadedAt",
];

/** Source labels that mean "we do not actually know where this came from". */
const GENERIC_SOURCES = new Set(["local-scan", "unknown", null, undefined]);

/** Fields that make up an asset record. Anything else is preserved but ignored. */
function normalizeAsset(input) {
  const now = new Date().toISOString();
  return {
    id: String(input.id),
    name: input.name || "Untitled",
    type: input.type || "unknown",
    category: input.category || "uncategorized",
    subcategory: input.subcategory || null,
    file: input.file || null,               // library-root-relative
    thumbnail: input.thumbnail || null,
    preview: input.preview || null,
    source: input.source || "unknown",
    sourceUrl: input.sourceUrl || null,
    author: input.author || null,
    license: input.license || null,
    licenseUrl: input.licenseUrl || null,
    attribution: input.attribution || null,
    downloadedAt: input.downloadedAt || now,
    addedAt: input.addedAt || now,
    updatedAt: now,
    developmentOnly: input.developmentOnly === true,
    syntheticFixture: input.syntheticFixture === true,
    sha256: input.sha256 || null,
    bytes: typeof input.bytes === "number" ? input.bytes : 0,
    duration: typeof input.duration === "number" ? input.duration : null,
    width: input.width || null,
    height: input.height || null,
    tags: Array.isArray(input.tags) ? [...new Set(input.tags.map((t) => String(t).toLowerCase()))] : [],
    favorite: input.favorite === true,
    collections: Array.isArray(input.collections) ? [...new Set(input.collections)] : [],
    rating: typeof input.rating === "number" ? input.rating : 0,
    useCount: typeof input.useCount === "number" ? input.useCount : 0,
    lastUsedAt: input.lastUsedAt || null,
    categorySource: input.categorySource || null,
    categoryConfidence: typeof input.categoryConfidence === "number" ? input.categoryConfidence : null,
    userCorrected: input.userCorrected === true,
    replacedFrom: input.replacedFrom || null,
    quarantined: input.quarantined === true,
    quarantineReason: input.quarantineReason || null,
    notes: input.notes || null,
  };
}

/**
 * One shared collator.
 *
 * String.prototype.localeCompare constructs a collator on every call, which at
 * 12k assets made sorting the dominant cost in a query. Reusing one instance
 * turns a ~450ms sort into a ~40ms one.
 */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "variant" });

/** Split a string into lowercase search tokens. */
function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

class AssetDatabase {
  constructor(file = paths.dbFile) {
    this.file = file;
    this.assets = new Map();       // id -> record
    this.collections = new Map();  // name -> { name, created, description }
    this.settings = {};
    this.byHashIndex = new Map();  // sha256 -> Set<id>
    this.tokenIndex = new Map();   // token -> Set<id>
    this.dirty = false;
    this.loaded = false;
  }

  /* --------------------------------------------------------------- indexes */

  indexAsset(asset) {
    if (asset.sha256) {
      if (!this.byHashIndex.has(asset.sha256)) this.byHashIndex.set(asset.sha256, new Set());
      this.byHashIndex.get(asset.sha256).add(asset.id);
    }
    for (const token of this.searchTokens(asset)) {
      if (!this.tokenIndex.has(token)) this.tokenIndex.set(token, new Set());
      this.tokenIndex.get(token).add(asset.id);
    }
  }

  deindexAsset(asset) {
    if (asset.sha256 && this.byHashIndex.has(asset.sha256)) {
      const set = this.byHashIndex.get(asset.sha256);
      set.delete(asset.id);
      if (set.size === 0) this.byHashIndex.delete(asset.sha256);
    }
    for (const token of this.searchTokens(asset)) {
      const set = this.tokenIndex.get(token);
      if (set) {
        set.delete(asset.id);
        if (set.size === 0) this.tokenIndex.delete(token);
      }
    }
  }

  searchTokens(asset) {
    const tokens = new Set();
    for (const t of tokenize(asset.name)) tokens.add(t);
    for (const t of asset.tags) for (const x of tokenize(t)) tokens.add(x);
    for (const t of tokenize(asset.type)) tokens.add(t);
    for (const t of tokenize(asset.category)) tokens.add(t);
    for (const t of tokenize(asset.subcategory)) tokens.add(t);
    for (const t of tokenize(asset.author)) tokens.add(t);
    return tokens;
  }

  rebuildIndexes() {
    this.byHashIndex.clear();
    this.tokenIndex.clear();
    for (const asset of this.assets.values()) this.indexAsset(asset);
  }

  /* ------------------------------------------------------------ persistence */

  load() {
    this.assets.clear();
    this.collections.clear();

    if (fs.existsSync(this.file)) {
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(this.file, "utf8"));
      } catch (e) {
        // A corrupt index must never lose the library: the files on disk are the
        // real asset, and a rescan reconstructs the index.
        const backup = this.file + ".corrupt-" + Date.now();
        fs.renameSync(this.file, backup);
        doc = { version: SCHEMA_VERSION, assets: [], collections: [], settings: {} };
        this.loadError = `index was unreadable and moved to ${path.basename(backup)}; run a rescan`;
      }

      for (const a of doc.assets || []) {
        const asset = normalizeAsset(a);
        this.assets.set(asset.id, asset);
      }
      for (const c of doc.collections || []) this.collections.set(c.name, c);
      this.settings = doc.settings || {};
    }

    this.rebuildIndexes();
    this.loaded = true;
    this.dirty = false;
    return this;
  }

  save() {
    ensureDir(path.dirname(this.file));
    const doc = {
      version: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      assets: [...this.assets.values()],
      collections: [...this.collections.values()],
      settings: this.settings,
    };

    // Write to a sibling temp file and rename: an interrupted save must not be
    // able to truncate a good index.
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
    this.dirty = false;
    return this;
  }

  /* ------------------------------------------------------------------ CRUD */

  upsert(input) {
    const asset = normalizeAsset(input);
    const existing = this.assets.get(asset.id);

    if (existing) {
      this.deindexAsset(existing);

      // Provenance survives a rescan. A filesystem scan cannot read a license,
      // an author or a source URL off the bytes, so it supplies null for all of
      // them — and without this, rescanning the library silently erases the
      // licensing information that made the asset safe to use in the first place.
      for (const field of PROVENANCE_FIELDS) {
        if (asset[field] == null && existing[field] != null) asset[field] = existing[field];
      }
      // Likewise the source: a scan reporting "local-scan" must not relabel an
      // asset that came from a known source.
      if (GENERIC_SOURCES.has(asset.source) && !GENERIC_SOURCES.has(existing.source)) {
        asset.source = existing.source;
      }
      if (existing.syntheticFixture) asset.syntheticFixture = true;

      // User-owned fields win over anything a rescan or re-download supplies.
      asset.favorite = existing.favorite;
      asset.collections = existing.collections;
      asset.rating = existing.rating;
      asset.useCount = existing.useCount;
      asset.lastUsedAt = existing.lastUsedAt;
      asset.addedAt = existing.addedAt;
      asset.notes = existing.notes;
      if (existing.userCorrected) {
        asset.type = existing.type;
        asset.category = existing.category;
        asset.subcategory = existing.subcategory;
        asset.userCorrected = true;
      }
    }

    this.assets.set(asset.id, asset);
    this.indexAsset(asset);
    this.dirty = true;
    return asset;
  }

  get(id) {
    return this.assets.get(id) || null;
  }

  remove(id) {
    const asset = this.assets.get(id);
    if (!asset) return false;
    this.deindexAsset(asset);
    this.assets.delete(id);
    this.dirty = true;
    return true;
  }

  all() {
    return [...this.assets.values()];
  }

  get size() {
    return this.assets.size;
  }

  /** Every asset sharing a content hash. This is how duplicates are found. */
  byHash(sha256) {
    const ids = this.byHashIndex.get(sha256);
    return ids ? [...ids].map((id) => this.assets.get(id)).filter(Boolean) : [];
  }

  /* ----------------------------------------------------------------- query */

  /**
   * Candidate ids for a text query, using the token index. Falls back to a
   * prefix scan so search-as-you-type matches before a word is finished.
   */
  textCandidates(text) {
    const terms = tokenize(text);
    if (terms.length === 0) return null;

    let result = null;
    for (const term of terms) {
      let ids = this.tokenIndex.get(term);
      if (!ids) {
        // Prefix match: "whoo" should find "whoosh".
        const merged = new Set();
        for (const [token, set] of this.tokenIndex) {
          if (token.startsWith(term)) for (const id of set) merged.add(id);
        }
        ids = merged;
      }
      if (ids.size === 0) return new Set();
      result = result === null ? new Set(ids) : new Set([...result].filter((id) => ids.has(id)));
      if (result.size === 0) return result;
    }
    return result;
  }

  /**
   * The single query entry point used by the Asset Browser.
   * Every filter is optional; omitted filters do not constrain.
   */
  query(opts = {}) {
    const {
      text, type, category, subcategory, tags, source, license,
      developmentOnly, favorite, collection, includeQuarantined = false,
      sort = "name", order = "asc", limit = 0, offset = 0,
    } = opts;

    const candidates = text ? this.textCandidates(text) : null;
    const pool = candidates
      ? [...candidates].map((id) => this.assets.get(id)).filter(Boolean)
      : this.all();

    const wantTags = tags && tags.length ? tags.map((t) => String(t).toLowerCase()) : null;

    let results = pool.filter((a) => {
      if (!includeQuarantined && a.quarantined) return false;
      if (type && a.type !== type) return false;
      if (category && a.category !== category) return false;
      if (subcategory && a.subcategory !== subcategory) return false;
      if (source && a.source !== source) return false;
      if (license && a.license !== license) return false;
      if (developmentOnly !== undefined && a.developmentOnly !== developmentOnly) return false;
      if (favorite !== undefined && a.favorite !== favorite) return false;
      if (collection && !a.collections.includes(collection)) return false;
      if (wantTags && !wantTags.every((t) => a.tags.includes(t))) return false;
      return true;
    });

    // Sorting dominates the cost of a query, and facet counting does not care
    // about order, so it is skippable.
    if (!opts.skipSort) {
      const dir = order === "desc" ? -1 : 1;
      const cmp = {
        name: (a, b) => COLLATOR.compare(a.name, b.name),
        added: (a, b) => String(a.addedAt).localeCompare(String(b.addedAt)),
        updated: (a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)),
        size: (a, b) => a.bytes - b.bytes,
        duration: (a, b) => (a.duration || 0) - (b.duration || 0),
        rating: (a, b) => a.rating - b.rating,
        used: (a, b) => a.useCount - b.useCount,
        type: (a, b) => COLLATOR.compare(a.type, b.type) || COLLATOR.compare(a.name, b.name),
      }[sort] || ((a, b) => COLLATOR.compare(a.name, b.name));

      results.sort((a, b) => cmp(a, b) * dir);
    }

    const total = results.length;
    if (offset) results = results.slice(offset);
    if (limit) results = results.slice(0, limit);

    return { total, offset, limit, results };
  }

  /* ----------------------------------------------------------------- facets */

  /** Counts per type/category/source/license/tag, for the browser sidebar. */
  facets(opts = {}) {
    const { results } = this.query({ ...opts, limit: 0, offset: 0, skipSort: true });
    const count = (list, key) => {
      const map = new Map();
      for (const a of list) {
        const v = a[key];
        if (v == null) continue;
        map.set(v, (map.get(v) || 0) + 1);
      }
      return [...map.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => ({ value: k, count: n }));
    };

    const tagCounts = new Map();
    for (const a of results) {
      for (const t of a.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }

    return {
      type: count(results, "type"),
      category: count(results, "category"),
      subcategory: count(results, "subcategory"),
      source: count(results, "source"),
      license: count(results, "license"),
      tags: [...tagCounts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 60)
        .map(([k, n]) => ({ value: k, count: n })),
    };
  }

  stats() {
    const all = this.all();
    const byType = {};
    let devCount = 0;
    let bytes = 0;
    let quarantined = 0;

    for (const a of all) {
      byType[a.type] = (byType[a.type] || 0) + 1;
      if (a.developmentOnly) devCount++;
      if (a.quarantined) quarantined++;
      bytes += a.bytes || 0;
    }

    return {
      total: all.length,
      developmentOnly: devCount,
      permanent: all.length - devCount,
      quarantined,
      bytes,
      collections: this.collections.size,
      favorites: all.filter((a) => a.favorite).length,
      byType,
    };
  }
}

module.exports = { AssetDatabase, normalizeAsset, tokenize, SCHEMA_VERSION };
