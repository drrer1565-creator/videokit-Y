const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const LETTER_TYPES = [
  'char_rise',
  'char_elastic',
  'char_wave',
  'char_drop',
  'char_squash',
  'char_center_spread',
];

test('T-subtitle animation selector exposes all six new letter effects and shared controls', () => {
  const html = read('src/index.html');
  for (const type of LETTER_TYPES) {
    assert.match(html, new RegExp(`value="${type}"`));
  }
  assert.match(html, /id="reels-char-fx-strength"/);
  assert.match(html, /id="reels-char-fx-duration"/);
  assert.match(html, /id="reels-char-fx-stagger"/);
  assert.match(html, /data-anim-types="char_rise,char_elastic,char_wave,char_drop,char_squash,char_center_spread"/);
});

test('animation presets and custom letter parameters persist with subtitle styles', () => {
  const batch = read('src/batch-reels.js');
  for (const key of [
    'rise_up_chars',
    'elastic_pop_chars',
    'wave_chars',
    'drop_bounce_chars',
    'squash_pop_chars',
    'center_spread_chars',
  ]) {
    assert.match(batch, new RegExp(`${key}: \\{`));
  }
  assert.match(batch, /char_fx_strength: num\('reels-char-fx-strength', 1\.0\)/);
  assert.match(batch, /char_fx_duration: num\('reels-char-fx-duration', 0\.36\)/);
  assert.match(batch, /char_fx_stagger: num\('reels-char-fx-stagger', 0\.035\)/);
  assert.match(batch, /const charFxStagger = style\.char_fx_stagger \?\? 0\.035;/);
});

test('character effect engine returns safe transforms and settles to identity', () => {
  const anim = require(path.join(root, 'src', 'reels-anim-engine.js'));
  assert.equal(typeof anim.computeCharacterPresetTransform, 'function');

  const riseStart = anim.computeCharacterPresetTransform('char_rise', 0, 0, 0, 8, {
    strength: 1,
    duration: 0.36,
    stagger: 0.03,
  });
  assert.ok(riseStart.dy > 0);
  assert.equal(riseStart.opacity, 0);

  const waveBeforeTurn = anim.computeCharacterPresetTransform('char_wave', 0, 0, 5, 8, {
    strength: 1,
    duration: 0.36,
    stagger: 0.05,
  });
  assert.deepEqual(waveBeforeTurn, { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 });

  const centerStart = anim.computeCharacterPresetTransform('char_center_spread', 0, 0, 0, 7, {
    strength: 1,
    duration: 0.4,
    stagger: 0,
    targetCenterX: 100,
    sentenceCenterX: 500,
  });
  assert.ok(centerStart.dx > 0, 'left-side letters should begin toward sentence center');
  assert.equal(centerStart.opacity, 0);

  for (const type of LETTER_TYPES) {
    const done = anim.computeCharacterPresetTransform(type, 3, 0, 0, 8, {
      strength: 2,
      duration: 0.2,
      stagger: 0.01,
      targetCenterX: 120,
      sentenceCenterX: 500,
    });
    assert.deepEqual(done, { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 });
  }
});

test('canvas renderer applies character transforms without mutating subtitle text', () => {
  const renderer = read('src/reels-canvas-renderer.js');
  assert.match(renderer, /V4_4_49_CHARACTER_FX_RENDER/);
  assert.match(renderer, /charEngine\.computeCharacterPresetTransform\(/);
  assert.match(renderer, /characterFxCounter \+= Array\.from\(wordStr\)\.length;/);
  assert.match(renderer, /sharedGradient = null, charAnim = null/);
  assert.match(renderer, /this\._drawWord\(ctx, ch, charX, y, fillColor,/);
  assert.equal(renderer.includes('segment.text = segment.text.toUpperCase()'), false);
});
