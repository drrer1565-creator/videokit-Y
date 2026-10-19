const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src', 'microsoft-tts.js');
const read = () => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
const section = (src, startMarker, endMarker, replacement, label) => {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`4.4.59 TTS frontend section missing: ${label}`);
  return src.slice(0, start) + replacement + src.slice(end);
};
const replaceOnce = (src, before, after, label) => {
  if (src.includes(after)) return src;
  if (!src.includes(before)) throw new Error(`4.4.59 TTS frontend marker missing: ${label}`);
  return src.replace(before, after);
};

const before = read();
let src = before;
if (!src.includes('V4_4_58_TTS_VOICE_CACHE_KEY')) throw new Error('4.4.58 Microsoft TTS reliability patch must run before v4.4.59');

if (!src.includes('V4_4_59_TTS_PLAYBACK_LIFECYCLE')) {
  src = replaceOnce(src, '    let previewRunId = 0;\n', [
    '    let previewRunId = 0;',
    '    // V4_4_59_TTS_PLAYBACK_LIFECYCLE',
    '    let currentAudioSettle = null;',
    '    let previewAllToken = 0;',
    '',
  ].join('\n'), 'playback state');

  const playback = [
    '    // V4_4_59_TTS_PLAYBACK_LIFECYCLE',
    '    function stopAudio(invalidate = true) {',
    '        if (invalidate) previewRunId += 1;',
    '        const settle = currentAudioSettle;',
    '        currentAudioSettle = null;',
    '        if (currentAudio) {',
    '            try { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio.src = ""; } catch (_) {}',
    '        }',
    '        if (currentAudioUrl) { try { URL.revokeObjectURL(currentAudioUrl); } catch (_) {} currentAudioUrl = ""; }',
    '        currentAudio = null;',
    '        if (currentPlayBtn) {',
    '            currentPlayBtn.disabled = false;',
    '            currentPlayBtn.textContent = currentPlayBtn.dataset.label || "试听";',
    '            currentPlayBtn = null;',
    '        }',
    '        currentPlayRowId = "";',
    '        if (settle) { try { settle({ stopped: true }); } catch (_) {} }',
    '    }',
    '',
    '    function base64ToUint8Array(base64) {',
    '        const bin = atob(base64);',
    '        const bytes = new Uint8Array(bin.length);',
    '        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);',
    '        return bytes;',
    '    }',
    '',
    '    async function playAudioSource(source, revokeWhenDone, button, row, statusEl, activeLabel = "播放中 (点击停止)") {',
    '        const runId = ++previewRunId;',
    '        stopAudio(false);',
    '        currentPlayBtn = button;',
    '        currentPlayRowId = row ? row.id : "";',
    '        if (button) { button.disabled = false; button.textContent = activeLabel; }',
    '        if (statusEl) statusEl.textContent = "播放中";',
    '        currentAudioUrl = revokeWhenDone ? source : "";',
    '        const audio = new Audio(source);',
    '        currentAudio = audio;',
    '        return new Promise((resolve, reject) => {',
    '            let settled = false;',
    '            const settle = (result, error) => {',
    '                if (settled) return;',
    '                settled = true;',
    '                if (currentAudioSettle === settle) currentAudioSettle = null;',
    '                if (currentAudio === audio) {',
    '                    if (revokeWhenDone && currentAudioUrl) { try { URL.revokeObjectURL(currentAudioUrl); } catch (_) {} currentAudioUrl = ""; }',
    '                    currentAudio = null;',
    '                    if (currentPlayBtn === button) {',
    '                        if (button) { button.disabled = false; button.textContent = button.dataset.label || "试听"; }',
    '                        currentPlayBtn = null;',
    '                        currentPlayRowId = "";',
    '                    }',
    '                }',
    '                if (error) reject(error); else resolve(result || { stopped: false });',
    '            };',
    '            currentAudioSettle = settle;',
    '            audio.onended = () => {',
    '                if (runId === previewRunId && statusEl) statusEl.textContent = row?.fileName || "试听完成";',
    '                settle({ stopped: false });',
    '            };',
    '            audio.onerror = () => { if (statusEl) statusEl.textContent = "播放失败"; settle(null, new Error("音频播放失败")); };',
    '            audio.play().catch(error => { if (statusEl) statusEl.textContent = "播放失败"; settle(null, error); });',
    '        });',
    '    }',
    '',
    '    async function playAudioBase64(base64, button, row, statusEl, activeLabel = "播放中 (点击停止)") {',
    '        const bytes = base64ToUint8Array(base64);',
    '        const blob = new Blob([bytes], { type: "audio/mpeg" });',
    '        return playAudioSource(URL.createObjectURL(blob), true, button, row, statusEl, activeLabel);',
    '    }',
    '',
    '    function fileExists(filePath) {',
    '        const value = String(filePath || "").trim();',
    '        if (!value) return false;',
    '        const exists = window.electronAPI?.fsExists;',
    '        if (typeof exists !== "function") return true;',
    '        try { return Boolean(exists(value)); } catch (_) { return false; }',
    '    }',
    '',
    '    async function playAudioPath(filePath, button, row, statusEl, activeLabel = "播放中 (点击停止)") {',
    '        const value = String(filePath || "").trim();',
    '        if (!value || !fileExists(value)) throw new Error("已生成的音频文件不存在，请重新生成");',
    '        const source = typeof window.electronAPI?.toFileUrl === "function" ? window.electronAPI.toFileUrl(value) : value;',
    '        return playAudioSource(source, false, button, row, statusEl, activeLabel);',
    '    }',
    '',
  ].join('\n');
  src = section(src, '    function stopAudio(invalidate = true) {', '    function currentVoiceSettings() {', playback, 'playback subsystem');
}

