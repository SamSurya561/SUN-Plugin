"use strict";
/**
 * Wikimedia Commons adapter.
 *
 * The Wikimedia user-agent policy is mandatory, not advisory: requests must
 * identify the application and a contact. A generic or absent UA gets blocked,
 * so this adapter refuses to run without one rather than getting the whole
 * project rate-limited.
 */

const { AssetSourceAdapter } = require("./base");
const { GuardError } = require("../queue/guards");
const { safeSegment } = require("../../core/util/safe-name");
const { extOf, kindOf } = require("../../core/util/formats");

function extMetaValue(extmetadata, key) {
  const field = extmetadata && extmetadata[key];
  if (!field) return null;
  return String(field.value || "").replace(/<[^>]*>/g, "").trim() || null;
}

function licenseToSpdx(shortName, licenseField) {
  const s = `${shortName || ""} ${licenseField || ""}`.toLowerCase();
  if (/cc0/.test(s)) return "CC0-1.0";
  if (/public domain|pd-|pdm/.test(s)) return "PDM-1.0";
  if (/cc[ -]?by[ -]?sa/.test(s)) return "CC-BY-SA-4.0";
  if (/cc[ -]?by/.test(s)) return "CC-BY-4.0";
  return null;
}

class WikimediaAdapter extends AssetSourceAdapter {
  constructor(source, policy) {
    super(source, policy);
    this.api = source.apiBase || "https://commons.wikimedia.org/w/api.php";
  }

  get userAgent() {
    const ua = super.userAgent;
    // The policy requires identification and contact information. A UA that is
    // only a product token is what gets blocked, so fail loudly here instead.
    if (!ua || ua.length < 12 || !/\(/.test(ua)) {
      throw new GuardError(
        "Wikimedia requires a descriptive User-Agent naming the app and a contact; set policy.defaultUserAgent",
        "USER_AGENT_REQUIRED"
      );
    }
    return ua;
  }

  async search(query, opts = {}) {
    const limit = Math.min(opts.limit || 20, 50);
    const fileType = opts.fileType || "bitmap"; // bitmap | video | audio

    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrsearch: `${query} filetype:${fileType}`,
      gsrnamespace: "6", // File:
      gsrlimit: String(limit),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata|user",
      iiurlwidth: "480",
    });

    const doc = await this.fetchJson(`${this.api}?${params.toString()}`);
    const pages = (doc.query && doc.query.pages) || [];

    return pages.map((p) => this.toResult(p)).filter((r) => r !== null);
  }

  toResult(page) {
    const info = page.imageinfo && page.imageinfo[0];
    if (!info) return null;

    const meta = info.extmetadata || {};
    const shortName = extMetaValue(meta, "LicenseShortName");
    const spdx = licenseToSpdx(shortName, extMetaValue(meta, "License"));
    if (!spdx) return null;

    const filter = (this.source.licenseFilter || []).map((f) => f.toLowerCase());
    if (filter.length) {
      const hay = `${shortName || ""} ${spdx}`.toLowerCase();
      if (!filter.some((f) => hay.includes(f))) return null;
    }

    const filename = page.title.replace(/^File:/, "");
    if (!kindOf(filename)) return null;

    return {
      id: String(page.pageid),
      title: extMetaValue(meta, "ObjectName") || filename.replace(/\.[^.]+$/, ""),
      filename,
      author: extMetaValue(meta, "Artist") || info.user || null,
      pageUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      downloadUrl: info.url,
      thumbnail: info.thumburl || null,
      license: shortName,
      spdx,
      licenseUrl: extMetaValue(meta, "LicenseUrl"),
      attribution: extMetaValue(meta, "Attribution")
        || extMetaValue(meta, "Credit")
        || `${filename} by ${extMetaValue(meta, "Artist") || "unknown"} (Wikimedia Commons, ${shortName})`,
      description: extMetaValue(meta, "ImageDescription"),
      width: info.width,
      height: info.height,
      bytes: info.size,
      mime: info.mime,
      tags: (extMetaValue(meta, "Categories") || "").split("|").filter(Boolean).slice(0, 10),
      type: extOf(filename) === ".png" || extOf(filename) === ".jpg" ? "image" : "video",
      raw: page,
    };
  }

  getAssetPage(ref) {
    return (ref && ref.pageUrl) || this.source.url;
  }

  async getDownloadInformation(ref) {
    if (!ref || !ref.downloadUrl) return null;
    return {
      url: ref.downloadUrl,
      filename: safeSegment(ref.filename || ref.title),
      bytes: ref.bytes || null,
      mime: ref.mime || null,
    };
  }

  async download(ref) {
    const info = await this.getDownloadInformation(ref);
    if (!info) throw new Error("no download URL");
    const result = await this.fetchBytes(info.url, { timeoutMs: 180000 });
    return { bytes: result.bytes, filename: info.filename, contentType: result.contentType };
  }

  normalizeMetadata(ref) {
    return {
      ...super.normalizeMetadata(ref),
      type: ref.type,
      license: ref.spdx,
      meta: { title: ref.title, description: ref.description, sourceTags: ref.tags },
    };
  }
}

module.exports = { WikimediaAdapter, licenseToSpdx };
