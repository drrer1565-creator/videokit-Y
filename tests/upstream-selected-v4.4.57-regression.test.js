const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('global undo/redo runtime is loaded and external side effects are marked', () => {
  const html = read('src/index.html');
  const history = read('src/global-edit-history.js');
  const app = read('src/app.js');
  assert.match(html, /src="global-edit-history\.js"/);
  assert.match(history, /window\.VideoKitGlobalHistory=/);
  assert.match(history, /undo:target=>step\(-1,target\)/);
  assert.match(history, /redo:target=>step\(1,target\)/);
  assert.match(history, /password\|secret\|token/);
  assert.match(app, /V4_4_57_GLOBAL_HISTORY_EXTERNAL_ACTION/);
  assert.match(app, /noteExternalAction\(\)/);
});

test('Microsoft TTS uses the upgraded native engine, card UI and new API routes', () => {
  const html = read('src/index.html');
  const client = read('src/microsoft-tts.js');
  const service = read('electron/services/edgeTts.js');
  const api = read('electron/apiRouter.js');
  for (const id of ['ms-pitch','ms-task-folder','ms-preview-all','ms-create-zip','ms-progress-fill','ms-card-count']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(client, /Clipchamp Voice Studio layout/);
  assert.match(client, /edge-tts\/preview/);
  assert.match(client, /edge-tts\/save-item/);
  assert.match(client, /edge-tts\/create-zip/);
  assert.match(service, /speech\.platform\.bing\.com/);
  assert.match(service, /generateSecMsGec/);
  assert.match(service, /synthesizeViaNativeWsOnce/);
  assert.match(service, /async function createZip/);
  assert.match(api, /case 'edge-tts\/preview'/);
  assert.match(api, /case 'edge-tts\/save-item'/);
  assert.match(api, /case 'edge-tts\/create-zip'/);
});

test('speech-synchronised writing supports split title/body and custom animated cursor images', () => {
  const html = read('src/index.html');
  const batch = read('src/batch-reels.js');
  const renderer = read('src/reels-canvas-renderer.js');
  const preload = read('electron/preload.js');
  const style = read('src/reels-style-engine.js');
  for (const id of [
    'reels-fullpage-typewriter-split','reels-fullpage-typewriter-auto-sequence',
    'reels-fullpage-typewriter-title-text','reels-fullpage-typewriter-title-font',
    'reels-fullpage-typewriter-body-reveal','reels-fullpage-typewriter-speech-sync',
    'reels-fullpage-typewriter-cursor-kind','reels-fullpage-typewriter-cursor-image-anchor-x',
    'reels-fullpage-typewriter-cursor-image-anchor-y'
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(batch, /V4_4_57_SPEECH_WRITING_RESOLVER/);
  assert.match(batch, /fullpage_typewriter_split: chk\('reels-fullpage-typewriter-split'\)/);
  assert.match(batch, /getWritingVisualStyle/);
  assert.match(renderer, /function getSplitWritingParts/);
  assert.match(renderer, /function getSpeechWritingTokens/);
  assert.match(renderer, /drawSpeechWritingTip/);
  assert.match(renderer, /prepareWritingCursorImage/);
  assert.match(renderer, /ImageDecoder/);
  assert.match(preload, /V4_4_57_WRITING_CURSOR_IMAGE_BRIDGE/);
  assert.match(preload, /importWritingCursorImage/);
  assert.match(style, /fullpage_typewriter_split: false/);
});

test('emergency fixes bind native drop paths before sorting and restore overlay escaping', () => {
  const table = read('src/reels-batch-table.js');
  const overlay = read('src/reels-overlay-panel.js');
  const bind = table.indexOf('V4_4_57_NATIVE_DROP_SORT');
  const sort = table.indexOf('const files = rawFiles.sort(_naturalSortByName)', bind);
  assert.ok(bind >= 0 && sort > bind, 'native paths should be bound before natural sorting');
  assert.match(table, /const rawPath = item\._nativePath \|\| item\.path \|\| ''/);
  assert.match(overlay, /V4_4_57_OVERLAY_ESC/);
  assert.match(overlay, /_esc\(str\)/);
  assert.match(overlay, /replace\(\/&\/g, '&amp;'\)/);
});

test('v4.4.57 remains chained after v4.4.56 and keeps the prior fast-row fix', () => {
  const chain = read('scripts/apply-v4.4.55-batch-import-performance-chain.js');
  const table = read('src/reels-batch-table.js');
  assert.match(chain, /apply-v4\.4\.56-fast-row-multidrop\.js/);
  assert.match(chain, /apply-v4\.4\.57-selected-upgrades\.js/);
  assert.match(table, /V4_4_56_FAST_ROW_BG_DROP/);
  assert.match(table, /_rbtRenderBackgroundCellLight/);
});
