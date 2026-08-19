#!/usr/bin/env node
"use strict";
/**
 * Sun Plugin development CLI.
 *
 * Drives the same modules the panel does, which is deliberate: if a workflow
 * cannot be exercised from here it is not really testable, and the CLI is how
 * the library gets built and rebuilt during development.
 *
 *   node tools/sun.js init
 *   node tools/sun.js generate [--type lut] [--limit 200] [--no-thumbnails]
 *   node tools/sun.js scan [path]
 *   node tools/sun.js search <query> [--type sfx] [--limit 20]
 *   node tools/sun.js stats
 *   node tools/sun.js sources [--probe]
 *   node tools/sun.js discover <query> [--source openverse] [--limit 10]
 *   node tools/sun.js download <query> --source openverse [--limit 5]
 *   node tools/sun.js import <path>
 *   node tools/sun.js export <file.json>
 *   node tools/sun.js stress --count 5000
 *   node tools/sun.js purge-dev [--yes]
 */

const path = require("path");
const fs = require("fs");

const ESC = String.fromCharCode(27);
const C = {
  reset: ESC + "[0m", dim: ESC + "[2m", bold: ESC + "[1m",
  red: ESC + "[31m", green: ESC + "[32m", yellow: ESC + "[33m",
  blue: ESC + "[34m", amber: ESC + "[38;5;214m", cyan: ESC + "[36m",
};

const { AssetDatabase } = require("../src/core/db/database");
const { paths, ensureLibrary } = require("../src/core/library/paths");
const { scanLibrary, rebuildIndex } = require("../src/core/scanner/scan");
const { importPath } = require("../src/core/importer/import");
const { writeExport } = require("../src/core/library/migrate");
const { purgeDevelopmentAssets } = require("../src/core/library/replace");

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (key.startsWith("no-")) { out.flags[key.slice(3)] = false; continue; }
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { out.flags[key] = next; i++; }
      else out.flags[key] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

const bytes = (n) => {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
};

const banner = (text) => {
  console.log(`\n${C.amber}${C.bold}  ${text}${C.reset}`);
  console.log(`${C.dim}  ${"-".repeat(text.length)}${C.reset}`);
};

function openDb() {
  ensureLibrary();
  return new AssetDatabase().load();
}

function progressBar(done, total, width = 28) {
  const ratio = total ? Math.min(1, done / total) : 0;
  const filled = Math.round(ratio * width);
  return `${C.amber}${"#".repeat(filled)}${C.dim}${".".repeat(width - filled)}${C.reset}`;
}

/* -------------------------------------------------------------- commands */