if (!src.includes('V4_4_59_TTS_FILE_RECONCILE')) {
  const helpers = [
    '    // V4_4_59_TTS_FILE_RECONCILE',
    '    function currentVoiceSettings() {',
    '        return {',
    '            voice: String($("voice")?.value || "").trim(),',
    '            rate: $("rate")?.value || "+0%",',
    '            pitch: $("pitch")?.value || "+0Hz",',
    '        };',
    '    }',
    '',
    '    function reconcileRowFiles(row) {',
    '        if (!row || row.state !== "success") return true;',
    '        if (!fileExists(row.audio)) {',
    '            row.state = "waiting";',
    '            row.warning = "原生成音频已不存在，已恢复为待生成";',
    '            row.error = "";',
    '            row.audio = row.mp4 = row.srt = row.fileName = row.baseName = "";',
    '            row.audioBase64 = row.fullAudioBase64 = "";',
    '            return false;',
    '        }',
    '        const warnings = [];',
    '        if (row.mp4 && !fileExists(row.mp4)) { row.mp4 = ""; warnings.push("MP4 文件不存在"); }',
    '        if (row.srt && !fileExists(row.srt)) { row.srt = ""; warnings.push("SRT 文件不存在"); }',
    '        if (warnings.length) row.warning = warnings.join("；");',
    '        row.fullAudioBase64 = "";',
    '        return true;',
    '    }',
    '',
    '    function reconcileAllRows() {',
    '        let changed = false;',
    '        for (const row of rows) {',
    '            const prev = [row.state, row.audio, row.mp4, row.srt, row.warning || ""].join("|");',
    '            reconcileRowFiles(row);',
    '            const next = [row.state, row.audio, row.mp4, row.srt, row.warning || ""].join("|");',
    '            if (prev !== next) changed = true;',
    '        }',
    '        if (changed) save();',
    '        return changed;',
    '    }',
    '',
    '    function trimPreviewCache(keepRow) {',
    '        for (const row of rows) {',
    '            if (row === keepRow) continue;',
    '            row.audioBase64 = row.fullAudioBase64 = "";',
    '            row._previewSettingsKey = row._fullPreviewSettingsKey = "";',
    '        }',
    '    }',
    '',
  ].join('\n');
  src = section(src, '    function currentVoiceSettings() {', '    // V4_4_58_TTS_VOICE_CACHE_KEY', helpers, 'voice settings/file helpers');
}

