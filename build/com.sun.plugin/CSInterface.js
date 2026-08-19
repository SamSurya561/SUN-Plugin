/**
 * CSInterface — Adobe Common Extensibility Platform interface library.
 *
 * Based on the official Adobe CSInterface v12.
 * Provides the bridge between the CEP panel (HTML/JS) and the host application.
 */

/* eslint-disable */

/** System path type constants. */
var SystemPath = {
    USER_DATA:        "userData",
    COMMON_FILES:     "commonFiles",
    MY_DOCUMENTS:     "myDocuments",
    APPLICATION:      "application",
    EXTENSION:        "extension",
    HOST_APPLICATION:  "hostApplication"
};

/** Color type constants. */
var ColorType = {
    RGB:     "rgb",
    GRADIENT: "gradient",
    NONE:    "none"
};

/** Host application IDs. */
var HostAppId = {
    PHSP: "PHSP", PHXS: "PHXS", ILST: "ILST", PPRO: "PPRO",
    PRLD: "PRLD", AEFT: "AEFT", FLPR: "FLPR", AUDT: "AUDT",
    DRWV: "DRWV", IDSN: "IDSN", AICY: "AICY", KBRG: "KBRG"
};

/** Theme color change event. */
var CSEvent = {
    THEME_COLOR_CHANGED_EVENT: "com.adobe.csxs.events.ThemeColorChanged"
};

/**
 * @constructor
 */
function CSInterface() {
    /** Stores the host environment retrieved from the runtime. */
    this.hostEnvironment = null;

    try {
        this.hostEnvironment = JSON.parse(window.__adobe_cep__.getHostEnvironment());
    } catch (e) {
        // Not running inside CEP host.
    }
}

/**
 * Retrieve the host environment.
 * @returns {Object} Host environment data.
 */
CSInterface.prototype.getHostEnvironment = function () {
    try {
        this.hostEnvironment = JSON.parse(window.__adobe_cep__.getHostEnvironment());
    } catch (e) {}
    return this.hostEnvironment;
};

/**
 * Close this extension panel.
 */
CSInterface.prototype.closeExtension = function () {
    window.__adobe_cep__.closeExtension();
};

/**
 * Get the system path of the given type.
 * @param {string} pathType - A SystemPath constant.
 * @returns {string} The system path.
 */
CSInterface.prototype.getSystemPath = function (pathType) {
    var p = "";
    try {
        p = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
    } catch (e) {
        return "";
    }

    // The runtime returns file:// URIs — normalise to plain OS paths.
    var isWindows = navigator.platform.indexOf("Win") >= 0;
    if (isWindows) {
        p = p.replace("file:///", "");
    } else {
        p = p.replace("file://", "");
    }
    return p;
};

/**
 * Evaluate an ExtendScript expression in the host.
 * @param {string}   script   - ExtendScript to evaluate.
 * @param {Function} [callback] - Receives the result string.
 */
CSInterface.prototype.evalScript = function (script, callback) {
    if (callback === null || callback === undefined) {
        callback = function () {};
    }
    window.__adobe_cep__.evalScript(script, callback);
};

/**
 * Retrieve the unique ID of this extension.
 * @returns {string}
 */
CSInterface.prototype.getExtensionID = function () {
    return window.__adobe_cep__.getExtensionId();
};

/**
 * Register interest in a host event.
 * @param {string}   type     - Event type string.
 * @param {Function} listener - Callback receiving a CSEvent-style object.
 * @param {Object}   [obj]    - Optional listener scope.
 */
CSInterface.prototype.addEventListener = function (type, listener, obj) {
    try {
        window.__adobe_cep__.addEventListener(type, function (csEvent) {
            var evt;
            try {
                evt = typeof csEvent === "string" ? JSON.parse(csEvent) : csEvent;
            } catch (e) {
                evt = { type: type, data: csEvent };
            }
            listener.call(obj || null, evt);
        });
    } catch (e) {}
};

/**
 * Remove a host event listener.
 * @param {string}   type     - Event type string.
 * @param {Function} listener - The originally registered callback.
 * @param {Object}   [obj]    - Optional listener scope.
 */
CSInterface.prototype.removeEventListener = function (type, listener, obj) {
    try {
        window.__adobe_cep__.removeEventListener(type, listener, obj);
    } catch (e) {}
};

/**
 * Dispatch a custom event to the host or other extensions.
 * @param {Object} event - Must have at minimum { type, scope, data }.
 */
CSInterface.prototype.dispatchEvent = function (event) {
    if (!event || !event.type) return;
    try {
        var eventJSON = JSON.stringify({
            type:        event.type,
            scope:       event.scope || "APPLICATION",
            appId:       event.appId || this.hostEnvironment && this.hostEnvironment.appId || "",
            extensionId: event.extensionId || this.getExtensionID(),
            data:        event.data || ""
        });
        window.__adobe_cep__.dispatchEvent(eventJSON);
    } catch (e) {}
};

/**
 * Request to open a URL in the default browser.
 * @param {string} url
 */
CSInterface.prototype.openURLInDefaultBrowser = function (url) {
    try {
        window.cep.util.openURLInDefaultBrowser(url);
    } catch (e) {
        // Fallback.
        window.open(url, "_blank");
    }
};

/**
 * Get the scale factor of the current screen.
 * @returns {number}
 */
CSInterface.prototype.getScaleFactor = function () {
    try {
        return window.__adobe_cep__.getScaleFactor();
    } catch (e) {
        return 1;
    }
};

/**
 * Set the title of the extension panel.
 * @param {string} title
 */
CSInterface.prototype.setWindowTitle = function (title) {
    try {
        window.__adobe_cep__.invokeSync("setWindowTitle", title);
    } catch (e) {}
};

/**
 * Get current API version.
 * @returns {Object} Version info with major, minor, micro.
 */
CSInterface.prototype.getCurrentApiVersion = function () {
    try {
        var v = JSON.parse(window.__adobe_cep__.getCurrentApiVersion());
        return v;
    } catch (e) {
        return { major: 0, minor: 0, micro: 0 };
    }
};

/**
 * Get extensions currently loaded in the host.
 * @param {Array} [extensionIds] - Optional array of IDs to filter.
 * @returns {Array}
 */
CSInterface.prototype.getExtensions = function (extensionIds) {
    try {
        var list = JSON.parse(window.__adobe_cep__.getExtensions(extensionIds));
        return list;
    } catch (e) {
        return [];
    }
};

/**
 * Get the network preferences (proxy settings, etc.).
 * @returns {Object}
 */
CSInterface.prototype.getNetworkPreferences = function () {
    try {
        return JSON.parse(window.__adobe_cep__.getNetworkPreferences());
    } catch (e) {
        return {};
    }
};