const commands = {
  async init() {
    banner("Initialising Sun Plugin library");
    const root = ensureLibrary();
    const db = new AssetDatabase().load();
    db.save();
    console.log(`  root      ${C.cyan}${root}${C.reset}`);
    console.log(`  library   ${paths.library}`);
    console.log(`  dev       ${paths.developmentLibrary}`);
    console.log(`  index     ${paths.dbFile}`);
    console.log(`\n${C.green}ready${C.reset}\n`);
  },

  async generate(args) {
    const db = openDb();
    const { activate } = require("../src/dev-ingestor");
    const ingestor = activate(db);

    banner("Generating development assets");
    const opts = {
      type: args.flags.type,
      category: args.flags.category,
      limit: args.flags.limit ? Number(args.flags.limit) : 0,
      thumbnails: args.flags.thumbnails !== false,
      query: args._[1] || "",
    };

    const adapter = ingestor.registry.adapterFor("synthetic");
    const total = (await adapter.search(opts.query, opts)).length;
    console.log(`  ${total} assets to generate${opts.thumbnails ? "" : " (thumbnails off)"}\n`);

    let last = 0;
    const started = Date.now();
    const stats = await ingestor.generate({
      ...opts,
      onProgress: (s) => {
        const done = s.generated + s.duplicates;
        if (done - last >= 25) {
          last = done;
          process.stdout.write(`\r  ${progressBar(done, total)} ${done}/${total}   `);
        }
      },
    });

    process.stdout.write(`\r  ${progressBar(total, total)} ${total}/${total}   \n`);
    db.save();

    console.log(`\n  generated   ${C.green}${stats.generated}${C.reset}`);
    if (stats.duplicates) console.log(`  duplicates  ${stats.duplicates}`);
    if (stats.quarantined) console.log(`  ${C.red}quarantined ${stats.quarantined}${C.reset}`);
    console.log(`  size        ${bytes(stats.bytes)}`);
    console.log(`  elapsed     ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
    for (const [type, n] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${type.padEnd(14)} ${String(n).padStart(5)}`);
    }
    console.log();
  },

  async scan(args) {
    const db = openDb();
    banner("Scanning library");

    const target = args._[1] ? path.resolve(args._[1]) : null;
    const roots = target ? [target] : [paths.library, paths.developmentLibrary];
    for (const r of roots) console.log(`  ${C.dim}${r}${C.reset}`);
    console.log();

    const stats = scanLibrary(db, {
      roots,
      thumbnails: args.flags.thumbnails !== false,
      prune: !target,
      developmentOnly: args.flags.dev ? true : undefined,
      onProgress: (s) => process.stdout.write(`\r  scanned ${s.scanned}  indexed ${s.indexed}   `),
    });

    process.stdout.write("\r" + " ".repeat(50) + "\r");
    db.save();

    console.log(`  scanned     ${stats.scanned}`);
    console.log(`  indexed     ${C.green}${stats.indexed}${C.reset}`);
    console.log(`  duplicates  ${stats.duplicates}`);
    console.log(`  skipped     ${stats.skipped}`);
    if (stats.pruned) console.log(`  pruned      ${stats.pruned} (file no longer on disk)`);
    if (stats.errors) console.log(`  ${C.red}errors      ${stats.errors}${C.reset}`);
    console.log(`  size        ${bytes(stats.bytes)}`);
    console.log(`  elapsed     ${(stats.elapsedMs / 1000).toFixed(1)}s`);

    if (Object.keys(stats.skippedReasons).length) {
      console.log(`\n  ${C.dim}skipped because:${C.reset}`);
      for (const [reason, n] of Object.entries(stats.skippedReasons)) {
        console.log(`    ${String(n).padStart(5)}  ${reason}`);
      }
    }
    console.log();
  },

  async rebuild(args) {
    const db = openDb();
    banner("Rebuilding index");
    const stats = rebuildIndex(db, { thumbnails: args.flags.thumbnails !== false });
    db.save();
    console.log(`  indexed ${C.green}${stats.indexed}${C.reset}, restored user data for ${stats.restored} records\n`);
  },

  async search(args) {
    const db = openDb();
    const query = args._.slice(1).join(" ");
    const limit = Number(args.flags.limit || 20);

    const result = db.query({
      text: query || undefined,
      type: args.flags.type,
      category: args.flags.category,
      developmentOnly: args.flags.dev ? true : args.flags.mine ? false : undefined,
      favorite: args.flags.favorite ? true : undefined,
      limit,
      sort: args.flags.sort || "name",
    });

    banner(`Search: ${query || "(all)"}`);
    console.log(`  ${result.total} match${result.total === 1 ? "" : "es"}, showing ${result.results.length}\n`);

    for (const a of result.results) {
      const badge = a.developmentOnly
        ? (a.syntheticFixture ? `${C.yellow}[FIXTURE]${C.reset}` : `${C.amber}[DEV]${C.reset}`)
        : `${C.green}[MINE]${C.reset}`;
      const dur = a.duration ? `${a.duration.toFixed(1)}s` : "";
      console.log(`  ${badge} ${C.bold}${a.name}${C.reset}`);
      console.log(`    ${C.dim}${a.type}/${a.category}${a.subcategory ? "/" + a.subcategory : ""}  ${bytes(a.bytes)} ${dur}  ${a.license || "no license"}${C.reset}`);
      console.log(`    ${C.dim}${a.tags.slice(0, 10).join(" ")}${C.reset}`);
    }
    console.log();
  },

  async stats() {
    const db = openDb();
    const s = db.stats();

    banner("Library");
    console.log(`  total assets    ${C.bold}${s.total}${C.reset}`);
    console.log(`  my library      ${C.green}${s.permanent}${C.reset}`);
    console.log(`  development     ${C.amber}${s.developmentOnly}${C.reset}`);
    console.log(`  favourites      ${s.favorites}`);
    console.log(`  collections     ${s.collections}`);
    if (s.quarantined) console.log(`  ${C.red}quarantined     ${s.quarantined}${C.reset}`);
    console.log(`  on disk         ${bytes(s.bytes)}`);

    console.log(`\n  ${C.dim}by type${C.reset}`);
    const entries = Object.entries(s.byType).sort((a, b) => b[1] - a[1]);
    const max = Math.max(...entries.map((e) => e[1]), 1);
    for (const [type, n] of entries) {
      const width = Math.round((n / max) * 30);
      console.log(`    ${type.padEnd(14)} ${String(n).padStart(5)}  ${C.amber}${"#".repeat(width)}${C.reset}`);
    }
    console.log();
  },

  async sources(args) {
    const db = openDb();
    const { activate } = require("../src/dev-ingestor");
    const ingestor = activate(db);

    banner("Development asset sources");
    const results = await ingestor.scanSources({ probe: Boolean(args.flags.probe) });

    for (const s of results) {
      const state = s.blocked ? `${C.red}blocked${C.reset}`
        : s.enabled ? `${C.green}enabled${C.reset}`
        : `${C.dim}disabled${C.reset}`;
      const reach = s.reachable === true ? ` ${C.green}reachable${C.reset}`
        : s.reachable === false ? ` ${C.red}unreachable${C.reset}` : "";

      console.log(`  ${C.bold}${s.name}${C.reset}  ${state}${reach}`);
      console.log(`    ${C.dim}${s.accessMethod} | ${s.automationAllowed ? "automation allowed" : "MANUAL ONLY"} | ${s.categories.join(", ")}${C.reset}`);
      console.log(`    ${C.dim}${s.classification.join("  ")}${C.reset}`);
      if (s.reason) console.log(`    ${C.yellow}${s.reason}${C.reset}`);
      if (s.probeError) console.log(`    ${C.red}${s.probeError}${C.reset}`);
      console.log();
    }
  },

  async discover(args) {
    const db = openDb();
    const { activate } = require("../src/dev-ingestor");
    const ingestor = activate(db);

    const query = args._.slice(1).join(" ");
    if (!query) return console.log("usage: sun discover <query> [--source id] [--limit n]");

    banner(`Discovering: ${query}`);
    const result = await ingestor.discover(query, {
      sources: args.flags.source ? [args.flags.source] : undefined,
      limit: Number(args.flags.limit || 10),
      mediaType: args.flags.media,
      category: args.flags.category,
    });

    console.log(`  searched: ${result.sourcesSearched.join(", ")}\n`);

    for (const r of result.found.slice(0, Number(args.flags.limit || 20))) {
      const badge = r._manualOnly ? `${C.yellow}[MANUAL]${C.reset}` : `${C.green}[AUTO]${C.reset}`;
      console.log(`  ${badge} ${C.bold}${r.title}${C.reset} ${C.dim}(${r._sourceId})${C.reset}`);
      console.log(`    ${C.dim}${r.spdx || r.license || "license unknown"}${r.author ? "  by " + r.author : ""}${C.reset}`);
      if (r._pageUrl) console.log(`    ${C.blue}${r._pageUrl}${C.reset}`);
    }

    if (result.errors.length) {
      console.log(`\n  ${C.yellow}sources that could not be searched${C.reset}`);
      for (const e of result.errors) {
        console.log(`    ${e.source}: ${e.error}`);
        if (e.pageUrl) console.log(`      ${C.blue}${e.pageUrl}${C.reset}`);
      }
    }
    console.log(`\n  ${result.found.length} results\n`);
  },

  async download(args) {
    const db = openDb();
    const { activate } = require("../src/dev-ingestor");
    const ingestor = activate(db);

    const query = args._.slice(1).join(" ");
    const limit = Number(args.flags.limit || 5);

    banner(`Downloading: ${query}`);
    const found = await ingestor.discover(query, {
      sources: args.flags.source ? [args.flags.source] : undefined,
      limit,
      mediaType: args.flags.media,
    });

    const auto = found.found.filter((r) => !r._manualOnly).slice(0, limit);
    if (!auto.length) {
      console.log(`  ${C.yellow}nothing available for automated download.${C.reset}`);
      for (const e of found.errors) console.log(`    ${e.source}: ${e.error}`);
      return;
    }

    ingestor.queue.on("job", (j) => {
      const mark = j.status === "done" ? `${C.green}ok${C.reset}`
        : j.status === "failed" ? `${C.red}fail${C.reset}`
        : j.status === "manual-required" ? `${C.yellow}manual${C.reset}`
        : j.status === "skipped" ? `${C.dim}skip${C.reset}` : `${C.dim}...${C.reset}`;
      if (["done", "failed", "skipped", "manual-required"].includes(j.status)) {
        console.log(`  ${mark}  ${j.title}${j.error ? ` ${C.dim}(${j.error})${C.reset}` : ""}`);
      }
    });

    const summary = await ingestor.download(auto, {});
    db.save();

    console.log(`\n  done ${C.green}${summary.done}${C.reset}, skipped ${summary.skipped}, failed ${C.red}${summary.failed}${C.reset}, manual ${C.yellow}${summary["manual-required"]}${C.reset}\n`);

    const manual = ingestor.queue.manualWorklist();
    if (manual.length) {
      console.log(`  ${C.yellow}download these yourself, then run: sun import <path>${C.reset}`);
      for (const m of manual) console.log(`    ${m.title}  ${C.blue}${m.pageUrl}${C.reset}`);
      console.log();
    }
  },

  async import(args) {
    const db = openDb();
    const target = args._[1];
    if (!target) return console.log("usage: sun import <file|folder|zip>");

    banner(`Importing ${target}`);
    const result = importPath(db, path.resolve(target), {
      developmentOnly: Boolean(args.flags.dev),
      source: args.flags.source || "user-import",
      copy: args.flags.copy !== false,
    });
    db.save();

    if (result.ok === false) {
      console.log(`  ${C.red}${result.error || (result.reasons || []).join("; ")}${C.reset}\n`);
      if (result.quarantinePath) console.log(`  quarantined at ${result.quarantinePath}\n`);
      return;
    }

    console.log(`  imported    ${C.green}${result.imported != null ? result.imported : (result.asset ? 1 : 0)}${C.reset}`);
    if (result.duplicates) console.log(`  duplicates  ${result.duplicates}`);
    if (result.skipped) console.log(`  skipped     ${result.skipped}`);
    if (result.quarantined) console.log(`  ${C.red}quarantined ${result.quarantined}${C.reset}`);
    console.log();
  },

  async export(args) {
    const db = openDb();
    const target = args._[1] || path.join(paths.root, "sun-library-export.json");
    banner("Exporting library metadata");
    const result = writeExport(db, path.resolve(target), {
      developmentOnly: args.flags.dev ? true : args.flags.mine ? false : undefined,
    });
    console.log(`  ${result.assets} assets, ${result.favorites} favourites, ${result.collections} collections`);
    console.log(`  -> ${C.cyan}${result.path}${C.reset}\n`);
  },

  /** Stress-test the UI at scale without generating real media. */
  async stress(args) {
    const db = openDb();
    const count = Number(args.flags.count || 1000);

    banner(`Generating ${count} synthetic metadata records`);
    const { generateStressAssets } = require("../src/dev-ingestor/generator/stress");
    const stats = generateStressAssets(db, count);
    db.save();

    console.log(`  created ${C.green}${stats.created}${C.reset} records in ${(stats.elapsedMs / 1000).toFixed(2)}s`);
    console.log(`  ${C.dim}these have metadata only and no media file; use --real to generate files${C.reset}`);
    console.log(`  library now holds ${db.size} assets\n`);
  },

  async "purge-dev"(args) {
    const db = openDb();
    const stats = db.stats();

    banner("Purge development assets");
    console.log(`  this removes ${C.amber}${stats.developmentOnly}${C.reset} development assets and their files`);
    console.log(`  ${C.green}${stats.permanent}${C.reset} assets in your own library are untouched\n`);

    if (!args.flags.yes) {
      console.log(`  ${C.yellow}re-run with --yes to confirm${C.reset}\n`);
      return;
    }

    const result = purgeDevelopmentAssets(db, {
      deleteFiles: true,
      keepFavorites: Boolean(args.flags["keep-favorites"]),
    });
    db.save();
    console.log(`  removed ${result.removed} assets, freed ${bytes(result.bytesFreed)}\n`);
  },

  async help() {
    console.log(`
${C.amber}${C.bold}  SUN PLUGIN${C.reset} ${C.dim}development CLI${C.reset}

  ${C.bold}library${C.reset}
    init                        create the library folder structure
    scan [path]                 index a folder tree (defaults to both libraries)
    rebuild                     rebuild the index, preserving user data
    search <query>              search the local index
    stats                       library summary
    import <path>               import a file, folder or zip
    export [file.json]          export metadata only

  ${C.bold}development assets${C.reset} ${C.dim}(removable subsystem)${C.reset}
    sources [--probe]           list sources and their automation status
    discover <query>            search enabled online sources
    download <query>            discover and download what is permitted
    generate [--type t]         generate the local asset corpus
    stress --count 5000         bulk metadata records for UI stress testing
    purge-dev --yes             delete every development asset

  ${C.bold}flags${C.reset}
    --type --category --limit --source --sort
    --dev --mine --favorite --no-thumbnails --yes
`);
  },
};

/* ------------------------------------------------------------------ main */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "help";
  const fn = commands[command];

  if (!fn) {
    console.log(`${C.red}unknown command: ${command}${C.reset}`);
    await commands.help();
    process.exit(1);
  }

  try {
    await fn(args);
  } catch (e) {
    console.error(`\n${C.red}${e.message}${C.reset}`);
    if (process.env.SUN_DEBUG) console.error(e.stack);
    process.exit(1);
  }
}

main();
