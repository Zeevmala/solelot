#!/usr/bin/env bash
# The gate. The factory runs the default branch's copy of this file after every
# build, on a runner with a read-only token. Exit non-zero to fail the run.
# Run it as: bash .factory/check.sh
# Static site, no package.json: every check is plain Node (22+) or headless
# Chrome on local files. No network. Never run scraper.js here (it calls the
# MAI API and rewrites locations.json).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== 1. JavaScript parses"
for f in *.js cartowolf/*.mjs; do
  node --check "$f"
done

echo "== 2. JSON parses"
json="locations.json manifest.json facilities.json data_overrides.json"
[ -f data_meta.json ] && json="$json data_meta.json"
for f in test-fixtures/*.json; do
  [ -f "$f" ] && json="$json $f"
done
for f in $json; do
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$f" \
    || { echo "FAIL: $f is not valid JSON"; exit 1; }
done
echo "ok: $json"

echo "== 3. Scraper tests"
node --test test-scraper.js

echo "== 4. Data quality"
node validate_data.js

echo "== 5. Colours come from the design system"
node cartowolf/check-colors.mjs style.css app.js index.html

echo "== 6. Service worker, manifest and page agree with the files on disk"
node - <<'NODE'
const fs = require('fs');
const fail = [];
const sw = fs.readFileSync('sw.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

// 6a. every local precache path exists (one missing critical file fails the install)
const precache = [...sw.matchAll(/^\s*'(\.\/[^']*|https:\/\/[^']+)',?\s*$/gm)].map(m => m[1]);
if (precache.length < 10) fail.push(`only ${precache.length} precache entries parsed from sw.js (list format changed?)`);
const local = precache.filter(p => p.startsWith('./'));
for (const p of local) {
  const file = p === './' ? 'index.html' : p.slice(2);
  if (!fs.existsSync(file)) fail.push(`sw.js precaches ${p} but ${file} does not exist`);
}

// 6b. everything index.html loads is precached, so the page works offline
const refs = [...html.matchAll(/<(?:link|script)\b[^>]*?\b(?:href|src)="([^"]+)"[^>]*>/g)]
  .filter(m => !/rel="(?:canonical|preconnect|prefetch|apple-touch-icon|icon)"/.test(m[0]))
  .map(m => m[1]);
for (const r of refs) {
  const key = /^https:/.test(r) ? r : './' + r;
  if (!precache.includes(key)) fail.push(`index.html loads ${r} but sw.js does not precache it`);
}
for (const m of fs.readFileSync('cartowolf/fonts.css', 'utf8').matchAll(/url\("([^"]+)"\)/g)) {
  if (!precache.includes('./cartowolf/' + m[1])) fail.push(`fonts.css uses ${m[1]} but sw.js does not precache it`);
}

// 6c. the site is served from /solelot/, so no path may start at the domain root
const rootPath = v => typeof v === 'string' && v.startsWith('/');
const urls = [manifest.start_url, manifest.scope, ...manifest.icons.map(i => i.src),
  ...(manifest.shortcuts || []).flatMap(s => [s.url, ...(s.icons || []).map(i => i.src)])];
for (const u of urls) if (rootPath(u)) fail.push(`manifest.json has a root-absolute path: ${u}`);
for (const m of html.matchAll(/\b(?:href|src)="(\/[^"]*)"/g)) fail.push(`index.html has a root-absolute path: ${m[1]}`);
if (/register\(\s*['"]\//.test(fs.readFileSync('app.js', 'utf8'))) fail.push('app.js registers the service worker with a root-absolute path');

// 6d. manifest icons exist and are the size they claim (PNG IHDR width/height)
for (const icon of manifest.icons) {
  if (!fs.existsSync(icon.src)) { fail.push(`manifest icon missing: ${icon.src}`); continue; }
  const b = fs.readFileSync(icon.src);
  const size = `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
  if (size !== icon.sizes) fail.push(`${icon.src} is ${size}, manifest says ${icon.sizes}`);
}

// 6e. social image and local icons named in <head> exist
for (const m of html.matchAll(/content="https:\/\/zeevmala\.github\.io\/solelot\/([^"]+)"/g)) {
  if (!fs.existsSync(m[1])) fail.push(`index.html meta points at missing file: ${m[1]}`);
}
for (const m of html.matchAll(/rel="(?:apple-touch-icon|icon|manifest)"[^>]*href="([^"]+)"/g)) {
  if (!fs.existsSync(m[1])) fail.push(`index.html links missing file: ${m[1]}`);
}

if (fail.length) { console.error(fail.map(f => 'FAIL: ' + f).join('\n')); process.exit(1); }
console.log(`ok: ${precache.length} precache entries (${local.length} local), ${refs.length} page assets, ${manifest.icons.length} icons`);
NODE

echo "== 7. Browser test pages (headless Chrome, local files only)"
chrome=""
for c in "${CHROME_BIN:-}" google-chrome google-chrome-stable chromium chromium-browser /opt/pw-browsers/chromium*/chrome-linux/chrome; do
  [ -n "$c" ] || continue
  if command -v "$c" >/dev/null 2>&1; then chrome=$(command -v "$c"); break; fi
