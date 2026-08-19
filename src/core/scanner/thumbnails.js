"use strict";
/**
 * Thumbnail generation.
 *
 * Where the format can be read without a decoder we render the real thing:
 *   .wav          the actual peak envelope
 *   .cube         the LUT applied to a reference ramp, so grades are comparable
 *   .mogrt        the thumbnail the template already carries inside its ZIP
 *   .png          the image itself, box-filtered down
 * Everything else gets a typed card: a labelled, colour-coded placeholder that
 * is honest about being one, rather than a broken-image box.
 */

const fs = require("fs");
const path = require("path");
const { Canvas } = require("../util/png");
const { decodePNG, resizeRGBA } = require("../util/png-decode");
const { peakEnvelope, readWAVInfo } = require("../util/wav");
const { listEntries, extractEntry } = require("../util/zip");
const { drawText, drawTextCentered, measureText, fitText } = require("../util/bitmap-font");
const { extOf } = require("../util/formats");

const THUMB_W = 240;
const THUMB_H = 135; // 16:9, matching the browser grid cell

/** Accent colour per asset type. Keeps the grid scannable by shape and hue. */
const TYPE_COLORS = {
  mogrt: [255, 154, 40],
  sfx: [86, 190, 255],
  music: [150, 130, 255],
  transition: [255, 118, 92],
  lut: [120, 220, 160],
  colorpreset: [120, 220, 160],
  preset: [200, 170, 120],
  caption: [240, 200, 90],
  overlay: [255, 130, 190],
  background: [110, 180, 220],
  effect: [170, 160, 255],
  guide: [150, 160, 175],
  template: [190, 190, 200],
  video: [130, 200, 230],
  image: [200, 180, 140],
  unknown: [140, 140, 150],
};

function colorFor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.unknown;
}

function card(type) {
  const c = new Canvas(THUMB_W, THUMB_H);
  const [r, g, b] = colorFor(type);
  // Dark panel with a faint wash of the type colour, so the card reads as UI
  // chrome rather than as a failed image load.
  c.shade((nx, ny) => [
    Math.round(26 + r * 0.10 * (1 - ny * 0.6)),
    Math.round(27 + g * 0.10 * (1 - ny * 0.6)),
    Math.round(31 + b * 0.10 * (1 - ny * 0.6)),
    255,
  ]);
  return c;
}

function label(canvas, text, y, color, scale = 2) {
  drawTextCentered(canvas, fitText(String(text).toUpperCase(), Math.floor(THUMB_W / (6 * scale))),
    0, THUMB_W, y, color, scale, 1);
}

/* ------------------------------------------------------------------- audio */

function audioThumb(bytes, asset) {
  const env = peakEnvelope(bytes, THUMB_W - 24);
  const info = readWAVInfo(bytes);
  const c = card(asset.type);
  const [r, g, b] = colorFor(asset.type);

  if (!env) {
    label(c, asset.type, 52, [r, g, b], 2);
    label(c, "AUDIO", 76, [120, 122, 130], 1);
    return { png: c.toPNG(), duration: info ? info.duration : null };
  }

  const mid = Math.round(THUMB_H * 0.52);
  const amp = THUMB_H * 0.30;

  // Baseline, then the envelope as vertical bars.
  c.rect(12, mid, THUMB_W - 24, 1, r, g, b, 0.25);
  env.forEach(([min, max], i) => {
    const x = 12 + i;
    const top = mid - Math.max(1, max * amp);
    const bottom = mid + Math.max(1, -min * amp);
    for (let y = Math.round(top); y <= Math.round(bottom); y++) {
      // Fade toward the extremes so loud transients still read as shape.
      const d = Math.abs(y - mid) / amp;
      c.blend(x, y, r, g, b, 0.95 - d * 0.35);
    }
  });

  if (info) {
    const secs = info.duration;
    const text = secs < 10 ? secs.toFixed(2) + "S" : Math.round(secs) + "S";
    drawText(c, text, THUMB_W - measureText(text, 1, 1) - 8, THUMB_H - 12, [150, 152, 160], 1, 1);
  }
  label(c, asset.subcategory || asset.category || asset.type, 14, [r, g, b], 1);

  return { png: c.toPNG(), duration: info ? info.duration : null };
}

/* --------------------------------------------------------------------- LUT */

/**
 * Parse a .cube file into { size, table } where table is a Float32Array of
 * size^3 RGB triples in the file order (red fastest).
 */
