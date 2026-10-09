const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'src', 'index.html');
const batchPath = path.join(root, 'src', 'batch-reels.js');
const animPath = path.join(root, 'src', 'reels-anim-engine.js');
const rendererPath = path.join(root, 'src', 'reels-canvas-renderer.js');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function write(file, before, after) {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.49-letter-fx] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.49-letter-fx] no changes needed for ${path.relative(root, file)}`);
  }
}

function syntax(source, file) {
  new vm.Script(source, { filename: file });
}

// ─────────────────────────────────────────────────────────────
// T-subtitle animation UI: six new letter effects + one shared parameter box.
// The shared controls keep the panel compact while still letting users tune
// strength, per-letter duration and stagger directly inside “5. 动画引擎”.
// ─────────────────────────────────────────────────────────────
let indexBefore = read(indexPath);
let index = indexBefore;
if (!index.includes('value="char_rise"')) {
  const optionMarker = `                            <option value="char_bounce">逐字弹跳</option>\n                            <option value="letter_jump">逐字放大</option>`;
  if (!index.includes(optionMarker)) throw new Error('letter-fx option marker missing');
  index = index.replace(optionMarker,
`                            <option value="char_bounce">逐字弹跳</option>\n                            <option value="char_rise">逐字上浮</option>\n                            <option value="char_elastic">逐字弹性放大</option>\n                            <option value="char_wave">逐字波浪</option>\n                            <option value="char_drop">逐字落下回弹</option>\n                            <option value="char_squash">逐字挤压弹跳</option>\n                            <option value="char_center_spread">中心扩散</option>\n                            <option value="letter_jump">逐字放大</option>`);

  const groupMarker = `                        <!-- 10. 随机散射卡片 -->`;
  if (!index.includes(groupMarker)) throw new Error('letter-fx parameter group marker missing');
  const group = `                        <!-- V4_4_49_LETTER_FX_UI: six adjustable per-character animation presets -->\n                        <div class="reels-anim-group-box" data-anim-types="char_rise,char_elastic,char_wave,char_drop,char_squash,char_center_spread" style="display: none; padding: 6px 8px; background: rgba(0,0,0,0.18); border-radius: 5px;">\n                          <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 5px; font-weight: 500;">字母动画参数</div>\n                          <div style="display:flex; flex-direction:column; gap:5px;">\n                            <div style="display:flex; flex-wrap:nowrap; align-items:center; gap:6px; width:100%;">\n                              <label style="margin:0; font-size:12px; flex:0 0 70px; white-space:nowrap;">动画强度:</label>\n                              <input type="range" id="reels-char-fx-strength-range" min="0.5" max="2.0" step="0.05" value="1.0" style="flex:1; min-width:40px;" oninput="document.getElementById('reels-char-fx-strength').value=this.value; reelsUpdatePreview()">\n                              <input type="number" id="reels-char-fx-strength" class="input input-small" min="0.5" max="2.0" step="0.05" value="1.0" style="width:50px; flex:0 0 50px; padding:2px; text-align:center;" oninput="document.getElementById('reels-char-fx-strength-range').value=this.value; reelsUpdatePreview()">\n                              <span style="font-size:11px; color:var(--text-secondary); flex:0 0 16px;">x</span>\n                            </div>\n                            <div style="display:flex; flex-wrap:nowrap; align-items:center; gap:6px; width:100%;">\n                              <label style="margin:0; font-size:12px; flex:0 0 70px; white-space:nowrap;">单字时长:</label>\n                              <input type="range" id="reels-char-fx-duration-range" min="0.12" max="0.90" step="0.01" value="0.36" style="flex:1; min-width:40px;" oninput="document.getElementById('reels-char-fx-duration').value=this.value; reelsUpdatePreview()">\n                              <input type="number" id="reels-char-fx-duration" class="input input-small" min="0.12" max="0.90" step="0.01" value="0.36" style="width:50px; flex:0 0 50px; padding:2px; text-align:center;" oninput="document.getElementById('reels-char-fx-duration-range').value=this.value; reelsUpdatePreview()">\n                              <span style="font-size:11px; color:var(--text-secondary); flex:0 0 16px;">s</span>\n                            </div>\n                            <div style="display:flex; flex-wrap:nowrap; align-items:center; gap:6px; width:100%;">\n                              <label style="margin:0; font-size:12px; flex:0 0 70px; white-space:nowrap;">逐字间隔:</label>\n                              <input type="range" id="reels-char-fx-stagger-range" min="0" max="0.12" step="0.005" value="0.035" style="flex:1; min-width:40px;" oninput="document.getElementById('reels-char-fx-stagger').value=this.value; reelsUpdatePreview()">\n                              <input type="number" id="reels-char-fx-stagger" class="input input-small" min="0" max="0.12" step="0.005" value="0.035" style="width:50px; flex:0 0 50px; padding:2px; text-align:center;" oninput="document.getElementById('reels-char-fx-stagger-range').value=this.value; reelsUpdatePreview()">\n                              <span style="font-size:11px; color:var(--text-secondary); flex:0 0 16px;">s</span>\n                            </div>\n                            <div style="font-size:10px; color:var(--text-secondary); line-height:1.35;">强度控制位移/缩放幅度；单字时长控制每个字完成动作所需时间；逐字间隔控制字母依次出现的节奏。过短字幕会自动压缩间隔，避免最后几个字来不及完成动画。</div>\n                          </div>\n                        </div>\n\n`;
  index = index.replace(groupMarker, group + groupMarker);
}
write(indexPath, indexBefore, index);