done
if [ -z "$chrome" ]; then
  echo "FAIL: no Chrome or Chromium found, so test.html and test-map.html cannot run."
  echo "      Install one, or set CHROME_BIN to the path of the browser binary."
  exit 1
fi
echo "browser: $chrome"
profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT
for page in test.html test-map.html; do
  line=$("$chrome" --headless --no-sandbox --disable-gpu --allow-file-access-from-files \
      --user-data-dir="$profile" --virtual-time-budget=10000 --dump-dom "file://$PWD/$page" 2>/dev/null \
    | grep -oE '[0-9]+ passed, [0-9]+ failed out of [0-9]+ tests' | head -n 1 || true)
  if [[ "$line" =~ ^([0-9]+)\ passed,\ 0\ failed\ out\ of\ ([0-9]+)\ tests$ ]] \
      && [ "${BASH_REMATCH[1]}" -gt 0 ] && [ "${BASH_REMATCH[1]}" = "${BASH_REMATCH[2]}" ]; then
    echo "ok: $page: $line"
  else
    echo "FAIL: $page: expected 'N passed, 0 failed out of N tests' with N > 0, got: '${line:-no summary line (the page did not finish)}'"
    exit 1
  fi
done

echo "== 8. Functions copied into the test pages equal the ones in app.js"
node - <<'NODE'
// The test pages test copies of app.js functions. A copy that drifts keeps the
// page green while the app is broken, so every top-level function with the same
// name in app.js and in a test page must have the same source text. The base
// indent is ignored (the copies sit indented inside <script>). A helper that
// exists only in a test page is not compared.
const fs = require('fs');

// Top-level function declarations of a script: name -> source text.
function topLevelFunctions(src, label) {
  const out = new Map();
  const templates = [];           // brace depth at each open `${`
  let depth = 0, parens = 0, i = 0, last = '';
  let pending = null, open = null; // a declaration waiting for its body / inside its body
  const regexMayStart = () => last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || /(?:return|typeof|case|in|of|void|delete)$/.test(src.slice(Math.max(0, i - 10), i).trimEnd());
  const skipString = q => { for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++; i++; };
  const skipTemplate = () => {     // from just after ` or after the } that closes ${...}
    for (; i < src.length; i++) {
      if (src[i] === '\\') i++;
      else if (src[i] === '`') { i++; return; }
      else if (src[i] === '$' && src[i + 1] === '{') { templates.push(depth); depth++; i += 2; return; }
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 2; continue; }
    if (c === '"' || c === "'") { skipString(c); last = c; continue; }
    if (c === '`') { i++; skipTemplate(); last = '`'; continue; }
    if (c === '/' && regexMayStart()) {
      let inClass = false;
      for (i++; i < src.length && (inClass || src[i] !== '/'); i++) {
        if (src[i] === '\\') i++; else if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false;
      }
      i++; last = '/'; continue;
    }
    if (depth === 0 && !open && !pending && /[af]/.test(c) && !/[\w$.]/.test(src[i - 1] || '')) {
      const m = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(src.slice(i, i + 200));
      if (m && /(^|\n)[ \t]*$/.test(src.slice(Math.max(0, i - 200), i))) pending = { name: m[1], start: i };
    }
    if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (c === '{') {
      if (pending && depth === 0 && parens === 0) { open = pending; pending = null; }
      depth++;
    } else if (c === '}') {
      depth--;
      if (templates.length && templates[templates.length - 1] === depth) { templates.pop(); i++; skipTemplate(); last = '`'; continue; }
      if (open && depth === 0) {
        const lineStart = src.lastIndexOf('\n', open.start) + 1;
        const indent = src.slice(lineStart, open.start);
        const text = src.slice(open.start, i + 1).split('\n').map(l => l.startsWith(indent) ? l.slice(indent.length) : l).join('\n').replace(/\r/g, '');
        if (out.has(open.name)) throw new Error(`${label}: function ${open.name} is declared twice at top level`);
        out.set(open.name, text);
        open = null;
      }
    }
    if (!/\s/.test(c)) last = c;
    i++;
  }
  if (depth !== 0 || parens !== 0 || open || pending) throw new Error(`${label}: could not match braces (depth ${depth}, parens ${parens}); the drift check cannot read this file`);
  return out;
}

