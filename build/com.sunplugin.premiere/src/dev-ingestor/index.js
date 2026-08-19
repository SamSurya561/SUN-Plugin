"use strict";
/**
 * Development Asset Ingestor — entry point.
 *
 * THIS ENTIRE DIRECTORY IS TEMPORARY AND REMOVABLE.
 *
 * It registers itself into the core feature registry rather than being imported
 * by the core. Delete `src/dev-ingestor/` and the registration simply never
 * happens: the Development Asset Tools disappear from the UI, and the Asset
 * Browser, search, favourites, collections, preview, database, MOGRT/SFX/LUT/
 * preset handling, Premiere integration and both host adapters keep working
 * untouched. That property is verified by tools/check-boundaries.mjs.
 */

const featureRegistry = require("../core/feature-registry");
const { SourceRegistry } = require("./registry");
const { DownloadQueue, STATUS } = require("./queue/queue");
const { ManualOnlySourceError, GuardError } = require("./queue/guards");

const FEATURE_ID = "development-assets";

class DevelopmentIngestor {
  constructor(db, opts = {}) {
    this.db = db;
    this.registry = new SourceRegistry(opts.configPath).load();
    this.queue = new DownloadQueue(db, {
      concurrency: opts.concurrency || 2,
      maxRetries: opts.maxRetries || 2,
    });
  }

  /* ------------------------------------------------------------- sources */

  listSources(opts) {
    return this.registry.list(opts);
  }

  sourceSummary() {
    return this.registry.summary();
  }

  setSourceEnabled(id, enabled) {
    return this.registry.setEnabled(id, enabled);
  }

  /**
   * Check every source: is it configured, credentialled and reachable?
   * Reachability is only probed for sources that are already enabled, so a
   * disabled source never causes a network call.
   */
  async scanSources({ probe = false } = {}) {
    const results = [];

    for (const source of this.registry.list()) {
      const entry = {
        id: source.id,
        name: source.name,
        enabled: Boolean(source.enabled) && !source.blocked,
        blocked: Boolean(source.blocked),
        reason: source.blockedReason || source.enabledReason || null,
        automationAllowed: Boolean(source.automationAllowed),
        accessMethod: source.accessMethod,
        classification: source.classification || [],
        categories: source.categories,
        reachable: null,
      };

      if (probe && entry.enabled && source.automationAllowed && source.domains && source.domains.length) {
        try {
          const adapter = this.registry.adapterFor(source.id);
          await adapter.search("test", { limit: 1 });
          entry.reachable = true;
        } catch (e) {
          entry.reachable = false;
          entry.probeError = e.message;
        }
      }

      results.push(entry);
    }

    return results;
  }

  /* ----------------------------------------------------------- discovery */

  /**
   * Search across enabled sources.
   * A failure in one source never aborts the others — a rate-limited Openverse
   * should not stop the local generator from returning results.
   */
  async discover(query, opts = {}) {
    const sources = this.registry.list({ enabledOnly: true, category: opts.category })
      .filter((s) => !opts.sources || opts.sources.includes(s.id));

    const found = [];
    const errors = [];

    for (const source of sources) {
      let adapter;
      try {
        adapter = this.registry.adapterFor(source.id);
      } catch (e) {
        errors.push({ source: source.id, error: e.message });
        continue;
      }

      try {
        const results = await adapter.search(query, opts);
        for (const ref of results) {
          found.push({
            ...ref,
            _sourceId: source.id,
            _manualOnly: !source.automationAllowed,
            _pageUrl: safe(() => adapter.getAssetPage(ref)),
          });
        }
      } catch (e) {
        errors.push({
          source: source.id,
          error: e.message,
          code: e.code || null,
          manualOnly: e instanceof ManualOnlySourceError,
          pageUrl: source.url,
        });
      }
    }

    return { query, found, errors, sourcesSearched: sources.map((s) => s.id) };
  }

  /* ------------------------------------------------------------ download */

  /** Queue discovery results and run them. */
  async download(refs, opts = {}) {
    for (const ref of refs) {
      const sourceId = ref._sourceId || opts.sourceId;
      const source = this.registry.get(sourceId);
      if (!source) continue;

      let adapter;
      try {
        adapter = this.registry.adapterFor(sourceId);
      } catch (e) {
        continue;
      }
      this.queue.add(adapter, ref, source, opts);
    }

    return this.queue.run();
  }

  /**
   * Generate the local corpus. No network, no license questions, no rate limits.
   * This is how the development library actually gets filled.
   */
  async generate(opts = {}) {
    const source = this.registry.get("synthetic");
    if (!source) throw new Error("synthetic source is not registered");

    const adapter = this.registry.adapterFor("synthetic");
    const refs = await adapter.search(opts.query || "", {
      type: opts.type,
      category: opts.category,
      limit: opts.limit,
    });

    const { ingestBuffer } = require("../core/library/ingest");
    const stats = { generated: 0, duplicates: 0, quarantined: 0, byType: {}, bytes: 0 };

    for (const ref of refs) {
      const meta = adapter.normalizeMetadata(ref);
      let downloaded;
      try {
        downloaded = await adapter.download(ref);
      } catch (e) {
        stats.quarantined++;
        continue;
      }

      const result = ingestBuffer(this.db, {
        bytes: downloaded.bytes,
        filename: downloaded.filename,
        developmentOnly: true,
        source: "synthetic",
        license: "CC0-1.0",
        licenseUrl: meta.licenseUrl,
        author: meta.author,
        syntheticFixture: ref.syntheticFixture,
        hints: { type: ref.type, category: ref.category, subcategory: ref.subcategory },
        meta: meta.meta,
        thumbnails: opts.thumbnails !== false,
      });

      if (result.quarantined) stats.quarantined++;
      else if (result.duplicate) stats.duplicates++;
      else {
        stats.generated++;
        stats.bytes += result.asset.bytes;
        stats.byType[result.asset.type] = (stats.byType[result.asset.type] || 0) + 1;
      }

      if (opts.onProgress && (stats.generated + stats.duplicates) % 25 === 0) {
        opts.onProgress({ ...stats, total: refs.length });
      }
    }

    return stats;
  }

  /** Sources that need a human, for the manual worklist panel. */
  manualSources(category) {
    const source = this.registry.get("manual");
    if (!source) return [];
    return (source.sites || []).filter((s) => !category || (s.categories || []).includes(category));
  }
}

function safe(fn) {
  try { return fn(); } catch (e) { return null; }
}

/**
 * Register with the core. Called by the plugin bootstrap IF this module exists.
 * The core never calls into this file directly.
 */
function activate(db, opts = {}) {
  const ingestor = new DevelopmentIngestor(db, opts);

  featureRegistry.register(FEATURE_ID, {
    label: "Development Asset Tools",
    version: "0.1.0",
    developmentOnly: true,
    ingestor,
    commands: [
      { id: "dev.research", label: "Research Sources", run: () => ingestor.sourceSummary() },
      { id: "dev.scan", label: "Scan Sources", run: (o) => ingestor.scanSources(o) },
      { id: "dev.discover", label: "Discover Assets", run: (q, o) => ingestor.discover(q, o) },
      { id: "dev.download", label: "Download Selected", run: (refs, o) => ingestor.download(refs, o) },
      { id: "dev.generate", label: "Generate Test Assets", run: (o) => ingestor.generate(o) },
    ],
    teardown: () => ingestor.queue.cancel(),
  });

  return ingestor;
}

module.exports = {
  DevelopmentIngestor,
  activate,
  FEATURE_ID,
  STATUS,
  GuardError,
  ManualOnlySourceError,
};
