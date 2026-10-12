const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { buildConnectedSubtitleBoxGeometry } = require(path.join(root, 'src', 'reels-canvas-renderer.js'));

test('near-equal connected rows snap both left and right edges to the widest row', () => {
  const geometry = buildConnectedSubtitleBoxGeometry([
    { left: 0, top: 0, right: 300, bottom: 60 },
    { left: 7, top: 80, right: 293, bottom: 140 },
  ], 28, 18);

  assert.equal(geometry.rects[0].left, 0);
  assert.equal(geometry.rects[0].right, 300);
  assert.equal(geometry.rects[1].left, 0);
  assert.equal(geometry.rects[1].right, 300);
  assert.equal(geometry.rects[0].bottom, 70);
  assert.equal(geometry.rects[1].top, 70);
});

test('near-equal snapping groups consecutive rows but preserves a clearly narrower row', () => {
  const geometry = buildConnectedSubtitleBoxGeometry([
    { left: 0, top: 0, right: 300, bottom: 60 },
    { left: 6, top: 80, right: 294, bottom: 140 },
    { left: 14, top: 160, right: 286, bottom: 220 },
    { left: 70, top: 240, right: 230, bottom: 300 },
  ], 28, 18);

  for (let i = 0; i < 3; i++) {
    assert.equal(geometry.rects[i].left, 0);
    assert.equal(geometry.rects[i].right, 300);
  }
  assert.equal(geometry.rects[3].left, 70);
  assert.equal(geometry.rects[3].right, 230);
});

test('snap decision follows the live inward radius threshold', () => {
  const rows = [
    { left: 0, top: 0, right: 300, bottom: 60 },
    { left: 7, top: 80, right: 293, bottom: 140 },
  ];

  const smallRadius = buildConnectedSubtitleBoxGeometry(rows, 28, 4);
  assert.equal(smallRadius.rects[1].left, 7);
  assert.equal(smallRadius.rects[1].right, 293);

  const largerRadius = buildConnectedSubtitleBoxGeometry(rows, 28, 8);
  assert.equal(largerRadius.rects[1].left, 0);
  assert.equal(largerRadius.rects[1].right, 300);
});

test('snapping never shrinks the widest row in a near-equal group', () => {
  const geometry = buildConnectedSubtitleBoxGeometry([
    { left: 10, top: 0, right: 290, bottom: 60 },
    { left: 0, top: 80, right: 300, bottom: 140 },
    { left: 8, top: 160, right: 292, bottom: 220 },
  ], 28, 18);

  for (const rect of geometry.rects) {
    assert.equal(rect.left, 0);
    assert.equal(rect.right, 300);
  }
});
