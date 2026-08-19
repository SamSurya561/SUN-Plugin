"use strict";
/**
 * PremiereAdapter — the interface both host bridges implement.
 *
 * Premiere extensibility is mid-transition: UXP shipped in 25.6 and is still
 * filling in, while ExtendScript remains supported through September 2026. So
 * the plugin talks to this interface and one of two bridges implements it, which
 * also means the CEP path can carry capabilities UXP has not exposed yet
 * (MOGRT insertion in particular) without the rest of the plugin knowing.
 *
 * KNOWN HOST CONSTRAINT
 * Drag-and-drop from a panel to the timeline is not exposed to CEP or UXP
 * panels. The interaction model is therefore *select, then insert at playhead*,
 * not drag. That is a host limitation, not a design preference.
 */

class PremiereAdapter {
  constructor() {
    this.name = "none";
    this.available = false;
  }

  /** @returns {Promise<boolean>} */
  async connect() { return false; }

  /** @returns {Promise<{name, version, path}|null>} */
  async getProject() { return null; }

  /** @returns {Promise<{name, id, playhead}|null>} */
  async getActiveSequence() { return null; }

  /** Import a media file into the project panel. */
  async importFile() { throw new Error("not implemented"); }

  /** Insert a Motion Graphics Template at the playhead. */
  async insertMogrt() { throw new Error("not implemented"); }

  /** Place an audio file on an audio track at the playhead. */
  async insertAudio() { throw new Error("not implemented"); }

  /** Place a video or image on a video track at the playhead. */
  async insertVideo() { throw new Error("not implemented"); }

  /** Apply a .cube LUT to the selected clip via Lumetri. */
  async applyLut() { throw new Error("not implemented"); }

  /** Apply a saved effect preset to the selected clips. */
  async applyPreset() { throw new Error("not implemented"); }

  /** What this bridge can actually do right now. */
  capabilities() {
    return {
      importFile: false,
      insertMogrt: false,
      insertAudio: false,
      insertVideo: false,
      applyLut: false,
      applyPreset: false,
      dragAndDrop: false, // not available in any host, by design of the host
    };
  }
}

/**
 * Route an asset to the right insertion call based on its type.
 * The core calls this and never branches on asset origin — only on what the
 * asset IS.
 */
async function insertAsset(adapter, asset, absolutePath, opts = {}) {
  if (!adapter || !adapter.available) {
    return { ok: false, error: "not connected to Premiere Pro" };
  }
  if (!absolutePath) {
    return { ok: false, error: "this asset has no file (stress-test record?)" };
  }
  if (asset.syntheticFixture) {
    // Refusing here is kinder than letting Premiere fail on a container with no
    // composition inside it.
    return {
      ok: false,
      error: "this is a development fixture, not a functional template. Use Replace File to point it at a real one.",
    };
  }

  const caps = adapter.capabilities();

  switch (asset.type) {
    case "mogrt":
    case "transition":
    case "caption":
      if (asset.file && asset.file.endsWith(".mogrt")) {
        if (!caps.insertMogrt) return { ok: false, error: "this host cannot insert MOGRTs yet" };
        return adapter.insertMogrt(absolutePath, opts);
      }
      return adapter.importFile(absolutePath, opts);

    case "sfx":
    case "music":
      if (!caps.insertAudio) return adapter.importFile(absolutePath, opts);
      return adapter.insertAudio(absolutePath, opts);

    case "overlay":
    case "background":
    case "video":
    case "image":
    case "guide":
    case "effect":
      if (!caps.insertVideo) return adapter.importFile(absolutePath, opts);
      return adapter.insertVideo(absolutePath, opts);

    case "lut":
    case "colorpreset":
      if (!caps.applyLut) return { ok: false, error: "this host cannot apply LUTs yet" };
      return adapter.applyLut(absolutePath, opts);

    case "preset":
      if (!caps.applyPreset) return { ok: false, error: "this host cannot apply presets yet" };
      return adapter.applyPreset(absolutePath, opts);

    default:
      return adapter.importFile(absolutePath, opts);
  }
}

/**
 * Pick a bridge for the current host.
 * Returns a base PremiereAdapter when neither is present, so the plugin runs in
 * a plain browser for UI work with every insertion cleanly reporting that it is
 * not connected.
 */
function detectAdapter() {
  try {
    if (typeof require === "function" && typeof window !== "undefined" && window.uxp) {
      const { UxpPremiereAdapter } = require("./uxp/uxp-adapter");
      return new UxpPremiereAdapter();
    }
  } catch (e) { /* fall through */ }

  try {
    if (typeof window !== "undefined" && window.__adobe_cep__) {
      const { CepPremiereAdapter } = require("./cep/cep-adapter");
      return new CepPremiereAdapter();
    }
  } catch (e) { /* fall through */ }

  return new PremiereAdapter();
}

module.exports = { PremiereAdapter, insertAsset, detectAdapter };
