const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const snap = path.join(root, 'upstream-snapshots', 'v4.4.43-fix');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');
const cur = (...p) => read(path.join(root, ...p));
const up = (...p) => read(path.join(snap, ...p));

function range(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${label}: range not found`);
  return src.slice(start, end);
}

function inclusive(src, startMarker, terminal, label) {
  const start = src.indexOf(startMarker);
  const tail = src.indexOf(terminal, start + startMarker.length);
  assert.ok(start >= 0 && tail >= start, `${label}: inclusive range not found`);
  return src.slice(start, tail + terminal.length);
}

function allRanges(src, startMarker, endMarker) {
  const out = [];
  let pos = 0;
  while (true) {
    const start = src.indexOf(startMarker, pos);
    if (start < 0) break;
    const end = src.indexOf(endMarker, start + startMarker.length);
    if (end < 0) break;
    out.push(src.slice(start, end));
    pos = end + endMarker.length;
  }
  return out;
}

test('v4.4.60 Microsoft TTS UI is byte-for-byte the upstream v4.4.43-fix panel', () => {
  const current = cur('src', 'index.html');
  const upstream = up('src', 'index.html');
  const start = '      <section id="microsoft-tts-panel" class="panel">';
  const end = '      <!-- ==================== 字幕对齐面板 ==================== -->';
  assert.equal(range(current, start, end, 'current TTS panel'), range(upstream, start, end, 'upstream TTS panel'));
  for (const cls of ['ms-studio-shell','ms-studio-sidebar','ms-brand','ms-box','ms-studio-topbar','ms-script-card']) {
    assert.match(current, new RegExp(cls));
  }
});

test('v4.4.60 Microsoft TTS frontend and native Edge engine are exact upstream implementations', () => {
  const client = cur('src', 'microsoft-tts.js');
  const engine = cur('electron', 'services', 'edgeTts.js');
  assert.equal(client, up('src', 'microsoft-tts.js'));
  assert.equal(engine, up('electron', 'services', 'edgeTts.js'));
  new vm.Script(client, { filename: 'src/microsoft-tts.js' });
  new vm.Script(engine, { filename: 'electron/services/edgeTts.js' });
});

test('v4.4.60 full-screen typewriter controls exactly match upstream', () => {
  const current = cur('src', 'index.html');
  const upstream = up('src', 'index.html');
  const start = '                      <!-- 4.6 全屏打字机模式 -->';
  const end = '                      <!-- 5. 排版与定位 -->';
  assert.equal(range(current, start, end, 'current fullpage UI'), range(upstream, start, end, 'upstream fullpage UI'));
  for (const id of [
    'reels-fullpage-typewriter-split','reels-fullpage-typewriter-auto-sequence','reels-fullpage-typewriter-keep-background',
    'reels-fullpage-typewriter-title-stroke-independent','reels-fullpage-typewriter-title-box-enabled',
    'reels-fullpage-typewriter-body-stroke-independent','reels-fullpage-typewriter-body-box-enabled',
    'reels-fullpage-typewriter-title-font','reels-fullpage-typewriter-title-reveal','reels-fullpage-typewriter-body-reveal',
    'reels-fullpage-typewriter-speech-sync','reels-fullpage-typewriter-cursor-kind',
    'reels-fullpage-typewriter-cursor-image-anchor-x','reels-fullpage-typewriter-cursor-image-anchor-y'
  ]) assert.match(current, new RegExp(`id="${id}"`));
});

test('v4.4.60 uses the upstream-native renderer instead of the old monkey-patch implementation', () => {
  const renderer = cur('src', 'reels-canvas-renderer.js');
  const upstream = up('src', 'reels-canvas-renderer.js');
  const stripped = renderer
    .replace(/^\/\/ V4_4_60_UPSTREAM_NATIVE_SPEECH_WRITING\n\/\/ V4_4_57_WRITING_CURSOR_POSITION V4_4_48_GRADIENT_SCOPE_RENDER V4_4_49_CHARACTER_FX_RENDER\n/, '')
    .replace(/\nif \(typeof window !== "undefined"\) window\.__V4_4_60_UPSTREAM_NATIVE_SPEECH_WRITING = true;\n?$/, '\n');
  assert.equal(stripped, upstream);
  for (const marker of ['getWritingGraphemes','repairCollapsedWritingSegments','getSpeechWritingTokens','drawSpeechWritingTip','getSplitWritingParts','getWritingVisualStyle','prepareWritingCursorImage']) {
    assert.match(renderer, new RegExp(marker));
  }
  const extension = cur('src', 'reels-speech-writing.js');
  assert.match(extension, /V4_4_60_NATIVE_RENDERER_GUARD/);
  assert.match(extension, /if \(window\.__V4_4_60_UPSTREAM_NATIVE_SPEECH_WRITING\) return;/);
});

test('v4.4.60 copies upstream Batch Reels speech resolver, handlers, and style read/write fields', () => {
  const current = cur('src', 'batch-reels.js');
  const upstream = up('src', 'batch-reels.js');
  const resolverStart = 'function _resolveSubtitleStyleForTask(task) {';
  const resolverEnd = 'function _resolveSubtitleStyleForTaskBase(task) {';
  assert.equal(range(current, resolverStart, resolverEnd, 'current resolver'), range(upstream, resolverStart, resolverEnd, 'upstream resolver'));

  const helperStart = 'window.reelsRefreshWritingTitleEditor = function() {';
  const helperTerminal = "window.reelsRefreshSpeechWritingPreview=function(...args){\n    reelsRefreshSpeechWritingImageUI();\n    return _refreshWritingBeforeCustomImage?.apply(this,args);\n};";
  const upstreamHandlers = inclusive(upstream, helperStart, helperTerminal, 'upstream handlers');
  assert.match(current, /V4_4_60_UPSTREAM_SPEECH_HANDLERS/);
  assert.ok(current.includes(upstreamHandlers), 'exact upstream speech handler block should be installed');

  const currentRead = allRanges(current, '        // Fullpage Typewriter\n', '        // Scatter Pop\n');
  const upstreamRead = allRanges(upstream, '        // Fullpage Typewriter\n', '        // Scatter Pop\n');
  assert.ok(currentRead.length >= 1 && upstreamRead.length >= 1);
  assert.equal(currentRead[0], upstreamRead[0]);

  assert.equal(
    range(current, '    // Fullpage Typewriter\n', '    // Scatter Pop\n', 'current write fields'),
    range(upstream, '    // Fullpage Typewriter\n', '    // Scatter Pop\n', 'upstream write fields')
  );
});

test('v4.4.60 style defaults match upstream and export integration uses the native writing logic', () => {
  const currentStyle = cur('src', 'reels-style-engine.js');
  const upstreamStyle = up('src', 'reels-style-engine.js');
  assert.equal(
    range(currentStyle, '    // ── Typewriter ──\n', '    // ── Scatter Pop ──\n', 'current defaults'),
    range(upstreamStyle, '    // ── Typewriter ──\n', '    // ── Scatter Pop ──\n', 'upstream defaults')
  );
  for (const rel of ['reels-wysiwyg-export.js','reels-layered-export.js']) {
    const src = cur('src', rel);
    assert.match(src, /style:getWritingVisualStyle\(params\.style\)/);
    assert.match(src, /setContextSegments\(segments, originalScript\)/);
    assert.match(src, /prepareWritingCursorImage/);
  }
});

test('v4.4.60 keeps required integration bridges and existing batch-performance fixes', () => {
  const preload = cur('electron', 'preload.js');
  const api = cur('electron', 'apiRouter.js');
  const table = cur('src', 'reels-batch-table.js');
  assert.match(preload, /importWritingCursorImage/);
  assert.match(preload, /readWritingCursorImage/);
  assert.match(api, /case 'edge-tts\/preview':/);
  assert.match(api, /case 'edge-tts\/save-item':/);
  assert.match(api, /case 'edge-tts\/create-zip':/);
  assert.match(table, /V4_4_55_BATCH_IMPORT_REFRESH_GUARD/);
  assert.match(table, /V4_4_56_FAST_ROW_BG_DROP/);
  assert.match(table, /_rbtRenderBackgroundCellLight/);
});
