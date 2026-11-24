#!/usr/bin/env node
/**
 * Finds colours written by hand instead of taken from a token.
 *
 * Usage:
 *   node check-colors.mjs <file or folder>... [--allow <path fragment>]...
 *
 * Scans stylesheets, markup and scripts for hex, rgb(), hsl(), oklch() and
 * similar literals. Exits 1 and prints `file:line` for each one found.
 *
 * Not flagged: generated token files (any path containing "tokens."), paths
 * given with --allow, and any line carrying the marker `cw-allow-color` with
 * a reason, for the rare literal that has to stay (a third-party brand colour).
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EXTENSIONS = new Set([".css", ".scss", ".less", ".html", ".htm", ".svg", ".js", ".jsx", ".mjs", ".ts", ".tsx", ".vue", ".svelte"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".next", ".vite"]);
const STYLE_EXTENSIONS = new Set([".css", ".scss", ".less"]);
const FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[^)]*\d[^)]*\)/gi;
const HEX = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;

/**
 * @typedef {{ file: string, line: number, text: string, match: string }} Finding
 */

/**
 * Colour literals on one line.
 * @param {string} line
 * @param {boolean} isStyle whether the file is a stylesheet
 * @returns {string[]}
 */
export function literalsIn(line, isStyle) {
  if (line.includes("cw-allow-color")) return [];
  const trimmed = line.trim();
  if (!isStyle && (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"))) return [];
  const found = [];
  for (const match of line.matchAll(HEX)) {
    const digits = match[0].slice(1);
    // Compatibility: outside stylesheets a short all-digit run such as "#115" is far more often an issue number than a colour.
    if (!isStyle && digits.length <= 4 && /^\d+$/.test(digits)) continue;
    if (isStyle && /^\s*[.#][\w-]+[^{;]*\{?\s*$/.test(line) && !line.includes(":")) continue;
    found.push(match[0]);
  }
  for (const match of line.matchAll(FUNCTION)) {
    if (/var\(|calc\(/.test(match[0])) continue;
    if (/^color\(/i.test(match[0]) && !isStyle) continue;
    found.push(match[0]);
  }
  return found;
}

/**
 * Every file under the given paths that should be scanned.
 * @param {string[]} roots
 * @param {string[]} allow path fragments to leave out
 * @returns {string[]}
 */
export function filesUnder(roots, allow) {
  const out = [];
  const visit = (/** @type {string} */ target) => {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(path.basename(target))) return;
      for (const entry of fs.readdirSync(target).sort()) visit(path.join(target, entry));
      return;
    }
    const normal = target.split(path.sep).join("/");
    if (!EXTENSIONS.has(path.extname(target).toLowerCase())) return;
    if (/(^|\/)tokens\.[\w.]+$/.test(normal) || /\.tokens\.json$/.test(normal)) return;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(normal)) return;
    if (allow.some((fragment) => normal.includes(fragment))) return;
    out.push(target);
  };
  roots.forEach(visit);
  return out;
}

/**
 * Scan files for hand-written colours.
 * @param {string[]} roots
 * @param {string[]} [allow]
 * @returns {Finding[]}
 */
export function check(roots, allow = []) {
  /** @type {Finding[]} */
  const findings = [];
  for (const file of filesUnder(roots, allow)) {
    const isStyle = STYLE_EXTENSIONS.has(path.extname(file).toLowerCase());
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((text, index) => {
        for (const match of literalsIn(text, isStyle)) findings.push({ file, line: index + 1, text: text.trim(), match });
      });
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const allow = [];
  const roots = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--allow") allow.push(args[(i += 1)] ?? "");
    else roots.push(args[i]);
  }
  if (roots.length === 0) {
    console.error("Usage: node check-colors.mjs <file or folder>... [--allow <path fragment>]...");
    process.exit(2);
  }
  const findings = check(roots, allow);
  for (const finding of findings) console.log(`${finding.file}:${finding.line}: ${finding.match}  ${finding.text.slice(0, 100)}`);
  if (findings.length > 0) {
    console.error(`\n${findings.length} hand-written colour(s). Use a token (var(--cw-...)), or mark a deliberate exception with "cw-allow-color: <reason>".`);
    process.exit(1);
  }
  console.log("No hand-written colours.");
}
