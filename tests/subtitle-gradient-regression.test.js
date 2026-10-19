const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('normal T-subtitles keep whole-line gradient as the upstream default', () => {
  const renderer = read('src/reels-canvas-renderer.js');
  const style = read('src/reels-style-engine.js');

  assert.match(style, /text_gradient_scope: 'line', \/\/ 'line' \(整句渐变\) \| 'word' \(每个单词独立渐变\)/);
  assert.match(renderer, /const activeGradBounds = \(s\.text_gradient_scope === 'word'\) \? wordGradBounds : lineGradBounds;/);
  assert.match(renderer, /const lineGradBounds = \{/);
  assert.match(renderer, /const wordGradBounds = \{/);
});

test('gradient range uses the original-author line/word dropdown and persists the selected scope', () => {
  const renderer = read('src/reels-canvas-renderer.js');
  const batch = read('src/batch-reels.js');
  const html = read('src/index.html');

  assert.match(html, /id="reels-text-gradient-scope"/);
  assert.match(html, /<option value="line" selected>整句渐变<\/option>/);
  assert.match(html, /<option value="word">每个单词独立渐变<\/option>/);
  assert.doesNotMatch(html, /id="reels-gradient-scope"/);
  assert.doesNotMatch(html, /reels-gradient-scope-sentence/);
  assert.doesNotMatch(html, /reels-gradient-scope-word/);

  assert.match(batch, /text_gradient_scope: val\('reels-text-gradient-scope'\) \|\| 'line'/);
  assert.match(batch, /set\('reels-text-gradient-scope', style\.text_gradient_scope === 'word' \? 'word' : 'line'\)/);
  assert.doesNotMatch(batch, /val\('reels-gradient-scope'\)/);
  assert.doesNotMatch(batch, /reelsSetGradientScope\(/);

  // Upstream uses the same gradient data for both modes; only the gradient
  // bounds change. line = one continuous gradient across the line, word =
  // restart the complete gradient independently inside each word.
  assert.match(renderer, /const activeGradBounds = \(s\.text_gradient_scope === 'word'\) \? wordGradBounds : lineGradBounds;/);
});

test('T-subtitle uppercase mode remains preset-safe and non-destructive under the upstream renderer', () => {
  const renderer = read('src/reels-canvas-renderer.js');
  const batch = read('src/batch-reels.js');
  const html = read('src/index.html');

  assert.match(html, /id="reels-uppercase"/);
  assert.match(batch, /uppercase: chk\('reels-uppercase'\)/);
  assert.match(batch, /setChk\('reels-uppercase', (?:!!)?style\.uppercase\)/);

  assert.match(renderer, /_applyTextTransform\(str, s\) \{/);
  assert.match(renderer, /if \(s\.uppercase === true \|\| String\(s\.text_transform \|\| ''\)\.toLowerCase\(\) === 'uppercase'\) \{/);
  assert.match(renderer, /return raw\.toUpperCase\(\);/);
});
