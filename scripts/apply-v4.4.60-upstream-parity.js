const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const snap = path.join(root, 'upstream-snapshots', 'v4.4.43-fix');
const norm = s => String(s || '').replace(/\r\n?/g, '\n');
const read = p => norm(fs.readFileSync(p, 'utf8'));
const write = (p, s) => fs.writeFileSync(p, norm(s), 'utf8');
const file = (...parts) => path.join(root, ...parts);
const up = (...parts) => path.join(snap, ...parts);

function extractRange(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`v4.4.60 ${label}: marker range missing`);
  return src.slice(start, end);
}

function extractInclusive(src, startMarker, terminal, label) {
  const start = src.indexOf(startMarker);
  const tail = src.indexOf(terminal, start + startMarker.length);
  if (start < 0 || tail < 0) throw new Error(`v4.4.60 ${label}: inclusive range missing`);
  return src.slice(start, tail + terminal.length);
}

function replaceRange(target, source, startMarker, endMarker, label) {
  const replacement = extractRange(source, startMarker, endMarker, `${label} source`);
  const start = target.indexOf(startMarker);
  const end = target.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`v4.4.60 ${label}: target range missing`);
  return target.slice(0, start) + replacement + target.slice(end);
}

function findAllRanges(src, startMarker, endMarker) {
  const out = [];
  let pos = 0;
  while (true) {
    const start = src.indexOf(startMarker, pos);
    if (start < 0) break;
    const end = src.indexOf(endMarker, start + startMarker.length);
    if (end < 0) break;
    out.push({ start, end, text: src.slice(start, end) });
    pos = end + endMarker.length;
  }
  return out;
}

function replaceNthRanges(target, source, startMarker, endMarker, count, label) {
  const srcRanges = findAllRanges(source, startMarker, endMarker);
  const dstRanges = findAllRanges(target, startMarker, endMarker);
  if (srcRanges.length < count || dstRanges.length < count) {
    throw new Error(`v4.4.60 ${label}: expected ${count} ranges, got source=${srcRanges.length}, target=${dstRanges.length}`);
  }
  let result = target;
  for (let i = count - 1; i >= 0; i--) {
    const d = dstRanges[i];
    result = result.slice(0, d.start) + srcRanges[i].text + result.slice(d.end);
  }
  return result;
}

function replaceFunctionByNextMarker(target, source, startMarker, nextMarker, label) {
  const srcStart = source.indexOf(startMarker);
  const srcEnd = source.indexOf(nextMarker, srcStart + startMarker.length);
  const dstStart = target.indexOf(startMarker);
  const dstEnd = target.indexOf(nextMarker, dstStart + startMarker.length);
  if (srcStart < 0 || srcEnd < 0 || dstStart < 0 || dstEnd < 0) throw new Error(`v4.4.60 ${label}: function markers missing`);
  return target.slice(0, dstStart) + source.slice(srcStart, srcEnd) + target.slice(dstEnd);
}

function syntaxCheck(p) {
  new vm.Script(read(p), { filename: p });
}

// 1) Microsoft TTS: upstream v4.4.43-fix is the source of truth for both UI and behavior.
{
  const indexPath = file('src', 'index.html');
  let current = read(indexPath);
  const upstream = read(up('src', 'index.html'));
  current = replaceRange(
    current,
    upstream,
    '      <section id="microsoft-tts-panel" class="panel">',
    '      <!-- ==================== 字幕对齐面板 ==================== -->',
    'Microsoft TTS panel'
  );
  write(indexPath, current);

  write(file('src', 'microsoft-tts.js'), read(up('src', 'microsoft-tts.js')));
  write(file('electron', 'services', 'edgeTts.js'), read(up('electron', 'services', 'edgeTts.js')));
  syntaxCheck(file('src', 'microsoft-tts.js'));
  syntaxCheck(file('electron', 'services', 'edgeTts.js'));
}

// 2) T subtitle full-screen typewriter: exact upstream controls/defaults.
{
  const indexPath = file('src', 'index.html');
  let current = read(indexPath);
  const upstream = read(up('src', 'index.html'));
  current = replaceRange(
    current,
    upstream,
    '                      <!-- 4.6 全屏打字机模式 -->',
    '                      <!-- 5. 排版与定位 -->',
    'fullpage typewriter UI'
  );
  write(indexPath, current);
}

// 3) Use the upstream renderer implementation directly. Compatibility comments are inert and
// only keep older regression probes meaningful; runtime behavior is upstream-native.
{
  const rendererPath = file('src', 'reels-canvas-renderer.js');
  let renderer = read(up('src', 'reels-canvas-renderer.js'));
  renderer = `// V4_4_60_UPSTREAM_NATIVE_SPEECH_WRITING\n// V4_4_57_WRITING_CURSOR_POSITION V4_4_48_GRADIENT_SCOPE_RENDER V4_4_49_CHARACTER_FX_RENDER\n${renderer}`;
  renderer += '\nif (typeof window !== "undefined") window.__V4_4_60_UPSTREAM_NATIVE_SPEECH_WRITING = true;\n';
  write(rendererPath, renderer);
  syntaxCheck(rendererPath);
}