if (!src.includes('V4_4_59_TTS_PREVIEW_DISK_AUDIO')) {
  const preview = [
    '    // V4_4_59_TTS_PREVIEW_DISK_AUDIO',
    '    async function previewRow(row, button, statusEl, fullTextMode = false) {',
    '        if (currentAudio && currentPlayBtn === button) { stopAudio(true); if (statusEl) statusEl.textContent = row.fileName || "已停止试听"; return; }',
    '        const rawText = String(row.text || "").trim();',
    '        if (!rawText) { if (statusEl) statusEl.textContent = "请先输入文案"; setStatus("请先在卡片中输入要试听的文案"); return; }',
    '        if (fullTextMode && row.state === "success" && fileExists(row.audio)) {',
    '            try { setStatus("正在播放已生成的原始 MP3"); await playAudioPath(row.audio, button, row, statusEl); setStatus("试听完成 · 已生成文件"); }',
    '            catch (error) { reconcileRowFiles(row); setStatus("试听失败：" + error.message); render(); }',
    '            return;',
    '        }',
    '        const opts = currentVoiceSettings();',
    '        if (!opts.voice.startsWith("edge:")) { if (statusEl) statusEl.textContent = "请选择音色"; setStatus("当前筛选结果没有可用微软音色，请调整语言或搜索条件"); return; }',
    '        const previewKey = voiceSettingsKey(opts);',
    '        if (!fullTextMode && row.audioBase64 && !row._dirtyPreview && row._previewSettingsKey === previewKey) { try { await playAudioBase64(row.audioBase64, button, row, statusEl); return; } catch (_) {} }',
    '        if (fullTextMode && row.fullAudioBase64 && !row._dirtyFull && row._fullPreviewSettingsKey === previewKey) { try { await playAudioBase64(row.fullAudioBase64, button, row, statusEl); return; } catch (_) {} }',
    '        const sampleText = fullTextMode ? rawText : rawText.slice(0, 60);',
    '        const runId = ++previewRunId;',
    '        stopAudio(false); currentPlayBtn = button; button.disabled = true; button.textContent = "生成中…";',
    '        if (statusEl) statusEl.textContent = "试听生成中…";',
    '        setStatus(`正在生成试听：${sampleText.slice(0, 24)}…`);',
    '        try {',
    '            const res = await request("edge-tts/preview", { text: sampleText, voice: opts.voice, rate: opts.rate, pitch: opts.pitch });',
    '            if (runId !== previewRunId) return;',
    '            trimPreviewCache(row);',
    '            if (fullTextMode) { row.fullAudioBase64 = res.audio_base64; row._dirtyFull = false; row._fullPreviewSettingsKey = previewKey; }',
    '            else { row.audioBase64 = res.audio_base64; row._dirtyPreview = false; row._previewSettingsKey = previewKey; }',
    '            setStatus("正在播放试听音频");',
    '            await playAudioBase64(res.audio_base64, button, row, statusEl);',
    '            const usedVoice = String(res.voice || opts.voice || "").replace(/^edge:/, "");',
    '            setStatus("试听完成 · " + usedVoice + (res.engine ? " · " + res.engine : ""));',
    '        } catch (error) {',
    '            if (button) { button.disabled = false; button.textContent = button.dataset.label || "试听"; }',
    '            currentPlayBtn = null; if (statusEl) statusEl.textContent = "试听失败"; setStatus("试听失败：" + error.message);',
    '        }',
    '    }',
    '',
  ].join('\n');
  src = section(src, '    async function previewRow(row, button, statusEl, fullTextMode = false) {', '    // V4_4_58_TTS_OPEN_PATH_FIX', preview, 'preview behavior');
}

if (!src.includes('V4_4_59_TTS_NO_EMPTY_VOICE_FALLBACK')) {
  src = replaceOnce(src,
    '        for (const v of filtered) {\n            const vid = v.voice_id.startsWith(\'edge:\') ? v.voice_id : `edge:${v.ShortName || v.voice_id}`;\n            select.add(new Option(voiceDisplayLabel(v), vid));\n        }\n',
    '        for (const v of filtered) {\n            const vid = v.voice_id.startsWith(\'edge:\') ? v.voice_id : `edge:${v.ShortName || v.voice_id}`;\n            select.add(new Option(voiceDisplayLabel(v), vid));\n        }\n        // V4_4_59_TTS_NO_EMPTY_VOICE_FALLBACK\n        if (!filtered.length) { const opt = new Option(\'没有匹配的微软音色\', \'\'); opt.disabled = true; select.add(opt); select.value = \'\'; }\n',
    'empty voice result');
}

