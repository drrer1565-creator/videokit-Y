const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = {
  index: path.join(root, 'src', 'index.html'),
  tts: path.join(root, 'src', 'microsoft-tts.js'),
  preload: path.join(root, 'electron', 'preload.js'),
  edge: path.join(root, 'electron', 'services', 'edgeTts.js'),
  bridge: path.join(root, 'electron', 'services', 'edge_tts_bridge.py'),
};

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
const write = (file, before, after) => {
  if (before !== after) fs.writeFileSync(file, after, 'utf8');
  console.log(`[4.4.58-ms-tts] ${before !== after ? 'patched' : 'validated'} ${path.relative(root, file)}`);
};
const replaceOnce = (src, before, after, label) => {
  if (src.includes(after)) return src;
  if (!src.includes(before)) throw new Error(`4.4.58 Microsoft TTS marker missing: ${label}`);
  return src.replace(before, after);
};
const replaceRange = (src, startMarker, endMarker, replacement, label) => {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`4.4.58 Microsoft TTS range missing: ${label}`);
  return src.slice(0, start) + replacement + src.slice(end);
};

// Editable output path.
{
  const file = files.index;
  const before = read(file);
  let src = before;
  if (!src.includes('V4_4_58_EDITABLE_TTS_OUTPUT')) {
    src = replaceOnce(
      src,
      '<label class="ms-field">输出目录<input id="ms-output" placeholder="默认下载目录" readonly></label>',
      '<!-- V4_4_58_EDITABLE_TTS_OUTPUT --><label class="ms-field">输出目录<input id="ms-output" placeholder="可输入路径，或点击“选择目录”" spellcheck="false"></label>',
      'editable output directory field'
    );
  }
  write(file, before, src);
}

// Expose openPath on electronAPI (bridge.openPath already existed).
{
  const file = files.preload;
  const before = read(file);
  let src = before;
  if (!src.includes('V4_4_58_ELECTRON_OPEN_PATH')) {
    const marker = "    // 在 Finder/Explorer 中高亮显示文件\n    showItemInFolder: (filePath) => {";
    src = replaceOnce(
      src,
      marker,
      "    // V4_4_58_ELECTRON_OPEN_PATH\n    openPath: safeOpenPath,\n\n" + marker,
      'electronAPI.openPath bridge'
    );
  }
  new vm.Script(src, { filename: file });
  write(file, before, src);
}

