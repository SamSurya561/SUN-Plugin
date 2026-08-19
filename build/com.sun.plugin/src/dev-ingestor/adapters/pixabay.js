"use strict";
/**
 * Pixabay adapter.
 *
 * Constrained on purpose. The Pixabay terms state the API is for real human
 * requests, prohibit systematic mass download, require responses to be cached
 * for 24 hours, and forbid hotlinking. All four are enforced here mechanically:
 *
 *   - a hard per-category session cap (no crawl-everything mode is exposed)
 *   - a 24h response cache
 *   - files are downloaded, never referenced by remote URL
 *   - redistribution is off: development-local use only
 *
 * The Pixabay Content License also prohibits redistributing assets as-is, so
 * anything acquired here must never be shipped with the plugin.
 */

const fs = require("fs");
const path = require("path");

const { AssetSourceAdapter } = require("./base");
const { GuardError } = require("../queue/guards");
const { paths, ensureDir } = require("../../core/library/paths");
const { safeSegment, filenameFromUrl } = require("../../core/util/safe-name");
const { sha256Text } = require("../../core/util/hash");

const CACHE_DIR = () => path.join(paths.cache, "pixabay");

class PixabayAdapter extends AssetSourceAdapter {
  constructor(source, policy) {
    super(source, policy);
    this.api = source.apiBase || "https://pixabay.com/api";
    this.cacheHours = (source.rateLimit && source.rateLimit.cacheHours) || 24;
  }

  get apiKey() {
    return this.credential();
  }

  /** Responses are cached for 24h because the terms require it. */
  cachePath(url) {
    return path.join(CACHE_DIR(), sha256Text(url).slice(0, 32) + ".json");
  }

  readCache(url) {
    const file = this.cachePath(url);
    if (!fs.existsSync(file)) return null;
    try {
      const doc = JSON.parse(fs.readFileSync(file, "utf8"));
      const ageMs = Date.now() - new Date(doc.cachedAt).getTime();
      if (ageMs > this.cacheHours * 3600 * 1000) return null;
      return doc.payload;
    } catch (e) {
      return null;
    }
  }

  writeCache(url, payload) {
    ensureDir(CACHE_DIR());
    fs.writeFileSync(
      this.cachePath(url),
      JSON.stringify({ cachedAt: new Date().toISOString(), url, payload }),
      "utf8"
    );
  }

  async fetchJson(url, opts = {}) {
    const cached = this.readCache(url);
    if (cached) return cached;
    const payload = await super.fetchJson(url, opts);
    this.writeCache(url, payload);
    return payload;
  }

  async search(query, opts = {}) {
    if (!this.apiKey) {
      throw new GuardError(
        "Pixabay requires your own API key. Set PIXABAY_API_KEY, or open the site and download manually.",
        "CREDENTIALS_REQUIRED"
      );
    }

    const cap = (this.source.limits && this.source.limits.maxPerCategoryPerSession) || 50;
    const limit = Math.min(opts.limit || 20, cap);

    const mediaType = opts.mediaType === "video" ? "videos/" : "";
    const params = new URLSearchParams({
      key: this.apiKey,
      q: query,
      per_page: String(limit),
      page: String(opts.page || 1),
      safesearch: "true",
    });
    if (opts.category) params.set("category", opts.category);

    const doc = await this.fetchJson(`${this.api}/${mediaType}?${params.toString()}`);
    return (doc.hits || []).map((h) => this.toResult(h, opts.mediaType)).filter(Boolean);
  }

  toResult(hit, mediaType) {
    const isVideo = mediaType === "video";

    // Pick a sensible rendition rather than always the largest: a 4K master is
    // not a useful development overlay.
    let downloadUrl = null;
    let width = null;
    let height = null;

    if (isVideo && hit.videos) {
      const v = hit.videos.medium || hit.videos.small || hit.videos.large;
      if (v) { downloadUrl = v.url; width = v.width; height = v.height; }
    } else {
      downloadUrl = hit.largeImageURL || hit.webformatURL;
      width = hit.imageWidth;
      height = hit.imageHeight;
    }
    if (!downloadUrl) return null;

    return {
      id: String(hit.id),
      title: (hit.tags || "Pixabay asset").split(",")[0].trim(),
      author: hit.user || null,
      pageUrl: hit.pageURL,
      downloadUrl,
      thumbnail: hit.previewURL || (hit.videos && hit.videos.tiny && hit.videos.tiny.thumbnail) || null,
      license: "Pixabay Content License",
      spdx: "Pixabay-Content-License",
      licenseUrl: "https://pixabay.com/service/license-summary/",
      attribution: null, // not required, but the author is recorded anyway
      width,
      height,
      duration: hit.duration || null,
      tags: (hit.tags || "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12),
      type: isVideo ? "overlay" : "background",
      redistribution: false,
      raw: hit,
    };
  }

  getAssetPage(ref) {
    return (ref && ref.pageUrl) || this.source.url;
  }

  async getDownloadInformation(ref) {
    if (!ref || !ref.downloadUrl) return null;
    return {
      url: ref.downloadUrl,
      filename: safeSegment(
        `${ref.title.replace(/\s+/g, "_")}_${ref.id}${path.extname(filenameFromUrl(ref.downloadUrl)) || ".jpg"}`
      ),
      bytes: null,
    };
  }

  async download(ref) {
    const info = await this.getDownloadInformation(ref);
    if (!info) throw new Error("no download URL");
    // Downloaded, never hotlinked: the terms forbid referencing Pixabay URLs
    // from the app, and a local library has to hold real files anyway.
    const result = await this.fetchBytes(info.url, { timeoutMs: 180000 });
    return { bytes: result.bytes, filename: info.filename, contentType: result.contentType };
  }

  normalizeMetadata(ref) {
    return {
      ...super.normalizeMetadata(ref),
      type: ref.type,
      license: "Pixabay-Content-License",
      meta: {
        title: ref.title,
        description: "Pixabay Content License - development use only, redistribution prohibited",
        sourceTags: ref.tags,
      },
    };
  }
}

module.exports = { PixabayAdapter };