if (!src.includes('V4_4_59_TTS_SUCCESS_FILE_GUARD')) {
  src = replaceOnce(src,
    '        const hasGenerated = rows.some(r => r.state === \'success\' && (r.audio || r.fullAudioBase64));',
    '        // V4_4_59_TTS_SUCCESS_FILE_GUARD\n        const hasGenerated = rows.some(r => r.state === \'success\' && fileExists(r.audio));',
    'generated controls');
  src = replaceOnce(src, '            const hasSavedFiles = Boolean(row.state === \'success\' && row.audio);', '            const hasSavedFiles = Boolean(row.state === \'success\' && fileExists(row.audio));', 'card file existence');
  src = replaceOnce(src, '            mp4Btn.disabled = !hasSavedFiles || !row.mp4 || running;', '            mp4Btn.disabled = !hasSavedFiles || !row.mp4 || !fileExists(row.mp4) || running;', 'MP4 existence');
  src = replaceOnce(src, '            srtBtn.disabled = !hasSavedFiles || !row.srt || running;', '            srtBtn.disabled = !hasSavedFiles || !row.srt || !fileExists(row.srt) || running;', 'SRT existence');
}

if (!src.includes('V4_4_59_TTS_WARNING_STATUS')) {
  src = replaceOnce(src,
    '            if (row.error) {\n                statusSpan.textContent = row.error;\n                statusSpan.style.color = \'#ff8d85\';\n            } else if (row.state === \'success\' && row.fileName) {',
    '            if (row.error) {\n                statusSpan.textContent = row.error;\n                statusSpan.style.color = \'#ff8d85\';\n            // V4_4_59_TTS_WARNING_STATUS\n            } else if (row.warning) {\n                statusSpan.textContent = row.warning;\n                statusSpan.style.color = \'#e4bd73\';\n            } else if (row.state === \'success\' && row.fileName) {',
    'warning display');
  src = replaceOnce(src, '                error: r.error || \'\',\n            }));', '                error: r.error || \'\',\n                warning: r.warning || \'\',\n            }));', 'persist warning');
}

if (!src.includes('V4_4_59_TTS_RESUMABLE_BATCH')) {
  const batch = [
    '    // V4_4_59_TTS_RESUMABLE_BATCH',
    '    async function startBatchGenerate() {',
    '        if (running) return;',
    '        const opts = currentVoiceSettings();',
    '        if (!opts.voice.startsWith("edge:")) { setStatus("请先选择一个微软音色"); return; }',
    '        reconcileAllRows();',
    '        const workItems = rows.map((row, rowIndex) => ({ row, rowIndex })).filter(item => String(item.row.text || "").trim() && item.row.state !== "success");',
    '        if (!workItems.length) { setStatus("所有有效文案都已经生成完成，无需重复生成"); render(); return; }',
    '        running = true; stopping = false; stopAudio(true); setProgress(0, workItems.length); render();',
    '        let completed = 0, failed = 0;',
    '        try {',
    '            const baseFolder = ($("output")?.value || "").trim() || await window.electronAPI.getDownloadsPath();',
    '            if (!baseFolder) throw new Error("请选择保存目录");',
    '            if ($("output") && !$("output").value) $("output").value = baseFolder;',
    '            const taskName = ($("task-folder")?.value || "").trim() || "第一期";',
    '            for (let i = 0; i < workItems.length; i++) {',
    '                if (stopping) break;',
    '                const { row, rowIndex } = workItems[i];',
    '                const seq = String(rowIndex + 1).padStart(2, "0");',
    '                const fileName = `${seq}_${sanitizeFilename(row.text)}.mp3`;',
    '                row.state = "running"; row.error = row.warning = ""; render();',
    '                setStatus(`正在生成 ${i + 1}/${workItems.length}：${fileName}`);',
    '                try {',
    '                    const result = await request("edge-tts/save-item", { text: row.text, voice: opts.voice, rate: opts.rate, pitch: opts.pitch, baseFolder, taskName, fileName });',
    '                    row.audio = result.paths?.mp3 || ""; row.mp4 = result.paths?.mp4 || ""; row.srt = result.paths?.srt || "";',
    '                    row.fileName = result.fileName || fileName; row.baseName = result.baseName || fileName.replace(/\\.mp3$/i, "");',
    '                    row.audioBase64 = row.fullAudioBase64 = ""; row._dirtyFull = true; row._fullPreviewSettingsKey = "";',
    '                    row.state = "success"; row.error = ""; row.warning = Array.isArray(result.warnings) ? result.warnings.join("；") : (result.mp4_error || "");',
    '                    lastOutput = result.folder || baseFolder; completed++;',
    '                } catch (err) { row.state = "error"; row.error = err.message; row.warning = ""; failed++; }',
    '                setProgress(i + 1, workItems.length); save(); render();',
    '            }',
    '            const remaining = rows.filter(row => String(row.text || "").trim() && row.state !== "success").length;',
    '            setStatus(`${stopping ? "已停止" : "本轮完成"}：成功 ${completed} 条${failed ? `，失败 ${failed} 条` : ""}${remaining ? `，剩余 ${remaining} 条可继续` : ""} · 目录：${lastOutput}`);',
    '        } catch (error) { setStatus("生成失败：" + error.message); }',
    '        finally { running = false; stopping = false; save(); render(); }',
    '    }',
    '',
  ].join('\n');
  src = section(src, '    async function startBatchGenerate() {', '    async function previewAllGenerated() {', batch, 'resumable batch');
}

