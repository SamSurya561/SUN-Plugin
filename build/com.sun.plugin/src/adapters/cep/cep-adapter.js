"use strict";
/**
 * CEP / ExtendScript bridge.
 *
 * Kept because ExtendScript is supported through September 2026 and still
 * reaches capabilities UXP has not exposed — MOGRT insertion with parameters,
 * Lumetri LUT assignment and effect presets among them. When the UXP surface
 * catches up this file can be deleted and nothing above it changes, which is the
 * point of having the adapter interface at all.
 *
 * Every call is a round trip through CSInterface.evalScript, so the ExtendScript
 * side is written as small self-contained functions returning JSON strings.
 */

const { PremiereAdapter } = require("../premiere-adapter");

/**
 * ExtendScript executed in the host.
 * Written as a single expression per call and JSON-encoded on the way back,
 * because evalScript can only hand back a string.
 */
const JSX = {
  getProject: `(function(){
    if (!app.project) return JSON.stringify(null);
    return JSON.stringify({ name: app.project.name, path: app.project.path });
  })()`,

  getSequence: `(function(){
    var s = app.project.activeSequence;
    if (!s) return JSON.stringify(null);
    return JSON.stringify({ name: s.name, id: s.sequenceID, playhead: s.getPlayerPosition().seconds });
  })()`,

  importFile: (path) => `(function(){
    try {
      var ok = app.project.importFiles([${JSON.stringify(path)}], true, app.project.rootItem, false);
      return JSON.stringify({ ok: ok !== false });
    } catch (e) { return JSON.stringify({ ok: false, error: e.toString() }); }
  })()`,

  insertMogrt: (path, videoTrack, audioTrack) => `(function(){
    try {
      var s = app.project.activeSequence;
      if (!s) return JSON.stringify({ ok: false, error: "no active sequence" });
      var t = s.getPlayerPosition();
      var clip = s.importMGT(${JSON.stringify(path)}, t.ticks, ${videoTrack}, ${audioTrack});
      return JSON.stringify({ ok: clip !== null && clip !== undefined });
    } catch (e) { return JSON.stringify({ ok: false, error: e.toString() }); }
  })()`,

  insertOnTrack: (path, kind, track) => `(function(){
    try {
      var s = app.project.activeSequence;
      if (!s) return JSON.stringify({ ok: false, error: "no active sequence" });
      app.project.importFiles([${JSON.stringify(path)}], true, app.project.rootItem, false);

      // The freshly imported item is the last child of the root bin.
      var root = app.project.rootItem;
      var item = root.children[root.children.numItems - 1];
      var t = s.getPlayerPosition();
      var tracks = ${kind === "audio" ? "s.audioTracks" : "s.videoTracks"};
      if (tracks.numTracks === 0) return JSON.stringify({ ok: false, error: "no ${kind} track" });
      tracks[${track}].overwriteClip(item, t.seconds);
      return JSON.stringify({ ok: true });
    } catch (e) { return JSON.stringify({ ok: false, error: e.toString() }); }
  })()`,

  applyLut: (path) => `(function(){
    try {
      var s = app.project.activeSequence;
      if (!s) return JSON.stringify({ ok: false, error: "no active sequence" });
      var sel = s.getSelection();
      if (!sel || sel.length === 0) return JSON.stringify({ ok: false, error: "select a clip first" });

      var applied = 0;
      for (var i = 0; i < sel.length; i++) {
        var comps = sel[i].components;
        for (var c = 0; c < comps.numItems; c++) {
          if (comps[c].displayName === "Lumetri Color") {
            var props = comps[c].properties;
            for (var p = 0; p < props.numItems; p++) {
              // The Creative LUT slot is the one that takes a .cube path.
              if (props[p].displayName.indexOf("Creative") !== -1 ||
                  props[p].displayName.indexOf("Input LUT") !== -1) {
                props[p].setValue(${JSON.stringify(path)}, true);
                applied++;
              }
            }
          }
        }
      }
      return JSON.stringify({ ok: applied > 0, applied: applied,
        error: applied ? null : "no Lumetri Color effect on the selected clips" });
    } catch (e) { return JSON.stringify({ ok: false, error: e.toString() }); }
  })()`,
};

class CepPremiereAdapter extends PremiereAdapter {
  constructor() {
    super();
    this.name = "cep";
    this.cs = null;
    this.available = false;
  }

  async connect() {
    try {
      // CSInterface is injected by the CEP host, not installed as a dependency.
      const CSInterface = window.CSInterface || (window.__adobe_cep__ && window.CSInterface);
      if (!CSInterface) return false;
      this.cs = new CSInterface();
      this.available = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  capabilities() {
    return {
      importFile: true,
      insertMogrt: true,
      insertAudio: true,
      insertVideo: true,
      applyLut: true,
      applyPreset: true,
      dragAndDrop: false, // not exposed to panels by the host
    };
  }

  /** One evalScript round trip, with the JSON decode and error paths handled. */
  eval(script) {
    return new Promise((resolve) => {
      if (!this.cs) return resolve({ ok: false, error: "not connected" });
      this.cs.evalScript(script, (raw) => {
        if (raw === "EvalScript error.") {
          return resolve({ ok: false, error: "ExtendScript evaluation failed" });
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          resolve({ ok: false, error: `unparseable host response: ${String(raw).slice(0, 120)}` });
        }
      });
    });
  }

  async getProject() {
    const result = await this.eval(JSX.getProject);
    return result && result.name ? result : null;
  }

  async getActiveSequence() {
    const result = await this.eval(JSX.getSequence);
    return result && result.name ? result : null;
  }

  async importFile(absolutePath) {
    return this.eval(JSX.importFile(absolutePath));
  }

  async insertMogrt(absolutePath, opts = {}) {
    return this.eval(JSX.insertMogrt(
      absolutePath,
      opts.videoTrack != null ? opts.videoTrack : 0,
      opts.audioTrack != null ? opts.audioTrack : 0
    ));
  }

  async insertAudio(absolutePath, opts = {}) {
    return this.eval(JSX.insertOnTrack(absolutePath, "audio", opts.audioTrack != null ? opts.audioTrack : 0));
  }

  async insertVideo(absolutePath, opts = {}) {
    return this.eval(JSX.insertOnTrack(absolutePath, "video", opts.videoTrack != null ? opts.videoTrack : 0));
  }

  async applyLut(absolutePath) {
    return this.eval(JSX.applyLut(absolutePath));
  }

  async applyPreset(absolutePath) {
    // .prfpset application has no scripting entry point; importing it puts the
    // preset in the Effects panel, which is as far as automation can go.
    const result = await this.importFile(absolutePath);
    return result.ok
      ? { ok: true, note: "preset imported; apply it from the Effects panel" }
      : result;
  }
}

module.exports = { CepPremiereAdapter, JSX };
