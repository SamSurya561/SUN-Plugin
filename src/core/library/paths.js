"use strict";
/**
 * Library locations.
 *
 * Two libraries live side by side under one root:
 *
 *   Library/            the permanent, personally owned collection
 *   DevelopmentLibrary/  the temporary test corpus, deletable at any time
 *
 * Both are OUTSIDE the plugin package. Nothing large is ever written into the
 * plugin itself, so the shipped bundle stays small however big the corpus grows.
 *
 * The core reads both. It does not know or care that one of them was populated
 * by a subsystem that will later be deleted.
 */

const path = require("path");
const os = require("os");
const fs = require("fs");

const APP_FOLDER = "Sun Plugin";

/** Category folders created inside each library. */
const LIBRARY_FOLDERS = [
  "MOGRT",
  "SFX",
  "Music",
  "Transitions",
  "LUTs",
  "Presets",
  "Presets/Color",
  "Captions",
  "Overlays",
  "Effects",
  "Effects/Backgrounds",
  "Effects/Images",
  "Effects/Video",
  "Guides",
  "Templates",
];

function homeDir() {
  return process.env.SUN_HOME || os.homedir();
}

/**
 * Root of everything Sun Plugin writes.
 * SUN_LIBRARY_ROOT overrides it, which is what the test suite and the CLI
 * `--root` flag use so a test run never touches the real library.
 */
function libraryRoot() {
  if (process.env.SUN_LIBRARY_ROOT) return path.resolve(process.env.SUN_LIBRARY_ROOT);
  return path.join(homeDir(), "Documents", APP_FOLDER);
}

const paths = {
  get root() { return libraryRoot(); },
  /** The permanent library. */
  get library() { return path.join(libraryRoot(), "Library"); },
  /** The temporary development corpus. Safe to delete wholesale. */
  get developmentLibrary() { return path.join(libraryRoot(), "DevelopmentLibrary"); },
  get db() { return path.join(libraryRoot(), "db"); },
  get dbFile() { return path.join(libraryRoot(), "db", "sun-assets.json"); },
  get cache() { return path.join(libraryRoot(), "cache"); },
  get thumbs() { return path.join(libraryRoot(), "cache", "thumbs"); },
  get previews() { return path.join(libraryRoot(), "cache", "previews"); },
  /** Downloads land here first and are only promoted after validation. */
  get staging() { return path.join(libraryRoot(), "cache", "staging"); },
  /** Anything that fails validation. Never indexed as an asset. */
  get quarantine() { return path.join(libraryRoot(), "quarantine"); },
  get settingsFile() { return path.join(libraryRoot(), "settings.json"); },
};

/** Root for a given origin. Development assets never mix into the real library. */
function rootFor(developmentOnly) {
  return developmentOnly ? paths.developmentLibrary : paths.library;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create the full folder tree. Idempotent. */
function ensureLibrary({ development = true } = {}) {
  ensureDir(paths.root);
  ensureDir(paths.db);
  ensureDir(paths.thumbs);
  ensureDir(paths.previews);
  ensureDir(paths.staging);
  ensureDir(paths.quarantine);

  const roots = development ? [paths.library, paths.developmentLibrary] : [paths.library];
  for (const base of roots) {
    ensureDir(base);
    for (const folder of LIBRARY_FOLDERS) ensureDir(path.join(base, folder));
  }
  return paths.root;
}

/**
 * Turn a path into one relative to the library root, using forward slashes.
 * Stored records are root-relative so the whole library can be moved or synced
 * to another machine without rewriting every row.
 */
function toRelative(absolute) {
  const rel = path.relative(paths.root, absolute);
  return rel.split(path.sep).join("/");
}

function toAbsolute(relative) {
  return path.join(paths.root, String(relative).split("/").join(path.sep));
}

/** Is this path inside the library root? Guards against traversal on write. */
function isInsideLibrary(candidate) {
  const rel = path.relative(paths.root, path.resolve(candidate));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

module.exports = {
  APP_FOLDER,
  LIBRARY_FOLDERS,
  paths,
  rootFor,
  ensureDir,
  ensureLibrary,
  toRelative,
  toAbsolute,
  isInsideLibrary,
  libraryRoot,
};
