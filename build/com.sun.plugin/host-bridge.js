/**
 * Sun Plugin CEP Host Bridge.
 *
 * This script runs in the CEP panel's Node.js-enabled Chromium context.
 * It bridges between:
 *   - The SunPlugin core (loaded via Node.js require)
 *   - The Premiere Pro host (via CSInterface / ExtendScript)
 *   - The panel UI (via window.sunHost)
 *
 * Loaded AFTER CSInterface.js, BEFORE panel.js.
 * Sets window.sunHost so the panel UI has a live data source instead of the
 * static preview fallback.
 */
(function () {
    "use strict";

    /* -------------------------------------------------------- CEP detection */

    var csInterface;
    try {
        csInterface = new CSInterface();
    } catch (e) {
        console.warn("[SunPlugin] Not running in CEP — host bridge inactive.");
        return;
    }

    var extPath = csInterface.getSystemPath(SystemPath.EXTENSION);
    if (!extPath) {
        console.warn("[SunPlugin] Cannot determine extension path.");
        return;
    }

    /* ------------------------------------------------------------ Node.js */

    var nodePath = require("path");
    var nodeFs   = require("fs");

    // Normalise the extension path to OS-native separators
    extPath = nodePath.normalize(extPath);

    /* ------------------------------------------------------ SunPlugin core */

    var SunPluginModule, plugin, pathsModule;

    try {
        SunPluginModule = require(nodePath.join(extPath, "src", "index"));
        pathsModule     = require(nodePath.join(extPath, "src", "core", "library", "paths"));

        plugin = new SunPluginModule.SunPlugin();
        plugin.start();

        console.log("[SunPlugin] Core loaded.  Assets: " + plugin.db.size +
                    "  Library: " + pathsModule.paths.root);
    } catch (e) {
        console.error("[SunPlugin] Failed to load core:", e);
        // Fall through — the panel will use its preview fallback.
        return;
    }

    /* ------------------------------------------------------- path helpers */

    /**
     * Resolve an asset's library-relative file path to an absolute OS path.
     * Asset records store paths relative to the library root with forward
     * slashes; this turns them into something the host can open.
     */
    function resolveAssetPath(asset) {
        if (!asset || !asset.file) return null;
        return pathsModule.toAbsolute(asset.file);
    }

    /**
     * Resolve a thumbnail path to a file:// URL the browser can load.
     * Thumbnails are stored as relative paths under cache/thumbs/.
     */
    function thumbFileUrl(asset) {
        if (!asset || !asset.thumbnail) return null;
        var abs = nodePath.join(pathsModule.paths.thumbs, asset.thumbnail);
        if (!nodeFs.existsSync(abs)) return null;
        // Convert to file:// URL with forward slashes.
        return "file:///" + abs.replace(/\\/g, "/");
    }

    /* -------------------------------------------------- ExtendScript calls */

    /**
     * Call a named ExtendScript function via evalScript and parse the JSON
     * result. All premiere.jsx functions return JSON strings.
     */
    function callJSX(expr) {
        return new Promise(function (resolve) {
            csInterface.evalScript(expr, function (raw) {
                if (raw === "EvalScript error.") {
                    return resolve({ ok: false, error: "ExtendScript evaluation failed" });
                }
                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    resolve({ ok: false, error: "Unparseable host response: " + String(raw).slice(0, 120) });
                }
            });
        });
    }

    /**
     * Escape a file path for safe embedding in an ExtendScript function call.
     * Backslashes must be doubled, and quotes escaped.
     */
    function escJSX(str) {
        return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    /* --------------------------------------------------------- sunHost API */

    window.sunHost = {
        preview: false,

        /**
         * Query the asset database.
         * Same contract as the preview-mode host.query().
         */
        async query(opts) {
            return plugin.search(opts || {});
        },

        /**
         * Compute facet counts for the sidebar.
         */
        async facets(opts) {
            return plugin.facets(opts || {});
        },

        /**
         * List all collections.
         */
        async collections() {
            var list = plugin.listCollections();
            return list || [];
        },

        async createCollection(name) {
            try {
                plugin.createCollection(name, "");
                plugin.save();
                return { ok: true };
            } catch(e) { return { ok: false, error: e.message }; }
        },

        async renameCollection(oldName, newName) {
            try {
                var res = plugin.renameCollection(oldName, newName);
                if(res) plugin.save();
                return { ok: res };
            } catch(e) { return { ok: false, error: e.message }; }
        },

        async deleteCollection(name) {
            try {
                var res = plugin.deleteCollection(name);
                if(res) plugin.save();
                return { ok: res };
            } catch(e) { return { ok: false, error: e.message }; }
        },

        async addToCollection(id, name) {
            try {
                var res = plugin.addToCollection(id, name);
                if(res) plugin.save();
                return { ok: res };
            } catch(e) { return { ok: false, error: e.message }; }
        },

        /**
         * Return the current plugin settings.
         */
        async settings() {
            return plugin.settings;
        },

        /**
         * Get editable parameters of the selected MOGRT in the timeline.
         */
        async getMogrtParams() {
            return callJSX('sunGetSelectedMogrtParams()');
        },

        /**
         * Update a parameter of the selected MOGRT in the timeline.
         */
        async updateMogrtParam(paramIndex, value) {
            // value could be string, number, boolean, or array (for colors)
            return callJSX('sunUpdateMogrtParam(' + paramIndex + ', ' + JSON.stringify(value) + ')');
        },

        /**
         * Toggle an asset's favourite status.
         */
        async toggleFavorite(id) {
            return plugin.toggleFavorite(id);
        },

        /**
         * Insert an asset at the playhead in Premiere Pro.
         * Routes through the ExtendScript functions defined in premiere.jsx.
         */
        async insert(id) {
            var asset = plugin.get(id);
            if (!asset) return { ok: false, error: "asset not found" };

            var absPath = resolveAssetPath(asset);
            if (!absPath) return { ok: false, error: "this asset has no file (stress-test record?)" };

            if (!nodeFs.existsSync(absPath)) {
                return { ok: false, error: "file not found: " + absPath };
            }

            // Allow fixtures to be inserted if the user demands it, though Premiere may reject them natively.

            // Mark the asset as used.
            plugin.markUsed(id);
            plugin.save();

            // Call the unified insertion function in ExtendScript.
            return callJSX('sunInsertAsset("' + escJSX(absPath) + '", "' + escJSX(asset.type) + '")');
        },

        /**
         * Execute a named command (import, replace, dev-tool commands, etc.).
         */
        async command(cmd, opts) {
            opts = opts || {};

            switch (cmd) {
                case "import": {
                    // Legacy bulk scan
                    var result = plugin.scan({});
                    plugin.save();
                    return { ok: true, imported: result.added || 0 };
                }

                case "import-dialog": {
                    // Open native OS file picker via CEP
                    if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialog) {
                        return { ok: false, error: "Native file picker not available in this context." };
                    }
                    var result = window.cep.fs.showOpenDialog(
                        true, // allowMultipleSelection
                        false, // chooseDirectory
                        "Select Assets to Import", // title
                        "", // initialPath
                        ["mogrt", "prfpset", "mp4", "mov", "png", "jpg", "wav", "mp3", "cube", "look"] // fileTypes
                    );
                    
                    if (result.err !== 0 || !result.data || result.data.length === 0) {
                        return { ok: false, error: "Import cancelled" };
                    }
                    
                    var importedCount = 0;
                    for (var i = 0; i < result.data.length; i++) {
                        // plugin.importFile will copy to library and index it
                        var fileRes = plugin.importFile(result.data[i]);
                        if (fileRes && fileRes.ok) {
                            importedCount++;
                            if (opts.collection && fileRes.asset) {
                                plugin.addToCollection(fileRes.asset.id, opts.collection);
                            }
                        }
                    }
                    
                    if (importedCount > 0) {
                        plugin.save();
                        return { ok: true, imported: importedCount };
                    } else {
                        return { ok: false, error: "Could not import selected files" };
                    }
                }

                case "replace": {
                    if (!opts.id) return { ok: false, error: "no asset selected" };
                    return { ok: false, error: "use the Import button to add your own assets" };
                }

                case "scan-local":
                case "rebuild": {
                    plugin.scan({});
                    plugin.save();
                    return { ok: true };
                }

                default:
                    return { ok: false, error: "command not available: " + cmd };
            }
        },

        /**
         * Return a file:// URL for the asset's thumbnail.
         */
        thumbUrl: function (asset) {
            return thumbFileUrl(asset);
        },

        /**
         * Resolve an asset file relative path to absolute OS path
         */
        toAbsolute: function (relPath) {
            return pathsModule.toAbsolute(relPath);
        }
    };

    console.log("[SunPlugin] Host bridge ready. window.sunHost is live.");

    /* ------------------------------------------------ Premiere host events */

    // Listen for theme changes so the panel can adapt to Premiere's brightness.
    try {
        csInterface.addEventListener(
            "com.adobe.csxs.events.ThemeColorChanged",
            function () {
                var env = csInterface.getHostEnvironment();
                if (env && env.appSkinInfo) {
                    var bg = env.appSkinInfo.panelBackgroundColor;
                    if (bg && bg.color) {
                        var lum = (bg.color.red + bg.color.green + bg.color.blue) / 3;
                        document.documentElement.setAttribute(
                            "data-theme",
                            lum > 127 ? "light" : "dark"
                        );
                    }
                }
            }
        );

        // Apply theme on load.
        var env = csInterface.getHostEnvironment();
        if (env && env.appSkinInfo) {
            var bg = env.appSkinInfo.panelBackgroundColor;
            if (bg && bg.color) {
                var lum = (bg.color.red + bg.color.green + bg.color.blue) / 3;
                document.documentElement.setAttribute(
                    "data-theme",
                    lum > 127 ? "light" : "dark"
                );
            }
        }
    } catch (e) {
        console.warn("[SunPlugin] Could not listen for theme changes:", e);
    }

})();
