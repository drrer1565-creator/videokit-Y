const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n?/g, '\n');

function findIsolatedScriptList(src) {
  const endMarker = '].map(name => path.join(scriptBase, name));';
  let cursor = 0;
  while (true) {
    const start = src.indexOf('const scriptPaths = [', cursor);
    if (start < 0) break;
    const end = src.indexOf(endMarker, start);
    if (end < 0) break;
    const list = src.slice(start, end);
    if (list.includes("'reels-canvas-renderer.js'") && list.includes("'reels-wysiwyg-export.js'")) return list;
    cursor = end + endMarker.length;
  }
  return '';
}

test('isolated WYSIWYG renderer loads speech-writing before export engine', () => {
  const scripts = findIsolatedScriptList(read('electron/main.js'));
  assert.ok(scripts, 'isolated renderer script list missing');

  const canvas = scripts.indexOf("'reels-canvas-renderer.js'");
  const speech = scripts.indexOf("'reels-speech-writing.js'");
  const wysiwyg = scripts.indexOf("'reels-wysiwyg-export.js'");

  assert.ok(canvas >= 0, 'canvas renderer missing');
  assert.ok(speech > canvas, 'speech-writing must load after canvas renderer');
  assert.ok(wysiwyg > speech, 'speech-writing must load before WYSIWYG export');
  assert.equal((scripts.match(/'reels-speech-writing\.js'/g) || []).length, 1, 'speech-writing should load exactly once');
});

test('WYSIWYG export dependency is provided by speech-writing adapter', () => {
  const exportSource = read('src/reels-wysiwyg-export.js');
  const speechSource = read('src/reels-speech-writing.js');

  assert.match(exportSource, /getWritingVisualStyle\(params\.style\)/, 'export no longer uses expected writing style normalization');
  assert.match(speechSource, /function getWritingVisualStyle\(style\)/, 'writing style normalizer missing');
  assert.match(speechSource, /Object\.assign\(window,[\s\S]*getWritingVisualStyle/, 'writing style normalizer is not exposed to the renderer window');
});

test('hotfix build identity is internally consistent after preparation', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const html = read('src/index.html');

  assert.equal(pkg.version, '4.4.60-fix1');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.ok(html.includes(`id="app-version-display">v${pkg.version}</span>`));
});
