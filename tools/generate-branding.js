#!/usr/bin/env node
"use strict";
/**
 * Rasterise the SUN mark to the PNG sizes the UXP and CEP manifests require.
 *
 * The SVG is the source of truth for the design, but there is no SVG rasteriser
 * available without pulling in a dependency, so the mark is re-drawn here with
 * the same geometry against the Canvas in core/util/png.js. The two are kept in
 * step by using identical constants: core radius 15/32 of the box, twelve rays
 * alternating long and short, the same amber ramp.
 */

const fs = require("fs");
const path = require("path");

const { Canvas } = require("../src/core/util/png");

const OUT_DIR = path.join(__dirname, "..", "assets", "branding", "icons");

/** Geometry in a 64-unit box, matching sun-icon.svg exactly. */
const GEOMETRY = {
  box: 64,
  center: 32,
  coreRadius: 15,
  rayInner: 18.6,
  rayLongOuter: 29.2,
  rayShortOuter: 25.2,
  rayLongHalfWidth: 2.5,
  rayShortHalfWidth: 1.9,
  rays: 12,
};

/** The amber ramp from the brand sheet. */
const PALETTE = {
  coreTop: [255, 224, 122],
  coreMid: [255, 179, 40],
  coreBottom: [240, 100, 28],
  rayTop: [255, 138, 30],
  rayBottom: [255, 183, 51],
  highlight: [255, 243, 196],
};

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

/**
 * Draw one tapered ray as a filled quad with a rounded tip, supersampled.
 * `sample(x, y)` returns coverage 0..1 for a point in icon space.
 */
function rayCoverage(x, y, angleRad, inner, outer, halfWidth) {
  // Rotate the point into the ray's local frame, where the ray points up (-y).
  const cos = Math.cos(-angleRad);
  const sin = Math.sin(-angleRad);
  const lx = x * cos - y * sin;
  const ly = x * sin + y * cos;

  const r = -ly; // distance along the ray
  if (r < inner - 0.5 || r > outer + 0.5) return 0;

  // Taper: full width at the inner end, narrowing toward the tip.
  const t = Math.max(0, Math.min(1, (r - inner) / (outer - inner)));
  const width = lerp(halfWidth, halfWidth * 0.42, t);

  if (Math.abs(lx) > width) return 0;

  // Round the tip so the silhouette does not read as a gear tooth.
  if (r > outer - width) {
    const dx = lx;
    const dy = r - (outer - width);
    if (Math.hypot(dx, dy) > width) return 0;
  }
  return 1;
}

function drawSun(size, { mono = false, monoColor = [255, 176, 46] } = {}) {
  const c = new Canvas(size, size);
  const g = GEOMETRY;
  const scale = size / g.box;
  const cx = size / 2;
  const cy = size / 2;

  // Supersample: small icons alias badly on the thin rays otherwise.
  const SS = size <= 32 ? 4 : 3;
  const step = 1 / SS;
  const weight = 1 / (SS * SS);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rayCov = 0;
      let coreCov = 0;
      let sumT = 0;
      let samples = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) * step - cx) / scale;
          const y = (py + (sy + 0.5) * step - cy) / scale;
          const dist = Math.hypot(x, y);

          if (dist <= g.coreRadius) coreCov += weight;
          else {
            for (let i = 0; i < g.rays; i++) {
              const angle = (i * 2 * Math.PI) / g.rays;
              const long = i % 2 === 0;
              const cov = rayCoverage(
                x, y, angle, g.rayInner,
                long ? g.rayLongOuter : g.rayShortOuter,
                long ? g.rayLongHalfWidth : g.rayShortHalfWidth
              );
              if (cov > 0) { rayCov += weight; break; }
            }
          }

          // Gradient position: down-and-right, matching the SVG light direction.
          sumT += Math.max(0, Math.min(1, (x / g.box + y / g.box) * 1.3 + 0.5));
          samples++;
        }
      }

      const t = samples ? sumT / samples : 0.5;

      if (mono) {
        const cov = Math.min(1, coreCov + rayCov);
        if (cov > 0) c.blend(px, py, monoColor[0], monoColor[1], monoColor[2], cov);
        continue;
      }

      if (rayCov > 0) {
        const col = mix(PALETTE.rayBottom, PALETTE.rayTop, t);
        c.blend(px, py, col[0], col[1], col[2], rayCov);
      }
      if (coreCov > 0) {
        const col = t < 0.5
          ? mix(PALETTE.coreTop, PALETTE.coreMid, t * 2)
          : mix(PALETTE.coreMid, PALETTE.coreBottom, (t - 0.5) * 2);
        c.blend(px, py, col[0], col[1], col[2], coreCov);
      }
    }
  }

  // Specular crescent, upper-left, only where it reads at size.
  if (!mono && size >= 32) {
    const hx = cx - 3.1 * scale;
    const hy = cy - 3.1 * scale;
    const outer = 12.1 * scale;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const d = Math.hypot(px + 0.5 - hx, py + 0.5 - hy);
        const fromCenter = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
        if (fromCenter > g.coreRadius * scale - 1) continue;
        // Keep the highlight a soft gloss hugging the upper-left rim. A wider or
        // stronger band starts reading as a crescent moon rather than as light
        // falling on a sphere.
        const band = Math.max(0, 1 - Math.abs(d - outer * 0.74) / (1.5 * scale));
        // Fade it out toward the core's edge so it never outlines the disc.
        const inset = Math.max(0, 1 - fromCenter / (g.coreRadius * scale));
        if (band > 0) {
          c.blend(px, py, PALETTE.highlight[0], PALETTE.highlight[1], PALETTE.highlight[2],
            band * 0.30 * Math.min(1, inset * 3));
        }
      }
    }
  }

  return c;
}

const SIZES = [16, 23, 24, 32, 46, 48, 64, 96, 128, 256];

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const written = [];

  for (const size of SIZES) {
    const file = path.join(OUT_DIR, `icon-${size}.png`);
    fs.writeFileSync(file, drawSun(size).toPNG());
    written.push({ file: path.basename(file), size });
  }

  for (const size of [16, 23, 24, 32, 46]) {
    const file = path.join(OUT_DIR, `icon-mono-${size}.png`);
    fs.writeFileSync(file, drawSun(size, { mono: true }).toPNG());
    written.push({ file: path.basename(file), size });
  }

  console.log(`wrote ${written.length} icons to assets/branding/icons/`);
  for (const w of written) console.log(`  ${w.file}`);
}

if (require.main === module) main();

module.exports = { drawSun, GEOMETRY, PALETTE };
