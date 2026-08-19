"use strict";
/**
 * Openverse adapter.
 *
 * The primary discovery surface: an open REST API run by WordPress/Creative
 * Commons over 800M+ openly licensed works, aggregating Flickr, Wikimedia,
 * Europeana, Jamendo, Freesound and others. License data is machine-readable per
 * result, which is what makes automated acquisition defensible here.
 *
 * The license filter is applied twice on purpose — once as a query parameter and
 * again on each result — because an aggregator can and does return records whose
 * license field disagrees with the filter, and the second check is the one that
 * actually gates the download.
 */

const { AssetSourceAdapter, normalizeSpdx } = require("./base");
const { filenameFromUrl } = require("../../core/util/safe-name");

/** Openverse audio categories mapped onto Sun Plugin types. */
const AUDIO_CATEGORY_TYPE = {
  music: "music",
  sound_effect: "sfx",
  podcast: "music",
  audiobook: "music",
  news: "music",
  pronunciation: "sfx",
};

class OpenverseAdapter extends AssetSourceAdapter {
  constructor(source, policy) {
    super(source, policy);
    this.apiBase = source.apiBase || "https://api.openverse.org/v1";
  }

  /**
   * @param {string} query
   * @param {object} opts { mediaType: "audio"|"images", limit, page, category }
   */
  async search(query, opts = {}) {
    const mediaType = opts.mediaType || "audio";
    const limit = Math.min(opts.limit || 20, 50);

    const params = new URLSearchParams({
      q: query,
      page_size: String(limit),
      page: String(opts.page || 1),
      license: (this.source.licenseFilter || ["cc0"]).join(","),
    });

    if (opts.extension) params.set("extension", opts.extension);
    if (mediaType === "audio" && opts.audioCategory) params.set("category", opts.audioCategory);

    const url = `${this.apiBase}/${mediaType}/?${params.toString()}`;
    const doc = await this.fetchJson(url);

    return (doc.results || [])
      .map((r) => this.toResult(r, mediaType))
      .filter((r) => r !== null);
  }

  toResult(r, mediaType) {
    const spdx = normalizeSpdx(r.license, r.license_version);
    if (!spdx) return null;

    // Second-pass license check. The API filter is a hint, not a guarantee.
    const filter = (this.source.licenseFilter || []).map((f) => f.toLowerCase());
    if (filter.length && !filter.includes(String(r.license || "").toLowerCase())) return null;

    const isAudio = mediaType === "audio";
    const type = isAudio
      ? (AUDIO_CATEGORY_TYPE[r.category] || "sfx")
      : "image";

    return {
      id: r.id,
      title: r.title || "Untitled",
      author: r.creator || null,
      pageUrl: r.foreign_landing_url || r.detail_url || null,
      downloadUrl: r.url || null,
      thumbnail: r.thumbnail || null,
      license: r.license,
      licenseVersion: r.license_version,
      spdx,
      licenseUrl: r.license_url || null,
      attribution: r.attribution || null,
      provider: r.provider || r.source || null,
      filesize: r.filesize || null,
      filetype: r.filetype || null,
      duration: r.duration ? r.duration / 1000 : null,
      tags: (r.tags || []).map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean),
      type,
      mediaType,
      raw: r,
    };
  }

  async getMetadata(ref) {
    if (!ref || !ref.id) return ref;
    const url = `${this.apiBase}/${ref.mediaType || "audio"}/${encodeURIComponent(ref.id)}/`;
    try {
      const doc = await this.fetchJson(url);
      return { ...ref, ...this.toResult(doc, ref.mediaType || "audio") };
    } catch (e) {
      return ref; // the search record is already sufficient to proceed
    }
  }

  getAssetPage(ref) {
    if (ref && ref.pageUrl) return ref.pageUrl;
    if (ref && ref.id) return `https://openverse.org/${ref.mediaType === "images" ? "image" : "audio"}/${ref.id}`;
    return this.source.url;
  }

  async getDownloadInformation(ref) {
    if (!ref || !ref.downloadUrl) return null;
    return {
      url: ref.downloadUrl,
      filename: filenameFromUrl(ref.downloadUrl, ref.title || "openverse-asset"),
      bytes: ref.filesize || null,
      mime: ref.filetype || null,
    };
  }

  async download(ref) {
    const info = await this.getDownloadInformation(ref);
    if (!info) throw new Error("no download URL for this result");

    // The media URL frequently lives on the original provider's host rather than
    // on Openverse. That host is not in our allowlist and we do not silently add
    // it — the honest outcome is to hand the user the page.
    const result = await this.fetchBytes(info.url);
    return {
      bytes: result.bytes,
      filename: info.filename,
      contentType: result.contentType,
    };
  }

  normalizeMetadata(ref) {
    const base = super.normalizeMetadata(ref);
    return {
      ...base,
      type: ref.type,
      license: ref.spdx,
      licenseUrl: ref.licenseUrl,
      duration: ref.duration,
      meta: {
        title: ref.title,
        description: ref.provider ? `via ${ref.provider}` : null,
        sourceTags: ref.tags,
      },
    };
  }
}

module.exports = { OpenverseAdapter };
