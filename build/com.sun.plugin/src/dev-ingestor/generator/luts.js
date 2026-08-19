"use strict";
/**
 * LUT generation.
 *
 * These are not placeholders. `.cube` is a documented plain-text format, so
 * everything produced here is a real 3D LUT that loads in Lumetri and grades
 * footage properly. Research found that the open-source world solves LUT supply
 * by generating rather than redistributing, and it is right to: generation gives
 * unlimited, licence-clean, deliberately varied coverage, which is exactly what
 * a test corpus needs.
 *
 * Each family is a colour transform expressed in code, parameterised into
 * variants. All operate on 0..1 linear-ish display values.
 */

/* --------------------------------------------------------------- primitives */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Rec.709 luminance. */
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Filmic S-curve. `strength` 0..1, pivoted at mid grey. */
function sCurve(v, strength) {
  const p = 0.435; // perceptual mid grey
  const x = clamp01(v);
  const curved = x < p
    ? p * Math.pow(x / p, 1 + strength)
    : 1 - (1 - p) * Math.pow((1 - x) / (1 - p), 1 + strength);
  return lerp(x, curved, 1);
}

/** Lift/gamma/gain, the standard three-way colour correction. */
function lgg(v, lift, gamma, gain) {
  const x = clamp01(v);
  const lifted = lift + x * (1 - lift);
  const gammaed = Math.pow(clamp01(lifted), 1 / Math.max(0.05, gamma));
  return clamp01(gammaed * gain);
}

function saturate(r, g, b, amount) {
  const l = luma(r, g, b);
  return [lerp(l, r, amount), lerp(l, g, amount), lerp(l, b, amount)];
}

/** Split-tone: one colour into shadows, another into highlights. */
function splitTone(r, g, b, shadow, highlight, strength) {
  const l = luma(r, g, b);
  const sw = Math.pow(1 - l, 2) * strength;
  const hw = Math.pow(l, 2) * strength;
  return [
    clamp01(r + shadow[0] * sw + highlight[0] * hw),
    clamp01(g + shadow[1] * sw + highlight[1] * hw),
    clamp01(b + shadow[2] * sw + highlight[2] * hw),
  ];
}

/* ------------------------------------------------------------------ families */

/**
 * Every family is { id, name, category, subcategory, variants[] }, and each
 * variant is { name, fn(r,g,b) -> [r,g,b] }.
 */
