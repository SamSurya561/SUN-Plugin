"use strict";
/**
 * Acquisition guards.
 *
 * The rules that must hold for every download, enforced centrally rather than
 * left to each adapter author to remember. An adapter cannot opt out: the queue
 * calls these, and a guard failure aborts the download.
 *
 * These encode the constraints from docs/DEVELOPMENT-ASSET-SOURCES.md. If a
 * source starts blocking automation, the correct response is to disable that
 * source, not to loosen a guard.
 */

class GuardError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "GuardError";
    this.code = code;
  }
}

class ManualOnlySourceError extends GuardError {
  constructor(source) {
    super(
      `${source.name} does not permit automated downloading. Use OPEN SOURCE PAGE, download manually, then IMPORT.`,
      "MANUAL_ONLY"
    );
    this.sourceId = source.id;
    this.pageUrl = source.url;
  }
}

const BLOCKING_CLASSIFICATIONS = ["LICENSE UNKNOWN", "AUTOMATION NOT AVAILABLE"];

/** Hosts we refuse regardless of what a source config claims. */
const NEVER_FETCH = [
  /(^|\.)pexels\.com$/i,          // terms explicitly prohibit systematic copying
  /(^|\.)shutterstock\.com$/i,
  /(^|\.)gettyimages\./i,
  /(^|\.)envato(elements)?\.com$/i,
  /(^|\.)motionarray\.com$/i,
  /(^|\.)artlist\.io$/i,
  /(^|\.)epidemicsound\.com$/i,
];

/** URL patterns that indicate an attempt to reach around an access control. */
const SUSPICIOUS_PATH = [
  /\/wp-admin\//i,
  /\/\.git\//i,
  /\/\.env$/i,
  /\/admin\//i,
  /\/private\//i,
  /[?&]token=/i,
  /[?&]bypass=/i,
];

/** A source is allowed to run automated acquisition at all. */
function assertSourceAutomatable(source) {
  if (!source) throw new GuardError("no source", "NO_SOURCE");

  if (source.blocked) {
    throw new GuardError(`${source.name} is blocked: ${source.blockedReason}`, "SOURCE_BLOCKED");
  }
  if (!source.enabled) {
    throw new GuardError(`${source.name} is disabled`, "SOURCE_DISABLED");
  }
  if (!source.automationAllowed || source.accessMethod === "manual") {
    throw new ManualOnlySourceError(source);
  }

  const classes = source.classification || [];
  const blocking = classes.filter((c) => BLOCKING_CLASSIFICATIONS.includes(c));
  // direct-url is the one place a user may knowingly accept an unknown license,
  // and it carries requiresUserConfirmation for exactly that reason.
  if (blocking.length && source.id !== "direct-url") {
    throw new GuardError(
      `${source.name} is classified ${blocking.join(", ")} and will not be fetched automatically`,
      "CLASSIFICATION_BLOCKED"
    );
  }

  return true;
}

/** The URL is one we are permitted to fetch for this source. */
function assertUrlAllowed(url, source, policy = {}) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (e) {
    throw new GuardError(`malformed URL: ${url}`, "BAD_URL");
  }

  if (parsed.protocol !== "https:") {
    throw new GuardError(`refusing non-https URL: ${parsed.protocol}//`, "INSECURE");
  }

  if (parsed.username || parsed.password) {
    throw new GuardError("refusing URL with embedded credentials", "EMBEDDED_CREDENTIALS");
  }

  for (const pattern of NEVER_FETCH) {
    if (pattern.test(parsed.hostname)) {
      throw new GuardError(
        `${parsed.hostname} prohibits automated retrieval; open the page and download manually`,
        "HOST_PROHIBITED"
      );
    }
  }

  for (const pattern of SUSPICIOUS_PATH) {
    if (pattern.test(parsed.pathname + parsed.search)) {
      throw new GuardError(`refusing suspicious URL path: ${parsed.pathname}`, "SUSPICIOUS_PATH");
    }
  }

  // The declared domain list is the allowlist. It is also what must appear in
  // the UXP manifest, so keeping them identical avoids a class of runtime
  // failures that are otherwise very hard to diagnose.
  const domains = source.domains || [];
  if (domains.length > 0) {
    const allowed = domains.some((d) => {
      try {
        const base = new URL(d);
        return parsed.hostname === base.hostname || parsed.hostname.endsWith("." + base.hostname);
      } catch (e) {
        return false;
      }
    });
    if (!allowed) {
      throw new GuardError(
        `${parsed.hostname} is not in the declared domains for ${source.name}`,
        "DOMAIN_NOT_DECLARED"
      );
    }
  } else if (source.id !== "direct-url") {
    throw new GuardError(`${source.name} declares no domains`, "NO_DOMAINS");
  }

  return parsed;
}

