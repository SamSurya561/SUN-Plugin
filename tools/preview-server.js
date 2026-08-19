#!/usr/bin/env node
"use strict";
/**
 * Static preview server for the panel.
 *
 * The panel is plain HTML/CSS/JS with no build step, so it can be developed in a
 * browser against an exported index. Two roots are served:
 *
 *   /          the plugin source tree (src/ui, assets/branding)
 *   /library/  the asset library root, so thumbnails resolve
 *
 * Read-only, bound to localhost, and it refuses any path that escapes either
 * root. It exists for development preview only and is not part of the plugin.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const LIBRARY_ROOT = process.env.SUN_LIBRARY_ROOT
  || path.join(process.env.USERPROFILE || process.env.HOME || "", "Documents", "Sun Plugin");
const PORT = Number(process.env.SUN_PREVIEW_PORT || 4317);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".cube": "text/plain; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** Resolve a request path inside a root, refusing anything that escapes it. */
function resolveSafe(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const resolved = path.resolve(root, "." + decoded);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

const UI_ROOT = path.join(PROJECT_ROOT, "src", "ui");

/**
 * The panel is the document root, so its own relative references (panel.css,
 * index-preview.json) resolve the way they will inside the UXP plugin. Other
 * trees are mounted beside it rather than the panel being served from a
 * subdirectory.
 */
const MOUNTS = [
  { prefix: "/library/", root: LIBRARY_ROOT },
  { prefix: "/assets/", root: path.join(PROJECT_ROOT, "assets"), strip: "/assets" },
  { prefix: "/src/", root: path.join(PROJECT_ROOT, "src"), strip: "/src" },
];

const server = http.createServer((req, res) => {
  let root = UI_ROOT;
  let requestPath = req.url;

  if (requestPath === "/") requestPath = "/index.html";

  for (const mount of MOUNTS) {
    if (requestPath.startsWith(mount.prefix)) {
      root = mount.root;
      requestPath = requestPath.slice((mount.strip || mount.prefix.replace(/\/$/, "")).length);
      break;
    }
  }

  const file = resolveSafe(root, requestPath);
  if (!file) {
    res.writeHead(403).end("forbidden");
    return;
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found: " + requestPath);
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Sun Plugin preview on http://localhost:${PORT}`);
  console.log(`  project  ${PROJECT_ROOT}`);
  console.log(`  library  ${LIBRARY_ROOT}`);
});