// Front-end cache + file/folder actions.
{
  const file = files.tts;
  const before = read(file);
  let src = before;

  if (!src.includes('V4_4_58_TTS_VOICE_CACHE_KEY')) {
    const marker = '    async function previewRow(row, button, statusEl, fullTextMode = false) {';
    const helper = [
      '    // V4_4_58_TTS_VOICE_CACHE_KEY',
      '    function voiceSettingsKey(settings = currentVoiceSettings()) {',
      "        return [settings.voice, settings.rate, settings.pitch].join('|');",
      '    }',
      '',
      '    function invalidateVoicePreviewCache() {',
      '        stopAudio(true);',
      '        for (const row of rows) {',
      '            row._dirtyPreview = true;',
      '            row._dirtyFull = true;',
      "            row._previewSettingsKey = '';",
      "            row._fullPreviewSettingsKey = '';",
      '        }',
      '    }',
      '',
      '    async function openSystemPath(targetPath) {',
      "        const clean = String(targetPath || '').trim();",
      "        if (!clean) throw new Error('路径为空');",
      '        const opener = window.electronAPI?.openPath || window.bridge?.openPath;',
      "        if (typeof opener !== 'function') throw new Error('系统打开路径接口不可用');",
      '        const result = await opener(clean);',
      "        if (typeof result === 'string' && result.trim()) throw new Error(result.trim());",
      "        if (result && typeof result === 'object' && result.ok === false) throw new Error(result.error || '无法打开路径');",
      '        return true;',
      '    }',
      '',
      marker,
    ].join('\n');
    src = replaceOnce(src, marker, helper, 'voice-aware preview helpers');

    src = replaceOnce(
      src,
      '        if (!fullTextMode && row.audioBase64 && !row._dirtyPreview) {',
      "        const previewSettings = currentVoiceSettings();\n        const previewKey = voiceSettingsKey(previewSettings);\n        if (!fullTextMode && row.audioBase64 && !row._dirtyPreview && row._previewSettingsKey === previewKey) {",
      'short preview cache key'
    );
    src = replaceOnce(
      src,
      '        if (fullTextMode && row.fullAudioBase64 && !row._dirtyFull) {',
      '        if (fullTextMode && row.fullAudioBase64 && !row._dirtyFull && row._fullPreviewSettingsKey === previewKey) {',
      'full preview cache key'
    );
    src = replaceOnce(
      src,
      "            const opts = currentVoiceSettings();\n            const res = await request('edge-tts/preview', {",
      "            const opts = previewSettings;\n            const res = await request('edge-tts/preview', {",
      'preview settings snapshot'
    );
    src = replaceOnce(
      src,
      '                row.fullAudioBase64 = res.audio_base64;\n                row._dirtyFull = false;',
      '                row.fullAudioBase64 = res.audio_base64;\n                row._dirtyFull = false;\n                row._fullPreviewSettingsKey = previewKey;',
      'full preview key write'
    );
    src = replaceOnce(
      src,
      '                row.audioBase64 = res.audio_base64;\n                row._dirtyPreview = false;',
      '                row.audioBase64 = res.audio_base64;\n                row._dirtyPreview = false;\n                row._previewSettingsKey = previewKey;',
      'short preview key write'
    );
    src = replaceOnce(
      src,
      "            setStatus('试听完成');",
      "            const usedVoice = String(res.voice || opts.voice || '').replace(/^edge:/, '');\n            const engineLabel = res.engine ? ' · ' + res.engine : '';\n            setStatus('试听完成 · ' + usedVoice + engineLabel);",
      'preview voice status'
    );
  }

  if (!src.includes('V4_4_58_TTS_OPEN_PATH_FIX')) {
    const openReplacement = [
      '    // V4_4_58_TTS_OPEN_PATH_FIX',
      '    async function showOrOpenFile(filePath, openDirectly = false) {',
      '        if (!filePath) return;',
      '        try {',
      '            if (openDirectly) {',
      '                await openSystemPath(filePath);',
      '            } else if (window.electronAPI?.showItemInFolder) {',
      '                await window.electronAPI.showItemInFolder(filePath);',
      '            } else {',
      '                const parent = window.electronAPI?.pathDirname?.(filePath) || filePath;',
      '                await openSystemPath(parent);',
      '            }',
      '        } catch (e) {',
      "            setStatus('打开失败：' + e.message);",
      '        }',
      '    }',
      '',
    ].join('\n');
    src = replaceRange(
      src,
      '    async function showOrOpenFile(filePath, openDirectly = false) {',
      '    function sanitizeFilename(text) {',
      openReplacement + '    function sanitizeFilename(text) {',
      'MP3/MP4/SRT open actions'
    );

    const openOutputReplacement = [
      "        // V4_4_58_TTS_OPEN_PATH_FIX",
      "        $('open-output').onclick = async () => {",
      '            try {',
      "                const base = ($('output')?.value || '').trim() || await window.electronAPI.getDownloadsPath();",
      "                if (!base) throw new Error('请先设置输出目录');",
      "                const task = ($('task-folder')?.value || '').trim();",
      '                const candidate = task && window.electronAPI?.pathJoin ? window.electronAPI.pathJoin(base, task) : base;',
      '                const target = candidate && window.electronAPI?.fsExists?.(candidate) ? candidate : base;',
      '                await openSystemPath(target);',
      "                setStatus('已打开目录：' + target);",
      '            } catch (e) {',
      "                setStatus('打开目录失败：' + e.message);",
      '            }',
      '        };',
      '',
    ].join('\n');
    src = replaceRange(
      src,
      "        $('open-output').onclick = async () => {",
      "        $('refresh').onclick = () => loadVoices(true);",
      openOutputReplacement + "        $('refresh').onclick = () => loadVoices(true);",
      'open output directory action'
    );
  }

  if (!src.includes('V4_4_58_TTS_SETTINGS_INVALIDATION')) {
    src = replaceOnce(
      src,
      "        $('language').onchange = () => {\n            if ($('voice-search')) $('voice-search').value = '';\n            fillVoices();\n            save();\n        };",
      "        $('language').onchange = () => {\n            if ($('voice-search')) $('voice-search').value = '';\n            fillVoices();\n            invalidateVoicePreviewCache();\n            save();\n        };",
      'language selection invalidation'
    );

    const settingsReplacement = [
      '        // V4_4_58_TTS_SETTINGS_INVALIDATION',
      "        $('refresh').onclick = () => loadVoices(true);",
      "        $('voice-search').oninput = () => {",
      "            const beforeVoice = $('voice')?.value;",
      '            fillVoices();',
      "            if ($('voice')?.value !== beforeVoice) invalidateVoicePreviewCache();",
      '        };',
      "        $('voice').onchange = () => { invalidateVoicePreviewCache(); save(); };",
      "        $('rate').onchange = () => { invalidateVoicePreviewCache(); save(); };",
      "        if ($('pitch')) {",
      "            $('pitch').onchange = () => { invalidateVoicePreviewCache(); save(); };",
      '        }',
      "        if ($('output')) $('output').oninput = () => { lastOutput = ''; save(); };",
      "        if ($('task-folder')) $('task-folder').oninput = () => { lastOutput = ''; save(); };",
      '',
    ].join('\n');
    src = replaceRange(
      src,
      "        $('refresh').onclick = () => loadVoices(true);",
      '        for (const input of zipFormatInputs()) {',
      settingsReplacement + '        for (const input of zipFormatInputs()) {',
      'voice/rate/pitch handlers'
    );
  }

  if (!src.includes('V4_4_58_TTS_PREVIEW_ALL_KEYED')) {
    const oldBlock = [
      '                let b64 = row.fullAudioBase64;',
      '                if (!b64) {',
      '                    const opts = currentVoiceSettings();',
      "                    const res = await request('edge-tts/preview', {",
      '                        text: row.text,',
      '                        voice: opts.voice,',
      '                        rate: opts.rate,',
      '                        pitch: opts.pitch,',
      '                    });',
      '                    b64 = res.audio_base64;',
      '                    row.fullAudioBase64 = b64;',
      '                }',
    ].join('\n');
    const newBlock = [
      '                // V4_4_58_TTS_PREVIEW_ALL_KEYED',
      '                const opts = currentVoiceSettings();',
      '                const key = voiceSettingsKey(opts);',
      '                let b64 = row.fullAudioBase64;',
      '                if (!b64 || row._dirtyFull || row._fullPreviewSettingsKey !== key) {',
      "                    const res = await request('edge-tts/preview', {",
      '                        text: row.text,',
      '                        voice: opts.voice,',
      '                        rate: opts.rate,',
      '                        pitch: opts.pitch,',
      '                    });',
      '                    b64 = res.audio_base64;',
      '                    row.fullAudioBase64 = b64;',
      '                    row._dirtyFull = false;',
      '                    row._fullPreviewSettingsKey = key;',
      '                }',
    ].join('\n');
    src = replaceOnce(src, oldBlock, newBlock, 'preview-all cache key');
    src = replaceOnce(
      src,
      "                    row.fullAudioBase64 = result.audio_base64 || '';\n                    row._dirtyFull = false;",
      "                    row.fullAudioBase64 = result.audio_base64 || '';\n                    row._dirtyFull = false;\n                    row._fullPreviewSettingsKey = voiceSettingsKey(opts);",
      'generated audio cache key'
    );
  }

  new vm.Script(src, { filename: file });
  write(file, before, src);
}

