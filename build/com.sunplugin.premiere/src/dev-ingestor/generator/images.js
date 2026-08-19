"use strict";
/**
 * Image asset generation: overlays, backgrounds and guides.
 *
 * All real PNGs that drop straight onto a timeline. Overlays carry alpha and are
 * designed for Screen/Add blending the way film-burn and light-leak plates are
 * used in practice. Guides are the one category here that is genuinely better
 * generated than sourced: a title-safe grid is a precise technical drawing, and
 * generating it is how you get it exactly right for every aspect ratio.
 */

const { Canvas } = require("../../core/util/png");
const { drawText, drawTextCentered, measureText } = require("../../core/util/bitmap-font");
const { mulberry32, seedFrom } = require("./audio");

const HD = { w: 1920, h: 1080 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

/** Value noise with smooth interpolation, for organic textures. */
function valueNoise2D(rnd, gridSize) {
  const g = new Float32Array((gridSize + 1) * (gridSize + 1));
  for (let i = 0; i < g.length; i++) g[i] = rnd();

  return (x, y) => {
    const fx = clamp01(x) * gridSize;
    const fy = clamp01(y) * gridSize;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(gridSize, x0 + 1), y1 = Math.min(gridSize, y0 + 1);
    const tx = smoothstep(fx - x0), ty = smoothstep(fy - y0);
    const at = (xi, yi) => g[yi * (gridSize + 1) + xi];
    return lerp(lerp(at(x0, y0), at(x1, y0), tx), lerp(at(x0, y1), at(x1, y1), tx), ty);
  };
}

/** Sum several noise octaves for detail at multiple scales. */
function fbm(rnd, octaves, baseGrid) {
  const layers = [];
  for (let i = 0; i < octaves; i++) {
    layers.push({ noise: valueNoise2D(rnd, baseGrid * Math.pow(2, i)), amp: Math.pow(0.5, i) });
  }
  const norm = layers.reduce((s, l) => s + l.amp, 0);
  return (x, y) => layers.reduce((s, l) => s + l.noise(x, y) * l.amp, 0) / norm;
}

/* ---------------------------------------------------------------- overlays */

/**
 * Film grain plate. Monochrome noise on transparent black, meant for Overlay or
 * Soft Light at low opacity. Grain size is the parameter that actually matters:
 * 8mm grain is coarse, 35mm is fine.
 */
function filmGrain(spec) {
  const rnd = mulberry32(seedFrom(spec.name));
  const c = new Canvas(spec.width, spec.height);
  const coarse = valueNoise2D(rnd, Math.round(spec.width / spec.grainSize));

  for (let y = 0; y < spec.height; y++) {
    for (let x = 0; x < spec.width; x++) {
      const nx = x / spec.width, ny = y / spec.height;
      // Fine per-pixel noise carries the texture; the coarse layer gives it
      // clumping, which is what separates film grain from digital noise.
      const fine = rnd();
      const clump = coarse(nx, ny);
      const v = clamp01(lerp(fine, clump, spec.clump));
      const level = Math.round(lerp(128 - spec.intensity * 128, 128 + spec.intensity * 128, v));
      c.set(x, y, level, level, level, Math.round(spec.opacity * 255));
    }
  }
  return c;
}

/**
 * Light leak. Warm bloom entering from an edge, on black, for Screen/Add.
 * Real leaks are soft, off-centre and asymmetric, so the shape is built from a
 * couple of offset radial falloffs rather than one clean gradient.
 */
function lightLeak(spec) {
  const rnd = mulberry32(seedFrom(spec.name));
  const c = new Canvas(spec.width, spec.height);
  const wobble = fbm(rnd, 3, 3);

  const sources = spec.sources.map((s) => ({ ...s }));

  for (let y = 0; y < spec.height; y++) {
    for (let x = 0; x < spec.width; x++) {
      const nx = x / spec.width, ny = y / spec.height;
      let r = 0, g = 0, b = 0;

      for (const s of sources) {
        const dx = (nx - s.x) / s.rx;
        const dy = (ny - s.y) / s.ry;
        let d = Math.sqrt(dx * dx + dy * dy);
        d *= 0.85 + wobble(nx, ny) * 0.3; // break up the perfect ellipse
        const falloff = Math.pow(Math.max(0, 1 - d), s.power);
        r += s.color[0] * falloff;
        g += s.color[1] * falloff;
        b += s.color[2] * falloff;
      }

      const a = clamp01(Math.max(r, g, b) / 255);
      c.set(x, y,
        Math.round(clamp01(r / 255) * 255),
        Math.round(clamp01(g / 255) * 255),
        Math.round(clamp01(b / 255) * 255),
        Math.round(a * 255 * spec.opacity));
    }
  }
  return c;
}

/**
 * Film burn. The blown-out, chemical edge of a frame: a hot core with a ragged
 * halo, biased to one side of frame.
 */
function filmBurn(spec) {
  const rnd = mulberry32(seedFrom(spec.name));
  const c = new Canvas(spec.width, spec.height);
  const edge = fbm(rnd, 4, 4);

  for (let y = 0; y < spec.height; y++) {
    for (let x = 0; x < spec.width; x++) {
      const nx = x / spec.width, ny = y / spec.height;
      const dx = (nx - spec.cx) / spec.rx;
      const dy = (ny - spec.cy) / spec.ry;
      const base = Math.sqrt(dx * dx + dy * dy);
      // The ragged boundary is the whole character of a burn.
      const d = base * (0.7 + edge(nx * 1.5, ny * 1.5) * 0.6);

      const core = Math.pow(Math.max(0, 1 - d), 3.2);
      const halo = Math.pow(Math.max(0, 1 - d * 0.62), 1.6) * 0.55;
      const heat = clamp01(core + halo);

      // Hot centres go white, edges stay orange-red.
      const r = clamp01(heat * 1.9);
      const g = clamp01(Math.pow(heat, 1.7) * 1.5);
      const b = clamp01(Math.pow(heat, 3.4) * 1.2);

      c.set(x, y,
        Math.round(r * 255), Math.round(g * 255), Math.round(b * 255),
        Math.round(clamp01(heat * 1.25) * 255 * spec.opacity));
    }
  }
  return c;
}

/** Dust and scratches: vertical hairlines plus specks, for analogue texture. */
function dustScratches(spec) {
  const rnd = mulberry32(seedFrom(spec.name));
  const c = new Canvas(spec.width, spec.height);

  for (let i = 0; i < spec.scratches; i++) {
    const x = Math.floor(rnd() * spec.width);
    const y0 = Math.floor(rnd() * spec.height * 0.4);
    const y1 = y0 + Math.floor(rnd() * spec.height * 0.8) + spec.height * 0.1;
    const bright = 140 + Math.floor(rnd() * 115);
    const drift = (rnd() - 0.5) * 6;
    for (let y = y0; y < Math.min(spec.height, y1); y++) {
      const t = (y - y0) / Math.max(1, y1 - y0);
      const xx = Math.round(x + drift * t);
      const a = Math.sin(t * Math.PI) * 0.9;
      c.blend(xx, y, bright, bright, bright, a);
      c.blend(xx + 1, y, bright, bright, bright, a * 0.35);
    }
  }

  for (let i = 0; i < spec.specks; i++) {
    const x = rnd() * spec.width;
    const y = rnd() * spec.height;
    const r = 0.6 + rnd() * spec.speckSize;
    const bright = rnd() > 0.35 ? 230 : 30;
    c.disc(x, y, r, bright, bright, bright, 0.55 + rnd() * 0.45);
  }

  return c;
}

/** Bokeh: soft out-of-focus discs, for Screen blending. */
function bokeh(spec) {
  const rnd = mulberry32(seedFrom(spec.name));
  const c = new Canvas(spec.width, spec.height);

  for (let i = 0; i < spec.count; i++) {
    const x = rnd() * spec.width;
    const y = rnd() * spec.height;
    const r = spec.minR + rnd() * (spec.maxR - spec.minR);
    const hue = spec.palette[Math.floor(rnd() * spec.palette.length)];
    const alpha = 0.10 + rnd() * 0.30;

    // A real bokeh disc has a bright rim and a slightly dimmer centre.
    for (let ring = 0; ring < 4; ring++) {
      const rr = r * (1 - ring * 0.14);
      const a = alpha * (ring === 0 ? 0.55 : 0.3);
      c.disc(x, y, rr, hue[0], hue[1], hue[2], a);
    }
    c.disc(x, y, r * 0.96, hue[0], hue[1], hue[2], alpha * 0.22);
  }
  return c;
}

/* ------------------------------------------------------------- backgrounds */

function gradientBackground(spec) {
  const c = new Canvas(spec.width, spec.height);
  const rnd = mulberry32(seedFrom(spec.name));
  const grain = valueNoise2D(rnd, 64);

  c.shade((nx, ny) => {
    let t;
    switch (spec.direction) {
      case "horizontal": t = nx; break;
      case "diagonal": t = (nx + ny) / 2; break;
      case "radial": t = Math.min(1, Math.hypot(nx - 0.5, ny - 0.5) * 1.7); break;
      default: t = ny;
    }
    t = spec.ease ? smoothstep(t) : t;

    // A touch of noise stops 8-bit gradients from banding on a broadcast display.
    const dither = (grain(nx * 4, ny * 4) - 0.5) * 3;
    return [
      Math.round(clamp01((lerp(spec.from[0], spec.to[0], t) + dither) / 255) * 255),
      Math.round(clamp01((lerp(spec.from[1], spec.to[1], t) + dither) / 255) * 255),
      Math.round(clamp01((lerp(spec.from[2], spec.to[2], t) + dither) / 255) * 255),
      255,
    ];
  });
  return c;
}

function abstractBackground(spec) {
  const rnd = mulberry32(seedFrom(spec.name));
  const field = fbm(rnd, 5, 2);
  const c = new Canvas(spec.width, spec.height);

  c.shade((nx, ny) => {
    const v = field(nx * spec.scale, ny * spec.scale);
    const t = clamp01((v - 0.35) * spec.contrast + 0.5);
    return [
      Math.round(lerp(spec.from[0], spec.to[0], t)),
      Math.round(lerp(spec.from[1], spec.to[1], t)),
      Math.round(lerp(spec.from[2], spec.to[2], t)),
      255,
    ];
  });
  return c;
}

/* ------------------------------------------------------------------ guides */

/**
 * Broadcast-style guide overlay: action-safe and title-safe boxes, centre
 * cross, rule-of-thirds, and optional social crop regions. Drawn to exact
 * percentages, which is the whole reason to generate rather than download one.
 */
function guideOverlay(spec) {
  const c = new Canvas(spec.width, spec.height);
  const W = spec.width, H = spec.height;
  const line = (x0, y0, x1, y1, color, alpha, thickness = 2) =>
    c.line(x0, y0, x1, y1, thickness, color[0], color[1], color[2], alpha);

  const box = (inset, color, alpha, thickness) => {
    const x0 = W * inset, y0 = H * inset;
    const x1 = W * (1 - inset), y1 = H * (1 - inset);
    line(x0, y0, x1, y0, color, alpha, thickness);
    line(x1, y0, x1, y1, color, alpha, thickness);
    line(x1, y1, x0, y1, color, alpha, thickness);
    line(x0, y1, x0, y0, color, alpha, thickness);
  };

  if (spec.thirds) {
    for (let i = 1; i <= 2; i++) {
      line((W * i) / 3, 0, (W * i) / 3, H, [255, 255, 255], 0.28, 2);
      line(0, (H * i) / 3, W, (H * i) / 3, [255, 255, 255], 0.28, 2);
    }
  }

  if (spec.crop) {
    // Darken everything outside the target crop, then outline it.
    const cw = spec.crop.w * W, ch = spec.crop.h * H;
    const cx = (W - cw) / 2, cy = (H - ch) / 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x < cx || x > cx + cw || y < cy || y > cy + ch) c.blend(x, y, 0, 0, 0, 0.55);
      }
    }
    line(cx, cy, cx + cw, cy, [255, 176, 40], 0.95, 3);
    line(cx + cw, cy, cx + cw, cy + ch, [255, 176, 40], 0.95, 3);
    line(cx + cw, cy + ch, cx, cy + ch, [255, 176, 40], 0.95, 3);
    line(cx, cy + ch, cx, cy, [255, 176, 40], 0.95, 3);
  }

  if (spec.actionSafe) box(0.05, [90, 220, 130], 0.85, 3);   // 90% action safe
  if (spec.titleSafe) box(0.10, [255, 176, 40], 0.85, 3);    // 80% title safe

  if (spec.center) {
    const cx = W / 2, cy = H / 2, s = Math.min(W, H) * 0.035;
    line(cx - s, cy, cx + s, cy, [255, 255, 255], 0.8, 2);
    line(cx, cy - s, cx, cy + s, [255, 255, 255], 0.8, 2);
  }

  if (spec.label) {
    const scale = Math.max(2, Math.round(W / 480));
    const text = spec.label.toUpperCase();
    const tw = measureText(text, scale, 1);
    // Plate behind the text so it stays readable over any footage.
    c.rect(Math.round(W / 2 - tw / 2) - 10, Math.round(H * 0.10) + 14 - 6,
      tw + 20, 7 * scale + 12, 0, 0, 0, 0.55);
    drawTextCentered(c, text, 0, W, Math.round(H * 0.10) + 14, [255, 255, 255, 1], scale, 1);
  }

  return c;
}