if (!src.includes('V4_4_59_TTS_PLAY_SAVED_BATCH')) {
  const previewAll = [
    '    // V4_4_59_TTS_PLAY_SAVED_BATCH',
    '    async function previewAllGenerated() {',
    '        if (running) return;',
    '        reconcileAllRows();',
    '        const generated = rows.filter(r => r.state === "success" && fileExists(r.audio));',
    '        if (!generated.length) { setStatus("没有可试听的已生成 MP3 文件"); render(); return; }',
    '        const btn = $("preview-all");',
    '        if (currentAudio && currentPlayBtn === btn) { previewAllToken += 1; stopAudio(true); setStatus("已停止全部试听"); return; }',
    '        const token = ++previewAllToken;',
    '        try {',
    '            for (let i = 0; i < generated.length; i++) {',
    '                if (token !== previewAllToken) break;',
    '                const row = generated[i];',
    '                setStatus(`正在顺序试听 ${i + 1}/${generated.length}：${row.fileName || row.name}`);',
    '                const result = await playAudioPath(row.audio, btn, row, null, `试听中 (${i + 1}/${generated.length})`);',
    '                if (result?.stopped || token !== previewAllToken) break;',
    '            }',
    '            if (token === previewAllToken) setStatus("全部试听完成");',
    '        } catch (error) { setStatus("试听中断：" + error.message); reconcileAllRows(); render(); }',
    '        finally { if (btn) btn.textContent = "试听全部"; refreshControls(); }',
    '    }',
    '',
  ].join('\n');
  src = section(src, '    async function previewAllGenerated() {', '    async function createZipArchive() {', previewAll, 'play saved batch');
}

