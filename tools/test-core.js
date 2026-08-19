#!/usr/bin/env node
"use strict";
/**
 * Core test suite.
 *
 * Runs against a throwaway library so it can never touch the real one. The last
 * group is the important one: it deletes the development ingestor from a copy of
 * the tree and proves the core still works, which is the claim the whole
 * architecture is built on.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ESC = String.fromCharCode(27);
const C = {
  reset: ESC + "[0m", dim: ESC + "[2m", bold: ESC + "[1m",
  red: ESC + "[31m", green: ESC + "[32m", yellow: ESC + "[33m",
};

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sun-test-"));
process.env.SUN_LIBRARY_ROOT = path.join(TMP, "library");

let passed = 0;
let failed = 0;
const failures = [];

function group(name) {
  console.log(`\n${C.bold}${name}${C.reset}`);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ${C.green}ok${C.reset}   ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  ${C.red}FAIL${C.reset} ${name}`);
    console.log(`       ${C.dim}${e.message}${C.reset}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || "not equal"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/* ------------------------------------------------------------- safe names */

group("safe filenames");
{
  const s = require("../src/core/util/safe-name");
  const NUL = String.fromCharCode(0);

  test("strips directory traversal", () => assertEqual(s.safeSegment("../../etc/passwd"), "passwd"));
  test("escapes Windows reserved names", () => assertEqual(s.safeSegment("CON.wav"), "_CON.wav"));
  test("replaces illegal characters", () => assert(!/[<>:"|?*]/.test(s.safeSegment('a<b>c:d"e|f?g*h.wav'))));
  test("removes control characters", () => assert(!s.safeSegment(`a${NUL}b.wav`).includes(NUL)));
  test("strips trailing dots and spaces", () => assertEqual(s.safeSegment("name.  "), "name"));
  test("never returns an empty name", () => assert(s.safeSegment("").length > 0));
  test("rejects archive path traversal", () => assertEqual(s.safeRelativePath("../x").ok, false));
  test("rejects absolute archive paths", () => assertEqual(s.safeRelativePath("/etc/x").ok, false));
  test("rejects drive-letter archive paths", () => assertEqual(s.safeRelativePath("C:/x").ok, false));
  test("accepts a normal nested path", () => assertEqual(s.safeRelativePath("SFX/Whoosh/a.wav").ok, true));
  test("dedupes colliding names", () => assertEqual(s.uniqueName("a.wav", (n) => n === "a.wav"), "a (2).wav"));
}

/* ----------------------------------------------------------------- hashing */

group("hashing");
{
  const { sha256Bytes, sha256 } = require("../src/core/util/hash");
  const crypto = require("crypto");

  test("sha256 of empty input", () =>
    assertEqual(sha256Bytes(new Uint8Array(0)),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
  test("sha256 of abc", () =>
    assertEqual(sha256Bytes(new Uint8Array([97, 98, 99])),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
  test("pure-JS matches node:crypto over random input", () => {
    for (let i = 0; i < 20; i++) {
      const b = crypto.randomBytes(Math.floor(Math.random() * 4000));
      assertEqual(sha256Bytes(new Uint8Array(b)), crypto.createHash("sha256").update(b).digest("hex"));
    }
  });
}

/* ----------------------------------------------------------------- formats */

group("format verification");
{
  const f = require("../src/core/util/formats");
  const bytes = (s) => new Uint8Array(Buffer.from(s));

  test("recognises a png", () =>
    assertEqual(f.verifyContent("a.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])).ok, true));
  test("rejects an exe disguised as mp4", () =>
    assertEqual(f.verifyContent("m.mp4", new Uint8Array([0x4d, 0x5a, 0, 0])).ok, false));
  test("rejects executable extensions", () => assertEqual(f.isExecutable("setup.exe"), true));
  test("rejects powershell scripts", () => assertEqual(f.isExecutable("run.ps1"), true));
  test("accepts a text .cube", () =>
    assertEqual(f.verifyContent("a.cube", bytes("LUT_3D_SIZE 2\n0 0 0\n")).ok, true));
  test("accepts an xml .prfpset", () =>
    assertEqual(f.verifyContent("a.prfpset", bytes("<?xml version=\"1.0\"?><P/>")).ok, true));
  test("accepts a zip .prfpset", () =>
    assertEqual(f.verifyContent("a.prfpset", new Uint8Array([0x50, 0x4b, 3, 4])).ok, true));
  test("gives media no text fallback", () =>
    assertEqual(f.verifyContent("a.wav", bytes("not audio at all")).ok, false));
  test("blocks executables inside archives", () => assertEqual(f.archiveEntryAllowed("x.dll"), false));
}

/* --------------------------------------------------------------------- zip */

group("zip");
{
  const zip = require("../src/core/util/zip");
  const zlib = require("zlib");
  const crypto = require("crypto");

  test("round-trips a written archive", () => {
    const built = zip.createZip([
      { name: "definition.json", data: JSON.stringify({ a: 1 }).repeat(40) },
      { name: "nested/x.txt", data: "hello ".repeat(50) },
    ]);
    const listed = zip.listEntries(built);
    assertEqual(listed.ok, true, "listEntries");
    assertEqual(listed.entries.length, 2);
    const text = Buffer.from(zip.extractEntry(built, listed.entries[1])).toString("utf8");
    assertEqual(text, "hello ".repeat(50));
  });

  test("pure-JS inflate matches zlib", () => {
    for (let i = 0; i < 10; i++) {
      const raw = crypto.randomBytes(Math.floor(Math.random() * 30000));
      const deflated = zlib.deflateRawSync(raw, { level: 9 });
      const out = Buffer.from(zip.inflateRawJS(new Uint8Array(deflated), raw.length));
      assert(out.equals(raw), `mismatch at iteration ${i}`);
    }
  });

  test("reports a non-zip cleanly", () =>
    assertEqual(zip.listEntries(new Uint8Array([1, 2, 3])).ok, false));
}

group("archive audit");
{
  const { auditArchive } = require("../src/core/importer/zip-audit");
  const { createZip } = require("../src/core/util/zip");

  test("accepts a clean asset pack", () => {
    const archive = createZip([
      { name: "SFX/Whoosh/a.wav", data: "RIFF....WAVE" },
      { name: "LUTs/x.cube", data: "LUT_3D_SIZE 2" },
    ]);
    assertEqual(auditArchive(archive).ok, true);
  });

  test("refuses an archive containing an executable", () => {
    const archive = createZip([
      { name: "readme.txt", data: "hi" },
      { name: "install.exe", data: "MZ...." },
    ]);
    const result = auditArchive(archive);
    assertEqual(result.ok, false);
    assert(result.reasons.join(" ").includes("executable"), "should name the executable");
  });

  test("skips unsupported types but keeps the archive", () => {
    const archive = createZip([
      { name: "a.wav", data: "RIFF....WAVE" },
      { name: "notes.docx", data: "whatever" },
    ]);
    const result = auditArchive(archive);
    assertEqual(result.ok, true);
    assertEqual(result.entries.length, 1);
    assertEqual(result.rejected.length, 1);
  });
}

/* --------------------------------------------------------- categorisation */

group("categorisation and tagging");
{
  const { categorize, targetFolder } = require("../src/core/scanner/categorize");
  const { generateTags } = require("../src/core/scanner/tags");

  test("reads type, category and subcategory from the folder tree", () => {
    const k = categorize("MOGRT/Cinematic/Titles/Cinematic_Title_Heavy_Reveal.mogrt");
    assertEqual(k.type, "mogrt");
    assertEqual(k.category, "titles");
    assertEqual(k.subcategory, "cinematic");
  });

  test("classifies SFX by folder", () => {
    const k = categorize("SFX/Whoosh/whoosh-001.wav");
    assertEqual(k.type, "sfx");
    assertEqual(k.category, "whoosh");
  });

  test("prefers the most specific nested type folder", () => {
    // "Effects/Backgrounds" must beat "Effects", or the writer and the scanner
    // disagree about where a background lives and each file gets two records.
    assertEqual(categorize("Effects/Backgrounds/Gradient/a.png").type, "background");
  });

  test("falls back to the extension when nothing else is known", () =>
    assertEqual(categorize("unsorted/mystery.wav").type, "sfx"));

  test("write path matches read path", () => {
    const p = "SFX/Impact/Cinematic/Impact_Heavy.wav";
    const k = categorize(p);
    assert(p.startsWith(targetFolder(k)), `${targetFolder(k)} should prefix ${p}`);
  });

  test("extracts meaningful tags", () => {
    const p = "MOGRT/Titles/Cinematic/Cinematic_Title_Heavy_Reveal.mogrt";
    const tags = generateTags(p, categorize(p), {});
    for (const want of ["cinematic", "title", "heavy", "reveal", "typography"]) {
      assert(tags.includes(want), `missing tag ${want} in ${tags.join(",")}`);
    }
  });

  test("drops the structural library root from tags", () => {
    const tags = generateTags("DevelopmentLibrary/LUTs/Vintage/Faded.cube", { type: "lut" }, {});
    assert(!tags.includes("development"), "should not tag 'development'");
    assert(!tags.includes("library"), "should not tag 'library'");
  });

  test("drops sequence numbers but keeps format vocabulary", () => {
    const tags = generateTags("Overlays/Film Grain/filmgrain_8mm_001.png", { type: "overlay" }, {});
    assert(tags.includes("8mm"), "should keep 8mm");
    assert(!tags.includes("001"), "should drop 001");
  });
}

/* ---------------------------------------------------------------- database */

group("database");
{
  const { AssetDatabase } = require("../src/core/db/database");
  const { ensureLibrary } = require("../src/core/library/paths");
  ensureLibrary();

  const db = new AssetDatabase().load();

  test("upserts and queries", () => {
    db.upsert({ id: "a1", name: "Cinematic Whoosh", type: "sfx", category: "whoosh", tags: ["whoosh", "cinematic"], sha256: "h1" });
    db.upsert({ id: "a2", name: "Vintage LUT", type: "lut", category: "vintage", tags: ["vintage", "film"], sha256: "h2" });
    assertEqual(db.query({ text: "whoosh" }).total, 1);
    assertEqual(db.query({ type: "lut" }).total, 1);
    assertEqual(db.query({}).total, 2);
  });

  test("matches on a prefix for search-as-you-type", () =>
    assertEqual(db.query({ text: "whoo" }).total, 1));

  test("finds duplicates by content hash", () => {
    db.upsert({ id: "a3", name: "Copy", type: "sfx", sha256: "h1" });
    assertEqual(db.byHash("h1").length, 2);
  });

  test("preserves favourites across re-upsert", () => {
    db.get("a1").favorite = true;
    db.upsert({ id: "a1", name: "Cinematic Whoosh", type: "sfx", sha256: "h1" });
    assertEqual(db.get("a1").favorite, true);
  });

  test("preserves licence when a rescan supplies none", () => {
    db.upsert({ id: "a4", name: "Licensed", type: "sfx", sha256: "h4", license: "CC0-1.0", author: "someone" });
    db.upsert({ id: "a4", name: "Licensed", type: "sfx", sha256: "h4" }); // a scan cannot know
    assertEqual(db.get("a4").license, "CC0-1.0");
    assertEqual(db.get("a4").author, "someone");
  });

  test("keeps a user category correction across rescans", () => {
    const { correctCategory } = require("../src/core/library/collections");
    correctCategory(db, "a2", { category: "teal-orange" });
    db.upsert({ id: "a2", name: "Vintage LUT", type: "lut", category: "vintage", sha256: "h2" });
    assertEqual(db.get("a2").category, "teal-orange");
  });

  test("survives a save and reload", () => {
    db.save();
    const reloaded = new AssetDatabase().load();
    assertEqual(reloaded.size, db.size);
    assertEqual(reloaded.get("a1").favorite, true);
  });

  test("computes facets", () => {
    const facets = db.facets({});
    assert(facets.type.some((t) => t.value === "sfx"), "expected an sfx facet");
  });
}

/* ------------------------------------------------------- collections etc. */

group("collections and favourites");
{
  const { AssetDatabase } = require("../src/core/db/database");
  const c = require("../src/core/library/collections");
  const db = new AssetDatabase().load();

  test("creates a collection and adds an asset", () => {
    c.createCollection(db, "Trailer");
    c.addToCollection(db, "a1", "Trailer");
    assertEqual(db.query({ collection: "Trailer" }).total, 1);
  });

  test("renaming a collection moves its members", () => {
    c.renameCollection(db, "Trailer", "Trailer Kit");
    assertEqual(db.query({ collection: "Trailer Kit" }).total, 1);
  });

  test("deleting a collection detaches its members", () => {
    c.deleteCollection(db, "Trailer Kit");
    assertEqual(db.get("a1").collections.length, 0);
  });

  test("toggles a favourite", () => {
    const before = db.get("a2").favorite;
    c.toggleFavorite(db, "a2");
    assert(db.get("a2").favorite !== before);
  });
}

/* -------------------------------------------------------- ingest + replace */

group("ingest, replace and migrate");
{
  const { AssetDatabase } = require("../src/core/db/database");
  const { ingestBuffer } = require("../src/core/library/ingest");
  const { replaceAsset } = require("../src/core/library/replace");
  const { exportMetadata } = require("../src/core/library/migrate");
  const { encodeWAV } = require("../src/core/util/wav");
  const { paths } = require("../src/core/library/paths");

  const db = new AssetDatabase().load();
  const wav = encodeWAV([new Float32Array(4800).map((_, i) => Math.sin(i / 20) * 0.5)], 48000);

  let ingested;
  test("ingests a valid wav", () => {
    ingested = ingestBuffer(db, {
      bytes: wav, filename: "Test_Whoosh.wav", developmentOnly: true,
      source: "synthetic", license: "CC0-1.0",
      hints: { type: "sfx", category: "whoosh" },
      thumbnails: false,
    });
    assert(ingested.asset, "expected an asset");
    assertEqual(ingested.asset.type, "sfx");
    assertEqual(ingested.asset.license, "CC0-1.0");
    assert(fs.existsSync(ingested.path), "file should exist on disk");
  });

  test("detects an identical re-ingest as a duplicate", () => {
    const again = ingestBuffer(db, {
      bytes: wav, filename: "Test_Whoosh.wav", developmentOnly: true,
      source: "synthetic", thumbnails: false,
    });
    assertEqual(again.duplicate, true);
  });

  test("quarantines an executable rather than storing it", () => {
    const result = ingestBuffer(db, {
      bytes: new Uint8Array([0x4d, 0x5a, 0, 0]), filename: "evil.exe",
      developmentOnly: true, source: "direct-url", thumbnails: false,
    });
    assertEqual(result.quarantined, true);
  });

  test("quarantines an exe disguised as a wav", () => {
    const result = ingestBuffer(db, {
      bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0]), filename: "sneaky.wav",
      developmentOnly: true, source: "direct-url", thumbnails: false,
    });
    assertEqual(result.quarantined, true);
  });

  test("replace preserves the asset id, favourites and collections", () => {
    const id = ingested.asset.id;
    const c = require("../src/core/library/collections");
    c.toggleFavorite(db, id);
    c.createCollection(db, "Keep");
    c.addToCollection(db, id, "Keep");

    const replacement = path.join(TMP, "my-own.wav");
    fs.writeFileSync(replacement, Buffer.from(encodeWAV([new Float32Array(2400).fill(0.2)], 48000)));

    const result = replaceAsset(db, id, replacement, { thumbnails: false });
    assertEqual(result.ok, true, result.error);
    assertEqual(result.asset.id, id, "id must be preserved");
    assertEqual(result.asset.favorite, true, "favourite must survive");
    assert(result.asset.collections.includes("Keep"), "collection must survive");
    assertEqual(result.asset.developmentOnly, false, "should become a permanent asset");
    assertEqual(result.asset.source, "user-import");
    assert(result.asset.replacedFrom, "should record what it replaced");
  });

  test("exports metadata without file bodies", () => {
    const doc = exportMetadata(db, {});
    assert(doc.assets.length > 0);
    assert(!JSON.stringify(doc).includes("RIFF"), "export must not carry media");
  });
}

/* ------------------------------------------------- the removability claim */

group("development ingestor is removable");
{
  test("core does not reference the ingestor", () => {
    execFileSync(process.execPath, [path.join(ROOT, "tools", "check-boundaries.js")], { stdio: "pipe" });
  });

  test("core loads and works with src/dev-ingestor deleted", () => {
    // Copy the tree, delete the subsystem, and run the core in a child process.
    const sandbox = path.join(TMP, "no-ingestor");
    fs.cpSync(path.join(ROOT, "src"), path.join(sandbox, "src"), { recursive: true });
    fs.cpSync(path.join(ROOT, "config"), path.join(sandbox, "config"), { recursive: true });
    fs.rmSync(path.join(sandbox, "src", "dev-ingestor"), { recursive: true, force: true });

    assert(!fs.existsSync(path.join(sandbox, "src", "dev-ingestor")), "ingestor should be gone");

    const script = `
      process.env.SUN_LIBRARY_ROOT = ${JSON.stringify(path.join(TMP, "lib2"))};
      const { SunPlugin } = require(${JSON.stringify(path.join(sandbox, "src", "index.js").replace(/\\/g, "/"))});
      const plugin = new SunPlugin({ settings: { developmentAssetMode: true } }).start();
      const { ingestBuffer } = require(${JSON.stringify(path.join(sandbox, "src", "core", "library", "ingest.js").replace(/\\/g, "/"))});
      const { encodeWAV } = require(${JSON.stringify(path.join(sandbox, "src", "core", "util", "wav.js").replace(/\\/g, "/"))});
      const wav = encodeWAV([new Float32Array(2400).fill(0.3)], 48000);
      const r = ingestBuffer(plugin.db, { bytes: wav, filename: "x.wav", developmentOnly: false, source: "user-import", thumbnails: false });
      const found = plugin.search({ text: "x" });
      console.log(JSON.stringify({
        started: true,
        devAvailable: plugin.developmentAssetsAvailable,
        devMode: plugin.settings.developmentAssetMode,
        ingested: Boolean(r.asset),
        searchable: found.total,
        stats: plugin.stats().total
      }));
    `;

    const out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", stdio: "pipe" });
    const result = JSON.parse(out.trim().split("\n").pop());

    assertEqual(result.started, true, "plugin should start");
    assertEqual(result.devAvailable, false, "development tools must be absent");
    assertEqual(result.devMode, false, "development mode must switch itself off");
    assertEqual(result.ingested, true, "import must still work");
    assertEqual(result.searchable, 1, "search must still work");
  });
}

/* -------------------------------------------------------------- ingestor */

group("development ingestor (present)");
{
  const { SourceRegistry } = require("../src/dev-ingestor/registry");
  const guards = require("../src/dev-ingestor/queue/guards");

  const registry = new SourceRegistry().load();

  test("loads the source registry", () => assert(registry.list().length >= 8));

  test("every registry entry validates", () => {
    const blocked = registry.list().filter((s) => s.blocked && !(s.auth && s.auth.optional === false));
    assertEqual(blocked.length, 0, `blocked: ${blocked.map((s) => s.id + ": " + s.blockedReason).join("; ")}`);
  });

  test("manual sources refuse automation", () => {
    const manual = registry.get("manual");
    let threw = false;
    try { guards.assertSourceAutomatable(manual); } catch (e) { threw = e.code === "MANUAL_ONLY"; }
    assert(threw, "manual source must throw ManualOnlySourceError");
  });

  test("refuses hosts that prohibit scraping", () => {
    const source = registry.get("openverse");
    let code = null;
    try {
      guards.assertUrlAllowed("https://www.pexels.com/video/1234/", source, {});
    } catch (e) { code = e.code; }
    assertEqual(code, "HOST_PROHIBITED");
  });

  test("refuses non-https", () => {
    let code = null;
    try { guards.assertUrlAllowed("http://archive.org/x", registry.get("internet-archive"), {}); }
    catch (e) { code = e.code; }
    assertEqual(code, "INSECURE");
  });

  test("refuses undeclared domains", () => {
    let code = null;
    try { guards.assertUrlAllowed("https://evil.example.com/x.wav", registry.get("openverse"), {}); }
    catch (e) { code = e.code; }
    assertEqual(code, "DOMAIN_NOT_DECLARED");
  });

  test("refuses URLs with embedded credentials", () => {
    let code = null;
    try { guards.assertUrlAllowed("https://user:pw@archive.org/x", registry.get("internet-archive"), {}); }
    catch (e) { code = e.code; }
    assertEqual(code, "EMBEDDED_CREDENTIALS");
  });

  test("refuses a download with no licence", () => {
    let code = null;
    try { guards.assertLicenseAcceptable(null, registry.get("openverse"), {}); }
    catch (e) { code = e.code; }
    assertEqual(code, "NO_LICENSE");
  });

  test("enforces the per-session cap", () => {
    const limiter = new guards.SessionLimiter();
    const source = { id: "x", name: "X", limits: { maxPerCategoryPerSession: 2 } };
    limiter.record(source, "video", 2);
    let code = null;
    try { limiter.check(source, "video", 1); } catch (e) { code = e.code; }
    assertEqual(code, "SESSION_CAP");
  });

  test("manifest declares every enabled source domain", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    const declared = new Set(manifest.requiredPermissions.network.domains);
    for (const domain of registry.requiredDomains()) {
      assert(declared.has(domain), `manifest is missing ${domain}`);
    }
  });

  test("production manifest requests no network access", () => {
    const production = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.production.json"), "utf8"));
    assertEqual(production.requiredPermissions.network.domains.length, 0);
  });
}

/* -------------------------------------------------------------- generator */

group("generators produce valid files");
{
  const { generateLUTs } = require("../src/dev-ingestor/generator/luts");
  const { generateSFX } = require("../src/dev-ingestor/generator/audio");
  const { generateImages } = require("../src/dev-ingestor/generator/images");
  const { generateTemplates } = require("../src/dev-ingestor/generator/templates");
  const { parseCube, sampleCube } = require("../src/core/scanner/thumbnails");
  const { readWAVInfo } = require("../src/core/util/wav");
  const { decodePNG } = require("../src/core/util/png-decode");
  const { listEntries } = require("../src/core/util/zip");

  const luts = generateLUTs();
  const sfx = generateSFX();
  const images = generateImages();
  const templates = generateTemplates();

  test("generates at least 50 LUTs", () => assert(luts.length >= 50, `got ${luts.length}`));
  test("generates at least 500 SFX", () => assert(sfx.length >= 500, `got ${sfx.length}`));
  test("generates overlays, backgrounds and guides", () => assert(images.length >= 100, `got ${images.length}`));
  test("generates MOGRT, preset and caption fixtures", () => assert(templates.length >= 90, `got ${templates.length}`));

  test("generated LUTs parse as real cube files", () => {
    const parsed = parseCube(luts[0].content);
    assert(parsed, "should parse");
    assertEqual(parsed.size, 17);
  });

  test("the identity LUT is an exact pass-through", () => {
    const identity = parseCube(luts.find((l) => l.name === "Utility Identity").content);
    for (let i = 0; i < 30; i++) {
      const [r, g, b] = [Math.random(), Math.random(), Math.random()];
      const out = sampleCube(identity, r, g, b);
      assert(Math.abs(out[0] - r) < 1e-6 && Math.abs(out[1] - g) < 1e-6 && Math.abs(out[2] - b) < 1e-6,
        "identity must not alter values");
    }
  });

  test("generated SFX are valid 48kHz wav", () => {
    const info = readWAVInfo(sfx[0].content);
    assert(info, "should be a wav");
    assertEqual(info.sampleRate, 48000);
    assertEqual(info.bitsPerSample, 16);
    assert(info.duration > 0);
  });

  test("SFX takes are genuinely different waveforms", () => {
    const a = sfx.find((s) => s.name.endsWith(" 01"));
    const b = sfx.find((s) => s.name === a.name.replace(/ 01$/, " 02"));
    assert(b, "expected a second take");
    const x = a.content;
    const y = b.content;
    let diff = 0;
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) diff++;
    assert(diff / x.length > 0.2, "takes should differ substantially");
  });

  test("generated images decode as valid PNG", () => {
    const decoded = decodePNG(images[0].content);
    assert(decoded && decoded.width > 0 && decoded.height > 0);
  });

  test("mogrt fixtures are valid zip containers", () => {
    const mogrt = templates.find((t) => t.filename.endsWith(".mogrt"));
    const listed = listEntries(mogrt.content);
    assertEqual(listed.ok, true);
    assert(listed.entries.some((e) => e.name === "definition.json"));
  });

  test("mogrt fixtures are flagged as fixtures", () => {
    const mogrt = templates.find((t) => t.filename.endsWith(".mogrt"));
    assertEqual(mogrt.syntheticFixture, true);
  });

  test("caption files are real, not fixtures", () => {
    const srt = templates.find((t) => t.filename.endsWith(".srt"));
    assertEqual(srt.syntheticFixture, false);
    assert(/^1\r?\n00:00:\d\d,\d\d\d --> /.test(srt.content), "should be valid SRT");
  });
}

/* ------------------------------------------------------------------ report */

console.log(`\n${C.bold}${passed + failed} tests${C.reset}  ${C.green}${passed} passed${C.reset}${failed ? `  ${C.red}${failed} failed${C.reset}` : ""}`);

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }

if (failed) {
  console.log(`\n${C.red}failures:${C.reset}`);
  for (const f of failures) console.log(`  ${f.name}\n    ${C.dim}${f.error.stack.split("\n").slice(0, 3).join("\n    ")}${C.reset}`);
  process.exit(1);
}
process.exit(0);