// Back-end: preserve the selected Microsoft voice. Windows releases bundle
// edge-tts, so prefer it; never silently substitute Google Translate TTS.
{
  const file = files.edge;
  const before = read(file);
  let src = before;
  if (!src.includes('V4_4_58_STRICT_MICROSOFT_VOICE')) {
    const startMarker = "async function synthesize(text, voice, rate = '+0%', pitch = '+0Hz') {";
    const endMarker = 'function safeSegment(value, fallback = \'Default\') {';
    const replacement = [
      '// V4_4_58_STRICT_MICROSOFT_VOICE',
      'async function synthesizeViaPython(text, shortName, validRate, validPitch) {',
      "    const output = path.join(settings.getSecureTmpDir(), 'edge_' + crypto.randomUUID() + '.mp3');",
      '    try {',
      '        const result = await invokePythonBridge({',
      "            action: 'synthesize',",
      '            text,',
      '            voice: shortName,',
      '            rate: validRate,',
      '            pitch: validPitch,',
      '            output,',
      '        });',
      '        return {',
      '            audio: fs.readFileSync(output),',
      '            usedKey: null,',
      "            srt: result.srt || '',",
      "            engine: 'edge-python',",
      '            voice: shortName,',
      '        };',
      '    } finally {',
      '        if (fs.existsSync(output)) fs.unlinkSync(output);',
      '    }',
      '}',
      '',
      "async function synthesize(text, voice, rate = '+0%', pitch = '+0Hz') {",
      '    const shortName = parseVoice(voice);',
      "    if (!String(text || '').trim()) throw new Error('配音文案不能为空');",
      '    const validRate = normalizeRate(rate);',
      '    const validPitch = normalizePitch(pitch);',
      '    const errors = [];',
      "    const preferPython = process.platform === 'win32' || Boolean(process.env.VIDEOKIT_EDGE_PYTHON);",
      '    if (preferPython) {',
      '        try {',
      '            return await synthesizeViaPython(text, shortName, validRate, validPitch);',
      '        } catch (error) {',
      "            errors.push('Python Edge-TTS: ' + error.message);",
      '            if (process.env.VIDEOKIT_EDGE_PYTHON) throw error;',
      '        }',
      '    }',
      '    try {',
      '        const result = await synthesizeNative(text, { voice: shortName, rate: validRate, pitch: validPitch }, 30000);',
      "        return { ...result, engine: 'edge-native', voice: shortName };",
      '    } catch (error) {',
      "        errors.push('Native Edge-TTS: ' + error.message);",
      '    }',
      '    if (!preferPython) {',
      '        try {',
      '            return await synthesizeViaPython(text, shortName, validRate, validPitch);',
      '        } catch (error) {',
      "            errors.push('Python Edge-TTS: ' + error.message);",
      '        }',
      '    }',
      "    throw new Error('所选微软音色 ' + shortName + ' 合成失败。' + errors.join('；'));",
      '}',
      '',
      endMarker,
    ].join('\n');
    src = replaceRange(src, startMarker, endMarker, replacement, 'strict Microsoft voice synthesize');

    const previewStart = src.indexOf('async function preview(data = {}) {');
    const previewEnd = src.indexOf('\nasync function saveItem', previewStart);
    if (previewStart < 0 || previewEnd < 0) throw new Error('preview function bounds missing');
    let previewPart = src.slice(previewStart, previewEnd);
    previewPart = replaceOnce(
      previewPart,
      "        srt: res.srt || '',\n    };",
      "        srt: res.srt || '',\n        engine: res.engine || 'edge',\n        voice: res.voice || parseVoice(data.voice),\n    };",
      'preview engine metadata'
    );
    src = src.slice(0, previewStart) + previewPart + src.slice(previewEnd);

    const saveStart = src.indexOf('async function saveItem(data = {}) {');
    const saveEnd = src.indexOf('\nasync function createZip', saveStart);
    if (saveStart < 0 || saveEnd < 0) throw new Error('saveItem function bounds missing');
    let savePart = src.slice(saveStart, saveEnd);
    savePart = replaceOnce(
      savePart,
      "        srt: res.srt || '',\n    };",
      "        srt: res.srt || '',\n        engine: res.engine || 'edge',\n        voice: res.voice || parseVoice(data.voice),\n    };",
      'save engine metadata'
    );
    src = src.slice(0, saveStart) + savePart + src.slice(saveEnd);
  }
  new vm.Script(src, { filename: file });
  write(file, before, src);
}