if (!src.includes('V4_4_59_TTS_STRICT_ZIP_FRONTEND')) {
  const zip = [
    '    // V4_4_59_TTS_STRICT_ZIP_FRONTEND',
    '    async function createZipArchive() {',
    '        reconcileAllRows();',
    '        const generated = rows.filter(r => r.state === "success" && fileExists(r.audio));',
    '        if (!generated.length || running) { setStatus("还没有有效的已生成音频文件可打包"); render(); return; }',
    '        const baseFolder = ($("output")?.value || "").trim() || await window.electronAPI.getDownloadsPath();',
    '        const taskName = ($("task-folder")?.value || "").trim() || "第一期";',
    '        const formats = selectedZipFormats(); const label = zipFormatLabel();',
    '        const zipName = `${sanitizeFilename(taskName)}_${label.replace("+", "_")}.zip`;',
    '        const btn = $("create-zip"); if (btn) btn.disabled = true; setStatus(`正在校验并打包 ${label} ZIP…`);',
    '        try {',
    '            const result = await request("edge-tts/create-zip", { baseFolder, taskName, zipName, formats, files: generated.map(r => ({ fileName: r.fileName, baseName: r.baseName, paths: { mp3: r.audio, mp4: r.mp4, srt: r.srt } })) });',
    '            lastOutput = result.folder || lastOutput;',
    '            setStatus(`ZIP 已保存：${result.zipPath} · ${result.count} 个文件`);',
    '            await showOrOpenFile(result.zipPath, false);',
    '        } catch (error) { setStatus("打包失败：" + error.message); }',
    '        finally { refreshControls(); }',
    '    }',
    '',
  ].join('\n');
  src = section(src, '    async function createZipArchive() {', '    document.addEventListener(\'DOMContentLoaded\'', zip, 'strict ZIP frontend');
}

if (!src.includes('V4_4_59_TTS_ACTUAL_OUTPUT_FOLDER')) {
  const endMarker = "        $('refresh').onclick = () => loadVoices(true);";
  const openOutput = [
    '        // V4_4_59_TTS_ACTUAL_OUTPUT_FOLDER',
    "        $('open-output').onclick = async () => {",
    '            try {',
    "                const base = ($('output')?.value || '').trim() || await window.electronAPI.getDownloadsPath();",
    "                if (!base) throw new Error('请先设置输出目录');",
    "                const task = ($('task-folder')?.value || '').trim();",
    '                let target = fileExists(lastOutput) ? lastOutput : "";',
    '                if (!target) {',
    '                    const candidate = task && window.electronAPI?.pathJoin ? window.electronAPI.pathJoin(base, task) : base;',
    '                    target = fileExists(candidate) ? candidate : base;',
    '                }',
    '                await openSystemPath(target);',
    "                setStatus('已打开目录：' + target);",
    '            } catch (e) { setStatus("打开目录失败：" + e.message); }',
    '        };',
    '',
    endMarker,
  ].join('\n');
  src = section(src, "        $('open-output').onclick = async () => {", endMarker, openOutput, 'actual output folder');
  src = replaceOnce(src,
    "                if (dir) {\n                    $('output').value = dir;\n                    save();\n                }",
    "                if (dir) {\n                    $('output').value = dir;\n                    lastOutput = '';\n                    save();\n                }",
    'output picker resets lastOutput');
}

if (!src.includes('V4_4_59_TTS_RECONCILE_RESTORED_ROWS')) {
  src = replaceOnce(src,
    '        ensureAtLeastOneRow();\n\n        $(\'add\').onclick = () => {',
    '        // V4_4_59_TTS_RECONCILE_RESTORED_ROWS\n        reconcileAllRows();\n        ensureAtLeastOneRow();\n\n        $(\'add\').onclick = () => {',
    'reconcile restored rows');
}

new vm.Script(src, { filename: file });
if (before !== src) fs.writeFileSync(file, src, 'utf8');
for (const marker of [
  'V4_4_59_TTS_PLAYBACK_LIFECYCLE', 'V4_4_59_TTS_FILE_RECONCILE', 'V4_4_59_TTS_PREVIEW_DISK_AUDIO',
  'V4_4_59_TTS_NO_EMPTY_VOICE_FALLBACK', 'V4_4_59_TTS_SUCCESS_FILE_GUARD', 'V4_4_59_TTS_WARNING_STATUS',
  'V4_4_59_TTS_RESUMABLE_BATCH', 'V4_4_59_TTS_PLAY_SAVED_BATCH', 'V4_4_59_TTS_STRICT_ZIP_FRONTEND',
  'V4_4_59_TTS_ACTUAL_OUTPUT_FOLDER', 'V4_4_59_TTS_RECONCILE_RESTORED_ROWS',
]) if (!src.includes(marker)) throw new Error(`4.4.59 TTS frontend patch incomplete: ${marker}`);
console.log('[4.4.59-ms-tts-frontend] Microsoft TTS resume/playback/cache/file-state UI hardening active.');
