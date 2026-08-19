"use strict";
/**
 * UXP bridge for Premiere Pro 25.6+.
 *
 * Notes that shaped this file, from the platform research in
 * docs/DEVELOPMENT-ASSET-SOURCES.md section 7:
 *
 *   - Entry point is app.Project.getActiveProject(), then getActiveSequence().
 *   - Every METHOD is async; PROPERTIES are synchronous. Mixing those up is the
 *     single most common porting mistake from ExtendScript.
 *   - Mutations must run inside an execute-as-modal scope or they are rejected.
 *   - The UXP surface is still filling in. Where an API is not yet exposed we
 *     report the capability as false rather than guessing at a call that will
 *     throw at runtime — the router in premiere-adapter.js then falls back to a
 *     plain project import, which always works.
 */

const { PremiereAdapter } = require("../premiere-adapter");

function ppro() {
  try {
    return require("premierepro");
  } catch (e) {
    return null;
  }
}

class UxpPremiereAdapter extends PremiereAdapter {
  constructor() {
    super();
    this.name = "uxp";
    this.api = null;
    this.available = false;
  }

  async connect() {
    this.api = ppro();
    this.available = Boolean(this.api);
    return this.available;
  }

  capabilities() {
    return {
      importFile: true,
      insertMogrt: this.hasApi("importMotionGraphicsTemplate"),
      insertAudio: this.hasApi("createAudioClip") || this.hasApi("overwriteClip"),
      insertVideo: this.hasApi("overwriteClip") || this.hasApi("insertClip"),
      applyLut: false,   // Lumetri parameter access is not exposed via UXP yet
      applyPreset: false, // effect preset application is not exposed via UXP yet
      dragAndDrop: false,
    };
  }

  /** Probe rather than assume: the API surface changes between point releases. */
  hasApi(method) {
    if (!this.api) return false;
    const candidates = [this.api.TrackItemSelection, this.api.Sequence, this.api.Project];
    return candidates.some((c) => c && typeof c.prototype === "object" && method in c.prototype);
  }

  async getProject() {
    if (!this.api) return null;
    const project = await this.api.Project.getActiveProject();
    if (!project) return null;
    return { name: project.name, path: project.path, handle: project };
  }

  async getActiveSequence() {
    const project = await this.getProject();
    if (!project) return null;
    const sequence = await project.handle.getActiveSequence();
    if (!sequence) return null;
    return { name: sequence.name, handle: sequence };
  }

  /**
   * All mutations go through here. UXP rejects project changes made outside an
   * execute-as-modal scope, and wrapping each call individually would produce
   * one undo entry per step instead of one per user action.
   */
  async modal(label, fn) {
    if (!this.api) throw new Error("not connected");
    const { executeAsModal } = require("premierepro");
    if (typeof executeAsModal !== "function") return fn();
    return executeAsModal(fn, { commandName: label });
  }

  async importFile(absolutePath) {
    const project = await this.getProject();
    if (!project) return { ok: false, error: "no open project" };

    try {
      await this.modal("Sun Plugin: import asset", async () => {
        await project.handle.importFiles([absolutePath], true, null, false);
      });
      return { ok: true, imported: absolutePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async insertMogrt(absolutePath, opts = {}) {
    const sequence = await this.getActiveSequence();
    if (!sequence) return { ok: false, error: "no active sequence" };

    try {
      const result = await this.modal("Sun Plugin: insert graphic", async () =>
        sequence.handle.importMGT(
          absolutePath,
          opts.time || await sequence.handle.getPlayerPosition(),
          opts.videoTrack != null ? opts.videoTrack : 0,
          opts.audioTrack != null ? opts.audioTrack : 0
        ));
      return { ok: true, clip: result };
    } catch (e) {
      // Falling back to a project import still gets the asset in front of the
      // user, which beats a dead end.
      const fallback = await this.importFile(absolutePath);
      return fallback.ok
        ? { ok: true, imported: absolutePath, note: "added to project panel; insert manually" }
        : { ok: false, error: e.message };
    }
  }

  async insertAudio(absolutePath, opts = {}) {
    const sequence = await this.getActiveSequence();
    if (!sequence) return this.importFile(absolutePath);

    try {
      await this.modal("Sun Plugin: insert audio", async () => {
        const project = await this.getProject();
        const items = await project.handle.importFiles([absolutePath], true, null, false);
        const item = Array.isArray(items) ? items[0] : items;
        if (item && sequence.handle.overwriteClip) {
          await sequence.handle.overwriteClip(
            item,
            opts.time || await sequence.handle.getPlayerPosition(),
            opts.audioTrack != null ? opts.audioTrack : 0
          );
        }
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async insertVideo(absolutePath, opts = {}) {
    const sequence = await this.getActiveSequence();
    if (!sequence) return this.importFile(absolutePath);

    try {
      await this.modal("Sun Plugin: insert clip", async () => {
        const project = await this.getProject();
        const items = await project.handle.importFiles([absolutePath], true, null, false);
        const item = Array.isArray(items) ? items[0] : items;
        if (item && sequence.handle.overwriteClip) {
          await sequence.handle.overwriteClip(
            item,
            opts.time || await sequence.handle.getPlayerPosition(),
            opts.videoTrack != null ? opts.videoTrack : 0
          );
        }
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async applyLut() {
    return {
      ok: false,
      error: "Lumetri LUT assignment is not exposed through UXP yet. Import the .cube and set it in the Lumetri Color panel, or use the CEP build.",
    };
  }

  async applyPreset() {
    return {
      ok: false,
      error: "effect preset application is not exposed through UXP yet.",
    };
  }
}

module.exports = { UxpPremiereAdapter };
