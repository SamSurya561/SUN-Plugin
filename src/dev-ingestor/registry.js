"use strict";
/**
 * Development source registry.
 *
 * Loads config/development-sources.json, validates it, and hands out adapter
 * instances. Sources can be enabled, disabled, updated, removed and rescanned
 * without touching code.
 *
 * Validation is not a formality here. A registry entry claims things about a
 * website's terms, and those claims decide whether automated downloading
 * happens. An entry that is internally inconsistent — automation allowed but
 * classified AUTOMATION NOT AVAILABLE — is rejected rather than resolved in the
 * permissive direction.
 */

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "development-sources.json");

const BLOCKING_CLASSIFICATIONS = ["LICENSE UNKNOWN", "AUTOMATION NOT AVAILABLE"];

class SourceRegistry {
  constructor(configPath = CONFIG_PATH) {
    this.configPath = configPath;
    this.config = null;
    this.sources = new Map();
    this.problems = [];
  }

  load() {
    const raw = fs.readFileSync(this.configPath, "utf8");
    this.config = JSON.parse(raw);
    this.sources.clear();
    this.problems = [];

    for (const source of this.config.sources || []) {
      const issues = this.validateSource(source);
      if (issues.length) {
        this.problems.push({ id: source.id, issues });
        // A source that fails validation is registered but forced inert, so the
        // UI can show it and explain why rather than it vanishing silently.
        source.enabled = false;
        source.blocked = true;
        source.blockedReason = issues.join("; ");
      }
      this.sources.set(source.id, source);
    }

    return this;
  }

  validateSource(source) {
    const issues = [];
    if (!source.id) issues.push("missing id");
    if (!source.adapter) issues.push("missing adapter");
    if (!Array.isArray(source.categories)) issues.push("categories must be an array");

    const classes = source.classification || [];

    // The core consistency check: a source cannot be flagged for automation and
    // simultaneously classified as one where automation is unavailable.
    if (source.automationAllowed && classes.some((c) => BLOCKING_CLASSIFICATIONS.includes(c))) {
      if (source.id !== "direct-url") {
        issues.push(
          `automationAllowed is true but classification includes ${classes.filter((c) => BLOCKING_CLASSIFICATIONS.includes(c)).join(", ")}`
        );
      }
    }

    // Network sources must declare their domains, because UXP requires every
    // domain to be allowlisted in manifest.json. Discovering this at fetch time
    // produces an opaque failure; discovering it here produces a clear one.
    const needsNetwork = ["api", "public-endpoint", "direct"].includes(source.accessMethod);
    if (needsNetwork && source.id !== "direct-url") {
      if (!Array.isArray(source.domains) || source.domains.length === 0) {
        issues.push("network source declares no domains (required for the UXP manifest allowlist)");
      }
      for (const d of source.domains || []) {
        if (!/^https:\/\//.test(d)) issues.push(`domain must be https: ${d}`);
      }
    }

    if (source.enabled && source.auth && source.auth.optional === false) {
      const key = source.auth.envVar && process.env[source.auth.envVar];
      if (!key) {
        issues.push(`requires credentials in ${source.auth.envVar}, which is not set`);
      }
    }

    return issues;
  }

  /** Every domain that must appear in manifest.json for enabled sources. */
  requiredDomains() {
    const domains = new Set();
    for (const source of this.sources.values()) {
      if (!source.enabled) continue;
      for (const d of source.domains || []) domains.add(d);
    }
    return [...domains].sort();
  }

  get(id) {
    return this.sources.get(id) || null;
  }

  list({ enabledOnly = false, category = null } = {}) {
    let out = [...this.sources.values()];
    if (enabledOnly) out = out.filter((s) => s.enabled && !s.blocked);
    if (category) {
      out = out.filter((s) => s.categories.includes(category) || s.categories.includes("*"));
    }
    return out;
  }

  setEnabled(id, enabled) {
    const source = this.sources.get(id);
    if (!source) return false;
    if (enabled && source.blocked) return false; // cannot enable a failed source
    source.enabled = Boolean(enabled);
    return true;
  }

  update(id, patch) {
    const source = this.sources.get(id);
    if (!source) return null;
    Object.assign(source, patch);
    const issues = this.validateSource(source);
    if (issues.length) {
      source.enabled = false;
      source.blocked = true;
      source.blockedReason = issues.join("; ");
    } else {
      source.blocked = false;
      source.blockedReason = null;
    }
    return source;
  }

  remove(id) {
    return this.sources.delete(id);
  }

  /** Persist the current state back to disk. */
  save() {
    const doc = {
      ...this.config,
      updatedAt: new Date().toISOString().slice(0, 10),
      sources: [...this.sources.values()].map((s) => {
        const { blocked, blockedReason, ...rest } = s;
        return rest;
      }),
    };
    fs.writeFileSync(this.configPath, JSON.stringify(doc, null, 2), "utf8");
    return this.configPath;
  }

  get policy() {
    return (this.config && this.config.policy) || {};
  }

  /** Instantiate the adapter for a source. */
  adapterFor(id) {
    const source = this.get(id);
    if (!source) throw new Error(`unknown source: ${id}`);

    const adapters = require("./adapters");
    const Adapter = adapters[source.adapter];
    if (!Adapter) throw new Error(`unknown adapter: ${source.adapter}`);

    return new Adapter(source, this.policy);
  }

  /** A readable summary, used by the CLI and the Development Asset Tools panel. */
  summary() {
    return this.list().map((s) => ({
      id: s.id,
      name: s.name,
      enabled: Boolean(s.enabled) && !s.blocked,
      blocked: Boolean(s.blocked),
      reason: s.blockedReason || s.enabledReason || null,
      accessMethod: s.accessMethod,
      automationAllowed: Boolean(s.automationAllowed),
      license: s.license,
      categories: s.categories,
      classification: s.classification || [],
    }));
  }
}

module.exports = { SourceRegistry, CONFIG_PATH, BLOCKING_CLASSIFICATIONS };
