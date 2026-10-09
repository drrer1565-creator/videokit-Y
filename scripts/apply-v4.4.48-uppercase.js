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
    console.log(`[4.4.48-uppercase] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.48-uppercase] no changes needed for ${path.relative(root, file)}`);
  }
}

function syntax(source, file) {
  new vm.Script(source, { filename: file });
}

// T-subtitle UI: add a non-destructive display-only uppercase switch next to B/I.
let indexBefore = read(indexPath);
let index = indexBefore;
if (!index.includes('id="reels-uppercase"')) {
  const marker = `                        <label class="checkbox-label" style="margin:0;"><input type="checkbox" id="reels-italic"\n                            onchange="reelsRefreshSubtitleWeightOptions(); reelsUpdatePreview()"><span>I</span></label>`;
  if (!index.includes(marker)) throw new Error('uppercase UI marker missing');
  index = index.replace(marker, marker + `\n                        <label class="checkbox-label" style="margin:0;" title="仅改变字幕显示，不修改原始 SRT/TXT 文本"><input type="checkbox" id="reels-uppercase"\n                            onchange="reelsUpdatePreview()"><span>大写</span></label>`);
}
write(indexPath, indexBefore, index);

// Persist the switch as a normal T-subtitle style property. Missing in old presets => false.
let batchBefore = read(batchPath);
let batch = batchBefore;
if (!batch.includes('V4_4_48_T_SUBTITLE_UPPERCASE')) {
  const collectMarker = `        bold: num('reels-font-weight', chk('reels-bold') ? 700 : 400) >= 600,\n        italic: chk('reels-italic'),\n        letter_spacing: num('reels-letter-spacing', 0),`;
  if (!batch.includes(collectMarker)) throw new Error('uppercase collect marker missing');
  batch = batch.replace(collectMarker,
`        bold: num('reels-font-weight', chk('reels-bold') ? 700 : 400) >= 600,\n        italic: chk('reels-italic'),\n        // V4_4_48_T_SUBTITLE_UPPERCASE: display-only; original subtitle text remains untouched.\n        uppercase: chk('reels-uppercase'),\n        letter_spacing: num('reels-letter-spacing', 0),`);

  const applyMarker = `    setChk('reels-bold', weight >= 600);\n    setChk('reels-italic', style.italic);\n    set('reels-letter-spacing', style.letter_spacing || 0);`;
  if (!batch.includes(applyMarker)) throw new Error('uppercase apply marker missing');
  batch = batch.replace(applyMarker,
`    setChk('reels-bold', weight >= 600);\n    setChk('reels-italic', style.italic);\n    setChk('reels-uppercase', !!style.uppercase);\n    set('reels-letter-spacing', style.letter_spacing || 0);`);
}
syntax(batch, batchPath);
write(batchPath, batchBefore, batch);