const FAMILIES = [
  {
    id: "teal-orange",
    label: "Teal Orange",
    category: "teal-orange",
    variants: [
      { name: "Blockbuster", strength: 0.34, contrast: 0.32, sat: 1.12 },
      { name: "Subtle", strength: 0.16, contrast: 0.18, sat: 1.04 },
      { name: "Heavy", strength: 0.52, contrast: 0.44, sat: 1.22 },
      { name: "Cool Shadows", strength: 0.40, contrast: 0.26, sat: 1.08 },
      { name: "Warm Skin", strength: 0.28, contrast: 0.30, sat: 1.16 },
    ],
    make: (v) => (r, g, b) => {
      let [nr, ng, nb] = splitTone(r, g, b, [-0.04, 0.03, 0.10], [0.10, 0.03, -0.06], v.strength);
      nr = sCurve(nr, v.contrast); ng = sCurve(ng, v.contrast); nb = sCurve(nb, v.contrast);
      return saturate(nr, ng, nb, v.sat);
    },
  },
  {
    id: "film-emulation",
    label: "Film Emulation",
    category: "film-emulation",
    variants: [
      { name: "Daylight Neg", lift: 0.030, gamma: 1.06, sat: 0.94, contrast: 0.30, warm: 0.03 },
      { name: "Tungsten Neg", lift: 0.026, gamma: 1.02, sat: 0.90, contrast: 0.26, warm: -0.04 },
      { name: "Print Stock", lift: 0.014, gamma: 0.98, sat: 1.06, contrast: 0.42, warm: 0.02 },
      { name: "Reversal", lift: 0.006, gamma: 0.94, sat: 1.18, contrast: 0.50, warm: 0.01 },
      { name: "Muted Stock", lift: 0.042, gamma: 1.10, sat: 0.82, contrast: 0.22, warm: 0.02 },
      { name: "Neutral Scan", lift: 0.020, gamma: 1.00, sat: 0.98, contrast: 0.28, warm: 0.00 },
    ],
    make: (v) => (r, g, b) => {
      // Halation-ish: film holds highlights softly and rolls off the toe.
      let nr = sCurve(lgg(r, v.lift, v.gamma, 1), v.contrast);
      let ng = sCurve(lgg(g, v.lift * 0.9, v.gamma, 1), v.contrast);
      let nb = sCurve(lgg(b, v.lift * 1.15, v.gamma, 1), v.contrast);
      nr = clamp01(nr + v.warm * 0.6);
      nb = clamp01(nb - v.warm * 0.6);
      return saturate(nr, ng, nb, v.sat);
    },
  },
  {
    id: "vintage",
    label: "Vintage",
    category: "vintage",
    variants: [
      { name: "Faded 70s", lift: 0.10, sat: 0.72, warm: 0.06, fade: 0.16 },
      { name: "Super 8", lift: 0.13, sat: 0.68, warm: 0.09, fade: 0.20 },
      { name: "Polaroid", lift: 0.09, sat: 0.84, warm: 0.04, fade: 0.12 },
      { name: "Old Print", lift: 0.07, sat: 0.62, warm: 0.07, fade: 0.10 },
      { name: "Washed Blue", lift: 0.11, sat: 0.70, warm: -0.05, fade: 0.18 },
    ],
    make: (v) => (r, g, b) => {
      // Lifted, compressed blacks plus a cream cast is what reads as "aged".
      let nr = lgg(r, v.lift, 1.02, 1 - v.fade * 0.3);
      let ng = lgg(g, v.lift * 0.95, 1.00, 1 - v.fade * 0.3);
      let nb = lgg(b, v.lift * 0.8, 0.98, 1 - v.fade * 0.4);
      nr = clamp01(nr + v.warm); nb = clamp01(nb - v.warm * 0.7);
      [nr, ng, nb] = saturate(nr, ng, nb, v.sat);
      return [clamp01(nr + v.fade * 0.05), clamp01(ng + v.fade * 0.04), clamp01(nb + v.fade * 0.03)];
    },
  },
  {
    id: "bleach",
    label: "Bleach Bypass",
    category: "bleach",
    variants: [
      { name: "Standard", sat: 0.42, contrast: 0.62 },
      { name: "Extreme", sat: 0.22, contrast: 0.86 },
      { name: "Soft", sat: 0.58, contrast: 0.42 },
      { name: "Cold", sat: 0.38, contrast: 0.68, cool: 0.05 },
    ],
    make: (v) => (r, g, b) => {
      let [nr, ng, nb] = saturate(r, g, b, v.sat);
      nr = sCurve(nr, v.contrast); ng = sCurve(ng, v.contrast); nb = sCurve(nb, v.contrast);
      if (v.cool) { nb = clamp01(nb + v.cool); nr = clamp01(nr - v.cool * 0.5); }
      return [nr, ng, nb];
    },
  },
  {
    id: "monochrome",
    label: "Monochrome",
    category: "monochrome",
    variants: [
      { name: "Neutral", tint: [1, 1, 1], contrast: 0.30 },
      { name: "Selenium", tint: [1.02, 0.99, 1.06], contrast: 0.38 },
      { name: "Sepia", tint: [1.12, 1.00, 0.82], contrast: 0.32 },
      { name: "Cyanotype", tint: [0.82, 0.96, 1.18], contrast: 0.40 },
      { name: "High Contrast", tint: [1, 1, 1], contrast: 0.72 },
    ],
    make: (v) => (r, g, b) => {
      const l = sCurve(luma(r, g, b), v.contrast);
      return [clamp01(l * v.tint[0]), clamp01(l * v.tint[1]), clamp01(l * v.tint[2])];
    },
  },
  {
    id: "warm",
    label: "Warm",
    category: "warm",
    variants: [
      { name: "Golden Hour", amount: 0.10, sat: 1.10, contrast: 0.22 },
      { name: "Candle", amount: 0.16, sat: 1.04, contrast: 0.16 },
      { name: "Sunset", amount: 0.13, sat: 1.18, contrast: 0.28 },
      { name: "Soft Warm", amount: 0.06, sat: 1.02, contrast: 0.12 },
    ],
    make: (v) => (r, g, b) => {
      let nr = clamp01(r + v.amount * (1 - r * 0.4));
      let ng = clamp01(g + v.amount * 0.35);
      let nb = clamp01(b - v.amount * 0.55);
      nr = sCurve(nr, v.contrast); ng = sCurve(ng, v.contrast); nb = sCurve(nb, v.contrast);
      return saturate(nr, ng, nb, v.sat);
    },
  },
  {
    id: "cool",
    label: "Cool",
    category: "cool",
    variants: [
      { name: "Moonlight", amount: 0.12, sat: 0.92, contrast: 0.26 },
      { name: "Night Interior", amount: 0.16, sat: 0.86, contrast: 0.34 },
      { name: "Winter", amount: 0.09, sat: 1.02, contrast: 0.20 },
      { name: "Steel", amount: 0.14, sat: 0.78, contrast: 0.40 },
    ],
    make: (v) => (r, g, b) => {
      let nr = clamp01(r - v.amount * 0.55);
      let ng = clamp01(g - v.amount * 0.10);
      let nb = clamp01(b + v.amount * (1 - b * 0.4));
      nr = sCurve(nr, v.contrast); ng = sCurve(ng, v.contrast); nb = sCurve(nb, v.contrast);
      return saturate(nr, ng, nb, v.sat);
    },
  },
  {
    id: "cinematic",
    label: "Cinematic",
    category: "cinematic",
    variants: [
      { name: "Thriller", shadow: [-0.02, 0.00, 0.07], high: [0.04, 0.02, -0.02], contrast: 0.46, sat: 0.94 },
      { name: "Drama", shadow: [0.02, 0.00, 0.03], high: [0.06, 0.04, 0.00], contrast: 0.38, sat: 1.02 },
      { name: "Sci Fi", shadow: [-0.03, 0.02, 0.09], high: [0.02, 0.05, 0.06], contrast: 0.44, sat: 1.08 },
      { name: "Western", shadow: [0.04, 0.01, -0.02], high: [0.10, 0.05, -0.04], contrast: 0.40, sat: 1.06 },
      { name: "Noir", shadow: [0.00, 0.00, 0.04], high: [0.02, 0.02, 0.03], contrast: 0.66, sat: 0.42 },
      { name: "Documentary", shadow: [0.01, 0.01, 0.01], high: [0.02, 0.02, 0.01], contrast: 0.24, sat: 1.00 },
    ],
    make: (v) => (r, g, b) => {
      let [nr, ng, nb] = splitTone(r, g, b, v.shadow, v.high, 1);
      nr = sCurve(nr, v.contrast); ng = sCurve(ng, v.contrast); nb = sCurve(nb, v.contrast);
      return saturate(nr, ng, nb, v.sat);
    },
  },
  {
    id: "technical",
    label: "Technical",
    category: "technical",
    variants: [
      { name: "Log To Rec709", mode: "log" },
      { name: "Contrast Boost", mode: "contrast" },
      { name: "Shadow Lift", mode: "lift" },
      { name: "Highlight Rolloff", mode: "rolloff" },
      { name: "Saturation Plus", mode: "sat" },
    ],
    make: (v) => (r, g, b) => {
      switch (v.mode) {
        case "log": {
          // Approximates a log-to-display transform: expand contrast, restore
          // saturation lost by the flat source curve.
          const f = (x) => clamp01(sCurve(Math.pow(clamp01(x), 1 / 0.62), 0.34));
          return saturate(f(r), f(g), f(b), 1.18);
        }
        case "contrast":
          return [sCurve(r, 0.5), sCurve(g, 0.5), sCurve(b, 0.5)];
        case "lift":
          return [lgg(r, 0.06, 1.08, 1), lgg(g, 0.06, 1.08, 1), lgg(b, 0.06, 1.08, 1)];
        case "rolloff": {
          const f = (x) => clamp01(x < 0.7 ? x : 0.7 + (1 - Math.exp(-(x - 0.7) * 3.2)) * 0.3);
          return [f(r), f(g), f(b)];
        }
        default:
          return saturate(r, g, b, 1.35);
      }
    },
  },
  {
    id: "utility",
    label: "Utility",
    category: "utility",
    variants: [
      { name: "Identity", mode: "identity" },
      { name: "Invert", mode: "invert" },
      { name: "Luminance Only", mode: "luma" },
      { name: "Red Channel", mode: "r" },
      { name: "Green Channel", mode: "g" },
      { name: "Blue Channel", mode: "b" },
    ],
    make: (v) => (r, g, b) => {
      switch (v.mode) {
        case "invert": return [1 - r, 1 - g, 1 - b];
        case "luma": { const l = luma(r, g, b); return [l, l, l]; }
        case "r": return [r, r, r];
        case "g": return [g, g, g];
        case "b": return [b, b, b];
        default: return [r, g, b];
      }
    },
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    category: "cyberpunk",
    variants: [
      { name: "Neon City", shadow: [0.0, 0.05, 0.15], high: [0.15, 0.0, 0.05], contrast: 0.6, sat: 1.3 },
      { name: "Acid Rain", shadow: [0.0, 0.1, 0.0], high: [0.0, 0.15, 0.15], contrast: 0.5, sat: 1.1 },
      { name: "Night Drive", shadow: [0.05, 0.0, 0.1], high: [0.2, 0.05, 0.0], contrast: 0.7, sat: 1.2 },
      { name: "Matrix", shadow: [0.0, 0.08, 0.02], high: [0.05, 0.2, 0.05], contrast: 0.45, sat: 1.0 },
    ],
    make: (v) => (r, g, b) => {
      let [nr, ng, nb] = splitTone(r, g, b, v.shadow, v.high, 1);
      nr = sCurve(nr, v.contrast); ng = sCurve(ng, v.contrast); nb = sCurve(nb, v.contrast);
      return saturate(nr, ng, nb, v.sat);
    },
  },
  {
    id: "bw-film",
    label: "B&W Film",
    category: "bw-film",
    variants: [
      { name: "Tri-X 400", contrast: 0.65, fade: 0.02, redFilter: 0.3 },
      { name: "Ilford HP5", contrast: 0.45, fade: 0.05, redFilter: 0.1 },
      { name: "T-Max 100", contrast: 0.8, fade: 0.0, redFilter: 0.5 },
      { name: "Ortho Plus", contrast: 0.5, fade: 0.03, redFilter: -0.2 },
    ],
    make: (v) => (r, g, b) => {
      const rf = r * (1 + v.redFilter);
      const gf = g * (1 - v.redFilter * 0.5);
      const bf = b * (1 - v.redFilter * 0.5);
      let l = sCurve(luma(rf, gf, bf), v.contrast);
      l = clamp01(l + v.fade);
      return [l, l, l];
    },
  },
];

