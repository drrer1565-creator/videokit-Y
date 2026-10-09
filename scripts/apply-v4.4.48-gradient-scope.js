const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'src', 'index.html');
const batchPath = path.join(root, 'src', 'batch-reels.js');
const rendererPath = path.join(root, 'src', 'reels-canvas-renderer.js');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function write(file, before, after) {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.48] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.48] no changes needed for ${path.relative(root, file)}`);
  }
}

function syntax(source, file) {
  new vm.Script(source, { filename: file });
}

// ─────────────────────────────────────────────────────────────
// index.html: add a two-segment gradient scope switch.
// Existing projects keep the current whole-sentence behavior by default.
// ─────────────────────────────────────────────────────────────
let indexBefore = read(indexPath);
let index = indexBefore;
if (!index.includes('reels-gradient-scope')) {
  const marker = `                        <button type="button" id="reels-color-high-gradient-btn" class="btn btn-secondary" style="font-size:11px; padding:2px 6px; height:28px; display:inline-flex; align-items:center; gap:2px;" title="高亮渐变色 (支持多节点自定义)">🌈</button>\n                      </div>`;
  if (!index.includes(marker)) throw new Error('gradient scope UI marker missing');
  const replacement = `                        <button type="button" id="reels-color-high-gradient-btn" class="btn btn-secondary" style="font-size:11px; padding:2px 6px; height:28px; display:inline-flex; align-items:center; gap:2px;" title="高亮渐变色 (支持多节点自定义)">🌈</button>\n                      </div>\n                      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; min-width:0; margin-top:8px;">\n                        <label style="margin:0;">渐变范围:</label>\n                        <input type="hidden" id="reels-gradient-scope" value="sentence">\n                        <div style="display:inline-flex; border:1px solid var(--border-color,#555); border-radius:7px; overflow:hidden;">\n                          <button type="button" id="reels-gradient-scope-sentence" onclick="reelsSetGradientScope('sentence')"\n                            style="padding:4px 10px; border:0; border-right:1px solid var(--border-color,#555); background:var(--accent-primary,#4d8dff); color:#fff; cursor:pointer; font-size:11px;">整句连续</button>\n                          <button type="button" id="reels-gradient-scope-word" onclick="reelsSetGradientScope('word')"\n                            style="padding:4px 10px; border:0; background:transparent; color:var(--text-secondary,#aaa); cursor:pointer; font-size:11px;">单词独立</button>\n                        </div>\n                      </div>`;
  index = index.replace(marker, replacement);
}
write(indexPath, indexBefore, index);

