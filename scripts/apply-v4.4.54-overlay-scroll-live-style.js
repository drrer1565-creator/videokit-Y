const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const overlayPanelPath = path.join(root, 'src', 'reels-overlay-panel.js');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function write(file, before, after) {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.54-overlay-scroll-live-style] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.54-overlay-scroll-live-style] no changes needed for ${path.relative(root, file)}`);
  }
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`overlay live-style patch marker missing: ${label}`);
  return source.replace(before, after);
}

function syntax(source, file) {
  new vm.Script(source, { filename: file });
}

let before = read(overlayPanelPath);
let src = before;

src = replaceOnce(
  src,
  `            'rop-scroll-font', 'rop-scroll-fontsize',\n            'rop-scroll-color', 'rop-scroll-bold', 'rop-scroll-weight',\n            'rop-scroll-align', 'rop-scroll-linespacing', 'rop-scroll-textw',\n`,
  `            'rop-scroll-font', 'rop-scroll-fontsize',\n            'rop-scroll-color', 'rop-scroll-bold', 'rop-scroll-weight',\n            // V4_4_54_SCROLL_STYLE_LIVE_SYNC\n            // These controls already participate in _syncToOverlay() and rendering,\n            // but were missing from the shared input/change listener list. Without\n            // listeners their values only became visible after another bound field\n            // (for example font size) happened to trigger a sync.\n            'rop-scroll-uppercase', 'rop-scroll-letterspacing',\n            'rop-scroll-align', 'rop-scroll-linespacing', 'rop-scroll-textw',\n`,
  'scroll body uppercase and letter-spacing listeners'
);

syntax(src, overlayPanelPath);
write(overlayPanelPath, before, src);

const required = [
  'V4_4_54_SCROLL_STYLE_LIVE_SYNC',
  "'rop-scroll-uppercase', 'rop-scroll-letterspacing'",
  "el.addEventListener('input', () => this._syncToOverlay())",
  "el.addEventListener('change', () => this._syncToOverlay())",
];
for (const marker of required) {
  if (!src.includes(marker)) throw new Error(`4.4.54 overlay live-style patch incomplete: ${marker}`);
}

console.log('[4.4.54-overlay-scroll-live-style] Scrolling overlay uppercase and letter spacing now preview immediately.');

// Keep the next batch-import performance patch in the existing predev/pretest/prebuild chain.
require('./apply-v4.4.55-batch-import-performance.js');
