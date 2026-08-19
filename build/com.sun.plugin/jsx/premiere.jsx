/**
 * Sun Plugin — ExtendScript functions for Premiere Pro.
 *
 * This file is loaded once by the CEP host (declared in manifest.xml <ScriptPath>).
 * The panel calls these functions via CSInterface.evalScript().
 *
 * All functions return JSON strings so the panel can parse them reliably.
 * Error handling wraps every function so a host exception never crashes the panel.
 */

/**
 * Check if a project is open.
 * @returns {string} JSON: { name, path } or null
 */
function sunGetProject() {
    try {
        if (!app.project) return JSON.stringify(null);
        return JSON.stringify({
            name: app.project.name,
            path: app.project.path || ""
        });
    } catch (e) {
        return JSON.stringify(null);
    }
}

/**
 * Get the active sequence.
 * @returns {string} JSON: { name, id, playhead } or null
 */
function sunGetSequence() {
    try {
        var s = app.project.activeSequence;
        if (!s) return JSON.stringify(null);
        return JSON.stringify({
            name: s.name,
            id: s.sequenceID,
            playhead: s.getPlayerPosition().seconds
        });
    } catch (e) {
        return JSON.stringify(null);
    }
}

/**
 * Import a file into the project panel.
 * @param {string} filePath - Absolute path to the file.
 * @returns {string} JSON: { ok: boolean, error?: string }
 */
function sunImportFile(filePath) {
    try {
        var f = new File(filePath);
        if (!f.exists) return JSON.stringify({ ok: false, error: "File not found: " + filePath });

        var ok = app.project.importFiles([filePath], true, app.project.rootItem, false);
        return JSON.stringify({ ok: ok !== false });
    } catch (e) {
        return JSON.stringify({ ok: false, error: "Failed to import (format not supported or invalid file)" });
    }
}

/**
 * Insert a Motion Graphics Template at the playhead.
 * @param {string} mogrtPath  - Path to .mogrt file.
 * @param {number} videoTrack - Zero-based video track index.
 * @param {number} audioTrack - Zero-based audio track index.
 * @returns {string} JSON: { ok: boolean, error?: string }
 */
function sunInsertMogrt(mogrtPath, videoTrack, audioTrack) {
    try {
        var s = app.project.activeSequence;
        if (!s) return JSON.stringify({ ok: false, error: "no active sequence" });
        var t = s.getPlayerPosition();
        var vt = (videoTrack !== undefined && videoTrack !== null) ? videoTrack : 0;
        var at = (audioTrack !== undefined && audioTrack !== null) ? audioTrack : 0;
        var clip = s.importMGT(mogrtPath, t.ticks, vt, at);
        return JSON.stringify({ ok: clip !== null && clip !== undefined });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

/**
 * Import and place a clip on a specific track at the playhead.
 * @param {string} filePath - Absolute path to the media file.
 * @param {string} kind     - "audio" or "video"
 * @param {number} track    - Zero-based track index.
 * @returns {string} JSON: { ok: boolean, error?: string }
 */
function sunInsertOnTrack(filePath, kind, track) {
    try {
        var s = app.project.activeSequence;
        if (!s) return JSON.stringify({ ok: false, error: "no active sequence" });

        // Import the file first.
        app.project.importFiles([filePath], true, app.project.rootItem, false);

        // The freshly imported item is the last child of the root bin.
        var root = app.project.rootItem;
        var item = root.children[root.children.numItems - 1];

        var t = s.getPlayerPosition();
        var trackIdx = (track !== undefined && track !== null) ? track : 0;

        if (kind === "audio") {
            if (s.audioTracks.numTracks === 0) {
                return JSON.stringify({ ok: false, error: "no audio track" });
            }
            s.audioTracks[trackIdx].overwriteClip(item, t.seconds);
        } else {
            if (s.videoTracks.numTracks === 0) {
                return JSON.stringify({ ok: false, error: "no video track" });
            }
            s.videoTracks[trackIdx].overwriteClip(item, t.seconds);
        }
        return JSON.stringify({ ok: true });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

/**
 * Apply a .cube LUT to the selected clips via Lumetri Color.
 * @param {string} lutPath - Absolute path to .cube file.
 * @returns {string} JSON: { ok: boolean, applied: number, error?: string }
 */
function sunApplyLut(lutPath) {
    try {
        var s = app.project.activeSequence;
        if (!s) return JSON.stringify({ ok: false, error: "no active sequence" });

        var sel = s.getSelection();
        if (!sel || sel.length === 0) {
            return JSON.stringify({ ok: false, error: "select a clip first" });
        }

        var applied = 0;
        for (var i = 0; i < sel.length; i++) {
            var comps = sel[i].components;
            for (var c = 0; c < comps.numItems; c++) {
                if (comps[c].displayName === "Lumetri Color") {
                    var props = comps[c].properties;
                    for (var p = 0; p < props.numItems; p++) {
                        if (props[p].displayName.indexOf("Creative") !== -1 ||
                            props[p].displayName.indexOf("Input LUT") !== -1) {
                            props[p].setValue(lutPath, true);
                            applied++;
                        }
                    }
                }
            }
        }
        return JSON.stringify({
            ok: applied > 0,
            applied: applied,
            error: applied ? null : "no Lumetri Color effect on the selected clips"
        });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

/**
 * Route an asset to the correct insertion method by type.
 * Called from the panel with the asset's type and absolute path.
 * @param {string} filePath  - Absolute path to the asset file.
 * @param {string} assetType - The asset type: mogrt, sfx, lut, overlay, etc.
 * @returns {string} JSON: { ok: boolean, error?: string }
 */
function sunInsertAsset(filePath, assetType) {
    try {
        var lowerPath = filePath.toLowerCase();
        
        // Handle presets specifically
        if (assetType === "preset" || lowerPath.indexOf(".prfpset") !== -1) {
            return JSON.stringify({
                ok: false,
                error: "Presets (.prfpset) cannot be imported via script. Please drag and drop the preset directly into your Effects panel."
            });
        }

        switch (assetType) {
            case "mogrt":
            case "transition":
            case "caption":
                if (lowerPath.indexOf(".mogrt") !== -1) {
                    return sunInsertMogrt(filePath, 0, 0);
                }
                return sunImportFile(filePath);

            case "sfx":
            case "music":
                return sunInsertOnTrack(filePath, "audio", 0);

            case "overlay":
            case "background":
            case "video":
            case "image":
            case "guide":
            case "effect":
                return sunInsertOnTrack(filePath, "video", 0);

            case "lut":
            case "colorpreset":
                if (lowerPath.indexOf(".cube") !== -1 || lowerPath.indexOf(".look") !== -1) {
                    return sunApplyLut(filePath);
                }
                return sunImportFile(filePath);

            default:
                return sunImportFile(filePath);
        }
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}