function parseCube(text) {
  const lines = String(text).split(/\r?\n/);
  let size = 0;
  const values = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^TITLE/i.test(line)) continue;
    if (/^DOMAIN_(MIN|MAX)/i.test(line)) continue;
    const m = /^LUT_3D_SIZE\s+(\d+)/i.exec(line);
    if (m) { size = parseInt(m[1], 10); continue; }
    if (/^LUT_1D_SIZE/i.test(line)) return null; // 1D LUTs are not previewed
    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      values.push(parts[0], parts[1], parts[2]);
    }
  }

  if (!size || values.length < size * size * size * 3) return null;
  return { size, table: Float32Array.from(values) };
}

/** Trilinear sample of a parsed cube. Inputs and outputs are 0..1. */
function sampleCube(lut, r, g, b) {
  const n = lut.size;
  const scale = n - 1;
  const fr = Math.min(scale, Math.max(0, r * scale));
  const fg = Math.min(scale, Math.max(0, g * scale));
  const fb = Math.min(scale, Math.max(0, b * scale));

  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(scale, r0 + 1), g1 = Math.min(scale, g0 + 1), b1 = Math.min(scale, b0 + 1);
  const dr = fr - r0, dg = fg - g0, db = fb - b0;

  // .cube ordering: red varies fastest, then green, then blue.
  const at = (ri, gi, bi) => ((bi * n + gi) * n + ri) * 3;

  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const c000 = lut.table[at(r0, g0, b0) + ch];
    const c100 = lut.table[at(r1, g0, b0) + ch];
    const c010 = lut.table[at(r0, g1, b0) + ch];
    const c110 = lut.table[at(r1, g1, b0) + ch];
    const c001 = lut.table[at(r0, g0, b1) + ch];
    const c101 = lut.table[at(r1, g0, b1) + ch];
    const c011 = lut.table[at(r0, g1, b1) + ch];
    const c111 = lut.table[at(r1, g1, b1) + ch];

    const c00 = c000 * (1 - dr) + c100 * dr;
    const c10 = c010 * (1 - dr) + c110 * dr;
    const c01 = c001 * (1 - dr) + c101 * dr;
    const c11 = c011 * (1 - dr) + c111 * dr;
    const c0 = c00 * (1 - dg) + c10 * dg;
    const c1 = c01 * (1 - dg) + c11 * dg;
    out[ch] = c0 * (1 - db) + c1 * db;
  }
  return out;
}

/**
 * A LUT thumbnail shows the grade, not the file. The reference image is a
 * synthetic scene: a sky-to-ground gradient with a skin-tone patch and a
 * greyscale ramp, which is what actually distinguishes one grade from another
 * at a glance.
 */
function lutThumb(text, asset) {
  const lut = parseCube(text);
  const c = card(asset.type);

  if (!lut) {
    const [r, g, b] = colorFor(asset.type);
    label(c, "LUT", 48, [r, g, b], 2);
    label(c, "NO PREVIEW", 74, [120, 122, 130], 1);
    return { png: c.toPNG() };
  }

  const rampH = 18;
  const sceneH = THUMB_H - rampH;

  // Reference scene, then the LUT applied to it.
  c.shade((nx, ny, x, y) => {
    if (y >= sceneH) return null;
    const v = ny / (sceneH / THUMB_H);
    let sr, sg, sb;
    if (v < 0.55) {
      // sky: blue to pale horizon
      const t = v / 0.55;
      sr = 0.28 + 0.52 * t; sg = 0.45 + 0.42 * t; sb = 0.72 + 0.18 * t;
    } else {
      // ground: warm mid tones
      const t = (v - 0.55) / 0.45;
      sr = 0.42 - 0.24 * t; sg = 0.33 - 0.20 * t; sb = 0.22 - 0.14 * t;
    }
    // skin-tone patch, lower left
    if (nx < 0.26 && v > 0.58) { sr = 0.76; sg = 0.56; sb = 0.45; }
    const [r, g, b] = sampleCube(lut, sr, sg, sb);
    return [
      Math.round(Math.max(0, Math.min(1, r)) * 255),
      Math.round(Math.max(0, Math.min(1, g)) * 255),
      Math.round(Math.max(0, Math.min(1, b)) * 255),
      255,
    ];
  });

  // Greyscale ramp through the LUT: reveals crushed blacks and lifted shadows.
  for (let x = 0; x < THUMB_W; x++) {
    const v = x / (THUMB_W - 1);
    const [r, g, b] = sampleCube(lut, v, v, v);
    for (let y = sceneH; y < THUMB_H; y++) {
      c.set(x, y,
        Math.round(Math.max(0, Math.min(1, r)) * 255),
        Math.round(Math.max(0, Math.min(1, g)) * 255),
        Math.round(Math.max(0, Math.min(1, b)) * 255), 255);
    }
  }
  c.rect(0, sceneH, THUMB_W, 1, 0, 0, 0, 0.5);

  const sizeText = lut.size + "X" + lut.size + "X" + lut.size;
  drawText(c, sizeText, 8, 8, [255, 255, 255, 1], 1, 1);

  return { png: c.toPNG(), lutSize: lut.size };
}