// Preserve selected pitch on the bundled Python path.
{
  const file = files.bridge;
  const before = read(file);
  let src = before;
  if (!src.includes('V4_4_58_EDGE_PITCH')) {
    src = replaceOnce(
      src,
      "        communicate = edge_tts.Communicate(text, voice, rate=data.get('rate', '+0%'),\n                                          boundary='SentenceBoundary')",
      "        # V4_4_58_EDGE_PITCH\n        communicate = edge_tts.Communicate(text, voice, rate=data.get('rate', '+0%'),\n                                          pitch=data.get('pitch', '+0Hz'),\n                                          boundary='SentenceBoundary')",
      'Python pitch forwarding'
    );
  }
  write(file, before, src);
}

const index = read(files.index);
const tts = read(files.tts);
const preload = read(files.preload);
const edge = read(files.edge);
const bridge = read(files.bridge);
for (const [source, marker] of [
  [index, 'V4_4_58_EDITABLE_TTS_OUTPUT'],
  [preload, 'V4_4_58_ELECTRON_OPEN_PATH'],
  [tts, 'V4_4_58_TTS_VOICE_CACHE_KEY'],
  [tts, 'V4_4_58_TTS_OPEN_PATH_FIX'],
  [tts, 'V4_4_58_TTS_SETTINGS_INVALIDATION'],
  [tts, 'V4_4_58_TTS_PREVIEW_ALL_KEYED'],
  [edge, 'V4_4_58_STRICT_MICROSOFT_VOICE'],
  [bridge, 'V4_4_58_EDGE_PITCH'],
]) {
  if (!source.includes(marker)) throw new Error(`4.4.58 Microsoft TTS patch incomplete: ${marker}`);
}
if (/id="ms-output"[^>]*\sreadonly(?:\s|>)/.test(index)) throw new Error('Microsoft TTS output field is still readonly');
const synthStart = edge.indexOf('async function synthesize(text, voice');
const synthEnd = edge.indexOf('\nfunction safeSegment', synthStart);
if (edge.slice(synthStart, synthEnd).includes('synthesizeCloudFallback')) throw new Error('Generic cloud voice fallback is still reachable');
console.log('[4.4.58-ms-tts] Voice switching, output paths and open actions are reliable.');
