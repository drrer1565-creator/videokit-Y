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

test('v4.4.60 Microsoft TTS frontend and native Edge engine expose the integrated workflow', () => {
  const client = cur('src', 'microsoft-tts.js');
  const engine = cur('electron', 'services', 'edgeTts.js');
  for (const capability of ['V4_4_59_TTS_POLISH', 'V4_4_59_TTS_RESUMABLE_BATCH', 'V4_4_59_TTS_PLAY_SAVED_BATCH']) {
    assert.ok(client.includes(capability), `fork TTS capability missing: ${capability}`);
  }
  for (const route of ['edge-tts/preview', 'edge-tts/save-item', 'edge-tts/create-zip']) {
    assert.ok(client.includes(route), `TTS workflow route missing: ${route}`);
  }
  assert.match(engine, /module\.exports/);
  assert.doesNotMatch(engine, /copyFile\(mp3Path,\s*mp4Path\)/);
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

test('v4.4.60 adapts upstream speech-writing behavior without replacing fork renderer features', () => {
  const renderer = cur('src', 'reels-canvas-renderer.js');
  const extension = cur('src', 'reels-speech-writing.js');

  for (const marker of [
    'V4_4_57_WRITING_CURSOR_POSITION',
    'V4_4_48_GRADIENT_SCOPE_RENDER',
    'V4_4_49_CHARACTER_FX_RENDER',
    'V4_4_51_CONNECTED_SUBTITLE_BOX_GEOMETRY',
    'V4_4_52_CONNECTED_FIT_WIDTH_SNAP',
    'charEngine.computeCharacterPresetTransform(',
    'buildConnectedSubtitleBoxGeometry(',
    'snapGroupToWidest',
    's.highlight_enabled === false',
  ]) assert.match(renderer, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  for (const marker of [
    'function getSpeechWritingTokens(',
    'function getSplitWritingParts(',
    'function getWritingVisualStyle(',
    'proto.prepareWritingCursorImage = async function',
    'proto._drawSpeechWritingTip = function',
    'proto._renderFullpageTypewriter = function',
    'ImageDecoder',
  ]) assert.ok(extension.includes(marker), `speech-writing adapter missing: ${marker}`);

  assert.doesNotMatch(extension, /V4_4_60_NATIVE_RENDERER_GUARD/);
  assert.doesNotMatch(extension, /window\.__V4_4_60_UPSTREAM_NATIVE_SPEECH_WRITING/);
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

test('v4.4.60 style defaults match upstream and export integration uses the adapted writing logic', () => {
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

function writingHarness() {
  const calls = [];
  const ctx = new Proxy({
    measureText: text => ({ width: Array.from(text).length * 10 }),
    fillText: text => calls.push({ cursor: text }),
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const sandbox = { console, Intl, Path2D: class {}, document: { createElement: () => ({ getContext: () => ctx }) } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(cur('src', 'reels-canvas-renderer.js'), sandbox);
  vm.runInContext(cur('src', 'reels-speech-writing.js'), sandbox);
  const renderer = new sandbox.ReelsCanvasRenderer({ getContext: () => ctx });
  renderer._drawWord = (_ctx, text, _x, _y, color) => calls.push({ text, color });
  const render = (segments, style, time, script = '') => {
    calls.length = 0;
    renderer.setContextSegments(segments, script);
    renderer._renderFullpageTypewriter({
      fullpage_typewriter: true, fullpage_typewriter_reveal_type: 'char',
      fontsize: 40, color_text: '#FFFFFF', color_high: '#FFD700',
      ...style,
    }, time, 1080, 1920);
    return calls.filter(call => call.text).map(call => call.text).join('');
  };
  return { sandbox, renderer, render, calls };
}

test('fullpage renderer uses speech timestamps, supports opt-out and preserves source text', () => {
  const h = writingHarness();
  const segments = [{ text: 'ab cd', start: 0, end: 10, words: [
    { word: 'ab', start: 0, end: 1 }, { word: 'cd', start: 8, end: 10 },
  ] }];
  const before = JSON.stringify(segments);
  assert.equal(h.render(segments, { uppercase: true }, 4).trim(), 'AB');
  assert.equal(h.render(segments, { fullpage_typewriter_speech_sync: false }, 6).trim(), 'ab c');
  assert.equal(JSON.stringify(segments), before);
  assert.equal(h.renderer._contextSegments, segments);
});

test('fullpage renderer reveals whole sentences and complete Unicode graphemes', () => {
  const h = writingHarness();
  const segments = [{ text: 'Hi there. Bye now.', start: 0, end: 10, words: [
    { word: 'Hi', start: 0, end: 1 }, { word: 'there', start: 1, end: 3 },
    { word: 'Bye', start: 6, end: 7 }, { word: 'now', start: 8, end: 10 },
  ] }];
  assert.equal(h.render(segments, { fullpage_typewriter_reveal_type: 'sentence' }, 1).trim(), 'Hi there.');
  assert.equal(h.render([{ text: '👩‍💻e\u0301', start: 0, end: 2 }], {}, 0.1), '👩‍💻');
  assert.equal(h.render([{ text: 'ab', edited_text: 'XY', start: 0, end: 2,
    words: [{ word: 'ab', start: 0, end: 1 }] }], { fullpage_typewriter_reveal_type: 'word' }, 1), 'XY');
});

test('collapsed trailing cues get display timing without altering saved segments or words', () => {
  const h = writingHarness();
  const segments = [{ text: 'abcd', start: 0, end: 4 }, { text: 'ef', start: 4, end: 4,
    words: [{ word: 'ef', start: 4, end: 4 }] }];
  const before = JSON.stringify(segments);
  assert.equal(h.render(segments, {}, 4.1).trim(), 'abcd e');
  const repaired = h.sandbox.repairCollapsedWritingSegments(segments);
  assert.equal(repaired[0], segments[0]);
  assert.equal(repaired[1].end, 6);
  assert.equal(repaired[1].words[0].end, 6);
  assert.equal(JSON.stringify(segments), before);
  const internalGap = [segments[1], { text: 'valid', start: 5, end: 8 }];
  assert.equal(h.sandbox.repairCollapsedWritingSegments(internalGap), internalGap);
});

test('split writing uses the original-script boundary and keeps custom headings separate from narration', () => {
  const h = writingHarness();
  const segments = [{ text: 'Hello there Body text', start: 0, end: 8, words: [
    { word: 'Hello', start: 0, end: 1 }, { word: 'there', start: 1, end: 2 },
    { word: 'Body', start: 4, end: 5 }, { word: 'text', start: 6, end: 8 },
  ] }];
  const before = JSON.stringify(segments);
  const parts = h.sandbox.getSplitWritingParts(segments, {
    fullpage_typewriter_title_auto: false, fullpage_typewriter_title_text: 'Custom heading',
  }, 'Hello there. Body text.');
  assert.equal(parts.title[0].text, 'Custom heading');
  assert.equal(parts.body[0].text, 'Body text');
  assert.equal(parts.body[0].start, 4);
  h.render(segments, { fullpage_typewriter_split: true, fullpage_typewriter_cursor: true }, 0.1, 'Hello there. Body text.');
  assert.equal(h.calls.filter(call => call.cursor === '|').length, 1);
  assert.equal(h.renderer._contextSegments, segments);
  assert.equal(JSON.stringify(segments), before);
});

test('non-split writing draws the selected tip and respects optional highlight', () => {
  const h = writingHarness();
  let tips = 0;
  h.renderer._drawSpeechWritingTip = () => tips++;
  h.render([{ text: 'hello', start: 0, end: 5 }], {
    fullpage_typewriter_cursor: true, fullpage_typewriter_cursor_kind: 'quill', highlight_enabled: false,
  }, 0.1);
  assert.equal(tips, 1);
  assert.equal(h.calls.filter(call => call.cursor).length, 0);
  assert.equal(h.calls.find(call => call.text).color, '#FFFFFF');
});
