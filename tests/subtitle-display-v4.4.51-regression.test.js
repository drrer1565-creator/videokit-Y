const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('T-subtitle basic text controls expose an optional highlight switch', () => {
  const html = read('src/index.html');
  const batch = read('src/batch-reels.js');
  const renderer = read('src/reels-canvas-renderer.js');

  assert.match(html, /id="reels-highlight-enabled" checked/);
  assert.match(batch, /highlight_enabled: chk\('reels-highlight-enabled'\)/);
  assert.match(batch, /setChk\('reels-highlight-enabled', style\.highlight_enabled !== false\)/);
  assert.match(renderer, /if \(s\.highlight_enabled === false\)/);
  assert.match(renderer, /s\.color_high = s\.color_text \|\| '#FFFFFF'/);
});

test('connected-fit box reuses existing box settings and adds only concave radius', () => {
  const html = read('src/index.html');
  const batch = read('src/batch-reels.js');

  assert.match(html, /id="reels-box-connected-fit"/);
  assert.match(html, /<span>连体贴合<\/span>/);
  assert.match(html, /id="reels-box-concave-radius"/);
  assert.match(html, /id="reels-box-opacity"/);
  assert.match(html, /id="reels-box-radius"/);
  assert.match(html, /id="reels-box-blur"/);
  assert.match(html, /id="reels-box-pad-x"/);
  assert.match(html, /id="reels-box-pad-y"/);

  assert.match(batch, /box_connected_fit: chk\('reels-box-connected-fit'\)/);
  assert.match(batch, /box_concave_radius: num\('reels-box-concave-radius', num\('reels-box-radius', 8\)\)/);
  assert.match(batch, /setChk\('reels-box-adaptive-width', !!style\.box_adaptive_width && !style\.box_connected_fit\)/);
  assert.match(batch, /reelsSetBoxFitMode\('connected', !!style\.box_connected_fit, false\)/);
});

test('connected-fit geometry joins line boxes and creates rounded concave corners', () => {
  const { buildConnectedSubtitleBoxGeometry } = require(path.join(root, 'src', 'reels-canvas-renderer.js'));
  assert.equal(typeof buildConnectedSubtitleBoxGeometry, 'function');

  const geometry = buildConnectedSubtitleBoxGeometry([
    { left: 0, top: 0, right: 300, bottom: 60 },
    { left: 80, top: 80, right: 220, bottom: 140 },
  ], 28, 24);

  assert.equal(geometry.rects.length, 2);
  assert.equal(geometry.rects[0].bottom, 70);
  assert.equal(geometry.rects[1].top, 70);
  assert.ok(geometry.points.length >= 8);

  const concave = geometry.corners.filter(c => c.concave);
  assert.ok(concave.length >= 2, 'wide-to-narrow transition should contain inward corners');
  assert.ok(concave.some(c => Math.abs(c.radius - 24) < 0.001), 'inner radius should control the inward arc');
  const convex = geometry.corners.filter(c => !c.concave && c.radius > 0);
  assert.ok(convex.some(c => Math.abs(c.radius - 28) < 0.001), 'outer radius should remain independently adjustable');
});

test('connected-fit stays on the stable standard-fill renderer path', () => {
  const renderer = read('src/reels-canvas-renderer.js');
  assert.match(renderer, /const isConnected = !!s\.box_connected_fit && !advEnabled/);
  assert.match(renderer, /const isAdaptive = \(!!s\.box_adaptive_width \|\| isConnected\) && !advEnabled/);
  assert.match(renderer, /const isBrush = !isConnected && brushEngine/);
  assert.match(renderer, /Math\.max\([\s\S]*Number\(finalLineWidths\[i\]\)/);
});