/* ------------------------------------------------------------------- image */

function imageThumb(bytes, asset) {
  const decoded = decodePNG(bytes);
  if (!decoded) return null;

  const fitted = resizeRGBA(decoded, THUMB_W, THUMB_H);
  const c = card(asset.type);

  // Checkerboard behind transparency so alpha overlays read correctly.
  const ox = Math.round((THUMB_W - fitted.width) / 2);
  const oy = Math.round((THUMB_H - fitted.height) / 2);
  for (let y = 0; y < fitted.height; y++) {
    for (let x = 0; x < fitted.width; x++) {
      const i = (y * fitted.width + x) * 4;
      const a = fitted.data[i + 3] / 255;
      const checker = ((x >> 3) + (y >> 3)) % 2 ? 58 : 44;
      c.set(ox + x, oy + y,
        Math.round(fitted.data[i] * a + checker * (1 - a)),
        Math.round(fitted.data[i + 1] * a + checker * (1 - a)),
        Math.round(fitted.data[i + 2] * a + checker * (1 - a)), 255);
    }
  }

  return { png: c.toPNG(), width: decoded.width, height: decoded.height };
}

/* ------------------------------------------------------------------- mogrt */

/** A .mogrt is a ZIP; templates normally carry their own preview image. */
function mogrtThumb(bytes, asset) {
  const listed = listEntries(bytes);
  if (!listed.ok) return null;

  const candidate = listed.entries.find((e) =>
    !e.isDirectory && /\.png$/i.test(e.name) && /thumb|preview|poster/i.test(e.name))
    || listed.entries.find((e) => !e.isDirectory && /\.png$/i.test(e.name));

  if (!candidate) return null;

  try {
    const inner = extractEntry(bytes, candidate);
    return imageThumb(inner, asset);
  } catch (e) {
    return null;
  }
}

/* -------------------------------------------------------------------- main */

/**
 * Generate a thumbnail for one asset.
 * Returns { relativePath, width, height, duration } or null when the format has
 * no readable preview and even the card could not be written.
 */
function generateThumbnail(absoluteFile, asset, outputDir) {
  const ext = extOf(absoluteFile);
  let result = null;

  try {
    const stat = fs.statSync(absoluteFile);
    // Reading a multi-gigabyte file to make a 240px card is never worth it;
    // large media falls straight through to the typed card.
    const readable = stat.size <= 64 * 1024 * 1024;
    const bytes = readable ? new Uint8Array(fs.readFileSync(absoluteFile)) : null;

    if (bytes) {
      if (ext === ".wav") result = audioThumb(bytes, asset);
      else if (ext === ".cube") result = lutThumb(Buffer.from(bytes).toString("utf8"), asset);
      else if (ext === ".png") result = imageThumb(bytes, asset);
      else if (ext === ".mogrt") result = mogrtThumb(bytes, asset);
    }
  } catch (e) {
    result = null;
  }

  if (!result) {
    // Typed card fallback: name on top, type beneath, colour-coded.
    const c = card(asset.type);
    const [r, g, b] = colorFor(asset.type);
    c.rect(0, 0, THUMB_W, 3, r, g, b, 0.9);
    label(c, asset.type, 46, [r, g, b], 2);
    label(c, asset.subcategory || asset.category || ext.replace(".", ""), 72, [130, 132, 140], 1);
    const e = ext.replace(".", "").toUpperCase();
    drawText(c, e, THUMB_W - measureText(e, 1, 1) - 8, THUMB_H - 12, [110, 112, 120], 1, 1);
    result = { png: c.toPNG() };
  }

  const filename = `${asset.id}.png`;
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, filename), result.png);

  return {
    filename,
    width: result.width || null,
    height: result.height || null,
    duration: result.duration || null,
    lutSize: result.lutSize || null,
  };
}

module.exports = {
  generateThumbnail,
  parseCube,
  sampleCube,
  colorFor,
  THUMB_W,
  THUMB_H,
  TYPE_COLORS,
};
