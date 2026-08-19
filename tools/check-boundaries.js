#!/usr/bin/env node
"use strict";
/**
 * Architectural boundary check.
 *
 * Enforces the one rule the whole design rests on:
 *
 *   src/core/ and src/adapters/ must NEVER reference src/dev-ingestor/
 *
 * Without this the removability of the development subsystem is an intention
 * rather than a fact, and intentions rot. Run as part of `npm test`.
 *
 * Also verifies that every domain an enabled source needs is declared in
 * manifest.json, because UXP blocks any fetch to an undeclared domain and the
 * resulting error gives no hint about the cause.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ESC = String.fromCharCode(27);
const RED = ESC + "[31m";
const GREEN = ESC + "[32m";
const YELLOW = ESC + "[33m";
const DIM = ESC + "[2m";
const RESET = ESC + "[0m";

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(js|mjs|cjs|jsx|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const failures = [];
const warnings = [];

/* ------------------------------------------- rule 1: no core -> ingestor */

const PROTECTED = [
  path.join(ROOT, "src", "core"),
  path.join(ROOT, "src", "adapters"),
];

const FORBIDDEN = /["'`](?:[^"'`\n]*\/)?dev-ingestor(?:\/[^"'`\n]*)?["'`]/;

let checked = 0;
for (const dir of PROTECTED) {
  for (const file of walk(dir)) {
    checked++;
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);

    lines.forEach((line, i) => {
      // Only flag real references, not the many comments explaining the rule.
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
      if (FORBIDDEN.test(line)) {
        failures.push({
          rule: "core-independence",
          file: path.relative(ROOT, file),
          line: i + 1,
          text: trimmed,
        });
      }
    });
  }
}

/* --------------------------------- rule 2: manifest declares every domain */

const manifestPath = path.join(ROOT, "manifest.json");
const sourcesPath = path.join(ROOT, "config", "development-sources.json");

if (fs.existsSync(manifestPath) && fs.existsSync(sourcesPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const sources = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));

  const declared = new Set(
    (manifest.requiredPermissions
      && manifest.requiredPermissions.network
      && manifest.requiredPermissions.network.domains) || []
  );

  for (const source of sources.sources || []) {
    if (!source.enabled) continue;
    for (const domain of source.domains || []) {
      if (!declared.has(domain)) {
        warnings.push(
          `source "${source.id}" needs ${domain}, which is not in manifest.json requiredPermissions.network.domains`
        );
      }
    }
  }

  // The reverse: a domain in the manifest with no enabled source behind it is
  // an over-broad permission request.
  const needed = new Set();
  for (const source of sources.sources || []) {
    if (!source.enabled) continue;
    for (const d of source.domains || []) needed.add(d);
  }
  for (const d of declared) {
    if (!needed.has(d)) warnings.push(`manifest.json declares ${d} but no enabled source uses it`);
  }
}

/* ------------------------------- rule 3: the ingestor is actually optional */

const ingestorDir = path.join(ROOT, "src", "dev-ingestor");
if (fs.existsSync(ingestorDir)) {
  const bootstrap = path.join(ROOT, "src", "index.js");
  if (fs.existsSync(bootstrap)) {
    const text = fs.readFileSync(bootstrap, "utf8");
    // The bootstrap is the one place allowed to reference the ingestor, and it
    // must do so defensively.
    if (text.includes("dev-ingestor") && !/tryLoad|try\s*{/.test(text)) {
      failures.push({
        rule: "optional-load",
        file: "src/index.js",
        line: 0,
        text: "references dev-ingestor without a guarded/optional load",
      });
    }
  }
}

/* ------------------------------------------------------------------ report */

console.log(`${DIM}checked ${checked} files under src/core and src/adapters${RESET}`);

if (warnings.length) {
  console.log(`\n${YELLOW}warnings (${warnings.length})${RESET}`);
  for (const w of warnings) console.log(`  ${YELLOW}!${RESET} ${w}`);
}

if (failures.length) {
  console.log(`\n${RED}BOUNDARY VIOLATIONS (${failures.length})${RESET}`);
  for (const f of failures) {
    console.log(`  ${RED}x${RESET} [${f.rule}] ${f.file}:${f.line}`);
    console.log(`      ${DIM}${f.text}${RESET}`);
  }
  console.log(`\n${RED}The core must not depend on the development ingestor.${RESET}`);
  console.log(`${DIM}Deleting src/dev-ingestor/ has to leave a working plugin.${RESET}\n`);
  process.exit(1);
}

console.log(`${GREEN}OK${RESET} core is independent of the development ingestor`);
if (!warnings.length) console.log(`${GREEN}OK${RESET} manifest domains match the enabled sources`);
process.exit(0);
