"use strict";
/**
 * AssetSourceAdapter — the interface every source implements.
 *
 * Deliberately not one giant scraper. Each source gets its own adapter because
 * no two of them are shaped alike: Openverse returns normalised license fields,
 * the Internet Archive needs a second request to enumerate an item's files,
 * Wikimedia buries the license in extmetadata, and GitHub needs the repository
 * license checked before any blob is touched.
 *
 * Contract:
 *   1. verifyLicense() runs before download(). The queue enforces it.
 *   2. If the source forbids automation, download() throws ManualOnlySourceError.
 *   3. getAssetPage() must never fail — link-out is the universal fallback.
 *   4. No adapter executes downloaded content or follows an undeclared redirect.
 */

const { ManualOnlySourceError, assertUrlAllowed, GuardError } = require("../queue/guards");

/** SPDX normalisation across the several spellings sources use in practice. */
const SPDX_ALIASES = {
  "cc0": "CC0-1.0",
  "cc0-1.0": "CC0-1.0",
  "cc zero": "CC0-1.0",
  "creative commons 0": "CC0-1.0",
  "creative commons zero": "CC0-1.0",
  "publicdomain": "PDM-1.0",
  "public domain": "PDM-1.0",
  "pdm": "PDM-1.0",
  "public domain mark": "PDM-1.0",
  "by": "CC-BY-4.0",
  "cc-by": "CC-BY-4.0",
  "cc by": "CC-BY-4.0",
  "attribution": "CC-BY-4.0",
  "by-sa": "CC-BY-SA-4.0",
  "cc-by-sa": "CC-BY-SA-4.0",
  "mit": "MIT",
  "apache-2.0": "Apache-2.0",
  "unlicense": "Unlicense",
  "bsd-2-clause": "BSD-2-Clause",
  "bsd-3-clause": "BSD-3-Clause",
};

function normalizeSpdx(raw, version) {
  if (!raw) return null;
  const key = String(raw).toLowerCase().trim();
  if (SPDX_ALIASES[key]) {
    const base = SPDX_ALIASES[key];
    // Preserve a specific CC version when the source gave one.
    if (version && /^CC-BY/.test(base)) return base.replace(/4\.0$/, String(version));
    return base;
  }
  // Already SPDX-shaped.
  if (/^[A-Za-z0-9.\-+]+$/.test(raw)) return raw;
  return null;
}

class AssetSourceAdapter {
  constructor(source, policy = {}) {
    this.source = source;
    this.policy = policy;
    this.id = source.id;
    this.name = source.name;
  }

  /* ------------------------------------------------------------- required */

  /**
   * @param {string} query
   * @param {object} opts { category, limit, page }
   * @returns {Promise<DiscoveryResult[]>}
   */
  async search() {
    throw new Error(`${this.constructor.name} does not implement search()`);
  }

  /** Full metadata for one result. */
  async getMetadata(ref) {
    return ref;
  }

  /**
   * A human-facing page for this asset or source.
   * This is the one method that must always work: it is the fallback whenever
   * automation is unavailable, blocked or has failed.
   */
  getAssetPage(ref) {
    if (ref && ref.pageUrl) return ref.pageUrl;
    if (ref && ref.sourceUrl) return ref.sourceUrl;
    return this.source.url || null;
  }

  /** @returns {Promise<{url, filename, bytes, mime}|null>} */
  async getDownloadInformation() {
    return null;
  }

  /** @returns {Promise<{allowed, spdx, url, attribution, raw}>} */
  async verifyLicense(ref) {
    // Prefer the SPDX id the adapter already resolved. Several sources report
    // the license as a URL ("http://creativecommons.org/licenses/by/3.0/"),
    // which is not parseable as an SPDX token — re-deriving it here would
    // reject perfectly valid CC-BY material.
    const spdx = (ref && ref.spdx)
      || normalizeSpdx(ref && ref.license, ref && ref.licenseVersion);
    const filter = this.source.licenseFilter;

    let allowed = Boolean(spdx);
    if (allowed && Array.isArray(filter) && filter.length) {
      // Match against the raw value AND the resolved id, since a filter entry
      // may be written either way ("cc0", "publicdomain", "CC0-1.0").
      const haystack = `${ref.license || ""} ${spdx}`.toLowerCase();
      allowed = filter.some((f) => haystack.includes(String(f).toLowerCase()));
    }

    return {
      allowed,
      spdx,
      url: (ref && ref.licenseUrl) || null,
      attribution: (ref && ref.attribution) || null,
      raw: ref && ref.license,
    };
  }

  /** Fetch the bytes. Manual-only sources throw instead. */
  async download() {
    throw new ManualOnlySourceError(this.source);
  }

  /** Map a raw source record onto the Sun Plugin asset manifest shape. */
  normalizeMetadata(raw) {
    return {
      name: raw.title || raw.name || "Untitled",
      type: raw.type || null,
      category: raw.category || null,
      subcategory: raw.subcategory || null,
      source: this.id,
      sourceUrl: raw.pageUrl || raw.url || null,
      author: raw.author || raw.creator || null,
      license: raw.spdx || raw.license || null,
      licenseUrl: raw.licenseUrl || null,
      attribution: raw.attribution || null,
      developmentOnly: true,
      meta: {
        title: raw.title || raw.name,
        description: raw.description || null,
        sourceTags: raw.tags || [],
      },
    };
  }

  /* -------------------------------------------------------------- helpers */

  get userAgent() {
    return (this.policy && this.policy.defaultUserAgent)
      || "SunPlugin/0.1 (development asset ingestor)";
  }

  headers(extra = {}) {
    return { "User-Agent": this.userAgent, Accept: "application/json", ...extra };
  }

  /** Credential for this source, from the environment. Never persisted. */
  credential() {
    const auth = this.source.auth;
    if (!auth || !auth.envVar) return null;
    return process.env[auth.envVar] || null;
  }

  /**
   * Guarded JSON fetch. Every network call in every adapter goes through here,
   * so the URL allowlist and the timeout apply uniformly.
   */
  async fetchJson(url, opts = {}) {
    assertUrlAllowed(url, this.source, this.policy);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 20000);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.headers(opts.headers),
        redirect: "follow",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new GuardError(`${this.name} returned HTTP ${response.status}`, "HTTP_ERROR");
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Guarded binary fetch, returning bytes plus what the server said they are. */
  async fetchBytes(url, opts = {}) {
    assertUrlAllowed(url, this.source, this.policy);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 120000);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.headers({ Accept: "*/*", ...opts.headers }),
        redirect: "follow",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new GuardError(`${this.name} returned HTTP ${response.status}`, "HTTP_ERROR");
      }

      // A redirect chain can land somewhere we never allowlisted.
      if (response.url && response.url !== url) {
        assertUrlAllowed(response.url, this.source, this.policy);
      }

      const buffer = await response.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        contentType: response.headers.get("content-type"),
        contentDisposition: response.headers.get("content-disposition"),
        finalUrl: response.url || url,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { AssetSourceAdapter, normalizeSpdx, SPDX_ALIASES };