// Renderer: uppercase is applied to display text before measurement/wrapping/drawing,
// while segment.text / edited_text and timing data are never mutated.
let rendererBefore = read(rendererPath);
let renderer = rendererBefore;
if (!renderer.includes('V4_4_48_T_SUBTITLE_UPPERCASE_RENDER')) {
  const mainTextMarker = `        const segmentText = segment.edited_text || segment.text || '';\n        const textDirection = (typeof ReelsTextDirection !== 'undefined')\n            ? ReelsTextDirection.resolve(s.text_direction, segmentText)\n            : 'ltr';`;
  if (!renderer.includes(mainTextMarker)) throw new Error('uppercase main text marker missing');
  renderer = renderer.replace(mainTextMarker,
`        const segmentText = segment.edited_text || segment.text || '';\n        // V4_4_48_T_SUBTITLE_UPPERCASE_RENDER: transform only the display string.\n        // Keeping segmentText intact preserves SRT/TXT content, word timings and saved projects.\n        const displaySegmentText = s.uppercase ? segmentText.toUpperCase() : segmentText;\n        const textDirection = (typeof ReelsTextDirection !== 'undefined')\n            ? ReelsTextDirection.resolve(s.text_direction, displaySegmentText)\n            : 'ltr';`);

  const mainDisplayMarker = `        const text = segmentText;\n        if (!text.trim()) return;`;
  if (!renderer.includes(mainDisplayMarker)) throw new Error('uppercase display marker missing');
  renderer = renderer.replace(mainDisplayMarker,
`        const text = displaySegmentText;\n        if (!text.trim()) return;`);

  // Auto-color/rich-text ranges stay anchored to the original text indices.
  const renderedTextMarker = `        const renderedText = segmentText;`;
  if (!renderer.includes(renderedTextMarker)) throw new Error('uppercase range marker missing');

  const flatWordsMarker = `        const flatWords = wordsInfo.length > 0\n            ? wordsInfo.map(w => w.word || '').filter(Boolean)\n            : text.split(/\\s+/).filter(Boolean);`;
  if (!renderer.includes(flatWordsMarker)) throw new Error('uppercase timed words marker missing');
  renderer = renderer.replace(flatWordsMarker,
`        const flatWords = wordsInfo.length > 0\n            ? wordsInfo.map(w => {\n                const word = w.word || '';\n                return s.uppercase ? word.toUpperCase() : word;\n            }).filter(Boolean)\n            : text.split(/\\s+/).filter(Boolean);`);

  // Rich text: split ranges against original text first, then uppercase each display chunk.
  const richTextMarker = `        const text = segment.edited_text || segment.text || '';\n        const textDirection = (typeof ReelsTextDirection !== 'undefined')\n            ? ReelsTextDirection.resolve(s.text_direction, text)\n            : 'ltr';`;
  if (!renderer.includes(richTextMarker)) throw new Error('uppercase rich text marker missing');
  renderer = renderer.replace(richTextMarker,
`        const text = segment.edited_text || segment.text || '';\n        const displayText = s.uppercase ? text.toUpperCase() : text;\n        const textDirection = (typeof ReelsTextDirection !== 'undefined')\n            ? ReelsTextDirection.resolve(s.text_direction, displayText)\n            : 'ltr';`);

  const richChunkMarker = `        for (const chunk of rawChunks) {\n            const regex = /([^ \\n]+|[ \\n])/g;\n            let match;\n            while ((match = regex.exec(chunk.text)) !== null) {`;
  if (!renderer.includes(richChunkMarker)) throw new Error('uppercase rich chunk marker missing');
  renderer = renderer.replace(richChunkMarker,
`        for (const chunk of rawChunks) {\n            const displayChunkText = s.uppercase ? chunk.text.toUpperCase() : chunk.text;\n            const regex = /([^ \\n]+|[ \\n])/g;\n            let match;\n            while ((match = regex.exec(displayChunkText)) !== null) {`);

  // Full-page typewriter: both measured text and timed word tokens use uppercase display text.
  const fpDirectionMarker = `        const directionSample = segments.map(seg => seg.edited_text || seg.text || '').join('\\n');`;
  if (!renderer.includes(fpDirectionMarker)) throw new Error('uppercase fullpage direction marker missing');
  renderer = renderer.replace(fpDirectionMarker,
`        const directionSample = segments.map(seg => {\n            const value = seg.edited_text || seg.text || '';\n            return s.uppercase ? value.toUpperCase() : value;\n        }).join('\\n');`);

  const fpTextMarker = `            const text = seg.edited_text || seg.text || '';\n            if (!text.trim()) continue;`;
  if (!renderer.includes(fpTextMarker)) throw new Error('uppercase fullpage text marker missing');
  renderer = renderer.replace(fpTextMarker,
`            const sourceText = seg.edited_text || seg.text || '';\n            const text = s.uppercase ? sourceText.toUpperCase() : sourceText;\n            if (!text.trim()) continue;`);

  const fpWordMarker = `                            text: w.word,\n                            start: w.start,`;
  if (!renderer.includes(fpWordMarker)) throw new Error('uppercase fullpage word marker missing');
  renderer = renderer.replace(fpWordMarker,
`                            text: s.uppercase ? String(w.word || '').toUpperCase() : w.word,\n                            start: w.start,`);

  // Scatter-pop caches timing/layout groups, so include the case mode in the cache key
  // and copy timed words with display-only uppercase when enabled.
  const scatterKeyMarker = `                    minRotate + '_' + maxRotate + '_' + videoW + '_' + videoH;`;
  if (!renderer.includes(scatterKeyMarker)) throw new Error('uppercase scatter key marker missing');
  renderer = renderer.replace(scatterKeyMarker,
`                    minRotate + '_' + maxRotate + '_' + videoW + '_' + videoH + '_' +\n                    (s.uppercase ? 'upper' : 'normal');`);

  const scatterWordsMarker = `        let words = segment.words;\n        if (!words || words.length === 0) {\n            const text = segment.edited_text || segment.text || '';`;
  if (!renderer.includes(scatterWordsMarker)) throw new Error('uppercase scatter words marker missing');
  renderer = renderer.replace(scatterWordsMarker,
`        let words = Array.isArray(segment.words)\n            ? segment.words.map(w => ({ ...w, word: s.uppercase ? String(w.word || '').toUpperCase() : w.word }))\n            : segment.words;\n        if (!words || words.length === 0) {\n            const sourceText = segment.edited_text || segment.text || '';\n            const text = s.uppercase ? sourceText.toUpperCase() : sourceText;`);

  // Random-position mode receives timed words from a shared helper; transform a copy only.
  const randomWordsMarker = `        const words = this._getTimedWords(segment);\n        if (!words.length) return;`;
  if (!renderer.includes(randomWordsMarker)) throw new Error('uppercase random-position marker missing');
  renderer = renderer.replace(randomWordsMarker,
`        const sourceWords = this._getTimedWords(segment);\n        const words = s.uppercase\n            ? sourceWords.map(w => ({ ...w, word: String(w.word || '').toUpperCase() }))\n            : sourceWords;\n        if (!words.length) return;`);

  // ASS fallback/export: preserve original text but emit uppercase display text when selected.
  const assMarker = `    const events = segments.map(seg => {\n        const sourceText = seg.text || '';\n        const rawText = sourceText.replace(/\\n/g, '\\\\N');\n        const segmentStyle = seg.style_override || seg.subtitle_style || {};`;
  if (!renderer.includes(assMarker)) throw new Error('uppercase ASS marker missing');
  renderer = renderer.replace(assMarker,
`    const events = segments.map(seg => {\n        const segmentStyle = seg.style_override || seg.subtitle_style || {};\n        const shouldUppercase = segmentStyle.uppercase !== undefined ? !!segmentStyle.uppercase : !!s.uppercase;\n        const sourceText = seg.text || '';\n        const displayText = shouldUppercase ? sourceText.toUpperCase() : sourceText;\n        const rawText = displayText.replace(/\\n/g, '\\\\N');`);

  const assChunkMarker = `                const segChunkText = c.text.replace(/\\n/g, '\\\\N');`;
  if (!renderer.includes(assChunkMarker)) throw new Error('uppercase ASS rich chunk marker missing');
  renderer = renderer.replace(assChunkMarker,
`                const segChunkText = (shouldUppercase ? c.text.toUpperCase() : c.text).replace(/\\n/g, '\\\\N');`);
}
syntax(renderer, rendererPath);
write(rendererPath, rendererBefore, renderer);

if (!index.includes('id="reels-uppercase"')
    || !batch.includes("uppercase: chk('reels-uppercase')")
    || !batch.includes("setChk('reels-uppercase', !!style.uppercase)")
    || !renderer.includes('const displaySegmentText = s.uppercase ? segmentText.toUpperCase() : segmentText')
    || !renderer.includes("word: String(w.word || '').toUpperCase()")) {
  throw new Error('4.4.48 uppercase patch incomplete');
}

console.log('[4.4.48-uppercase] T-subtitle uppercase switch is ready and preset-safe.');
