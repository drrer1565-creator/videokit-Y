const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const snap = path.join(root, 'upstream-snapshots', 'v4.4.43-fix');
const norm = value => String(value || '').replace(/\r\n?/g, '\n');
const read = p => norm(fs.readFileSync(p, 'utf8'));
const write = (p, s) => fs.writeFileSync(p, norm(s), 'utf8');
const file = (...parts) => path.join(root, ...parts);
const up = (...parts) => path.join(snap, ...parts);

function extractInclusive(src, startMarker, terminal, label) {
  const start = src.indexOf(startMarker);
  const tail = src.indexOf(terminal, start + startMarker.length);
  if (start < 0 || tail < 0) throw new Error(`v4.4.60 gradient parity ${label}: range missing`);
  return src.slice(start, tail + terminal.length);
}

function syntaxCheck(p) {
  new vm.Script(read(p), { filename: p });
}

// The fork's v4.4.48 implementation used a separate two-button segmented switch
// (sentence / word). Upstream now exposes the same behavior as a compact select
// directly beside the text-gradient button, using line / word values.
{
  const indexPath = file('src', 'index.html');
  let current = read(indexPath);
  const upstream = read(up('src', 'index.html'));

  const legacyUi = `                      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; min-width:0; margin-top:8px;">\n                        <label style="margin:0;">渐变范围:</label>\n                        <input type="hidden" id="reels-gradient-scope" value="sentence">\n                        <div style="display:inline-flex; border:1px solid var(--border-color,#555); border-radius:7px; overflow:hidden;">\n                          <button type="button" id="reels-gradient-scope-sentence" onclick="reelsSetGradientScope('sentence')"\n                            style="padding:4px 10px; border:0; border-right:1px solid var(--border-color,#555); background:var(--accent-primary,#4d8dff); color:#fff; cursor:pointer; font-size:11px;">整句连续</button>\n                          <button type="button" id="reels-gradient-scope-word" onclick="reelsSetGradientScope('word')"\n                            style="padding:4px 10px; border:0; background:transparent; color:var(--text-secondary,#aaa); cursor:pointer; font-size:11px;">单词独立</button>\n                        </div>\n                      </div>`;
  if (current.includes(legacyUi)) current = current.replace(legacyUi, '');

  const scopeSelect = extractInclusive(
    upstream,
    '                        <select id="reels-text-gradient-scope"',
    '                        </select>',
    'upstream scope select'
  );
  if (!current.includes('id="reels-text-gradient-scope"')) {
    const textGradientButton = '                        <button type="button" id="reels-color-text-gradient-btn" class="btn btn-secondary" style="font-size:11px; padding:2px 6px; height:28px; display:inline-flex; align-items:center; gap:2px;" title="文字渐变色 (支持多节点自定义)">🌈</button>';
    if (!current.includes(textGradientButton)) throw new Error('v4.4.60 gradient parity: text gradient button missing');
    current = current.replace(textGradientButton, `${textGradientButton}\n${scopeSelect}`);
  }

  if ((current.match(/id="reels-text-gradient-scope"/g) || []).length !== 1) {
    throw new Error('v4.4.60 gradient parity: scope select should exist exactly once');
  }
  if (current.includes('id="reels-gradient-scope"') || current.includes('reels-gradient-scope-sentence') || current.includes('reels-gradient-scope-word')) {
    throw new Error('v4.4.60 gradient parity: legacy segmented scope UI still present');
  }
  write(indexPath, current);
}

