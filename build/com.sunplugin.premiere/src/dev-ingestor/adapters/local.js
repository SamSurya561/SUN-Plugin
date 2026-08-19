"use strict";
/**
 * The three adapters that do not scrape anything:
 *
 *   SyntheticAdapter    generates assets locally — the primary volume source
 *   DirectUrlAdapter    fetches one URL the user explicitly supplied
 *   ManualSourceAdapter link-out only, for sources that forbid automation
 *
 * ManualSourceAdapter is the important one philosophically. When a site does not
 * permit automated downloading the answer is not a cleverer scraper, it is
 * OPEN SOURCE PAGE -> the human downloads -> IMPORT. That path is first-class
 * here, not a consolation prize.
 */

const { AssetSourceAdapter } = require("./base");
const { ManualOnlySourceError, GuardError, assertUrlAllowed } = require("../queue/guards");
const { filenameFromUrl, filenameFromContentDisposition, safeSegment } = require("../../core/util/safe-name");

/* ------------------------------------------------------------- synthetic */

class SyntheticAdapter extends AssetSourceAdapter {
  constructor(source, policy) {
    super(source, policy);
    this._catalogue = null;
  }

  /** Lazily assemble the full generated catalogue across all three generators. */
  catalogue() {
    if (this._catalogue) return this._catalogue;

    const { generateLUTs } = require("../generator/luts");
    const { generateSFX } = require("../generator/audio");
    const { generateImages } = require("../generator/images");
    const { generateTemplates } = require("../generator/templates");

    this._catalogue = [
      ...generateLUTs(),
      ...generateSFX(),
      ...generateImages(),
      ...generateTemplates(),
    ].map((item, index) => ({
      id: `synthetic-${index}`,
      title: item.name,
      filename: item.filename,
      type: item.type,
      category: item.category,
      subcategory: item.subcategory,
      tags: item.tags || [],
      duration: item.duration || null,
      syntheticFixture: item.syntheticFixture === true,
      spdx: "CC0-1.0",
      license: "CC0-1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      author: "Sun Plugin generator",
      _item: item,
    }));

    return this._catalogue;
  }

  async search(query, opts = {}) {
    const all = this.catalogue();
    const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);

    let results = all;
    if (opts.type) results = results.filter((r) => r.type === opts.type);
    if (opts.category) results = results.filter((r) => r.category === opts.category);