/* --------------------------------------------------------------- catalogue */

function buildCatalogue() {
  const items = [];
  const add = (item) => items.push(item);

  // --- film grain
  const grains = [
    { key: "8mm Heavy", grainSize: 3, intensity: 0.55, clump: 0.55, opacity: 0.9 },
    { key: "16mm", grainSize: 2, intensity: 0.40, clump: 0.40, opacity: 0.85 },
    { key: "35mm Fine", grainSize: 1.4, intensity: 0.26, clump: 0.25, opacity: 0.8 },
    { key: "Digital Noise", grainSize: 1, intensity: 0.32, clump: 0.05, opacity: 0.8 },
    { key: "Vintage Coarse", grainSize: 4, intensity: 0.62, clump: 0.7, opacity: 0.92 },
  ];
  for (const g of grains) {
    for (let take = 1; take <= 3; take++) {
      const name = `Film Grain ${g.key} ${String(take).padStart(2, "0")}`;
      add({
        name, type: "overlay", category: "film-grain", subcategory: "film-grain",
        tags: ["grain", "film", "texture", "analog"],
        render: () => filmGrain({ name, width: 960, height: 540, ...g }),
      });
    }
  }

  // --- light leaks
  const leakPalettes = [
    { key: "Warm", colors: [[255, 150, 60], [255, 90, 40]] },
    { key: "Golden", colors: [[255, 200, 90], [255, 140, 30]] },
    { key: "Magenta", colors: [[255, 80, 160], [200, 60, 220]] },
    { key: "Cyan", colors: [[80, 200, 255], [40, 140, 255]] },
    { key: "Red", colors: [[255, 60, 50], [200, 30, 60]] },
  ];
  const leakSides = [
    { key: "Left", x: -0.05, y: 0.5 }, { key: "Right", x: 1.05, y: 0.45 },
    { key: "Top", x: 0.5, y: -0.05 }, { key: "Corner", x: 1.02, y: -0.02 },
  ];
  for (const p of leakPalettes) {
    for (const s of leakSides) {
      const name = `Light Leak ${p.key} ${s.key}`;
      add({
        name, type: "overlay", category: "light-leak", subcategory: "light-leak",
        tags: ["leak", "light", "analog", p.key.toLowerCase()],
        render: () => lightLeak({
          name, width: 960, height: 540, opacity: 0.95,
          sources: [
            { x: s.x, y: s.y, rx: 0.55, ry: 0.75, power: 2.0, color: p.colors[0] },
            { x: s.x + (s.x > 0.5 ? -0.18 : 0.18), y: s.y + 0.15, rx: 0.34, ry: 0.44, power: 2.6, color: p.colors[1] },
          ],
        }),
      });
    }
  }

  // --- film burns
  const burnPositions = [
    { key: "Left", cx: -0.05, cy: 0.5, rx: 0.55, ry: 0.85 },
    { key: "Right", cx: 1.05, cy: 0.5, rx: 0.55, ry: 0.85 },
    { key: "Center", cx: 0.5, cy: 0.5, rx: 0.62, ry: 0.62 },
    { key: "Top", cx: 0.5, cy: -0.05, rx: 0.8, ry: 0.5 },
  ];
  for (const b of burnPositions) {
    for (let take = 1; take <= 3; take++) {
      const name = `Film Burn ${b.key} ${String(take).padStart(2, "0")}`;
      add({
        name, type: "overlay", category: "film-burn", subcategory: "film-burn",
        tags: ["burn", "film", "analog", "warm"],
        render: () => filmBurn({ name, width: 960, height: 540, opacity: 0.95, ...b }),
      });
    }
  }

  // --- dust and scratches
  const dustLevels = [
    { key: "Light", scratches: 6, specks: 120, speckSize: 1.2 },
    { key: "Medium", scratches: 16, specks: 340, speckSize: 1.8 },
    { key: "Heavy", scratches: 34, specks: 800, speckSize: 2.6 },
  ];
  for (const d of dustLevels) {
    for (let take = 1; take <= 3; take++) {
      const name = `Dust And Scratches ${d.key} ${String(take).padStart(2, "0")}`;
      add({
        name, type: "overlay", category: "scratches", subcategory: "dust",
        tags: ["dust", "scratches", "analog", "film"],
        render: () => dustScratches({ name, width: 960, height: 540, ...d }),
      });
    }
  }

  // --- bokeh
  const bokehStyles = [
    { key: "Warm", palette: [[255, 200, 120], [255, 160, 80], [255, 230, 180]], count: 40, minR: 14, maxR: 60 },
    { key: "Cool", palette: [[140, 200, 255], [100, 160, 255], [200, 230, 255]], count: 40, minR: 14, maxR: 60 },
    { key: "Neon", palette: [[255, 80, 200], [80, 255, 220], [180, 120, 255]], count: 34, minR: 18, maxR: 72 },
    { key: "Gold Dense", palette: [[255, 210, 130], [255, 180, 90]], count: 90, minR: 8, maxR: 34 },
  ];
  for (const b of bokehStyles) {
    for (let take = 1; take <= 2; take++) {
      const name = `Bokeh ${b.key} ${String(take).padStart(2, "0")}`;
      add({
        name, type: "overlay", category: "bokeh", subcategory: "bokeh",
        tags: ["bokeh", "light", "blur", b.key.toLowerCase()],
        render: () => bokeh({ name, width: 960, height: 540, ...b }),
      });
    }
  }

  // --- gradient backgrounds
  const gradients = [
    { key: "Midnight", from: [12, 16, 38], to: [46, 24, 74] },
    { key: "Sunset", from: [255, 120, 60], to: [90, 30, 90] },
    { key: "Ocean", from: [10, 60, 100], to: [8, 140, 150] },
    { key: "Ember", from: [30, 10, 10], to: [200, 70, 30] },
    { key: "Slate", from: [38, 42, 50], to: [90, 98, 112] },
    { key: "Forest", from: [12, 40, 26], to: [60, 120, 70] },
    { key: "Mono Dark", from: [16, 16, 18], to: [58, 58, 64] },
    { key: "Amber", from: [60, 30, 5], to: [255, 176, 40] },
  ];
  const directions = ["vertical", "diagonal", "radial"];
  for (const g of gradients) {
    for (const d of directions) {
      const name = `Gradient ${g.key} ${d.charAt(0).toUpperCase() + d.slice(1)}`;
      add({
        name, type: "background", category: "gradient", subcategory: "gradient",
        tags: ["background", "gradient", g.key.toLowerCase(), d],
        render: () => gradientBackground({ name, width: 1920, height: 1080, direction: d, ease: true, ...g }),
      });
    }
  }

  // --- abstract backgrounds
  for (const g of gradients.slice(0, 6)) {
    for (const scale of [1.5, 3.5]) {
      const name = `Abstract ${g.key} ${scale < 2 ? "Soft" : "Detailed"}`;
      add({
        name, type: "background", category: "abstract", subcategory: "abstract",
        tags: ["background", "abstract", "texture", g.key.toLowerCase()],
        render: () => abstractBackground({ name, width: 1280, height: 720, scale, contrast: 2.2, ...g }),
      });
    }
  }

  // --- guides
  const formats = [
    { key: "1920x1080", w: 1920, h: 1080 },
    { key: "3840x2160", w: 3840, h: 2160 },
    { key: "1080x1920", w: 1080, h: 1920 },
    { key: "1080x1080", w: 1080, h: 1080 },
  ];
  for (const f of formats) {
    add({
      name: `Safe Areas ${f.key}`, type: "guide", category: "safe-area", subcategory: "safe-area",
      tags: ["guide", "safe", "broadcast", "title-safe", "action-safe"],
      render: () => guideOverlay({
        width: f.w, height: f.h, actionSafe: true, titleSafe: true,
        center: true, label: `Safe Areas ${f.key}`,
      }),
    });
    add({
      name: `Rule Of Thirds ${f.key}`, type: "guide", category: "composition", subcategory: "thirds",
      tags: ["guide", "thirds", "composition", "framing"],
      render: () => guideOverlay({
        width: f.w, height: f.h, thirds: true, center: true,
        label: `Thirds ${f.key}`,
      }),
    });
  }

  // Social crop guides: shoot 16:9, deliver vertical and square.
  const crops = [
    { key: "9x16 Vertical", w: 0.3164, h: 1 },
    { key: "1x1 Square", w: 0.5625, h: 1 },
    { key: "4x5 Portrait", w: 0.45, h: 1 },
  ];
  for (const crop of crops) {
    add({
      name: `Social Crop ${crop.key}`, type: "guide", category: "social-crop", subcategory: "social",
      tags: ["guide", "crop", "social", "vertical", "safe"],
      render: () => guideOverlay({
        width: 1920, height: 1080, crop, thirds: true, center: true,
        label: `Crop ${crop.key}`,
      }),
    });
  }

  return items;
}

let CATALOGUE = null;
function catalogue() {
  if (!CATALOGUE) CATALOGUE = buildCatalogue();
  return CATALOGUE;
}

/** Enumerate the image corpus with lazy PNG rendering. */
function generateImages({ limit = 0, types = null } = {}) {
  const out = [];
  for (const item of catalogue()) {
    if (types && !types.includes(item.type)) continue;
    out.push({
      name: item.name,
      filename: item.name.replace(/\s+/g, "_") + ".png",
      type: item.type,
      category: item.category,
      subcategory: item.subcategory,
      tags: item.tags,
      get content() { return item.render().toPNG(); },
    });
    if (limit && out.length >= limit) break;
  }
  return out;
}

module.exports = {
  generateImages,
  catalogue,
  filmGrain,
  lightLeak,
  filmBurn,
  dustScratches,
  bokeh,
  gradientBackground,
  abstractBackground,
  guideOverlay,
  HD,
};
