"use strict";
/**
 * Minimal PNG encoder.
 *
 * Used for thumbnails, generated overlays, guide frames and icon output. No
 * dependencies: Node gets real deflate via node:zlib, and the UXP path falls
 * back to stored (uncompressed) deflate blocks, which every PNG decoder accepts.
 * Thumbnails are small, so the size penalty in the fallback path is irrelevant.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function nodeZlib() {
  try {
    if (typeof require !== "function") return null;
    if (typeof process === "undefined" || !process.versions || !process.versions.node) return null;
    return require("zlib");
  } catch (e) {
    return null;
  }
}

/** zlib stream using stored deflate blocks. Valid, just not compressed. */
function zlibStored(data) {
  const MAX = 65535;
  const blocks = Math.max(1, Math.ceil(data.length / MAX));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  let p = 0;

  out[p++] = 0x78; // CM=8 (deflate), CINFO=7 (32K window)
  out[p++] = 0x01; // FCHECK so that (0x78<<8|0x01) % 31 === 0

  for (let i = 0; i < blocks; i++) {
    const off = i * MAX;
    const len = Math.min(MAX, data.length - off);
    out[p++] = i === blocks - 1 ? 1 : 0; // BFINAL, BTYPE=00 (stored)
    out[p++] = len & 0xff;
    out[p++] = (len >>> 8) & 0xff;
    out[p++] = ~len & 0xff;
    out[p++] = (~len >>> 8) & 0xff;
    out.set(data.subarray(off, off + len), p);
    p += len;
  }

  const ad = adler32(data);
  out[p++] = (ad >>> 24) & 0xff;
  out[p++] = (ad >>> 16) & 0xff;
  out[p++] = (ad >>> 8) & 0xff;
  out[p++] = ad & 0xff;

  return out.subarray(0, p);
}

function deflate(data) {
  const z = nodeZlib();
  if (z) return new Uint8Array(z.deflateSync(Buffer.from(data), { level: 9 }));
  return zlibStored(data);
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length), false);
  return out;
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Encode RGBA pixel data as a PNG.
 * @param {Uint8Array} rgba - width*height*4 bytes
 */
function encodePNG(rgba, width, height) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePNG: expected ${width * height * 4} bytes, got ${rgba.length}`);
  }

  // Each scanline is prefixed with its filter byte. Filter 0 (None) keeps the
  // encoder trivial; zlib still compresses flat colour and gradients well.
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = y * (width * 4 + 1);
    raw[dst] = 0;
    raw.set(rgba.subarray(src, src + width * 4), dst + 1);
  }

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width, false);
  dv.setUint32(4, height, false);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none

  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * A tiny RGBA drawing surface. Enough for thumbnails, gradients, grain,
 * vignettes, guide overlays and waveform strips; deliberately not a full 2D API.
 */
class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  index(x, y) {
    return (y * this.width + x) * 4;
  }

  /** Source-over blend of one pixel. Alpha is 0..1. */
  blend(x, y, r, g, b, a = 1) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || a <= 0) return;
    const i = this.index(x, y);
    const d = this.data;
    const sa = Math.min(1, a);
    const da = d[i + 3] / 255;
    const out = sa + da * (1 - sa);
    if (out <= 0) {
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
      return;
    }
    d[i] = Math.round((r * sa + d[i] * da * (1 - sa)) / out);
    d[i + 1] = Math.round((g * sa + d[i + 1] * da * (1 - sa)) / out);
    d[i + 2] = Math.round((b * sa + d[i + 2] * da * (1 - sa)) / out);
    d[i + 3] = Math.round(out * 255);
  }

  set(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = this.index(x, y);
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
  }

  fill(r, g, b, a = 255) {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
    }
    return this;
  }

  /** fn(nx, ny) -> [r,g,b,a?] with nx, ny normalised to 0..1. */
  shade(fn) {
    for (let y = 0; y < this.height; y++) {
      const ny = this.height > 1 ? y / (this.height - 1) : 0;
      for (let x = 0; x < this.width; x++) {
        const nx = this.width > 1 ? x / (this.width - 1) : 0;
        const c = fn(nx, ny, x, y);
        if (c) this.set(x, y, c[0], c[1], c[2], c.length > 3 ? c[3] : 255);
      }
    }
    return this;
  }

  rect(x0, y0, w, h, r, g, b, a = 1) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) this.blend(x, y, r, g, b, a);
    }
    return this;
  }

  /** Anti-aliased filled disc. */
  disc(cx, cy, radius, r, g, b, a = 1) {
    const x0 = Math.max(0, Math.floor(cx - radius - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius + 1));
    const y0 = Math.max(0, Math.floor(cy - radius - 1));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const cover = Math.max(0, Math.min(1, radius + 0.5 - d));
        if (cover > 0) this.blend(x, y, r, g, b, a * cover);
      }
    }
    return this;
  }

  /** Anti-aliased line with round caps. */
  line(x0, y0, x1, y1, thickness, r, g, b, a = 1) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thickness / 2, r, g, b, a);
    }
    return this;
  }

  toPNG() {
    return encodePNG(this.data, this.width, this.height);
  }
}

module.exports = { encodePNG, Canvas, crc32, adler32, deflate };
