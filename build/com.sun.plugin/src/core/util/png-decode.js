"use strict";
/**
 * Minimal PNG decoder, paired with the encoder in png.js.
 *
 * Exists so thumbnails of PNG assets are the actual image rather than a
 * placeholder card. Supports 8-bit greyscale, RGB, palette, greyscale+alpha and
 * RGBA, non-interlaced, which covers effectively every PNG in an editing asset
 * pack. 16-bit is downsampled to 8. Interlaced (Adam7) is rejected rather than
 * decoded wrongly.
 */

const { inflateRaw } = require("./zip");

function nodeZlib() {
  try {
    if (typeof require !== "function") return null;
    if (typeof process === "undefined" || !process.versions || !process.versions.node) return null;
    return require("zlib");
  } catch (e) {
    return null;
  }
}

function inflateZlib(bytes) {
  const z = nodeZlib();
  if (z) return new Uint8Array(z.inflateSync(Buffer.from(bytes)));
  // Strip the 2-byte zlib header and 4-byte adler trailer, then raw-inflate.
  return inflateRaw(bytes.subarray(2, bytes.length - 4));
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decode a PNG to { width, height, data } where data is RGBA.
 * Returns null for anything it cannot handle, so callers fall back cleanly.
 */
function decodePNG(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 8) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return null;

  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];

  while (off + 8 <= b.length) {
    const len = dv.getUint32(off, false);
    const type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
    const start = off + 8;
    if (start + len > b.length) break;

    if (type === "IHDR") {
      width = dv.getUint32(start, false);
      height = dv.getUint32(start + 4, false);
      depth = b[start + 8];
      colorType = b[start + 9];
      interlace = b[start + 12];
    } else if (type === "PLTE") {
      palette = b.subarray(start, start + len);
    } else if (type === "tRNS") {
      trns = b.subarray(start, start + len);
    } else if (type === "IDAT") {
      idat.push(b.subarray(start, start + len));
    } else if (type === "IEND") {
      break;
    }

    off = start + len + 4; // + CRC
  }

  if (!width || !height) return null;
  if (interlace !== 0) return null;          // Adam7 not supported
  if (depth !== 8 && depth !== 16) return null;
  if (idat.length === 0) return null;

  const channelsFor = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsFor[colorType];
  if (!channels) return null;
  if (colorType === 3 && !palette) return null;

  let compressed;
  if (idat.length === 1) {
    compressed = idat[0];
  } else {
    let total = 0;
    for (const c of idat) total += c.length;
    compressed = new Uint8Array(total);
    let p = 0;
    for (const c of idat) { compressed.set(c, p); p += c.length; }
  }

  let raw;
  try {
    raw = inflateZlib(compressed);
  } catch (e) {
    return null;
  }

  const bytesPerSample = depth / 8;
  const bpp = channels * bytesPerSample;              // bytes per pixel
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) return null;

  // Un-filter in place into a contiguous buffer.
  const lines = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = raw[src + x];
      const a = x >= bpp ? lines[dst + x - bpp] : 0;
      const up = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let value;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + a; break;
        case 2: value = rawByte + up; break;
        case 3: value = rawByte + ((a + up) >> 1); break;
        case 4: value = rawByte + paeth(a, up, c); break;
        default: return null;
      }
      lines[dst + x] = value & 0xff;
    }
    prev = lines.subarray(dst, dst + stride);
  }

  // Expand to RGBA.
  const out = new Uint8Array(width * height * 4);
  const step = bytesPerSample; // read the high byte of 16-bit samples

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * bpp;
      const d = (y * width + x) * 4;

      if (colorType === 0) {
        const g = lines[s];
        out[d] = out[d + 1] = out[d + 2] = g;
        out[d + 3] = 255;
      } else if (colorType === 2) {
        out[d] = lines[s];
        out[d + 1] = lines[s + step];
        out[d + 2] = lines[s + step * 2];
        out[d + 3] = 255;
      } else if (colorType === 3) {
        const i = lines[s] * 3;
        out[d] = palette[i];
        out[d + 1] = palette[i + 1];
        out[d + 2] = palette[i + 2];
        out[d + 3] = trns && lines[s] < trns.length ? trns[lines[s]] : 255;
      } else if (colorType === 4) {
        const g = lines[s];
        out[d] = out[d + 1] = out[d + 2] = g;
        out[d + 3] = lines[s + step];
      } else {
        out[d] = lines[s];
        out[d + 1] = lines[s + step];
        out[d + 2] = lines[s + step * 2];
        out[d + 3] = lines[s + step * 3];
      }
    }
  }

  return { width, height, data: out };
}

/**
 * Box-filter downscale to fit inside maxW x maxH, preserving aspect ratio.
 * Box averaging rather than nearest-neighbour because thumbnails of detailed
 * overlays alias badly otherwise.
 */
function resizeRGBA(image, maxW, maxH) {
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  if (w === image.width && h === image.height) return image;

  const out = new Uint8Array(w * h * 4);
  const xRatio = image.width / w;
  const yRatio = image.height / h;

  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xRatio));

      let r = 0, g = 0, bl = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1 && sy < image.height; sy++) {
        for (let sx = x0; sx < x1 && sx < image.width; sx++) {
          const i = (sy * image.width + sx) * 4;
          const alpha = image.data[i + 3];
          // Weight colour by alpha so transparent edges do not darken the result.
          r += image.data[i] * alpha;
          g += image.data[i + 1] * alpha;
          bl += image.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }

      const d = (y * w + x) * 4;
      if (a > 0) {
        out[d] = Math.round(r / a);
        out[d + 1] = Math.round(g / a);
        out[d + 2] = Math.round(bl / a);
        out[d + 3] = Math.round(a / n);
      }
    }
  }

  return { width: w, height: h, data: out };
}

module.exports = { decodePNG, resizeRGBA };