// ─────────────────────────────────────────────────────────────
// Batch/T-subtitle panel: presets, shared parameter visibility, style
// persistence and preset restore. Existing presets omit the new fields and
// therefore use conservative defaults.
// ─────────────────────────────────────────────────────────────
let batchBefore = read(batchPath);
let batch = batchBefore;
if (!batch.includes('V4_4_49_LETTER_ANIMATION_PRESETS')) {
  const presetMarker = `    metro_beat: {\n        label: 'Rhythm Beat · 节奏逐词',`;
  if (!batch.includes(presetMarker)) throw new Error('letter-fx preset marker missing');
  const presets = `    // V4_4_49_LETTER_ANIMATION_PRESETS\n    rise_up_chars: {\n        label: 'Rise Up · 逐字上浮',\n        anim_in_type: 'char_rise',\n        anim_in_duration: 0.34,\n        anim_out_type: 'fade',\n        anim_out_duration: 0.18,\n        char_fx_strength: 0.90,\n        char_fx_duration: 0.34,\n        char_fx_stagger: 0.028,\n    },\n    elastic_pop_chars: {\n        label: 'Elastic Pop · 弹性放大',\n        anim_in_type: 'char_elastic',\n        anim_in_duration: 0.38,\n        anim_out_type: 'fade',\n        anim_out_duration: 0.18,\n        char_fx_strength: 1.00,\n        char_fx_duration: 0.38,\n        char_fx_stagger: 0.025,\n    },\n    wave_chars: {\n        label: 'Wave · 逐字波浪',\n        anim_in_type: 'char_wave',\n        anim_in_duration: 0.42,\n        anim_out_type: 'fade',\n        anim_out_duration: 0.18,\n        char_fx_strength: 0.85,\n        char_fx_duration: 0.42,\n        char_fx_stagger: 0.040,\n    },\n    drop_bounce_chars: {\n        label: 'Drop Bounce · 落下回弹',\n        anim_in_type: 'char_drop',\n        anim_in_duration: 0.46,\n        anim_out_type: 'fade',\n        anim_out_duration: 0.20,\n        char_fx_strength: 1.05,\n        char_fx_duration: 0.46,\n        char_fx_stagger: 0.030,\n    },\n    squash_pop_chars: {\n        label: 'Squash Pop · 挤压弹跳',\n        anim_in_type: 'char_squash',\n        anim_in_duration: 0.34,\n        anim_out_type: 'fade',\n        anim_out_duration: 0.18,\n        char_fx_strength: 1.00,\n        char_fx_duration: 0.34,\n        char_fx_stagger: 0.025,\n    },\n    center_spread_chars: {\n        label: 'Center Spread · 中心扩散',\n        anim_in_type: 'char_center_spread',\n        anim_in_duration: 0.42,\n        anim_out_type: 'fade',\n        anim_out_duration: 0.20,\n        char_fx_strength: 0.90,\n        char_fx_duration: 0.42,\n        char_fx_stagger: 0.022,\n    },\n`;
  batch = batch.replace(presetMarker, presets + presetMarker);

  const applyPresetMarker = `    set('reels-bounce-height', preset.char_bounce_height);\n    set('reels-metro-bpm', preset.metronome_bpm);`;
  if (!batch.includes(applyPresetMarker)) throw new Error('letter-fx preset apply marker missing');
  batch = batch.replace(applyPresetMarker,
`    set('reels-bounce-height', preset.char_bounce_height);\n    set('reels-char-fx-strength', preset.char_fx_strength);\n    set('reels-char-fx-strength-range', preset.char_fx_strength);\n    set('reels-char-fx-duration', preset.char_fx_duration);\n    set('reels-char-fx-duration-range', preset.char_fx_duration);\n    set('reels-char-fx-stagger', preset.char_fx_stagger);\n    set('reels-char-fx-stagger-range', preset.char_fx_stagger);\n    set('reels-metro-bpm', preset.metronome_bpm);`);

  const paramGroupMarker = `    { types: ['char_bounce'], label: '逐字弹跳', ids: ['reels-bounce-height', 'reels-bounce-height-range'] },`;
  if (!batch.includes(paramGroupMarker)) throw new Error('letter-fx param availability marker missing');
  batch = batch.replace(paramGroupMarker, paramGroupMarker + `\n    { types: ['char_rise', 'char_elastic', 'char_wave', 'char_drop', 'char_squash', 'char_center_spread'], label: '字母动画', ids: ['reels-char-fx-strength', 'reels-char-fx-strength-range', 'reels-char-fx-duration', 'reels-char-fx-duration-range', 'reels-char-fx-stagger', 'reels-char-fx-stagger-range'] },`);

  const collectMarker = `        char_bounce_height: num('reels-bounce-height', 20),\n        char_bounce_stagger: 0.05,\n        metronome_bpm: num('reels-metro-bpm', 120),`;
  if (!batch.includes(collectMarker)) throw new Error('letter-fx collect marker missing');
  batch = batch.replace(collectMarker,
`        char_bounce_height: num('reels-bounce-height', 20),\n        char_bounce_stagger: 0.05,\n        char_fx_strength: num('reels-char-fx-strength', 1.0),\n        char_fx_duration: num('reels-char-fx-duration', 0.36),\n        char_fx_stagger: num('reels-char-fx-stagger', 0.035),\n        metronome_bpm: num('reels-metro-bpm', 120),`);

  const applyStyleMarker = `    set('reels-bounce-height', style.char_bounce_height || 20);\n    set('reels-metro-bpm', style.metronome_bpm || 120);`;
  if (!batch.includes(applyStyleMarker)) throw new Error('letter-fx style apply marker missing');
  batch = batch.replace(applyStyleMarker,
`    set('reels-bounce-height', style.char_bounce_height || 20);\n    const charFxStrength = style.char_fx_strength ?? 1.0;\n    const charFxDuration = style.char_fx_duration ?? 0.36;\n    const charFxStagger = style.char_fx_stagger ?? 0.035;\n    set('reels-char-fx-strength', charFxStrength);\n    set('reels-char-fx-strength-range', charFxStrength);\n    set('reels-char-fx-duration', charFxDuration);\n    set('reels-char-fx-duration-range', charFxDuration);\n    set('reels-char-fx-stagger', charFxStagger);\n    set('reels-char-fx-stagger-range', charFxStagger);\n    set('reels-metro-bpm', style.metronome_bpm || 120);`);
}
syntax(batch, batchPath);
write(batchPath, batchBefore, batch);

