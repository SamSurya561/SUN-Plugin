"use strict";
/**
 * Template fixtures: .mogrt, .prfpset and caption files.
 *
 * IMPORTANT AND DELIBERATE LIMITATION
 * -----------------------------------
 * A functional Motion Graphics Template is authored in After Effects and carries
 * a compiled composition. Nothing can synthesise that, and pretending otherwise
 * would put files in the library that look real, get favourited and collected,
 * and then fail the moment they are dragged into a sequence.
 *
 * So these are FIXTURES: structurally valid ZIP containers with real
 * definition.json metadata and real embedded PNG thumbnails, which exercise
 * every part of the toolkit that does not open the template itself — scanning,
 * hashing, ZIP audit, categorisation, tagging, thumbnails, indexing, search,
 * favourites, collections, virtualised grids, replace, migrate. Every one is
 * flagged `syntheticFixture: true` and shows a FIXTURE badge in the browser, so
 * they can never be mistaken for production templates.
 *
 * Real MOGRTs come from the manual-import path. That is the honest answer, and
 * it is documented in DEVELOPMENT-ASSET-SOURCES.md section 1.
 *
 * Caption files are the exception: .srt and .vtt are plain text with a published
 * grammar, so those generate as fully real, usable files.
 */

const { createZip } = require("../../core/util/zip");
const { Canvas } = require("../../core/util/png");
const { drawTextCentered, measureText, fitText } = require("../../core/util/bitmap-font");
const { mulberry32, seedFrom } = require("./audio");

/* ------------------------------------------------------------- thumbnails */

/** A poster frame that shows what the template is meant to look like. */
function templatePoster(spec) {
  const c = new Canvas(480, 270);
  const rnd = mulberry32(seedFrom(spec.name));
  const [r, g, b] = spec.accent;

  c.shade((nx, ny) => [
    Math.round(18 + 14 * (1 - ny)),
    Math.round(19 + 15 * (1 - ny)),
    Math.round(23 + 18 * (1 - ny)),
    255,
  ]);

  // Sketch the layout the template describes, so the grid is readable at a glance.
  switch (spec.layout) {
    case "lower-third": {
      c.rect(40, 176, 250, 26, r, g, b, 0.92);
      c.rect(40, 206, 170, 12, 255, 255, 255, 0.34);
      c.rect(40, 176, 5, 42, 255, 255, 255, 0.85);
      break;
    }
    case "title": {
      c.rect(90, 108, 300, 34, 255, 255, 255, 0.90);
      c.rect(140, 150, 200, 12, r, g, b, 0.80);
      break;
    }
    case "caption": {
      c.rect(120, 200, 240, 26, 0, 0, 0, 0.72);
      c.rect(132, 208, 216, 10, 255, 255, 255, 0.88);
      break;
    }
    case "transition": {
      for (let i = 0; i < 7; i++) {
        const x = 40 + i * 60;
        c.rect(x, 40, 26, 190, r, g, b, 0.30 + i * 0.09);
      }
      break;
    }
    case "logo": {
      c.disc(240, 120, 44, r, g, b, 0.92);
      c.disc(240, 120, 26, 18, 19, 23, 1);
      c.rect(170, 186, 140, 12, 255, 255, 255, 0.55);
      break;
    }
    default: { // callout / infographic
      c.line(120, 200, 210, 130, 3, r, g, b, 0.9);
      c.disc(120, 200, 6, r, g, b, 1);
      c.rect(210, 112, 160, 34, 255, 255, 255, 0.16);
      c.rect(218, 122, 120, 8, 255, 255, 255, 0.7);
      c.rect(218, 134, 80, 6, 255, 255, 255, 0.4);
    }
  }

  // Fixture banner, so a poster frame is never mistaken for a real preview.
  c.rect(0, 0, 480, 18, r, g, b, 0.16);
  drawTextCentered(c, "FIXTURE - NOT A FUNCTIONAL TEMPLATE", 0, 480, 6, [r, g, b, 0.95], 1, 1);

  const title = fitText(spec.name.toUpperCase(), 38);
  drawTextCentered(c, title, 0, 480, 244, [190, 192, 200, 1], 1, 1);

  return c.toPNG();
}

