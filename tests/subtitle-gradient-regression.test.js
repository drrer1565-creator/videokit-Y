const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('normal T-subtitles use one shared gradient across the whole sentence', () => {
  const src = read('src/reels-canvas-renderer.js');

  assert.match(src, /_createTextGradient\(ctx, fillColor, direction = 'horizontal', bounds = null\)/);
  assert.match(src, /const sharedGradientBounds = \{/);
  assert.match(src, /const sharedTextGradient = this\._createTextGradient/);
  assert.match(src, /const sharedHighGradient = this\._createTextGradient/);
  assert.match(src, /sharedGradient = null\)/);
  assert.match(src, /if \(sharedGradient\) \{\s*ctx\.fillStyle = sharedGradient;/);

  // Keep old per-word gradient only as fallback for special renderers.
  assert.match(src, /else if \(typeof fillColor === 'string' && fillColor\.includes\(','\)\)/);
});