/** The license attached to a discovery result is one we accept. */
function assertLicenseAcceptable(licenseInfo, source, policy = {}) {
  if (!licenseInfo) {
    throw new GuardError("no license information; refusing download", "NO_LICENSE");
  }
  if (licenseInfo.allowed === false) {
    throw new GuardError(
      `license not acceptable: ${licenseInfo.spdx || licenseInfo.raw || "unknown"}`,
      "LICENSE_REJECTED"
    );
  }

  const allowed = policy.allowedLicenses;
  if (Array.isArray(allowed) && allowed.length && licenseInfo.spdx) {
    const ok = allowed.some((a) => a.toLowerCase() === String(licenseInfo.spdx).toLowerCase());
    if (!ok) {
      throw new GuardError(
        `license ${licenseInfo.spdx} is not in the allowed list`,
        "LICENSE_NOT_ALLOWED"
      );
    }
  }

  return true;
}

/**
 * A redirect is safe to follow.
 * Cross-host redirects are re-checked against the allowlist, because otherwise
 * an allowlisted domain becomes an open proxy to anywhere.
 */
function assertRedirectAllowed(fromUrl, toUrl, source, policy) {
  const to = assertUrlAllowed(toUrl, source, policy);
  const from = new URL(fromUrl);
  if (to.hostname !== from.hostname) {
    // Allowed only if the destination is independently declared.
    assertUrlAllowed(toUrl, source, policy);
  }
  return to;
}

/**
 * Per-session acquisition limits, for sources whose terms cap volume.
 * Pixabay in particular prohibits systematic mass download; the cap is how that
 * is honoured mechanically rather than by intention.
 */
class SessionLimiter {
  constructor() {
    this.counts = new Map(); // `${sourceId}:${category}` -> n
  }

  key(sourceId, category) {
    return `${sourceId}:${category || "*"}`;
  }

  check(source, category, requested = 1) {
    const limit = source.limits && source.limits.maxPerCategoryPerSession;
    if (!limit) return true;

    const key = this.key(source.id, category);
    const used = this.counts.get(key) || 0;
    if (used + requested > limit) {
      throw new GuardError(
        `${source.name} session cap reached for ${category || "all"} (${limit} per session, ${used} used)`,
        "SESSION_CAP"
      );
    }
    return true;
  }

  record(source, category, n = 1) {
    const key = this.key(source.id, category);
    this.counts.set(key, (this.counts.get(key) || 0) + n);
  }

  reset() {
    this.counts.clear();
  }
}

/** Politeness throttle honouring each source's declared rate limit. */
class RateLimiter {
  constructor() {
    this.last = new Map();
  }

  async wait(source) {
    const rpm = (source.rateLimit && source.rateLimit.requestsPerMinute) || 30;
    const minGap = 60000 / rpm;
    const now = Date.now();
    const previous = this.last.get(source.id) || 0;
    const wait = Math.max(0, previous + minGap - now);
    this.last.set(source.id, now + wait);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

module.exports = {
  GuardError,
  ManualOnlySourceError,
  assertSourceAutomatable,
  assertUrlAllowed,
  assertLicenseAcceptable,
  assertRedirectAllowed,
  SessionLimiter,
  RateLimiter,
  NEVER_FETCH,
  BLOCKING_CLASSIFICATIONS,
};