// ─────────────────────────────────────────────────────────────
// batch-reels.js: persist/apply text_gradient_scope and keep old presets
// backward-compatible (missing field => sentence).
// ─────────────────────────────────────────────────────────────
let batchBefore = read(batchPath);
let batch = batchBefore;
if (!batch.includes('V4_4_48_GRADIENT_SCOPE_SWITCH')) {
  const inputListenerMarker = `document.addEventListener('input', (e) => {\n    if (e.target && e.target.id && e.target.id.startsWith('reels-')) {\n        e.target.dataset.rawValue = e.target.value;\n    }\n});\n`;
  if (!batch.includes(inputListenerMarker)) throw new Error('gradient scope function marker missing');
  batch = batch.replace(inputListenerMarker, inputListenerMarker + `\n// V4_4_48_GRADIENT_SCOPE_SWITCH: sentence keeps the current behavior; word restores\n// the original per-word gradient without removing or changing whole-sentence gradients.\nfunction reelsSetGradientScope(scope = 'sentence', updatePreview = true) {\n    const normalized = scope === 'word' ? 'word' : 'sentence';\n    const valueEl = document.getElementById('reels-gradient-scope');\n    if (valueEl) {\n        valueEl.value = normalized;\n        valueEl.dataset.rawValue = normalized;\n    }\n    const sentenceBtn = document.getElementById('reels-gradient-scope-sentence');\n    const wordBtn = document.getElementById('reels-gradient-scope-word');\n    const applyState = (button, selected) => {\n        if (!button) return;\n        button.setAttribute('aria-pressed', selected ? 'true' : 'false');\n        button.style.background = selected ? 'var(--accent-primary,#4d8dff)' : 'transparent';\n        button.style.color = selected ? '#fff' : 'var(--text-secondary,#aaa)';\n    };\n    applyState(sentenceBtn, normalized === 'sentence');\n    applyState(wordBtn, normalized === 'word');\n    if (updatePreview && typeof reelsUpdatePreview === 'function') reelsUpdatePreview();\n}\nwindow.reelsSetGradientScope = reelsSetGradientScope;\n\ndocument.addEventListener('DOMContentLoaded', () => {\n    setTimeout(() => reelsSetGradientScope(document.getElementById('reels-gradient-scope')?.value || 'sentence', false), 0);\n});\n`);

  const collectMarker = `        color_text: val('reels-color-text') || '#FFFFFF',\n        text_gradient_direction: get('reels-color-text')?.dataset?.gradientDirection || 'horizontal',\n        color_high: val('reels-color-high') || '#FFD700',`;
  if (!batch.includes(collectMarker)) throw new Error('gradient scope collect marker missing');
  batch = batch.replace(collectMarker,
`        color_text: val('reels-color-text') || '#FFFFFF',\n        text_gradient_direction: get('reels-color-text')?.dataset?.gradientDirection || 'horizontal',\n        text_gradient_scope: val('reels-gradient-scope') || 'sentence',\n        color_high: val('reels-color-high') || '#FFD700',`);

  const applyMarker = `        colorTextEl.dataset.gradientDirection = style.text_gradient_direction || 'horizontal';\n        if (typeof _syncSubtitleGradientSwatch === 'function') {\n            _syncSubtitleGradientSwatch(colorTextEl, document.getElementById('reels-color-text-gradient-btn'));\n        }\n    }`;
  if (!batch.includes(applyMarker)) throw new Error('gradient scope apply marker missing');
  batch = batch.replace(applyMarker, applyMarker + `\n    if (typeof reelsSetGradientScope === 'function') {\n        reelsSetGradientScope(style.text_gradient_scope || 'sentence', false);\n    }`);
}
syntax(batch, batchPath);
write(batchPath, batchBefore, batch);

// ─────────────────────────────────────────────────────────────
// reels-canvas-renderer.js: in sentence mode create/reuse the shared gradient;
// in word mode deliberately pass null so _drawWord() uses its preserved
// per-word gradient fallback and each word runs through the full colour ramp.
// ─────────────────────────────────────────────────────────────
let rendererBefore = read(rendererPath);
let renderer = rendererBefore;
if (!renderer.includes('V4_4_48_GRADIENT_SCOPE_RENDER')) {
  const marker = `        const sharedTextGradient = this._createTextGradient(\n            ctx, textColor, s.text_gradient_direction || 'horizontal', sharedGradientBounds\n        );\n        const sharedHighGradient = this._createTextGradient(\n            ctx, highColor, s.high_gradient_direction || s.text_gradient_direction || 'horizontal', sharedGradientBounds\n        );`;
  if (!renderer.includes(marker)) throw new Error('gradient scope renderer marker missing');
  renderer = renderer.replace(marker,
`        // V4_4_48_GRADIENT_SCOPE_RENDER: old presets omit this field and therefore\n        // remain on the current whole-sentence gradient. Word mode reuses the\n        // preserved _drawWord() per-word fallback by not supplying a shared gradient.\n        const gradientScope = s.text_gradient_scope === 'word' ? 'word' : 'sentence';\n        const sharedTextGradient = gradientScope === 'sentence' ? this._createTextGradient(\n            ctx, textColor, s.text_gradient_direction || 'horizontal', sharedGradientBounds\n        ) : null;\n        const sharedHighGradient = gradientScope === 'sentence' ? this._createTextGradient(\n            ctx, highColor, s.high_gradient_direction || s.text_gradient_direction || 'horizontal', sharedGradientBounds\n        ) : null;`);
}
syntax(renderer, rendererPath);
write(rendererPath, rendererBefore, renderer);

if (!index.includes('reels-gradient-scope-word')
    || !batch.includes("text_gradient_scope: val('reels-gradient-scope') || 'sentence'")
    || !renderer.includes("const gradientScope = s.text_gradient_scope === 'word' ? 'word' : 'sentence'")) {
  throw new Error('4.4.48 gradient scope patch incomplete');
}

console.log('[4.4.48] Subtitle gradient scope switch is ready (sentence + per-word).');