/* ----------------------------------------------------------------- .mogrt */

/**
 * Build a .mogrt-shaped ZIP.
 * The definition.json mirrors the real schema closely enough that the toolkit
 * metadata reader has something meaningful to parse.
 */
function buildMogrt(spec) {
  const definition = {
    $schema: "https://sun-plugin.local/schemas/mogrt-fixture.json",
    generator: "Sun Plugin development asset generator",
    fixture: true,
    fixtureNote: "Structurally valid container for toolkit testing. Contains no After Effects composition and will not render in Premiere Pro.",
    version: 1,
    id: spec.id,
    name: spec.name,
    category: spec.category,
    subcategory: spec.subcategory,
    duration: spec.duration,
    frameRate: 29.97,
    resolution: { width: 1920, height: 1080 },
    license: "CC0-1.0",
    capabilities: { essentialGraphics: true, editableText: true },
    parameters: spec.parameters,
  };

  return createZip([
    { name: "definition.json", data: JSON.stringify(definition, null, 2) },
    { name: "thumbnail.png", data: templatePoster(spec) },
    {
      name: "README.txt",
      data: [
        "Sun Plugin development fixture",
        "",
        "This is NOT a functional Motion Graphics Template.",
        "It is a structurally valid .mogrt container generated locally so that the",
        "Sun Plugin asset library, scanner, index and browser can be tested at",
        "realistic scale without redistributing anyone else's licensed templates.",
        "",
        "Replace it with a real template using: Asset > Replace File.",
        "The asset id is preserved, so favourites and collections survive.",
        "",
        "License: CC0-1.0 (public domain dedication)",
      ].join("\n"),
    },
  ]);
}

/* --------------------------------------------------------------- .prfpset */

/**
 * Premiere effect presets are a binary/XML hybrid Adobe does not publish. We
 * therefore emit a documented, self-describing XML fixture rather than a
 * malformed imitation of the real format.
 */
function buildPreset(spec) {
  const params = spec.parameters
    .map((p) => `      <Parameter name="${p.name}" type="${p.type}" value="${p.value}"/>`)
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!--",
    "  Sun Plugin development fixture.",
    "  This is NOT a functional Premiere Pro effect preset. The .prfpset format is",
    "  proprietary and undocumented; this file exists so preset browsing, metadata",
    "  and indexing can be tested. Replace with a real preset via Asset > Replace File.",
    "  License: CC0-1.0",
    "-->",
    '<SunPluginPresetFixture version="1">',
    `  <Preset name="${spec.name}" category="${spec.category}" subcategory="${spec.subcategory}">`,
    `    <Description>${spec.description}</Description>`,
    "    <Parameters>",
    params,
    "    </Parameters>",
    "  </Preset>",
    "</SunPluginPresetFixture>",
    "",
  ].join("\n");
}

/* --------------------------------------------------------------- captions */

