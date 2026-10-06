const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('batch import uses numeric natural order', () => {
  const src = read('src/reels-batch-table.js');
  assert.ok(src.includes('function _naturalSortByName'));
  assert.ok(src.includes('files.sort(_naturalSortByName);'));
  assert.equal(
    src.includes("files.sort((a, b) => (a.name || '').localeCompare(b.name || ''));"),
    false,
    'lexicographic batch file sorting must not remain'
  );

  const names = ['1.mp3', '11.mp3', '2.mp3', '18.mp3', '3.mp3'];
  const sorted = names.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  assert.deepEqual(sorted, ['1.mp3', '2.mp3', '3.mp3', '11.mp3', '18.mp3']);
});

test('single media file can be dropped directly into a background cell', () => {
  const src = read('src/reels-batch-table.js');
  assert.ok(src.includes('V4_4_43_DIRECT_BG_DROP'));
  assert.ok(src.includes("await _assignSingleFile(idx, 'bg', file);"));
});

test('multi-background drop preserves the exact target row', () => {
  const src = read('src/reels-batch-table.js');
  assert.ok(src.includes('V4_4_43_MULTI_BG_TARGET_ROW'));
  assert.ok(src.includes('Number.isInteger(options?.targetIdx)'));
  assert.ok(src.includes('targetIdx: Number.isInteger(droppedRowIdx)'));
});

test('batch video thumbnails are static and hover keeps the original video source', () => {
  const src = read('src/reels-batch-table.js');
  const preload = read('electron/preload.js');
  assert.ok(src.includes('V4_4_45_STATIC_BATCH_VIDEO_THUMBS'));
  assert.ok(src.includes('_RBT_STATIC_THUMB_MAX_CONCURRENCY = 3'));
  assert.ok(src.includes('img.dataset.videoSrc = videoSrc'));
  assert.ok(src.includes('target.dataset.videoSrc'));
  assert.ok(src.includes('window.electronAPI?.localFiles?.getVideoThumbnail'));
  assert.ok(preload.includes("getVideoThumbnail: (filePath, size) => ipcRenderer.invoke('local:video-thumbnail', localMediaUrlToPath(filePath), size)"));
});

test('preset name dialog guards typing focus from global handlers', () => {
  const src = read('src/reels-overlay-panel.js');
  assert.ok(src.includes('V4_4_43_PRESET_NAME_FOCUS_GUARD'));
  assert.ok(src.includes("['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste']"));
  assert.ok(src.includes('requestAnimationFrame(focusNameInput)'));
});

test('package version is 4.4.44', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, '4.4.44');
});
