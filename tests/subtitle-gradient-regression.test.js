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
  assert.match(renderer, /V4_4_48_GRADIENT_SCOPE_RENDER/);
  assert.match(renderer, /const gradientScope = s\.text_gradient_scope === 'word' \? 'word' : 'line';/);
  assert.match(renderer, /const sharedTextGradient = gradientScope === 'line' \? this\._createTextGradient\(/);
  assert.match(renderer, /const sharedHighGradient = gradientScope === 'line' \? this\._createTextGradient\(/);
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

  // The fork renderer keeps its established rendering pipeline: line mode
  // supplies one shared gradient, while word mode passes null so _drawWord()
  // rebuilds the complete gradient independently inside each word.
  assert.match(renderer, /const gradientScope = s\.text_gradient_scope === 'word' \? 'word' : 'line';/);
  assert.match(renderer, /const sharedTextGradient = gradientScope === 'line' \? this\._createTextGradient\([\s\S]*?\) : null;/);
});

test('T-subtitle uppercase mode remains preset-safe and non-destructive under the fork renderer', () => {
  const renderer = read('src/reels-canvas-renderer.js');
  const batch = read('src/batch-reels.js');
  const html = read('src/index.html');

  assert.match(html, /id="reels-uppercase"/);
  assert.match(batch, /uppercase: chk\('reels-uppercase'\)/);
  assert.match(batch, /setChk\('reels-uppercase', (?:!!)?style\.uppercase\)/);

  // VideoKit-Y implements uppercase as a display-only transform inside its
  // existing renderer instead of importing the upstream transform helper.
  // The source segment stays intact so SRT\/TXT text, word timings and old
  // project data are not mutated.
  assert.match(renderer, /const segmentText = segment\.edited_text \|\| segment\.text \|\| '';/);
  assert.match(renderer, /const displaySegmentText = s\.uppercase \? segmentText\.toUpperCase\(\) : segmentText;/);
  assert.match(renderer, /const text = displaySegmentText;/);
  assert.match(renderer, /return s\.uppercase \? word\.toUpperCase\(\) : word;/);
  assert.match(renderer, /const displayText = s\.uppercase \? text\.toUpperCase\(\) : text;/);
});
