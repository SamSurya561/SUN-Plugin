"use strict";
/**
 * Freesound adapter.
 *
 * The deepest CC0 sound-effects catalogue that exists, and the one source here
 * where the access rules need stating plainly:
 *
 *   - Search and metadata work with an API token.
 *   - Downloading the ORIGINAL file requires OAuth2 as the logged-in user.
 *   - Lossy previews are retrievable with the token alone.
 *
 * We honour that split exactly. Without an OAuth grant this adapter will not
 * attempt to fetch originals; it degrades to preview-only plus link-out. The
 * OAuth path is the user authenticating as themselves — it is not a bypass, and
 * nothing here tries to be one.
 */

const { AssetSourceAdapter } = require("./base");
const { GuardError } = require("../queue/guards");
const { safeSegment } = require("../../core/util/safe-name");

class FreesoundAdapter extends AssetSourceAdapter {
  constructor(source, policy) {
    super(source, policy);
    this.api = source.apiBase || "https://freesound.org/apiv2";
  }

  /** A token allows search; OAuth allows original downloads. Different things. */
  get token() {
    return this.credential();
  }

  get oauthToken() {
    return process.env.FREESOUND_OAUTH_TOKEN || null;
  }

  headers(extra = {}) {
    const base = { "User-Agent": this.userAgent, Accept: "application/json", ...extra };
    if (this.oauthToken) base.Authorization = `Bearer ${this.oauthToken}`;
    else if (this.token) base.Authorization = `Token ${this.token}`;
    return base;
  }

  async search(query, opts = {}) {
    if (!this.token && !this.oauthToken) {
      throw new GuardError(
        "Freesound requires an API token. Set FREESOUND_TOKEN, or use OPEN SOURCE PAGE and import manually.",
        "CREDENTIALS_REQUIRED"
      );
    }

    const limit = Math.min(opts.limit || 20, 50);
    const filters = [];
    // CC0 only by default: it is the one license with no attribution burden,
    // which matters for a corpus that will be replaced anyway.
    for (const f of this.source.licenseFilter || ["Creative Commons 0"]) {
      filters.push(`license:"${f}"`);
    }
    if (opts.maxDuration) filters.push(`duration:[0 TO ${opts.maxDuration}]`);
    if (opts.filetype) filters.push(`type:${opts.filetype}`);

    const params = new URLSearchParams({
      query,
      page_size: String(limit),
      page: String(opts.page || 1),
      filter: filters.join(" "),
      fields: "id,name,username,license,previews,download,duration,filesize,type,tags,description,url,samplerate,channels",
      sort: opts.sort || "score",
    });

    const doc = await this.fetchJson(`${this.api}/search/text/?${params.toString()}`);
    return (doc.results || []).map((r) => this.toResult(r)).filter(Boolean);
  }

  toResult(r) {
    const license = String(r.license || "");
    const spdx = /creativecommons\.org\/publicdomain\/zero/i.test(license) ? "CC0-1.0"
      : /publicdomain\/mark/i.test(license) ? "PDM-1.0"
      : /licenses\/by-sa/i.test(license) ? "CC-BY-SA-4.0"
      : /licenses\/by\//i.test(license) ? "CC-BY-4.0"
      : null;

    if (!spdx) return null;

    return {
      id: String(r.id),
      title: r.name ? r.name.replace(/\.[^.]+$/, "") : `Freesound ${r.id}`,
      filename: safeSegment(r.name || `freesound-${r.id}.wav`),
      author: r.username || null,
      pageUrl: r.url || `https://freesound.org/s/${r.id}/`,
      downloadUrl: r.download || null,
      previewUrl: (r.previews && (r.previews["preview-hq-mp3"] || r.previews["preview-lq-mp3"])) || null,
      license,
      spdx,
      licenseUrl: license,
      attribution: spdx === "CC0-1.0" ? null : `"${r.name}" by ${r.username} (freesound.org), ${spdx}`,
      duration: r.duration || null,
      bytes: r.filesize || null,
      filetype: r.type || null,
      channels: r.channels || null,
      sampleRate: r.samplerate || null,
      description: r.description ? String(r.description).slice(0, 240) : null,
      tags: (r.tags || []).slice(0, 12),
      type: "sfx",
      raw: r,
    };
  }

  getAssetPage(ref) {
    if (ref && ref.pageUrl) return ref.pageUrl;
    if (ref && ref.id) return `https://freesound.org/s/${ref.id}/`;
    return this.source.url;
  }

  /**
   * Original download requires OAuth. Without it we offer the preview and say
   * so, rather than failing opaquely or trying the original anyway.
   */
  async getDownloadInformation(ref) {
    if (!ref) return null;

    if (this.oauthToken && ref.downloadUrl) {
      return {
        url: ref.downloadUrl,
        filename: safeSegment(ref.filename || `${ref.title}.wav`),
        bytes: ref.bytes || null,
        quality: "original",
      };
    }

    if (ref.previewUrl) {
      return {
        url: ref.previewUrl,
        filename: safeSegment(`${ref.title}.mp3`),
        bytes: null,
        quality: "preview",
        note: "Lossy preview. Connect a Freesound account to download the original.",
      };
    }

    return null;
  }

  async download(ref, opts = {}) {
    const info = await this.getDownloadInformation(ref);
    if (!info) throw new GuardError("no downloadable file for this sound", "NO_DOWNLOAD");

    if (info.quality === "preview" && opts.requireOriginal) {
      throw new GuardError(
        "original download requires a Freesound OAuth grant; open the page to download it yourself",
        "OAUTH_REQUIRED"
      );
    }

    const result = await this.fetchBytes(info.url, { timeoutMs: 120000 });
    return {
      bytes: result.bytes,
      filename: info.filename,
      contentType: result.contentType,
      quality: info.quality,
    };
  }

  normalizeMetadata(ref) {
    return {
      ...super.normalizeMetadata(ref),
      type: "sfx",
      license: ref.spdx,
      duration: ref.duration,
      meta: { title: ref.title, description: ref.description, sourceTags: ref.tags },
    };
  }
}

module.exports = { FreesoundAdapter };