// Persist the upstream line/word value and remove the old UI helper. Legacy
// saved value "sentence" is intentionally normalized to "line" when loaded.
{
  const batchPath = file('src', 'batch-reels.js');
  let current = read(batchPath);

  const helperStart = '// V4_4_48_GRADIENT_SCOPE_SWITCH:';
  const helperTerminal = "document.addEventListener('DOMContentLoaded', () => {\n    setTimeout(() => reelsSetGradientScope(document.getElementById('reels-gradient-scope')?.value || 'sentence', false), 0);\n});\n";
  if (current.includes(helperStart)) {
    const start = current.indexOf(helperStart);
    const end = current.indexOf(helperTerminal, start);
    if (end < 0) throw new Error('v4.4.60 gradient parity: legacy helper terminal missing');
    current = current.slice(0, start) + current.slice(end + helperTerminal.length);
  }

  current = current.split("text_gradient_scope: val('reels-gradient-scope') || 'sentence',")
    .join("text_gradient_scope: val('reels-text-gradient-scope') || 'line',");

  const legacyApply = `    if (typeof reelsSetGradientScope === 'function') {\n        reelsSetGradientScope(style.text_gradient_scope || 'sentence', false);\n    }`;
  current = current.split(legacyApply)
    .join("    set('reels-text-gradient-scope', style.text_gradient_scope === 'word' ? 'word' : 'line');");

  if (!current.includes("text_gradient_scope: val('reels-text-gradient-scope') || 'line',")) {
    throw new Error('v4.4.60 gradient parity: upstream scope collector missing');
  }
  if (!current.includes("set('reels-text-gradient-scope', style.text_gradient_scope === 'word' ? 'word' : 'line');")) {
    throw new Error('v4.4.60 gradient parity: scope apply normalization missing');
  }
  if (current.includes("val('reels-gradient-scope')") || current.includes('reelsSetGradientScope(')) {
    throw new Error('v4.4.60 gradient parity: legacy scope state path still active');
  }

  write(batchPath, current);
  syntaxCheck(batchPath);
}

// Make the field a first-class style key so presets, task styles and exports all
// preserve it. This also makes the upstream default explicit: whole-line gradient.
{
  const stylePath = file('src', 'reels-style-engine.js');
  let current = read(stylePath);
  const upstream = read(up('src', 'reels-style-engine.js'));
  const upstreamLine = "    text_gradient_scope: 'line', // 'line' (整句渐变) | 'word' (每个单词独立渐变)";

  current = current.replace(/    text_gradient_scope: 'sentence',[^\n]*\n/g, `${upstreamLine}\n`);
  if (!current.includes("text_gradient_scope: 'line'")) {
    const marker = "    text_gradient_direction: 'horizontal',";
    if (!current.includes(marker) || !upstream.includes(upstreamLine)) {
      throw new Error('v4.4.60 gradient parity: style default marker missing');
    }
    current = current.replace(marker, `${marker}\n${upstreamLine}`);
  }
  write(stylePath, current);
  syntaxCheck(stylePath);
}

// Keep the fork renderer and adapt its existing v4.4.48 gradient implementation
// to upstream's line/word vocabulary. In line mode the renderer supplies one shared
// gradient across the complete line; in word mode it deliberately supplies no shared
// gradient so _drawWord() recreates the full ramp independently for each word.
{
  const rendererPath = file('src', 'reels-canvas-renderer.js');
  let renderer = read(rendererPath);

  renderer = renderer.split("const gradientScope = s.text_gradient_scope === 'word' ? 'word' : 'sentence';")
    .join("const gradientScope = s.text_gradient_scope === 'word' ? 'word' : 'line';");
  renderer = renderer.split("gradientScope === 'sentence'").join("gradientScope === 'line'");

  for (const marker of [
    'V4_4_48_GRADIENT_SCOPE_RENDER',
    "const gradientScope = s.text_gradient_scope === 'word' ? 'word' : 'line';",
    "const sharedTextGradient = gradientScope === 'line' ? this._createTextGradient(",
    "const sharedHighGradient = gradientScope === 'line' ? this._createTextGradient(",
  ]) {
    if (!renderer.includes(marker)) throw new Error(`v4.4.60 gradient parity: adapted renderer scope logic missing: ${marker}`);
  }

  write(rendererPath, renderer);
  syntaxCheck(rendererPath);
}

console.log('[v4.4.60] T subtitle gradient scope matches upstream line/word behavior on the fork renderer.');