function timecode(seconds, comma = true) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${comma ? "," : "."}${pad(ms, 3)}`;
}

const SAMPLE_LINES = [
  "Welcome back to the channel.",
  "Today we are looking at something different.",
  "Let me show you exactly how this works.",
  "First, open the project panel.",
  "Then drag the clip onto the timeline.",
  "Notice how the transition lands on the beat.",
  "This is the part most people get wrong.",
  "Keep the cut tight and let it breathe.",
  "That is the whole technique.",
  "If this helped, you know what to do.",
  "One more thing before we finish.",
  "Check the description for the full breakdown.",
];

/** Real .srt and .vtt files, correct to the published grammar. */
function buildCaption(spec) {
  const rnd = mulberry32(seedFrom(spec.name));
  const cues = [];
  let t = 0.5;

  for (let i = 0; i < spec.lines; i++) {
    const text = SAMPLE_LINES[i % SAMPLE_LINES.length];
    const duration = 1.6 + rnd() * 1.8;
    cues.push({ index: i + 1, start: t, end: t + duration, text });
    t += duration + 0.15 + rnd() * 0.4;
  }

  if (spec.format === "vtt") {
    const body = cues.map((c) =>
      `${c.index}\n${timecode(c.start, false)} --> ${timecode(c.end, false)}${spec.styled ? " line:85% align:center" : ""}\n${c.text}\n`
    ).join("\n");
    return `WEBVTT - ${spec.name}\nNOTE Generated by Sun Plugin development asset generator. License: CC0-1.0\n\n${body}`;
  }

  return cues.map((c) =>
    `${c.index}\n${timecode(c.start)} --> ${timecode(c.end)}\n${c.text}\n`
  ).join("\n");
}

/* --------------------------------------------------------------- catalogue */

const ACCENTS = {
  titles: [255, 154, 40],
  "lower-thirds": [86, 190, 255],
  captions: [240, 200, 90],
  "kinetic-typography": [190, 130, 255],
  "text-animations": [150, 200, 255],
  transitions: [255, 118, 92],
  "logo-reveals": [120, 220, 160],
  infographics: [200, 170, 120],
  social: [255, 130, 190],
  callouts: [170, 200, 140],
};

const TEXT_PARAMS = [
  { name: "Primary Text", type: "text", value: "Your Headline" },
  { name: "Secondary Text", type: "text", value: "Supporting line" },
  { name: "Primary Color", type: "color", value: "#FFB328" },
  { name: "Animation Speed", type: "slider", value: "1.0" },
  { name: "Position", type: "point", value: "960,540" },
];

function buildCatalogue() {
  const items = [];

  const mogrtGroups = [
    { category: "titles", layout: "title", styles: ["Cinematic", "Minimal", "Bold", "Serif", "Kinetic", "Split", "Boxed", "Underline", "Fade", "Slide"], count: 10 },
    { category: "lower-thirds", layout: "lower-third", styles: ["Clean", "Bar", "Corner", "Rounded", "Outline", "Gradient", "Broadcast", "Minimal"], count: 8 },
    { category: "captions", layout: "caption", styles: ["Subtitle", "Karaoke", "Pop", "Highlight", "Boxed", "Shadow"], count: 6 },
    { category: "kinetic-typography", layout: "title", styles: ["Bounce", "Scale", "Typewriter", "Wave", "Stagger", "Rotate"], count: 6 },
    { category: "text-animations", layout: "title", styles: ["Fade In", "Slide Up", "Mask Reveal", "Blur In", "Scale In"], count: 5 },
    { category: "transitions", layout: "transition", styles: ["Whip", "Zoom", "Glitch", "Shape", "Light", "Film", "Wipe", "Dissolve"], count: 8 },
    { category: "logo-reveals", layout: "logo", styles: ["Shine", "Assemble", "Fade", "Stamp", "Draw"], count: 5 },
    { category: "infographics", layout: "callout", styles: ["Bar Chart", "Pie", "Counter", "Timeline", "Stat"], count: 5 },
    { category: "social", layout: "lower-third", styles: ["Subscribe", "Handle", "Like", "Comment", "Follow", "Share"], count: 6 },
    { category: "callouts", layout: "callout", styles: ["Arrow", "Circle", "Line", "Box", "Pointer"], count: 5 },
  ];

  for (const group of mogrtGroups) {
    for (const style of group.styles.slice(0, group.count)) {
      const name = `${style} ${group.category.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())}`;
      const spec = {
        id: `mogrt-${group.category}-${style.toLowerCase().replace(/\s+/g, "-")}`,
        name,
        layout: group.layout,
        category: group.category,
        subcategory: style.toLowerCase().replace(/\s+/g, "-"),
        accent: ACCENTS[group.category] || [255, 154, 40],
        duration: 3 + (style.length % 4),
        parameters: TEXT_PARAMS,
      };
      items.push({
        name,
        filename: name.replace(/\s+/g, "_") + ".mogrt",
        type: group.category === "transitions" ? "transition" : group.category === "captions" ? "caption" : "mogrt",
        category: group.category,
        subcategory: spec.subcategory,
        tags: ["mogrt", "template", "fixture", ...group.category.split("-"), ...style.toLowerCase().split(/\s+/)],
        syntheticFixture: true,
        build: () => buildMogrt(spec),
      });
    }
  }

  // --- presets
  const presetGroups = [
    { category: "motion", names: ["Smooth Zoom In", "Smooth Zoom Out", "Handheld Shake", "Slow Push", "Whip Pan", "Ease Slide", "Drift", "Snap Scale"] },
    { category: "effect", names: ["Glow Soft", "Glitch RGB", "Chromatic Aberration", "Vignette Soft", "Sharpen Light", "Blur Edges"] },
    { category: "audio", names: ["Voice Clarity", "Bass Boost", "De Ess", "Podcast Master", "Telephone"] },
    { category: "text", names: ["Fade Text", "Pop Text", "Slide Text", "Blur Text"] },
    { category: "speed", names: ["Speed Ramp Up", "Speed Ramp Down", "Freeze Frame", "Slow Motion"] },
    { category: "stabilize", names: ["Warp Subtle", "Warp Strong"] },
  ];

  for (const group of presetGroups) {
    for (const n of group.names) {
      const spec = {
        name: n,
        category: group.category,
        subcategory: n.toLowerCase().split(/\s+/)[0],
        description: `${n} preset fixture for Sun Plugin development testing.`,
        parameters: [
          { name: "Amount", type: "float", value: "0.5" },
          { name: "Duration", type: "float", value: "1.0" },
          { name: "Easing", type: "string", value: "ease-in-out" },
        ],
      };
      items.push({
        name: n,
        filename: n.replace(/\s+/g, "_") + ".prfpset",
        type: "preset",
        category: group.category,
        subcategory: spec.subcategory,
        tags: ["preset", "fixture", group.category, ...n.toLowerCase().split(/\s+/)],
        syntheticFixture: true,
        build: () => buildPreset(spec),
      });
    }
  }

  // --- captions (real files, not fixtures)
  const captionSets = [
    { key: "Tutorial", lines: 12, format: "srt", styled: false },
    { key: "Tutorial", lines: 12, format: "vtt", styled: true },
    { key: "Interview", lines: 24, format: "srt", styled: false },
    { key: "Interview", lines: 24, format: "vtt", styled: true },
    { key: "Short Form", lines: 6, format: "srt", styled: false },
    { key: "Short Form", lines: 6, format: "vtt", styled: true },
    { key: "Long Form", lines: 40, format: "srt", styled: false },
    { key: "Vlog", lines: 18, format: "srt", styled: false },
  ];

  for (const set of captionSets) {
    const name = `${set.key} Captions ${set.format.toUpperCase()}`;
    items.push({
      name,
      filename: name.replace(/\s+/g, "_") + "." + set.format,
      type: "caption",
      category: "subtitle",
      subcategory: set.format,
      tags: ["caption", "subtitle", set.format, ...set.key.toLowerCase().split(/\s+/)],
      syntheticFixture: false, // these are genuinely valid caption files
      build: () => buildCaption({ name, ...set }),
    });
  }

  return items;
}

let CATALOGUE = null;
function catalogue() {
  if (!CATALOGUE) CATALOGUE = buildCatalogue();
  return CATALOGUE;
}

function generateTemplates({ limit = 0, types = null } = {}) {
  const out = [];
  for (const item of catalogue()) {
    if (types && !types.includes(item.type)) continue;
    out.push({
      name: item.name,
      filename: item.filename,
      type: item.type,
      category: item.category,
      subcategory: item.subcategory,
      tags: item.tags,
      syntheticFixture: item.syntheticFixture,
      get content() { return item.build(); },
    });
    if (limit && out.length >= limit) break;
  }
  return out;
}

module.exports = {
  generateTemplates,
  catalogue,
  buildMogrt,
  buildPreset,
  buildCaption,
  templatePoster,
  timecode,
};
