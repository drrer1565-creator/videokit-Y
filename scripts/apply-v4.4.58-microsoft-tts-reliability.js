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
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.58-ms-tts] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.58-ms-tts] no changes needed for ${path.relative(root, file)}`);
  }
};
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`4.4.58 Microsoft TTS marker missing: ${label}`);
  return source.replace(before, after);
};

// ── Output path UX: manual editing is allowed in addition to the folder picker.
{
  const file = files.index;
  const before = read(file);
  let src = before;
  if (!src.includes('V4_4_58_EDITABLE_TTS_OUTPUT')) {
    const oldField = '<label class="ms-field">输出目录<input id="ms-output" placeholder="默认下载目录" readonly></label>';
    const newField = '<!-- V4_4_58_EDITABLE_TTS_OUTPUT --><label class="ms-field">输出目录<input id="ms-output" placeholder="可输入路径，或点击“选择目录”" spellcheck="false"></label>';
    src = replaceOnce(src, oldField, newField, 'editable output directory field');
  }
  write(file, before, src);
}

// ── The TTS workspace uses openPath directly; expose the existing safe bridge on
// electronAPI as well (bridge.openPath already existed, but this page does not use it).
{
  const file = files.preload;
  const before = read(file);
  let src = before;
  if (!src.includes('V4_4_58_ELECTRON_OPEN_PATH')) {
    const marker = `    // 在 Finder/Explorer 中高亮显示文件\n    showItemInFolder: (filePath) => {`;
    const replacement = `    // V4_4_58_ELECTRON_OPEN_PATH\n    // Keep the page-facing API consistent with bridge.openPath.\n    openPath: safeOpenPath,\n\n${marker}`;
    src = replaceOnce(src, marker, replacement, 'electronAPI.openPath bridge');
  }
  new vm.Script(src, { filename: file });
  write(file, before, src);
}

