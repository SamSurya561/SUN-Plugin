"use strict";
/**
 * A 5x7 bitmap font.
 *
 * There is no text rendering in the UXP sandbox and no font file to lean on, but
 * an unlabelled thumbnail grid is much harder to scan than a labelled one. Five
 * by seven is the smallest cell that stays legible when a thumbnail is drawn at
 * 1x, and the glyph set is limited to what asset labels actually contain.
 */

const GLYPHS = {
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111",
  F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111",
  H: "10001 10001 10001 11111 10001 10001 10001",
  I: "11111 00100 00100 00100 00100 00100 11111",
  J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001",
  N: "10001 11001 10101 10011 10001 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101",
  R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 11011 10001",
  X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100",
  Z: "11111 00001 00010 00100 01000 10000 11111",
  0: "01110 10001 10011 10101 11001 10001 01110",
  1: "00100 01100 00100 00100 00100 00100 01110",
  2: "01110 10001 00001 00010 00100 01000 11111",
  3: "11111 00010 00100 00010 00001 10001 01110",
  4: "00010 00110 01010 10010 11111 00010 00010",
  5: "11111 10000 11110 00001 00001 10001 01110",
  6: "00110 01000 10000 11110 10001 10001 01110",
  7: "11111 00001 00010 00100 01000 01000 01000",
  8: "01110 10001 10001 01110 10001 10001 01110",
  9: "01110 10001 10001 01111 00001 00010 01100",
  " ": "00000 00000 00000 00000 00000 00000 00000",
  ".": "00000 00000 00000 00000 00000 01100 01100",
  ",": "00000 00000 00000 00000 01100 01100 11000",
  "-": "00000 00000 00000 11111 00000 00000 00000",
  "/": "00001 00010 00010 00100 01000 01000 10000",
  ":": "00000 01100 01100 00000 01100 01100 00000",
  "(": "00010 00100 01000 01000 01000 00100 00010",
  ")": "01000 00100 00010 00010 00010 00100 01000",
  "+": "00000 00100 00100 11111 00100 00100 00000",
  "%": "11001 11010 00010 00100 01000 01011 10011",
  "#": "01010 11111 01010 01010 01010 11111 01010",
  "?": "01110 10001 00001 00010 00100 00000 00100",
  "!": "00100 00100 00100 00100 00100 00000 00100",
  "*": "00000 10101 01110 11111 01110 10101 00000",
};

const GLYPH_W = 5;
const GLYPH_H = 7;

const CACHE = new Map();

function glyph(ch) {
  const key = String(ch).toUpperCase();
  if (CACHE.has(key)) return CACHE.get(key);
  const spec = GLYPHS[key];
  if (!spec) {
    CACHE.set(key, null);
    return null;
  }
  const rows = spec.split(" ").map((r) => r.split("").map((c) => c === "1"));
  CACHE.set(key, rows);
  return rows;
}

/** Pixel width of `text` at the given scale and letter spacing. */
function measureText(text, scale = 1, spacing = 1) {
  const n = String(text).length;
  if (n === 0) return 0;
  return n * GLYPH_W * scale + (n - 1) * spacing * scale;
}

/**
 * Draw text onto a Canvas from png.js.
 * Unknown characters render as a blank cell rather than throwing, so a stray
 * character in an asset name can never break thumbnail generation.
 */
function drawText(canvas, text, x, y, color, scale = 1, spacing = 1) {
  const [r, g, b, a = 1] = color;
  let cursor = x;

  for (const ch of String(text)) {
    const rows = glyph(ch);
    if (rows) {
      for (let gy = 0; gy < GLYPH_H; gy++) {
        for (let gx = 0; gx < GLYPH_W; gx++) {
          if (!rows[gy][gx]) continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              canvas.blend(cursor + gx * scale + sx, y + gy * scale + sy, r, g, b, a);
            }
          }
        }
      }
    }
    cursor += (GLYPH_W + spacing) * scale;
  }

  return cursor - x;
}

/** Draw text centred within [x, x+width). */
function drawTextCentered(canvas, text, x, width, y, color, scale = 1, spacing = 1) {
  const w = measureText(text, scale, spacing);
  return drawText(canvas, text, Math.round(x + (width - w) / 2), y, color, scale, spacing);
}

/** Shorten to fit, with a trailing ellipsis made of periods. */
function fitText(text, maxChars) {
  const t = String(text);
  if (t.length <= maxChars) return t;
  if (maxChars <= 3) return t.slice(0, maxChars);
  return t.slice(0, maxChars - 3) + "...";
}

module.exports = { drawText, drawTextCentered, measureText, fitText, GLYPH_W, GLYPH_H };
