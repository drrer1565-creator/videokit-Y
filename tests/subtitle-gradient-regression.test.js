const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('normal T-subtitles keep whole-sentence gradient as the default', () => {
  const src = read('src/reels-canvas-renderer.js');

  assert.match(src, /_createTextGradient\(ctx, fillColor, direction = 'horizontal', bounds = null\)/);
  assert.match(src, /const sharedGradientBounds = \{/);
  assert.match(src, /const gradientScope = s\.text_gradient_scope === 'word' \? 'word' : 'sentence'/);
  assert.match(src, /const sharedTextGradient = gradientScope === 'sentence' \? this\._createTextGradient/);
  assert.match(src, /const sharedHighGradient = gradientScope === 'sentence' \? this\._createTextGradient/);
  assert.match(src, /sharedGradient = null\)/);
  assert.match(src, /if \(sharedGradient\) \{\s*ctx\.fillStyle = sharedGradient;/);
});

test('per-word gradient mode reuses the preserved per-word fallback', () => {
  const renderer = read('src/reels-canvas-renderer.js');
  const batch = read('src/batch-reels.js');
  const html = read('src/index.html');

  // No shared gradient is created in word mode, so _drawWord builds a fresh gradient
  // from each word's own x/width just like the pre-4.4.42 behavior.
  assert.match(renderer, /gradientScope === 'sentence' \? this\._createTextGradient[\s\S]*?: null;/);
  assert.match(renderer, /else if \(typeof fillColor === 'string' && fillColor\.includes\(','\)\)/);
  assert.match(renderer, /ctx\.createLinearGradient\(x, y, x \+ \(wordW \|\| fontSize \* 2\), y\)/);

  assert.match(batch, /text_gradient_scope: val\('reels-gradient-scope'\) \|\| 'sentence'/);
  assert.match(batch, /reelsSetGradientScope\(style\.text_gradient_scope \|\| 'sentence', false\)/);
  assert.match(html, /id="reels-gradient-scope" value="sentence"/);
  assert.match(html, /id="reels-gradient-scope-sentence"/);
  assert.match(html, /id="reels-gradient-scope-word"/);
});

test('T-subtitle uppercase mode is preset-safe and non-destructive', () => {
  const renderer = read('src/reels-canvas-renderer.js');
  const batch = read('src/batch-reels.js');
  const html = read('src/index.html');

  assert.match(html, /id="reels-uppercase"/);
  assert.match(batch, /uppercase: chk\('reels-uppercase'\)/);
  assert.match(batch, /setChk\('reels-uppercase', !!style\.uppercase\)/);

  // The original subtitle string remains untouched; layout and drawing use a
  // derived display string so switching the option off restores the source text.
  assert.match(renderer, /const segmentText = segment\.edited_text \|\| segment\.text \|\| '';/);
  assert.match(renderer, /const displaySegmentText = s\.uppercase \? segmentText\.toUpperCase\(\) : segmentText;/);
  assert.match(renderer, /const text = displaySegmentText;/);

  // Timed words are transformed on copies, preserving word timing metadata.
  assert.match(renderer, /return s\.uppercase \? word\.toUpperCase\(\) : word;/);
  assert.match(renderer, /word: s\.uppercase \? String\(w\.word \|\| ''\)\.toUpperCase\(\) : w\.word/);
  assert.match(renderer, /sourceWords\.map\(w => \(\{ \.\.\.w, word: String\(w\.word \|\| ''\)\.toUpperCase\(\) \}\)\)/);

  // ASS fallback honors the same style without altering saved source text.
  assert.match(renderer, /const shouldUppercase = segmentStyle\.uppercase !== undefined \? !!segmentStyle\.uppercase : !!s\.uppercase;/);
  assert.match(renderer, /const displayText = shouldUppercase \? sourceText\.toUpperCase\(\) : sourceText;/);
});