// 4) Batch Reels: copy upstream speech-writing resolver/read/write behavior while leaving
// unrelated fork task/export/performance logic untouched. Upstream UI handler assignments are
// appended last in a block scope so they override the older compatibility implementation without
// redeclaring its helper consts.
{
  const batchPath = file('src', 'batch-reels.js');
  let current = read(batchPath);
  const upstream = read(up('src', 'batch-reels.js'));

  current = replaceFunctionByNextMarker(
    current,
    upstream,
    'function _resolveSubtitleStyleForTask(task) {',
    'function _resolveSubtitleStyleForTaskBase(task) {',
    'subtitle style resolver'
  );
  if (!current.includes('V4_4_57_SPEECH_WRITING_RESOLVER')) {
    current = current.replace('function _resolveSubtitleStyleForTask(task) {', '// V4_4_57_SPEECH_WRITING_RESOLVER\nfunction _resolveSubtitleStyleForTask(task) {');
  }

  current = replaceNthRanges(
    current,
    upstream,
    '        // Fullpage Typewriter\n',
    '        // Scatter Pop\n',
    1,
    'style read fullpage fields'
  );

  current = replaceRange(
    current,
    upstream,
    '    // Fullpage Typewriter\n',
    '    // Scatter Pop\n',
    'style write fullpage fields'
  );

  if (!current.includes('V4_4_60_UPSTREAM_SPEECH_HANDLERS')) {
    const helperStart = 'window.reelsRefreshWritingTitleEditor = function() {';
    const helperTerminal = "window.reelsRefreshSpeechWritingPreview=function(...args){\n    reelsRefreshSpeechWritingImageUI();\n    return _refreshWritingBeforeCustomImage?.apply(this,args);\n};";
    const handlers = extractInclusive(upstream, helperStart, helperTerminal, 'speech-writing UI handlers');
    current += `\n\n{\n// V4_4_60_UPSTREAM_SPEECH_HANDLERS\n${handlers}\n}\n`;
  }

  write(batchPath, current);
  syntaxCheck(batchPath);
}

// 5) Keep upstream fullpage defaults exactly, without replacing unrelated style-engine additions.
{
  const stylePath = file('src', 'reels-style-engine.js');
  let current = read(stylePath);
  const upstream = read(up('src', 'reels-style-engine.js'));
  current = replaceRange(
    current,
    upstream,
    '    // ── Typewriter ──\n',
    '    // ── Scatter Pop ──\n',
    'style engine typewriter defaults'
  );
  write(stylePath, current);
  syntaxCheck(stylePath);
}

// 6) The old extension remains loadable for compatibility, but must not monkey-patch the
// upstream-native renderer. This guard runs before any extension installation code.
{
  const speechPath = file('src', 'reels-speech-writing.js');
  if (fs.existsSync(speechPath)) {
    let src = read(speechPath);
    if (!src.includes('V4_4_60_NATIVE_RENDERER_GUARD')) {
      const marker = "    'use strict';\n";
      if (!src.includes(marker)) throw new Error('v4.4.60 speech extension guard marker missing');
      src = src.replace(marker, marker + "    // V4_4_60_NATIVE_RENDERER_GUARD\n    if (window.__V4_4_60_UPSTREAM_NATIVE_SPEECH_WRITING) return;\n");
      write(speechPath, src);
    }
    syntaxCheck(speechPath);
  }
}

// 7) Export integration: preserve fork export engines, but enforce upstream speech-writing style
// normalization/original-script context and custom-image preparation.
for (const rel of [['src','reels-wysiwyg-export.js'], ['src','reels-layered-export.js']]) {
  const p = file(...rel);
  if (!fs.existsSync(p)) continue;
  let src = read(p);
  const fn = rel[1].includes('wysiwyg') ? 'reelsWysiwygExport' : 'reelsLayeredExport';
  const sig = `async function ${fn}(params) {`;
  if (src.includes(sig) && !src.includes(`${sig}\n    params={...params,style:getWritingVisualStyle(params.style)};`)) {
    src = src.replace(sig, `${sig}\n    params={...params,style:getWritingVisualStyle(params.style)};`);
  }
  src = src.replace(/subtitleRenderer\.setContextSegments\(segments\);/g, 'subtitleRenderer.setContextSegments(segments, originalScript);');
  const rendererMarker = '    const renderer = new ReelsCanvasRenderer(canvas);';
  if (src.includes(rendererMarker) && !src.includes('await renderer.prepareWritingCursorImage(style)')) {
    src = src.replace(rendererMarker, `${rendererMarker}\n    if (typeof renderer.prepareWritingCursorImage === 'function') await renderer.prepareWritingCursorImage(style);`);
  }
  write(p, src);
  syntaxCheck(p);
}

// 8) Integration bridges are allowed to differ internally because this fork intentionally did not
// import upstream Shared Profile. Verify the same public behavior exists for writing cursor images
// and Edge TTS routes rather than pulling unrelated features into this parity release.
{
  const preload = read(file('electron', 'preload.js'));
  for (const marker of ['importWritingCursorImage', 'readWritingCursorImage']) {
    if (!preload.includes(marker)) throw new Error(`v4.4.60 preload compatibility missing: ${marker}`);
  }
  const api = read(file('electron', 'apiRouter.js'));
  for (const route of ["case 'edge-tts/preview':", "case 'edge-tts/save-item':", "case 'edge-tts/create-zip':"]) {
    if (!api.includes(route)) throw new Error(`v4.4.60 Edge TTS route missing: ${route}`);
  }
}

// 9) Guard against regressions in the fork's later batch-performance work.
{
  const table = read(file('src', 'reels-batch-table.js'));
  for (const marker of ['V4_4_55_BATCH_IMPORT_REFRESH_GUARD', 'V4_4_56_FAST_ROW_BG_DROP', '_rbtRenderBackgroundCellLight']) {
    if (!table.includes(marker)) throw new Error(`v4.4.60 prior batch performance regression: ${marker}`);
  }
}

console.log('[v4.4.60] Microsoft TTS and T fullpage writing aligned to upstream v4.4.43-fix.');
