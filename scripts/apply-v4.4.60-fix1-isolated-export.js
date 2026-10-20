const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const HOTFIX_VERSION = '4.4.60-fix1';

const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n?/g, '\n');
const write = (rel, content) => fs.writeFileSync(path.join(root, rel), content.replace(/\r\n?/g, '\n'), 'utf8');

function syncLockfileVersion() {
  const pkg = JSON.parse(read('package.json'));
  if (pkg.version !== HOTFIX_VERSION) {
    throw new Error(`v4.4.60-fix1: package.json version must be ${HOTFIX_VERSION}, got ${pkg.version}`);
  }

  const lock = JSON.parse(read('package-lock.json'));
  let changed = false;
  if (lock.version !== pkg.version) {
    lock.version = pkg.version;
    changed = true;
  }
  if (lock.packages?.[''] && lock.packages[''].version !== pkg.version) {
    lock.packages[''].version = pkg.version;
    changed = true;
  }
  if (changed) write('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
}

function syncAboutVersion() {
  const rel = 'src/index.html';
  let src = read(rel);
  const re = /(id="app-version-display">)v[^<]+(<\/span>)/;
  if (!re.test(src)) throw new Error('v4.4.60-fix1: app-version-display marker missing');
  src = src.replace(re, `$1v${HOTFIX_VERSION}$2`);
  write(rel, src);
}

function findIsolatedScriptList(src) {
  const endMarker = '].map(name => path.join(scriptBase, name));';
  let cursor = 0;
  while (true) {
    const start = src.indexOf('const scriptPaths = [', cursor);
    if (start < 0) break;
    const end = src.indexOf(endMarker, start);
    if (end < 0) break;
    const list = src.slice(start, end);
    if (list.includes("'reels-canvas-renderer.js'") && list.includes("'reels-wysiwyg-export.js'")) {
      return { start, end, list };
    }
    cursor = end + endMarker.length;
  }
  throw new Error('v4.4.60-fix1: isolated renderer script list missing');
}

function patchIsolatedRendererScripts() {
  const rel = 'electron/main.js';
  let src = read(rel);
  const found = findIsolatedScriptList(src);

  if (!found.list.includes("'reels-speech-writing.js'")) {
    const marker = "            'reels-canvas-renderer.js',\n            'reels-overlay.js',";
    if (!found.list.includes(marker)) {
      throw new Error('v4.4.60-fix1: renderer/export insertion point changed');
    }
    const replacement = "            'reels-canvas-renderer.js',\n            'reels-speech-writing.js',\n            'reels-overlay.js',";
    const patchedList = found.list.replace(marker, replacement);
    src = src.slice(0, found.start) + patchedList + src.slice(found.end);
    write(rel, src);
  }

  const verified = findIsolatedScriptList(read(rel)).list;
  const canvas = verified.indexOf("'reels-canvas-renderer.js'");
  const speech = verified.indexOf("'reels-speech-writing.js'");
  const exportEngine = verified.indexOf("'reels-wysiwyg-export.js'");
  if (!(canvas >= 0 && speech > canvas && exportEngine > speech)) {
    throw new Error('v4.4.60-fix1: speech-writing must load after canvas renderer and before WYSIWYG export');
  }
}

syncLockfileVersion();
syncAboutVersion();
patchIsolatedRendererScripts();
console.log('[4.4.60-fix1] isolated WYSIWYG export hotfix applied.');