// ─────────────────────────────────────────────────────────────
// Animation engine: one pure transform calculator for all six effects.
// Returning dx/dy/scale/rotation/opacity keeps preview and export deterministic.
// ─────────────────────────────────────────────────────────────
let animBefore = read(animPath);
let anim = animBefore;
if (!anim.includes('V4_4_49_CHARACTER_PRESET_TRANSFORM')) {
  const labelsMarker = `    ['逐字弹跳', 'char_bounce'],\n    ['逐字放大', 'letter_jump'],`;
  if (!anim.includes(labelsMarker)) throw new Error('letter-fx animation labels marker missing');
  anim = anim.replace(labelsMarker,
`    ['逐字弹跳', 'char_bounce'],\n    ['逐字上浮', 'char_rise'],\n    ['逐字弹性放大', 'char_elastic'],\n    ['逐字波浪', 'char_wave'],\n    ['逐字落下回弹', 'char_drop'],\n    ['逐字挤压弹跳', 'char_squash'],\n    ['中心扩散', 'char_center_spread'],\n    ['逐字放大', 'letter_jump'],`);

  const functionMarker = `/** Return scale factor for the currently-spoken word in letter-jump mode. */`;
  if (!anim.includes(functionMarker)) throw new Error('letter-fx engine function marker missing');
  const functionCode = `// V4_4_49_CHARACTER_PRESET_TRANSFORM\n// Six reusable character-entry effects. The result is intentionally a plain\n// transform object so Canvas preview and off-screen export use identical math.\nfunction computeCharacterPresetTransform(type, currentTime, segStart, charIndex, totalChars, options = {}) {\n    const identity = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };\n    if (currentTime == null) return identity;\n\n    const supported = new Set(['char_rise', 'char_elastic', 'char_wave', 'char_drop', 'char_squash', 'char_center_spread']);\n    if (!supported.has(type)) return identity;\n\n    const count = Math.max(1, parseInt(totalChars, 10) || 1);\n    const idx = Math.max(0, Math.min(count - 1, parseInt(charIndex, 10) || 0));\n    const strength = Math.max(0.25, Math.min(2.5, Number(options.strength ?? 1.0)));\n    const duration = Math.max(0.08, Math.min(2.0, Number(options.duration ?? 0.36)));\n    const stagger = Math.max(0, Math.min(0.5, Number(options.stagger ?? 0.035)));\n\n    let orderIndex = idx;\n    if (type === 'char_center_spread') {\n        const center = (count - 1) / 2;\n        const evenOffset = count % 2 === 0 ? 0.5 : 0;\n        orderIndex = Math.max(0, Math.abs(idx - center) - evenOffset);\n    }\n\n    const start = Number(segStart || 0) + orderIndex * stagger;\n    const dt = Number(currentTime) - start;\n    if (dt >= duration) return identity;\n\n    // Wave is a travelling accent over already-visible text. All other effects\n    // hide or transform characters that have not reached their own start time.\n    if (dt < 0 && type === 'char_wave') return identity;\n\n    const p = Math.max(0, Math.min(1, dt / duration));\n    const fade = easeOutCubic(p);\n\n    if (type === 'char_rise') {\n        const eased = easeOutCubic(p);\n        return { dx: 0, dy: (1 - eased) * 32 * strength, scaleX: 1, scaleY: 1, rotation: 0, opacity: eased };\n    }\n\n    if (type === 'char_elastic') {\n        const eased = easeOutElastic(p);\n        const amount = Math.min(0.55, 0.30 * strength);\n        const scale = Math.max(0.25, 1 + (eased - 1) * amount);\n        return { dx: 0, dy: 0, scaleX: scale, scaleY: scale, rotation: 0, opacity: fade };\n    }\n\n    if (type === 'char_wave') {\n        const envelope = Math.sin(Math.PI * p);\n        const dy = -20 * strength * envelope;\n        const rotation = 0.035 * strength * Math.sin(Math.PI * 2 * p);\n        return { dx: 0, dy, scaleX: 1, scaleY: 1, rotation, opacity: 1 };\n    }\n\n    if (type === 'char_drop') {\n        const eased = easeOutBounce(p);\n        return { dx: 0, dy: -(1 - eased) * 52 * strength, scaleX: 1, scaleY: 1, rotation: 0, opacity: Math.min(1, p * 3) };\n    }\n\n    if (type === 'char_squash') {\n        const eased = easeOutBack(p);\n        const delta = 1 - eased;\n        const scaleX = Math.max(0.35, 1 + 0.30 * strength * delta);\n        const scaleY = Math.max(0.35, 1 - 0.26 * strength * delta);\n        return { dx: 0, dy: 0, scaleX, scaleY, rotation: 0, opacity: Math.min(1, p * 3) };\n    }\n\n    const eased = easeOutCubic(p);\n    const targetCenterX = Number(options.targetCenterX || 0);\n    const sentenceCenterX = Number(options.sentenceCenterX || 0);\n    const spread = Math.min(1, 0.90 * strength);\n    const dx = (sentenceCenterX - targetCenterX) * (1 - eased) * spread;\n    const startScale = Math.max(0.68, 1 - 0.12 * strength);\n    const scale = startScale + (1 - startScale) * eased;\n    return { dx, dy: 0, scaleX: scale, scaleY: scale, rotation: 0, opacity: eased };\n}\n\n`;
  anim = anim.replace(functionMarker, functionCode + functionMarker);

  const exportMarker = `    computeLetterJumpScale,\n    computeWordRandomPopScale,`;
  if (!anim.includes(exportMarker)) throw new Error('letter-fx engine export marker missing');
  anim = anim.replace(exportMarker,
`    computeLetterJumpScale,\n    computeCharacterPresetTransform,\n    computeWordRandomPopScale,`);
}
syntax(anim, animPath);
write(animPath, animBefore, anim);

