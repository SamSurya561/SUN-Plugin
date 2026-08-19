"use strict";
/**
 * Sun Plugin bootstrap.
 *
 * The ONLY file permitted to reference the development ingestor, and it does so
 * defensively: the module is loaded optionally through the feature registry. If
 * `src/dev-ingestor/` has been deleted, or Development Asset Mode is off,
 * `tryLoad` returns null and the plugin carries on with no error and no missing
 * feature — the tools simply are not there.
 *
 * Everything below this line is offline-capable. Nothing in the core performs
 * network I/O.
 */

const featureRegistry = require("./core/feature-registry");
const { AssetDatabase } = require("./core/db/database");
const { paths, ensureLibrary } = require("./core/library/paths");
const { scanLibrary, rebuildIndex } = require("./core/scanner/scan");
const { importPath, importFile, importFolder, importArchive } = require("./core/importer/import");
const { replaceAsset, promoteToPermanent, purgeDevelopmentAssets } = require("./core/library/replace");
const { exportMetadata, writeExport, importLibrary } = require("./core/library/migrate");
const collections = require("./core/library/collections");

const DEFAULT_SETTINGS = {
  developmentAssetMode: false,
  showDevelopmentBadges: true,
  thumbnailsOnScan: true,
  gridSize: "medium",
  theme: "auto",
};

class SunPlugin {
  constructor(opts = {}) {
    ensureLibrary({ development: opts.developmentAssetMode !== false });
    this.db = new AssetDatabase(opts.dbFile).load();
    this.settings = { ...DEFAULT_SETTINGS, ...this.db.settings, ...(opts.settings || {}) };
    this.ingestor = null;
  }

  /* ------------------------------------------------------------ lifecycle */

  /**
   * Start the plugin. Development tools are attached only when the setting is
   * on AND the module is present; either being false is a normal, silent state.
   */
  start() {
    if (this.settings.developmentAssetMode) {
      this.enableDevelopmentAssets();
    }
    return this;
  }

  enableDevelopmentAssets() {
    if (this.ingestor) return this.ingestor;

    const module = featureRegistry.tryLoad("./dev-ingestor");
    if (!module) {
      // Expected in a production build. Not an error.
      this.settings.developmentAssetMode = false;
      return null;
    }

    this.ingestor = module.activate(this.db);
    this.settings.developmentAssetMode = true;
    this.saveSettings();
    return this.ingestor;
  }

  disableDevelopmentAssets() {
    if (featureRegistry.has("development-assets")) {
      featureRegistry.unregister("development-assets");
    }
    this.ingestor = null;
    this.settings.developmentAssetMode = false;
    this.saveSettings();
  }

  get developmentAssetsAvailable() {
    return featureRegistry.has("development-assets");
  }

  saveSettings() {
    this.db.settings = { ...this.settings };
    this.db.save();
  }

  save() {
    this.db.save();
    return this;
  }

  /* ------------------------------------------------- core library surface */

  search(opts) { return this.db.query(opts); }
  facets(opts) { return this.db.facets(opts); }
  stats() { return this.db.stats(); }
  get(id) { return this.db.get(id); }

  scan(opts) { return scanLibrary(this.db, { thumbnails: this.settings.thumbnailsOnScan, ...opts }); }
  rebuild(opts) { return rebuildIndex(this.db, opts); }

  import(target, opts) { return importPath(this.db, target, opts); }
  importFile(target, opts) { return importFile(this.db, target, opts); }
  importFolder(target, opts) { return importFolder(this.db, target, opts); }
  importArchive(target, opts) { return importArchive(this.db, target, opts); }

  replace(id, file, opts) { return replaceAsset(this.db, id, file, opts); }
  promote(id, opts) { return promoteToPermanent(this.db, id, opts); }
  purgeDevelopment(opts) { return purgeDevelopmentAssets(this.db, opts); }

  exportMetadata(opts) { return exportMetadata(this.db, opts); }
  writeExport(file, opts) { return writeExport(this.db, file, opts); }
  importLibrary(doc, root, opts) { return importLibrary(this.db, doc, root, opts); }

  toggleFavorite(id) { return collections.toggleFavorite(this.db, id); }
  addToCollection(id, name) { return collections.addToCollection(this.db, id, name); }
  removeFromCollection(id, name) { return collections.removeFromCollection(this.db, id, name); }
  createCollection(name, desc) { return collections.createCollection(this.db, name, desc); }
  renameCollection(from, to) { return collections.renameCollection(this.db, from, to); }
  deleteCollection(name) { return collections.deleteCollection(this.db, name); }
  listCollections() { return collections.listCollections(this.db); }
  listRecent(limit) { return collections.listRecent(this.db, limit); }
  markUsed(id) { return collections.markUsed(this.db, id); }
  correctCategory(id, patch) { return collections.correctCategory(this.db, id, patch); }
  addTags(id, tags) { return collections.addTags(this.db, id, tags); }
  removeTags(id, tags) { return collections.removeTags(this.db, id, tags); }

  /** Commands from every registered feature, for the panel command list. */
  commands() { return featureRegistry.commands(); }
}

module.exports = {
  SunPlugin,
  featureRegistry,
  paths,
  DEFAULT_SETTINGS,
};