/* -------------------------------------------------------------- serialisation */

/**
 * Write a .cube file. Size 33 is the common production size and keeps files
 * around 700KB; 17 is used for the bulk variants to keep the corpus compact
 * while remaining a legitimate, loadable LUT.
 */
function writeCube(title, fn, size = 17) {
  const lines = [
    `# Generated by Sun Plugin development asset generator`,
    `# This is a synthetic LUT created locally. License: CC0-1.0`,
    `TITLE "${String(title).replace(/"/g, "")}"`,
    `LUT_3D_SIZE ${size}`,
    `DOMAIN_MIN 0.0 0.0 0.0`,
    `DOMAIN_MAX 1.0 1.0 1.0`,
    "",
  ];

  const scale = size - 1;
  // .cube ordering: red varies fastest, then green, then blue.
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = fn(r / scale, g / scale, b / scale);
        lines.push(
          clamp01(out[0]).toFixed(6) + " " +
          clamp01(out[1]).toFixed(6) + " " +
          clamp01(out[2]).toFixed(6)
        );
      }
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Enumerate every LUT this generator can produce.
 * Returns [{ name, family, category, subcategory, size, content }].
 */
function generateLUTs({ size = 17, limit = 0 } = {}) {
  const out = [];

  for (const family of FAMILIES) {
    for (const variant of family.variants) {
      const fn = family.make(variant);
      const name = `${family.label} ${variant.name}`;
      out.push({
        name,
        filename: `${name.replace(/\s+/g, "_")}.cube`,
        family: family.id,
        type: "lut",
        category: family.category,
        subcategory: variant.name.toLowerCase().replace(/\s+/g, "-"),
        size,
        get content() { return writeCube(name, fn, size); },
        tags: [family.id, ...variant.name.toLowerCase().split(/\s+/)],
      });
      if (limit && out.length >= limit) return out;
    }
  }

  return out;
}

module.exports = { generateLUTs, writeCube, FAMILIES, sCurve, lgg, saturate, splitTone, luma };