    if (terms.length) {
      results = results.filter((r) => {
        const hay = `${r.title} ${r.type} ${r.category} ${r.subcategory} ${r.tags.join(" ")}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }

    return opts.limit ? results.slice(0, opts.limit) : results;
  }

  getAssetPage() {
    return null; // generated locally; there is no page to open
  }

  async getDownloadInformation(ref) {
    return { url: null, filename: ref.filename, bytes: null, local: true };
  }

  async verifyLicense() {
    return {
      allowed: true,
      spdx: "CC0-1.0",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
      attribution: null,
      raw: "CC0-1.0",
    };
  }

  /** "Download" means render. No network involved. */
  async download(ref) {
    const content = ref._item.content;
    const bytes = typeof content === "string"
      ? new TextEncoder().encode(content)
      : content;
    return { bytes, filename: ref.filename, contentType: null };
  }

  normalizeMetadata(ref) {
    return {
      name: ref.title,
      type: ref.type,
      category: ref.category,
      subcategory: ref.subcategory,
      source: "synthetic",
      sourceUrl: null,
      author: "Sun Plugin generator",
      license: "CC0-1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      attribution: null,
      developmentOnly: true,
      syntheticFixture: ref.syntheticFixture,
      duration: ref.duration,
      meta: { title: ref.title, sourceTags: ref.tags },
    };
  }
}

/* ------------------------------------------------------------ direct URL */

class DirectUrlAdapter extends AssetSourceAdapter {
  /**
   * There is nothing to search: the user supplies a URL. This returns a single
   * result describing what they pasted.
   */
  async search(query) {
    let parsed;
    try {
      parsed = new URL(String(query));
    } catch (e) {
      throw new GuardError(`not a valid URL: ${query}`, "BAD_URL");
    }

    if (parsed.protocol !== "https:") {
      throw new GuardError("only https URLs are accepted", "INSECURE");
    }

    return [{
      id: parsed.href,
      title: filenameFromUrl(parsed.href, "download").replace(/\.[^.]+$/, ""),
      pageUrl: parsed.href,
      downloadUrl: parsed.href,
      license: null,
      spdx: null,
      host: parsed.hostname,
      type: null,
      userSupplied: true,
      tags: [],
    }];
  }

  getAssetPage(ref) {
    return (ref && ref.pageUrl) || null;
  }

  async getDownloadInformation(ref) {
    return {
      url: ref.downloadUrl,
      filename: filenameFromUrl(ref.downloadUrl, "download"),
      bytes: null,
    };
  }

  /**
   * The license is whatever the user asserts. That assertion is recorded on the
   * asset so it is visible later, rather than the asset simply appearing with a
   * blank license field.
   */
  async verifyLicense(ref) {
    if (!ref.userDeclaredLicense) {
      return {
        allowed: false,
        spdx: null,
        url: null,
        attribution: null,
        raw: null,
        reason: "a user-supplied URL needs a declared license before it can be downloaded",
      };
    }
    return {
      allowed: true,
      spdx: ref.userDeclaredLicense,
      url: ref.userDeclaredLicenseUrl || null,
      attribution: ref.attribution || null,
      raw: ref.userDeclaredLicense,
      userDeclared: true,
    };
  }

  async download(ref) {
    // The declared-domains allowlist is empty for this source by design, so the
    // per-source check is skipped; the global host blocklist in guards still
    // applies, and every other validation downstream is unchanged.
    const url = ref.downloadUrl;
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new GuardError("only https is accepted", "INSECURE");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": this.userAgent, Accept: "*/*" },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) throw new GuardError(`HTTP ${response.status}`, "HTTP_ERROR");

      const buffer = await response.arrayBuffer();
      const disposition = response.headers.get("content-disposition");

      return {
        bytes: new Uint8Array(buffer),
        filename: filenameFromContentDisposition(disposition) || filenameFromUrl(url, "download"),
        contentType: response.headers.get("content-type"),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  normalizeMetadata(ref) {
    return {
      ...super.normalizeMetadata(ref),
      source: "direct-url",
      license: ref.userDeclaredLicense || null,
      meta: {
        title: ref.title,
        description: `User-supplied URL from ${ref.host}`,
        sourceTags: [],
      },
    };
  }
}

/* ----------------------------------------------------------------- manual */

class ManualSourceAdapter extends AssetSourceAdapter {
  /**
   * Returns the catalogue of manual sites rather than remote results. Nothing
   * is fetched; this exists so the UI can present real, good sources that
   * happen to require a human.
   */
  async search(query, opts = {}) {
    const sites = this.source.sites || [];
    const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);

    return sites
      .filter((s) => !opts.category || (s.categories || []).includes(opts.category))
      .filter((s) => {
        if (!terms.length) return true;
        const hay = `${s.name} ${(s.categories || []).join(" ")} ${s.license}`.toLowerCase();
        return terms.some((t) => hay.includes(t));
      })
      .map((s) => ({
        id: s.name.toLowerCase().replace(/\s+/g, "-"),
        title: s.name,
        pageUrl: s.url,
        license: s.license,
        spdx: null,
        categories: s.categories,
        manualOnly: true,
        reason: s.why,
        tags: s.categories || [],
        type: null,
      }));
  }

  getAssetPage(ref) {
    return (ref && ref.pageUrl) || this.source.url;
  }

  async getDownloadInformation(ref) {
    return {
      url: null,
      filename: null,
      manualOnly: true,
      pageUrl: this.getAssetPage(ref),
      instructions: [
        "Open the source page",
        "Download the asset yourself, accepting the terms of that site",
        "Use IMPORT FILE / FOLDER / ZIP in Sun Plugin",
      ],
    };
  }

  async verifyLicense(ref) {
    return {
      allowed: false,
      spdx: null,
      url: null,
      attribution: null,
      raw: ref && ref.license,
      reason: "manual source: license is accepted by the user at download time",
    };
  }

  async download() {
    throw new ManualOnlySourceError(this.source);
  }
}

module.exports = { SyntheticAdapter, DirectUrlAdapter, ManualSourceAdapter };
