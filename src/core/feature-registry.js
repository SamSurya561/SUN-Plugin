"use strict";
/**
 * Feature registry.
 *
 * The mechanism that makes the development ingestor genuinely removable.
 *
 * The core NEVER imports `src/dev-ingestor/`. Instead the ingestor — if it is
 * present — registers itself here at startup, and the core asks the registry
 * what exists. Delete the directory and the registration simply never happens:
 * no import error, no missing module, no dead branch. The UI hides what is not
 * registered.
 *
 * This is the difference between "the code is organised so it could be removed"
 * and "the code can actually be removed", and it is checked by
 * tools/check-boundaries.mjs on every test run.
 */

const features = new Map();
const listeners = new Set();

/**
 * @param {string} id      e.g. "development-assets"
 * @param {object} feature { label, version, commands, panels, teardown }
 */
function register(id, feature) {
  if (!id || typeof id !== "string") throw new Error("feature id is required");
  features.set(id, { id, registeredAt: new Date().toISOString(), ...feature });
  for (const fn of listeners) {
    try { fn({ type: "register", id, feature }); } catch (e) { /* a bad listener must not break registration */ }
  }
  return features.get(id);
}

function unregister(id) {
  const feature = features.get(id);
  if (!feature) return false;
  if (typeof feature.teardown === "function") {
    try { feature.teardown(); } catch (e) { /* best effort */ }
  }
  features.delete(id);
  for (const fn of listeners) {
    try { fn({ type: "unregister", id }); } catch (e) { /* ignore */ }
  }
  return true;
}

function has(id) {
  return features.has(id);
}

function get(id) {
  return features.get(id) || null;
}

function list() {
  return [...features.values()];
}

/** Commands contributed by all registered features, for the command palette. */
function commands() {
  const out = [];
  for (const feature of features.values()) {
    for (const command of feature.commands || []) {
      out.push({ ...command, featureId: feature.id });
    }
  }
  return out;
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Attempt to load an optional module by path.
 *
 * Returns null when it is absent, which is the expected state in a production
 * build. A genuine error inside a module that IS present is rethrown, because
 * silently swallowing that would turn a real bug into a mysteriously missing
 * feature.
 */
function tryLoad(modulePath) {
  try {
    return require(modulePath);
  } catch (e) {
    const missing = e && (e.code === "MODULE_NOT_FOUND" || e.code === "ERR_MODULE_NOT_FOUND");
    if (missing && String(e.message).includes(modulePath.split("/").pop())) return null;
    if (missing) return null;
    throw e;
  }
}

module.exports = { register, unregister, has, get, list, commands, onChange, tryLoad };
