"use strict";
/**
 * GitHub adapter.
 *
 * Repository-level licensing, checked before any blob is fetched. The license
 * endpoint returning NOASSERTION means GitHub could not identify a license, and
 * that is LICENSE UNKNOWN — refused, not guessed at from the presence of a
 * README claim.
 *
 * Research note: searching for LUT repositories returns overwhelmingly LUT
 * *generators* rather than LUT *collections*, which is why the synthetic
 * generator carries the LUT category and this adapter is a supplement.
 */

const { AssetSourceAdapter } = require("./base");
const { safeSegment } = require("../../core/util/safe-name");
const { kindOf, extOf } = require("../../core/util/formats");

class GitHubAdapter extends AssetSourceAdapter {
  constructor(source, policy) {
    super(source, policy);
    this.api = source.apiBase || "https://api.github.com";
  }

  headers(extra = {}) {
    const base = {
      "User-Agent": this.userAgent,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    };
    const token = this.credential();
    // A user's own token only raises their rate limit; it is never required.
    if (token) base.Authorization = `Bearer ${token}`;
    return base;
  }

  /** Find repositories, then filter to ones with an allowlisted license. */
  async search(query, opts = {}) {
    const limit = Math.min(opts.limit || 10, 30);
    const params = new URLSearchParams({
      q: query,
      per_page: String(limit),
      sort: opts.sort || "stars",
      order: "desc",
    });

    const doc = await this.fetchJson(`${this.api}/search/repositories?${params.toString()}`);
    const allowed = (this.source.licenseFilter || []).map((f) => f.toLowerCase());

    return (doc.items || []).map((repo) => {
      const spdx = repo.license && repo.license.spdx_id;
      // NOASSERTION is GitHub saying "we could not determine this".
      if (!spdx || spdx === "NOASSERTION") return null;
      if (allowed.length && !allowed.includes(spdx.toLowerCase())) return null;

      return {
        id: repo.full_name,
        title: repo.name,
        author: repo.owner && repo.owner.login,
        pageUrl: repo.html_url,
        description: repo.description,
        license: spdx,
        spdx,
        licenseUrl: repo.license.url || null,
        attribution: `${repo.full_name} (${spdx})`,
        stars: repo.stargazers_count,
        defaultBranch: repo.default_branch,
        tags: (repo.topics || []).slice(0, 10),
        type: "template",
        raw: repo,
      };
    }).filter(Boolean);
  }

  /** List the asset files a repository contains. */
  async getMetadata(ref, opts = {}) {
    if (!ref || !ref.id) return ref;

    const branch = ref.defaultBranch || "main";
    const tree = await this.fetchJson(
      `${this.api}/repos/${ref.id}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    );

    const wanted = opts.extensions ? new Set(opts.extensions) : null;
    const maxBytes = opts.maxBytes || 64 * 1024 * 1024;

    const files = (tree.tree || [])
      .filter((n) => n.type === "blob")
      .filter((n) => kindOf(n.path))
      .filter((n) => !wanted || wanted.has(extOf(n.path)))
      .filter((n) => !n.size || n.size <= maxBytes)
      .map((n) => ({
        path: n.path,
        size: n.size,
        url: `https://raw.githubusercontent.com/${ref.id}/${branch}/${n.path.split("/").map(encodeURIComponent).join("/")}`,
      }));

    return { ...ref, branch, files, truncated: Boolean(tree.truncated) };
  }

  getAssetPage(ref) {
    if (ref && ref.pageUrl) return ref.pageUrl;
    if (ref && ref.id) return `https://github.com/${ref.id}`;
    return this.source.url;
  }

  async getDownloadInformation(ref, opts = {}) {
    const detailed = ref.files ? ref : await this.getMetadata(ref, opts);
    if (!detailed.files || !detailed.files.length) return null;

    const file = opts.file
      ? detailed.files.find((f) => f.path === opts.file)
      : detailed.files[0];
    if (!file) return null;

    return {
      url: file.url,
      filename: safeSegment(file.path.split("/").pop()),
      bytes: file.size,
      path: file.path,
    };
  }

  async download(ref, opts = {}) {
    const info = await this.getDownloadInformation(ref, opts);
    if (!info) throw new Error(`no usable asset files in ${ref.id}`);
    const result = await this.fetchBytes(info.url);
    return { bytes: result.bytes, filename: info.filename, contentType: result.contentType };
  }

  /** Download every asset file in a repository, respecting the license. */
  async downloadAll(ref, opts = {}) {
    const detailed = await this.getMetadata(ref, opts);
    const out = [];
    const limit = opts.limit || 100;

    for (const file of (detailed.files || []).slice(0, limit)) {
      try {
        const result = await this.fetchBytes(file.url);
        out.push({
          bytes: result.bytes,
          filename: safeSegment(file.path.split("/").pop()),
          path: file.path,
        });
      } catch (e) {
        out.push({ error: e.message, path: file.path });
      }
    }
    return out;
  }

  normalizeMetadata(ref) {
    return {
      ...super.normalizeMetadata(ref),
      license: ref.spdx,
      meta: { title: ref.title, description: ref.description, sourceTags: ref.tags },
    };
  }
}

module.exports = { GitHubAdapter };