// ── Front-end reliability: preview cache must be keyed by the selected voice,
// rate and pitch; opening files/folders must use a real path bridge; and current
// output fields must win over stale lastOutput state.
{
  const file = files.tts;
  const before = read(file);
  let src = before;

  if (!src.includes('V4_4_58_TTS_VOICE_CACHE_KEY')) {
    const marker = `    async function previewRow(row, button, statusEl, fullTextMode = false) {`;
    const helpers = `    // V4_4_58_TTS_VOICE_CACHE_KEY\n    // Audio previews are valid only for the exact voice/rate/pitch that created\n    // them. This prevents a previous voice from being replayed after selection.\n    function voiceSettingsKey(settings = currentVoiceSettings()) {\n        return [settings.voice, settings.rate, settings.pitch].join('|');\n    }\n\n    function invalidateVoicePreviewCache() {\n        stopAudio(true);\n        for (const row of rows) {\n            row._dirtyPreview = true;\n            row._dirtyFull = true;\n            row._previewSettingsKey = '';\n            row._fullPreviewSettingsKey = '';\n        }\n    }\n\n    async function openSystemPath(targetPath) {\n        const clean = String(targetPath || '').trim();\n        if (!clean) throw new Error('路径为空');\n        const opener = window.electronAPI?.openPath || window.bridge?.openPath;\n        if (typeof opener !== 'function') throw new Error('系统打开路径接口不可用');\n        const result = await opener(clean);\n        if (typeof result === 'string' && result.trim()) throw new Error(result.trim());\n        if (result && typeof result === 'object' && result.ok === false) throw new Error(result.error || '无法打开路径');\n        return true;\n    }\n\n${marker}`;
    src = replaceOnce(src, marker, helpers, 'voice-aware preview helpers');

    src = replaceOnce(
      src,
      `        if (!fullTextMode && row.audioBase64 && !row._dirtyPreview) {`,
      `        const previewSettings = currentVoiceSettings();\n        const previewKey = voiceSettingsKey(previewSettings);\n        if (!fullTextMode && row.audioBase64 && !row._dirtyPreview && row._previewSettingsKey === previewKey) {`,
      'short preview cache key'
    );
    src = replaceOnce(
      src,
      `        if (fullTextMode && row.fullAudioBase64 && !row._dirtyFull) {`,
      `        if (fullTextMode && row.fullAudioBase64 && !row._dirtyFull && row._fullPreviewSettingsKey === previewKey) {`,
      'full preview cache key'
    );
    src = replaceOnce(
      src,
      `            const opts = currentVoiceSettings();\n            const res = await request('edge-tts/preview', {`,
      `            const opts = previewSettings;\n            const res = await request('edge-tts/preview', {`,
      'preview request settings snapshot'
    );
    src = replaceOnce(
      src,
      `                row.fullAudioBase64 = res.audio_base64;\n                row._dirtyFull = false;`,
      `                row.fullAudioBase64 = res.audio_base64;\n                row._dirtyFull = false;\n                row._fullPreviewSettingsKey = previewKey;`,
      'full preview key write'
    );
    src = replaceOnce(
      src,
      `                row.audioBase64 = res.audio_base64;\n                row._dirtyPreview = false;`,
      `                row.audioBase64 = res.audio_base64;\n                row._dirtyPreview = false;\n                row._previewSettingsKey = previewKey;`,
      'short preview key write'
    );
    src = replaceOnce(
      src,
      `            setStatus('试听完成');`,
      `            const usedVoice = String(res.voice || opts.voice || '').replace(/^edge:/, '');\n            const engineLabel = res.engine ? \` · \${res.engine}\` : '';\n            setStatus(\`试听完成 · \${usedVoice}\${engineLabel}\`);`,
      'preview engine status'
    );
  }

  if (!src.includes('V4_4_58_TTS_OPEN_PATH_FIX')) {
    const oldOpen = `    async function showOrOpenFile(filePath, openDirectly = false) {\n        if (!filePath) return;\n        try {\n            if (!openDirectly && window.electronAPI?.showItemInFolder) {\n                await window.electronAPI.showItemInFolder(filePath);\n            } else if (window.electronAPI?.openPath) {\n                await window.electronAPI.openPath(filePath);\n            }\n        } catch (e) {\n            setStatus(e.message);\n        }\n    }`;
    const newOpen = `    // V4_4_58_TTS_OPEN_PATH_FIX\n    async function showOrOpenFile(filePath, openDirectly = false) {\n        if (!filePath) return;\n        try {\n            if (openDirectly) {\n                await openSystemPath(filePath);\n            } else if (window.electronAPI?.showItemInFolder) {\n                await window.electronAPI.showItemInFolder(filePath);\n            } else {\n                const parent = window.electronAPI?.pathDirname?.(filePath) || filePath;\n                await openSystemPath(parent);\n            }\n        } catch (e) {\n            setStatus('打开失败：' + e.message);\n        }\n    }`;
    src = replaceOnce(src, oldOpen, newOpen, 'MP3/MP4/SRT open actions');

    const oldOpenOutput = `        $('open-output').onclick = async () => {\n            try {\n                const base = ($('output')?.value || '').trim() || await window.electronAPI.getDownloadsPath();\n                const task = ($('task-folder')?.value || '').trim();\n                const target = lastOutput || (task ? \\`\${base.replace(/[\\\\/]+$/, '')}/\${task}\\` : base);\n                if (target) await window.electronAPI.openPath(target);\n            } catch (e) {\n                setStatus(e.message);\n            }\n        };`;
    const newOpenOutput = `        // V4_4_58_TTS_OPEN_PATH_FIX\n        $('open-output').onclick = async () => {\n            try {\n                const base = ($('output')?.value || '').trim() || await window.electronAPI.getDownloadsPath();\n                if (!base) throw new Error('请先设置输出目录');\n                const task = ($('task-folder')?.value || '').trim();\n                const candidate = task && window.electronAPI?.pathJoin ? window.electronAPI.pathJoin(base, task) : base;\n                const target = candidate && window.electronAPI?.fsExists?.(candidate) ? candidate : base;\n                await openSystemPath(target);\n                setStatus(\`已打开目录：\${target}\`);\n            } catch (e) {\n                setStatus('打开目录失败：' + e.message);\n            }\n        };`;
    src = replaceOnce(src, oldOpenOutput, newOpenOutput, 'open output directory action');
  }

  if (!src.includes('V4_4_58_TTS_SETTINGS_INVALIDATION')) {
    const oldHandlers = `        $('refresh').onclick = () => loadVoices(true);\n        $('voice-search').oninput = () => fillVoices();\n        $('voice').onchange = () => {\n            rows.forEach(r => { r._dirtyPreview = true; r._dirtyFull = true; });\n            save();\n        };\n        $('rate').onchange = () => {\n            rows.forEach(r => { r._dirtyPreview = true; r._dirtyFull = true; });\n            save();\n        };\n        if ($('pitch')) {\n            $('pitch').onchange = () => {\n                rows.forEach(r => { r._dirtyPreview = true; r._dirtyFull = true; });\n                save();\n            };\n        }\n        if ($('output')) $('output').oninput = save;\n        if ($('task-folder')) $('task-folder').oninput = save;`;
    const newHandlers = `        // V4_4_58_TTS_SETTINGS_INVALIDATION\n        $('refresh').onclick = () => loadVoices(true);\n        $('voice-search').oninput = () => {\n            const beforeVoice = $('voice')?.value;\n            fillVoices();\n            if ($('voice')?.value !== beforeVoice) invalidateVoicePreviewCache();\n        };\n        $('voice').onchange = () => { invalidateVoicePreviewCache(); save(); };\n        $('rate').onchange = () => { invalidateVoicePreviewCache(); save(); };\n        if ($('pitch')) {\n            $('pitch').onchange = () => { invalidateVoicePreviewCache(); save(); };\n        }\n        if ($('output')) $('output').oninput = () => { lastOutput = ''; save(); };\n        if ($('task-folder')) $('task-folder').oninput = () => { lastOutput = ''; save(); };`;
    src = replaceOnce(src, oldHandlers, newHandlers, 'voice/rate/pitch cache invalidation');

    const oldLanguage = `        $('language').onchange = () => {\n            if ($('voice-search')) $('voice-search').value = '';\n            fillVoices();\n            save();\n        };`;
    const newLanguage = `        $('language').onchange = () => {\n            if ($('voice-search')) $('voice-search').value = '';\n            fillVoices();\n            invalidateVoicePreviewCache();\n            save();\n        };`;
    src = replaceOnce(src, oldLanguage, newLanguage, 'language change cache invalidation');
  }

  if (!src.includes('V4_4_58_TTS_PREVIEW_ALL_KEYED')) {
    const oldBlock = `                let b64 = row.fullAudioBase64;\n                if (!b64) {\n                    const opts = currentVoiceSettings();\n                    const res = await request('edge-tts/preview', {\n                        text: row.text,\n                        voice: opts.voice,\n                        rate: opts.rate,\n                        pitch: opts.pitch,\n                    });\n                    b64 = res.audio_base64;\n                    row.fullAudioBase64 = b64;\n                }`;
    const newBlock = `                // V4_4_58_TTS_PREVIEW_ALL_KEYED\n                const opts = currentVoiceSettings();\n                const key = voiceSettingsKey(opts);\n                let b64 = row.fullAudioBase64;\n                if (!b64 || row._dirtyFull || row._fullPreviewSettingsKey !== key) {\n                    const res = await request('edge-tts/preview', {\n                        text: row.text,\n                        voice: opts.voice,\n                        rate: opts.rate,\n                        pitch: opts.pitch,\n                    });\n                    b64 = res.audio_base64;\n                    row.fullAudioBase64 = b64;\n                    row._dirtyFull = false;\n                    row._fullPreviewSettingsKey = key;\n                }`;
    src = replaceOnce(src, oldBlock, newBlock, 'preview-all voice-aware cache');

    src = replaceOnce(
      src,
      `                    row.fullAudioBase64 = result.audio_base64 || '';\n                    row._dirtyFull = false;`,
      `                    row.fullAudioBase64 = result.audio_base64 || '';\n                    row._dirtyFull = false;\n                    row._fullPreviewSettingsKey = voiceSettingsKey(opts);`,
      'generated audio cache key'
    );
  }

  new vm.Script(src, { filename: file });
  write(file, before, src);
}

