#!/usr/bin/env node
"use strict";
/**
 * Build script — assembles the CEP extension into a ready-to-install package.
 *
 * Usage:
 *   node tools/build-cep.js              Build the extension to build/com.sunplugin.premiere/
 *   node tools/build-cep.js --install    Build and copy to the CEP extensions directory
 *   node tools/build-cep.js --installer  Build and run Inno Setup to produce the .exe
 *
 * The output directory is a complete, self-contained CEP extension that can be
 * dropped into %APPDATA%\Adobe\CEP\extensions\ or packaged with Inno Setup.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CEP_SRC = path.join(ROOT, "cep");
const BUILD = path.join(ROOT, "build", "com.sun.plugin");

const EXTENSION_ID = "com.sun.plugin";

/* ---------------------------------------------------------------- helpers */

function clean(dir) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
}

function copyDir(src, dest, exclude = []) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (exclude.includes(entry.name)) continue;
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(s, d, exclude);
        } else {
            copyFile(s, d);
        }
    }
}

function countFiles(dir) {
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
        else count++;
    }
    return count;
}

/* ------------------------------------------------------------------ build */

console.log("=== Sun Plugin CEP Build ===\n");

// 1. Clean previous build
console.log("1. Cleaning build directory...");
clean(BUILD);
ensureDir(BUILD);

// 2. Copy CEP-specific files (manifest, CSInterface, host bridge, etc.)
console.log("2. Copying CEP extension files...");
copyDir(CEP_SRC, BUILD);

// 3. (UI is now built by Vite, so we skip copying panel files here)

// Copy preview index for fallback
if (fs.existsSync(path.join(ROOT, "src", "ui", "index-preview.json"))) {
    copyFile(
        path.join(ROOT, "src", "ui", "index-preview.json"),
        path.join(BUILD, "index-preview.json")
    );
}

// 4. Copy source tree (core, adapters — but not dev-ingestor for production)
console.log("4. Copying source modules...");
const srcDest = path.join(BUILD, "src");

// Copy src/index.js
copyFile(path.join(ROOT, "src", "index.js"), path.join(srcDest, "index.js"));

// Copy src/core/
copyDir(path.join(ROOT, "src", "core"), path.join(srcDest, "core"));

// Copy src/adapters/
copyDir(path.join(ROOT, "src", "adapters"), path.join(srcDest, "adapters"));

// Copy src/dev-ingestor/ (optional — the feature flag controls activation)
if (fs.existsSync(path.join(ROOT, "src", "dev-ingestor"))) {
    copyDir(path.join(ROOT, "src", "dev-ingestor"), path.join(srcDest, "dev-ingestor"));
}

// 5. Copy config
console.log("5. Copying config...");
copyDir(path.join(ROOT, "config"), path.join(BUILD, "config"));

// 6. Copy package.json (for metadata)
copyFile(path.join(ROOT, "package.json"), path.join(BUILD, "package.json"));

// 7. Copy icons
console.log("6. Copying icons...");
const iconsDir = path.join(ROOT, "assets", "branding", "icons");
const destIcons = path.join(BUILD, "icons");
ensureDir(destIcons);
for (const file of fs.readdirSync(iconsDir)) {
    if (file.endsWith(".png")) {
        copyFile(path.join(iconsDir, file), path.join(destIcons, file));
    }
}

// Done
const fileCount = countFiles(BUILD);
console.log(`\n✓ Build complete: ${fileCount} files in build/com.sunplugin.premiere/\n`);

/* ------------------------------------------------------- optional actions */

const args = process.argv.slice(2);

if (args.includes("--install")) {
    const cepDir = path.join(
        process.env.APPDATA || "",
        "Adobe", "CEP", "extensions", EXTENSION_ID
    );
    console.log(`Installing to ${cepDir} ...`);
    clean(cepDir);
    copyDir(BUILD, cepDir);
    console.log("✓ Installed. Restart Premiere Pro to load the extension.\n");

    // Enable debug mode (for unsigned extensions)
    enableDebugMode();
}

if (args.includes("--installer")) {
    console.log("Building installer with Inno Setup...\n");
    const issFile = path.join(ROOT, "installer", "SunPlugin.iss");
    if (!fs.existsSync(issFile)) {
        console.error("ERROR: installer/SunPlugin.iss not found.");
        process.exit(1);
    }

    // Try common Inno Setup paths
    const isccPaths = [
        "C:\\Program Files (x86)\\Inno Setup 7\\ISCC.exe",
        "C:\\Program Files\\Inno Setup 7\\ISCC.exe",
        "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
        "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
        "C:\\Program Files (x86)\\Inno Setup 5\\ISCC.exe",
    ];

    let iscc = null;
    for (const p of isccPaths) {
        if (fs.existsSync(p)) { iscc = p; break; }
    }

    if (!iscc) {
        // Try PATH
        try {
            execSync("ISCC /?" , { stdio: "pipe" });
            iscc = "ISCC";
        } catch (e) {
            console.error("ERROR: Inno Setup not found. Install it from https://jrsoftware.org/isinfo.php");
            process.exit(1);
        }
    }

    try {
        console.log(`Using: ${iscc}`);
        execSync(`"${iscc}" "${issFile}"`, { stdio: "inherit", cwd: ROOT });
        console.log("\n✓ Installer built successfully!\n");

        // Check where it was output
        const outputDir = path.join(ROOT, "installer", "Output");
        if (fs.existsSync(outputDir)) {
            const files = fs.readdirSync(outputDir).filter(f => f.endsWith(".exe"));
            for (const f of files) {
                console.log(`  → ${path.join(outputDir, f)}`);
            }
        }
    } catch (e) {
        console.error("ERROR: Inno Setup compilation failed.");
        process.exit(1);
    }
}

/* --------------------------------------------------- debug mode registry */

function enableDebugMode() {
    console.log("Setting PlayerDebugMode registry keys...");
    const versions = [9, 10, 11, 12];
    for (const v of versions) {
        try {
            execSync(
                `reg add "HKCU\\Software\\Adobe\\CSXS.${v}" /v PlayerDebugMode /t REG_SZ /d 1 /f`,
                { stdio: "pipe" }
            );
        } catch (e) {
            // Ignore — not all versions may be present.
        }
    }
    console.log("✓ Debug mode enabled for CSXS 9–12.\n");
}

if (args.includes("--debug")) {
    enableDebugMode();
}
