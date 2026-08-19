"use strict";
/**
 * Internet Archive adapter.
 *
 * The best available source of genuine public-domain film — which is exactly
 * what film burns, grain plates and light leaks are made from.
 *
 * Two-step by necessity: the scrape API finds items, then /metadata/{id}
 * enumerates the files inside one. The rights check happens on the item, before
 * any file is touched.
 *
 * Critical detail: a great many Archive items carry NO rights metadata at all.
 * Absence is not public domain. Those items are refused, not assumed.
 */

const { AssetSourceAdapter, normalizeSpdx } = require("./base");
const { safeSegment } = require("../../core/util/safe-name");
const { extOf } = require("../../core/util/formats");

/** Formats worth pulling, by the type of asset we are hunting for. */
const USEFUL_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".mp3", ".wav", ".flac", ".ogg", ".png", ".jpg", ".jpeg"]);

/** Archive.org derivative formats we prefer, best first. */
const FORMAT_PREFERENCE = [
  "h.264 IA", "h.264", "MPEG4", "512Kb MPEG4", "HiRes MPEG4",
  "VBR MP3", "MP3", "Flac", "PNG", "JPEG",
];

function rightsToSpdx(item) {
  const licenseUrl = item.licenseurl || item.license || "";
  const rights = String(item.rights || "").toLowerCase();

  if (/creativecommons\.org\/publicdomain\/zero/i.test(licenseUrl)) return "CC0-1.0";
  if (/creativecommons\.org\/publicdomain\/mark/i.test(licenseUrl)) return "PDM-1.0";

  // Keep the actual version rather than flattening everything to 4.0: the
  // attribution terms differ between CC versions, and recording 4.0 for a 3.0
  // work is simply wrong metadata.
  const bySa = /creativecommons\.org\/licenses\/by-sa\/([\d.]+)/i.exec(licenseUrl);
  if (bySa) return `CC-BY-SA-${bySa[1]}`;
  const by = /creativecommons\.org\/licenses\/by\/([\d.]+)/i.exec(licenseUrl);
  if (by) return `CC-BY-${by[1]}`;
  if (/creativecommons\.org\/licenses\/by-sa/i.test(licenseUrl)) return "CC-BY-SA-4.0";
  if (/creativecommons\.org\/licenses\/by\//i.test(licenseUrl)) return "CC-BY-4.0";

  if (/public\s*domain/.test(rights)) return "PDM-1.0";
  if (/\bcc0\b/.test(rights)) return "CC0-1.0";

  return null;
}

class InternetArchiveAdapter extends AssetSourceAdapter {
  constructor(source, policy) {
    super(source, policy);
    this.base = source.apiBase || "https://archive.org";
  }

  /**
   * @param {string} query
   * @param {object} opts { mediaType: "movies"|"audio"|"image", collection, limit }
   */
  async search(query, opts = {}) {
    const wanted = opts.limit || 20;

    // Constrain to items that actually declare a license, so the rights check
    // below has something to work with instead of rejecting nearly everything.
    const clauses = [`(${query})`];
    if (opts.mediaType) clauses.push(`mediatype:(${opts.mediaType})`);
    if (opts.collection) clauses.push(`collection:(${opts.collection})`);
    clauses.push("licenseurl:[* TO *]");

    // The scrape API rejects any count below 100 outright, so ask for its
    // minimum and narrow locally. Asking for 20 is an HTTP 400, not 20 results.
    const params = new URLSearchParams({
      q: clauses.join(" AND "),
      count: String(Math.max(100, Math.min(wanted, 10000))),
      fields: "identifier,title,creator,date,licenseurl,rights,mediatype,description,subject,downloads",
    });

    const url = `${this.base}/services/search/v1/scrape?${params.toString()}`;
    const doc = await this.fetchJson(url);

    return (doc.items || [])
      .map((item) => this.toResult(item))
      .filter((r) => r !== null)
      .slice(0, wanted);
  }

  toResult(item) {
    const spdx = rightsToSpdx(item);
    if (!spdx) return null; // no declared rights: refuse rather than assume

    const filter = (this.source.licenseFilter || []).map((f) => f.toLowerCase());
    if (filter.length) {
      const hay = `${item.licenseurl || ""} ${item.rights || ""} ${spdx}`.toLowerCase();
      if (!filter.some((f) => hay.includes(f))) return null;
    }

    return {
      id: item.identifier,
      title: item.title || item.identifier,
      author: Array.isArray(item.creator) ? item.creator[0] : item.creator || null,
      pageUrl: `https://archive.org/details/${item.identifier}`,
      license: item.licenseurl || item.rights,
      spdx,
      licenseUrl: item.licenseurl || null,
      attribution: item.creator ? `${item.title} by ${item.creator} (Internet Archive)` : item.title,
      description: Array.isArray(item.description) ? item.description[0] : item.description || null,
      tags: [].concat(item.subject || []).filter(Boolean).slice(0, 12),
      mediaType: item.mediatype,
      type: item.mediatype === "audio" ? "sfx" : item.mediatype === "movies" ? "overlay" : "image",
      raw: item,
    };
  }

  /** Enumerate the files inside an item and pick the best usable derivative. */
  async getMetadata(ref) {
    if (!ref || !ref.id) return ref;

    const doc = await this.fetchJson(`${this.base}/metadata/${encodeURIComponent(ref.id)}`);
    const files = (doc.files || []).filter((f) => USEFUL_EXTENSIONS.has(extOf(f.name || "")));

    const scored = files.map((f) => {
      const preferenceIndex = FORMAT_PREFERENCE.indexOf(f.format);
      return {
        name: f.name,
        format: f.format,
        size: f.size ? Number(f.size) : null,
        length: f.length ? Number(f.length) : null,
        // Prefer a known-good derivative; unknown formats sort last.
        score: preferenceIndex === -1 ? 999 : preferenceIndex,
      };
    }).sort((a, b) => a.score - b.score || (a.size || 0) - (b.size || 0));

    return { ...ref, files: scored, server: doc.server, dir: doc.dir };
  }

  getAssetPage(ref) {
    if (ref && ref.id) return `https://archive.org/details/${ref.id}`;
    return this.source.url;
  }

  async getDownloadInformation(ref, opts = {}) {
    const detailed = ref.files ? ref : await this.getMetadata(ref);
    if (!detailed.files || detailed.files.length === 0) return null;

    // Skip enormous masters: a 4GB scan is not a useful development asset.
    const maxBytes = opts.maxBytes || 200 * 1024 * 1024;
    const chosen = detailed.files.find((f) => !f.size || f.size <= maxBytes) || detailed.files[0];
    if (!chosen) return null;

    return {
      url: `${this.base}/download/${encodeURIComponent(detailed.id)}/${encodeURIComponent(chosen.name)}`,
      filename: safeSegment(chosen.name),
      bytes: chosen.size,
      mime: null,
      format: chosen.format,
    };
  }

  async download(ref, opts = {}) {
    const info = await this.getDownloadInformation(ref, opts);
    if (!info) throw new Error(`no usable file in archive item ${ref.id}`);

    const result = await this.fetchBytes(info.url, { timeoutMs: 300000 });
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

module.exports = { InternetArchiveAdapter, rightsToSpdx };