// ─────────────────────────────────────────────────────────────
// Canvas renderer: use the shared engine transform per character. Drawing each
// character through _drawWord() preserves normal fill, sentence/word gradients,
// shadow and regular stroke. Expanded stroke falls back to the normal outline
// for these six animated effects so a static expanded outline never lags behind.
// ─────────────────────────────────────────────────────────────
let rendererBefore = read(rendererPath);
let renderer = rendererBefore;
if (!renderer.includes('V4_4_49_CHARACTER_FX_RENDER')) {
  const flagMarker = `        // ── Character bounce ──\n        const isCharBounce = animInType === 'char_bounce';\n        const cbHeight = s.char_bounce_height || 20;\n        const cbStagger = s.char_bounce_stagger || 0.05;`;
  if (!renderer.includes(flagMarker)) throw new Error('letter-fx renderer flag marker missing');
  renderer = renderer.replace(flagMarker,
`        // ── Character bounce ──\n        const isCharBounce = animInType === 'char_bounce';\n        const cbHeight = s.char_bounce_height || 20;\n        const cbStagger = s.char_bounce_stagger || 0.05;\n\n        // V4_4_49_CHARACTER_FX_RENDER\n        const characterFxTypes = ['char_rise', 'char_elastic', 'char_wave', 'char_drop', 'char_squash', 'char_center_spread'];\n        const isCharacterFx = characterFxTypes.includes(animInType);\n        const totalCharacterFxCount = Math.max(1, words.reduce((count, word) => count + Array.from(word).length, 0));\n        const charFxStrength = Math.max(0.5, Math.min(2.0, Number(s.char_fx_strength ?? 1.0)));\n        const charFxDuration = Math.max(0.12, Math.min(0.90, Number(s.char_fx_duration ?? 0.36)));\n        const requestedCharFxStagger = Math.max(0, Math.min(0.12, Number(s.char_fx_stagger ?? 0.035)));\n        const characterFxSegDur = Math.max(0.001, segEnd - segStart);\n        const maxCharFxStagger = totalCharacterFxCount > 1\n            ? Math.max(0, (characterFxSegDur - Math.min(characterFxSegDur, charFxDuration)) / (totalCharacterFxCount - 1))\n            : requestedCharFxStagger;\n        const charFxStagger = Math.min(requestedCharFxStagger, maxCharFxStagger);`);

  const counterMarker = `        let wordCounter = 0;\n        let twCharCounter = 0;`;
  if (!renderer.includes(counterMarker)) throw new Error('letter-fx renderer counter marker missing');
  renderer = renderer.replace(counterMarker,
`        let wordCounter = 0;\n        let twCharCounter = 0;\n        let characterFxCounter = 0;`);

  const wordIndexMarker = `                wordCounter++;\n                const wordIdx = wordCounter - 1;\n                const totalWordCount = Math.max(1, words.length);`;
  if (!renderer.includes(wordIndexMarker)) throw new Error('letter-fx renderer word-index marker missing');
  renderer = renderer.replace(wordIndexMarker,
`                wordCounter++;\n                const wordIdx = wordCounter - 1;\n                const charFxOffset = characterFxCounter;\n                characterFxCounter += Array.from(wordStr).length;\n                const totalWordCount = Math.max(1, words.length);`);

  const expandMarker = `                    if (s.stroke_expand_enabled && needsPerWordStrokeExpand) {`;
  if (!renderer.includes(expandMarker)) throw new Error('letter-fx expanded-stroke marker missing');
  renderer = renderer.replace(expandMarker,
`                    if (s.stroke_expand_enabled && needsPerWordStrokeExpand && !isCharacterFx) {`);

  const shadowMarker = `                    if (shadowColor && shadowColor.includes(',')) {\n                        const shadowColors = shadowColor.split(',').map(c => c.trim());\n                        currentShadowColor = isHighlight ? (shadowColors[1] || shadowColors[0]) : shadowColors[0];\n                    }\n\n                    if (typewriterPartial) {`;
  if (!renderer.includes(shadowMarker)) throw new Error('letter-fx render-call marker missing');
  renderer = renderer.replace(shadowMarker,
`                    if (shadowColor && shadowColor.includes(',')) {\n                        const shadowColors = shadowColor.split(',').map(c => c.trim());\n                        currentShadowColor = isHighlight ? (shadowColors[1] || shadowColors[0]) : shadowColors[0];\n                    }\n\n                    const characterFx = isCharacterFx ? {\n                        type: animInType,\n                        currentTime,\n                        segStart,\n                        charOffset: charFxOffset,\n                        totalChars: totalCharacterFxCount,\n                        strength: charFxStrength,\n                        duration: charFxDuration,\n                        stagger: charFxStagger,\n                        sentenceCenterX: cx,\n                    } : null;\n\n                    if (typewriterPartial) {`);

  const drawMarker = `                        this._drawWord(ctx, wordStr, drawX, wordY, wordColor,\n                            useStroke && !s.stroke_expand_enabled, wordStrokeColor, borderW, outlineAlpha,\n                            currentShadowBlur, shadowOffX, shadowOffY, currentShadowColor, shadowAlpha, letterSpacing, s, wordGradient);`;
  if (!renderer.includes(drawMarker)) throw new Error('letter-fx normal draw marker missing');
  renderer = renderer.replace(drawMarker,
`                        this._drawWord(ctx, wordStr, drawX, wordY, wordColor,\n                            useStroke && (!s.stroke_expand_enabled || isCharacterFx), wordStrokeColor, borderW, outlineAlpha,\n                            currentShadowBlur, shadowOffX, shadowOffY, currentShadowColor, shadowAlpha, letterSpacing, s, wordGradient, characterFx);`);

  const signatureMarker = `    _drawWord(ctx, text, x, y, fillColor,\n        useStroke, strokeColor, strokeWidth, strokeAlpha,\n        shadowBlur, shadowOffX, shadowOffY, shadowColor, shadowAlpha, letterSpacing = 0, s = null, sharedGradient = null) {\n\n        // Speed Trail (motion blur / speed lines)`;
  if (!renderer.includes(signatureMarker)) throw new Error('letter-fx _drawWord signature marker missing');
  const animatedHead = `    _drawWord(ctx, text, x, y, fillColor,\n        useStroke, strokeColor, strokeWidth, strokeAlpha,\n        shadowBlur, shadowOffX, shadowOffY, shadowColor, shadowAlpha, letterSpacing = 0, s = null, sharedGradient = null, charAnim = null) {\n\n        // Six V4.4.49 letter presets are rendered character-by-character here.\n        // Recursing with charAnim=null reuses the normal shadow/stroke/fill code,\n        // so preview and export keep exactly the same typography pipeline.\n        const charEngine = (typeof ReelsAnimEngine !== 'undefined') ? ReelsAnimEngine : null;\n        if (charAnim && charEngine && typeof charEngine.computeCharacterPresetTransform === 'function' && text) {\n            const chars = Array.from(text);\n            const wordWidth = this._measureTextWithSpacing(ctx, text, letterSpacing);\n            const fontMatch = String(ctx.font || '').match(/(\\d+(?:\\.\\d+)?)px/);\n            const fontSize = fontMatch ? parseFloat(fontMatch[1]) : 80;\n            const centerY = y + fontSize * 0.5;\n            let animatedGradient = sharedGradient;\n            if (!animatedGradient && typeof fillColor === 'string' && fillColor.includes(',')) {\n                let gradientDirection = 'horizontal';\n                if (s) {\n                    gradientDirection = fillColor === s.color_high\n                        ? (s.high_gradient_direction || s.text_gradient_direction || 'horizontal')\n                        : (s.text_gradient_direction || 'horizontal');\n                }\n                animatedGradient = this._createTextGradient(ctx, fillColor, gradientDirection, {\n                    x, y, width: Math.max(1, wordWidth), height: Math.max(1, fontSize * 0.95)\n                });\n            }\n\n            let charX = x;\n            for (let localIndex = 0; localIndex < chars.length; localIndex++) {\n                const ch = chars[localIndex];\n                const charW = ctx.measureText(ch).width;\n                const charCenterX = charX + charW / 2;\n                const transform = charEngine.computeCharacterPresetTransform(\n                    charAnim.type, charAnim.currentTime, charAnim.segStart,\n                    (charAnim.charOffset || 0) + localIndex, charAnim.totalChars || chars.length,\n                    {\n                        strength: charAnim.strength,\n                        duration: charAnim.duration,\n                        stagger: charAnim.stagger,\n                        targetCenterX: charCenterX,\n                        sentenceCenterX: charAnim.sentenceCenterX,\n                    }\n                );\n\n                ctx.save();\n                ctx.globalAlpha *= Math.max(0, Math.min(1, Number(transform.opacity ?? 1)));\n                ctx.translate(charCenterX + Number(transform.dx || 0), centerY + Number(transform.dy || 0));\n                if (transform.rotation) ctx.rotate(Number(transform.rotation));\n                ctx.scale(Number(transform.scaleX || 1), Number(transform.scaleY || 1));\n                ctx.translate(-charCenterX, -centerY);\n                this._drawWord(ctx, ch, charX, y, fillColor,\n                    useStroke, strokeColor, strokeWidth, strokeAlpha,\n                    shadowBlur, shadowOffX, shadowOffY, shadowColor, shadowAlpha, 0, s, animatedGradient, null);\n                ctx.restore();\n                charX += charW + letterSpacing;\n            }\n            return;\n        }\n\n        // Speed Trail (motion blur / speed lines)`;
  renderer = renderer.replace(signatureMarker, animatedHead);
}
syntax(renderer, rendererPath);
write(rendererPath, rendererBefore, renderer);

if (!index.includes('value="char_center_spread"')
    || !index.includes('id="reels-char-fx-strength"')
    || !batch.includes('V4_4_49_LETTER_ANIMATION_PRESETS')
    || !batch.includes("char_fx_strength: num('reels-char-fx-strength', 1.0)")
    || !anim.includes('function computeCharacterPresetTransform(')
    || !anim.includes('computeCharacterPresetTransform,')
    || !renderer.includes('V4_4_49_CHARACTER_FX_RENDER')
    || !renderer.includes('charEngine.computeCharacterPresetTransform(')) {
  throw new Error('4.4.49 letter animation patch incomplete');
}

console.log('[4.4.49-letter-fx] Six adjustable T-subtitle letter animations are ready.');