// ── Back-end fidelity: never silently fall back to Google Translate TTS when a
// specific Microsoft voice was selected. Packaged Windows already bundles
// edge-tts Python; prefer that high-fidelity path, keep the native Edge client as
// fallback, and surface a real error if neither Microsoft route works.
{
  const file = files.edge;
  const before = read(file);
  let src = before;

  if (!src.includes('V4_4_58_STRICT_MICROSOFT_VOICE')) {
    const start = src.indexOf(`async function synthesize(text, voice, rate = '+0%', pitch = '+0Hz') {`);
    const end = src.indexOf('\nfunction safeSegment', start);
    if (start < 0 || end < 0) throw new Error('4.4.58 Microsoft TTS synthesize function bounds missing');
    const replacement = `// V4_4_58_STRICT_MICROSOFT_VOICE\nasync function synthesizeViaPython(text, shortName, validRate, validPitch) {\n    const output = path.join(settings.getSecureTmpDir(), \`edge_\${crypto.randomUUID()}.mp3\`);\n    try {\n        const result = await invokePythonBridge({\n            action: 'synthesize',\n            text,\n            voice: shortName,\n            rate: validRate,\n            pitch: validPitch,\n            output,\n        });\n        return {\n            audio: fs.readFileSync(output),\n            usedKey: null,\n            srt: result.srt || '',\n            engine: 'edge-python',\n            voice: shortName,\n        };\n    } finally {\n        if (fs.existsSync(output)) fs.unlinkSync(output);\n    }\n}\n\nasync function synthesize(text, voice, rate = '+0%', pitch = '+0Hz') {\n    const shortName = parseVoice(voice);\n    if (!String(text || '').trim()) throw new Error('配音文案不能为空');\n    const validRate = normalizeRate(rate);\n    const validPitch = normalizePitch(pitch);\n    const errors = [];\n\n    // Windows releases bundle edge-tts==7.2.8 specifically for reliable named\n    // Microsoft voices. Prefer it so Ava/Emma/Andrew/etc. cannot collapse into\n    // a generic locale-only fallback voice.\n    const preferPython = process.platform === 'win32' || Boolean(process.env.VIDEOKIT_EDGE_PYTHON);\n    if (preferPython) {\n        try {\n            return await synthesizeViaPython(text, shortName, validRate, validPitch);\n        } catch (error) {\n            errors.push(\`Python Edge-TTS: \${error.message}\`);\n            if (process.env.VIDEOKIT_EDGE_PYTHON) throw error;\n        }\n    }\n\n    try {\n        const result = await synthesizeNative(text, { voice: shortName, rate: validRate, pitch: validPitch }, 30000);\n        return { ...result, engine: 'edge-native', voice: shortName };\n    } catch (error) {\n        errors.push(\`Native Edge-TTS: \${error.message}\`);\n    }\n\n    if (!preferPython) {\n        try {\n            return await synthesizeViaPython(text, shortName, validRate, validPitch);\n        } catch (error) {\n            errors.push(\`Python Edge-TTS: \${error.message}\`);\n        }\n    }\n\n    throw new Error(\`所选微软音色 \${shortName} 合成失败。\${errors.join('；')}\`);\n}\n`;
    src = src.slice(0, start) + replacement + src.slice(end);

    src = replaceOnce(
      src,
      `    return {\n        audio_base64: res.audio.toString('base64'),\n        srt: res.srt || '',\n    };`,
      `    return {\n        audio_base64: res.audio.toString('base64'),\n        srt: res.srt || '',\n        engine: res.engine || 'edge',\n        voice: res.voice || parseVoice(data.voice),\n    };`,
      'preview voice/engine metadata'
    );

    src = replaceOnce(
      src,
      `        audio_base64: res.audio.toString('base64'),\n        srt: res.srt || '',\n    };`,
      `        audio_base64: res.audio.toString('base64'),\n        srt: res.srt || '',\n        engine: res.engine || 'edge',\n        voice: res.voice || parseVoice(data.voice),\n    };`,
      'save item voice/engine metadata'
    );
  }

  new vm.Script(src, { filename: file });
  write(file, before, src);
}

// Python edge-tts supports pitch; pass the UI's chosen value instead of silently
// ignoring it on the bundled Windows path.
{
  const file = files.bridge;
  const before = read(file);
  let src = before;
  if (!src.includes('V4_4_58_EDGE_PITCH')) {
    src = replaceOnce(
      src,
      `        communicate = edge_tts.Communicate(text, voice, rate=data.get('rate', '+0%'),\n                                          boundary='SentenceBoundary')`,
      `        # V4_4_58_EDGE_PITCH\n        communicate = edge_tts.Communicate(text, voice, rate=data.get('rate', '+0%'),\n                                          pitch=data.get('pitch', '+0Hz'),\n                                          boundary='SentenceBoundary')`,
      'Python Edge TTS pitch'
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
if (edge.slice(synthStart, synthEnd).includes('synthesizeCloudFallback')) {
  throw new Error('Microsoft TTS still silently falls back to a locale-only non-Microsoft voice');
}

console.log('[4.4.58-ms-tts] Voice selection, preview cache, output paths and file/folder actions are reliable.');