const app = topLevelFunctions(fs.readFileSync('app.js', 'utf8'), 'app.js');
const fail = [];
let compared = 0;
for (const page of ['test.html', 'test-map.html']) {
  const html = fs.readFileSync(page, 'utf8');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!inline.length) fail.push(`${page}: no inline <script> found`);
  inline.forEach((code, n) => {
    for (const [name, copy] of topLevelFunctions(code, `${page} script ${n + 1}`)) {
      if (!app.has(name)) continue;
      compared++;
      const a = app.get(name).split('\n'), b = copy.split('\n');
      if (a.join('\n') === b.join('\n')) continue;
      let k = 0;
      while (k < a.length && k < b.length && a[k] === b[k]) k++;
      fail.push(`${page}: ${name}() differs from app.js at line ${k + 1} of the function\n        app.js: ${(a[k] ?? '(function ends)').trim()}\n        ${page}: ${(b[k] ?? '(function ends)').trim()}`);
    }
  });
}
if (!compared && !fail.length) fail.push('no function in the test pages has the same name as one in app.js; nothing was compared');
if (fail.length) { console.error(fail.map(f => 'FAIL: ' + f).join('\n')); process.exit(1); }
console.log(`ok: ${compared} copied functions equal app.js (${app.size} top-level functions in app.js)`);
NODE

echo "== 9. STATIC_CACHE is bumped when a cached file changes"
base=""
for ref in "$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null || true)" origin/master origin/main; do
  [ -n "$ref" ] && [ "$ref" != "origin/HEAD" ] || continue
  if git rev-parse --verify -q "$ref^{commit}" >/dev/null; then base=$ref; break; fi
done
if [ -z "$base" ]; then
  echo "FAIL: no origin/HEAD, origin/master or origin/main to compare with. Fetch the default branch first."
  exit 1
fi
# The files the service worker precaches (read from sw.js), plus sw.js itself.
# locations.json is left out: the worker fetches it network-first.
cached=$(node -e '
  const sw = require("fs").readFileSync("sw.js", "utf8");
  const paths = [...sw.matchAll(/^\s*\x27\.\/([^\x27]*)\x27,?\s*$/gm)].map(m => m[1] || "index.html");
  console.log([...new Set(["sw.js", ...paths])].filter(p => p !== "locations.json").join("\n"));')
changed=$(printf '%s\n' "$cached" | tr '\n' '\0' | xargs -0 git diff --name-only "$base" --)
if [ -n "$changed" ]; then
  if ! git diff "$base" -- sw.js | grep -qE '^\+const STATIC_CACHE = '; then
    echo "FAIL: files the service worker caches changed since $base, but STATIC_CACHE in sw.js did not:"
    printf '%s\n' "$changed" | sed 's/^/      /'
    exit 1
  fi
  echo "ok: cached files changed and STATIC_CACHE changed (compared with $base)"
else
  echo "ok: no cached file changed (compared with $base)"
fi

echo "GATE PASSED"
