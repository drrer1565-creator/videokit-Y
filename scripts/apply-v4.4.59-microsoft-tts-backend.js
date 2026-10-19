const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'electron', 'services', 'edgeTts.js');
const read = () => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
const section = (src, startMarker, endMarker, replacement, label) => {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`4.4.59 TTS backend section missing: ${label}`);
  return src.slice(0, start) + replacement + src.slice(end);
};

const before = read();
let src = before;
if (!src.includes('V4_4_58_STRICT_MICROSOFT_VOICE')) throw new Error('4.4.58 Microsoft TTS reliability patch must run before v4.4.59 backend hardening');

if (!src.includes('V4_4_59_REAL_MP4_ONLY')) {
  const saveItem = [
    '// V4_4_59_REAL_MP4_ONLY',
    'async function saveItem(data = {}) {',
    '    const text = String(data.text || "").trim();',
    '    if (!text) throw new Error("配音文案不能为空");',
    '    const folder = resolveTaskFolder(data.baseFolder, data.taskName);',
    '    await fs.promises.mkdir(folder, { recursive: true });',
    '',
    '    const requestedName = safeFileName(data.fileName, "voice.mp3");',
    '    const baseName = path.parse(requestedName).name || "voice";',
    '    const mp3Name = `${baseName}.mp3`;',
    '    const mp4Name = `${baseName}.mp4`;',
    '    const srtName = `${baseName}.srt`;',
    '    const res = await synthesize(text, data.voice, data.rate || "+0%", data.pitch || "+0Hz");',
    '    const mp3Path = path.join(folder, mp3Name);',
    '    const mp4Path = path.join(folder, mp4Name);',
    '    const srtPath = path.join(folder, srtName);',
    '',
    '    await fs.promises.writeFile(mp3Path, res.audio);',
    '    if (res.srt) await fs.promises.writeFile(srtPath, res.srt, "utf8");',
    '',
    '    let validMp4Path = "";',
    '    let mp4Error = "";',
    '    try {',
    '        const ffmpeg = requ' + 'ire("./ffmpeg");',
    '        await ffmpeg.runCommand("ffmpeg", [',
    '            "-y", "-hide_banner", "-loglevel", "error",',
    '            "-i", mp3Path,',
    '            "-vn", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",',
    '            mp4Path,',
    '        ]);',
    '        const fd = await fs.promises.open(mp4Path, "r");',
    '        try {',
    '            const header = Buffer.alloc(12);',
    '            const { bytesRead } = await fd.read(header, 0, header.length, 0);',
    '            if (bytesRead < 8 || header.subarray(4, 8).toString("ascii") !== "ftyp") throw new Error("FFmpeg 输出不是有效 MP4 容器");',
    '        } finally { await fd.close(); }',
    '        validMp4Path = mp4Path;',
    '    } catch (error) {',
    '        mp4Error = `MP4 生成失败：${error.message || error}`;',
    '        try { await fs.promises.unlink(mp4Path); } catch (_) {}',
    '    }',
    '',
    '    return {',
    '        folder, fileName: mp3Name, baseName,',
    '        paths: { mp3: mp3Path, mp4: validMp4Path, srt: res.srt ? srtPath : "" },',
    '        srt: res.srt || "",',
    '        engine: res.engine || "edge",',
    '        voice: res.voice || parseVoice(data.voice),',
    '        mp4_error: mp4Error,',
    '        warnings: mp4Error ? [mp4Error] : [],',
    '    };',
    '}',
    '',
  ].join('\n');
  src = section(src, 'async function saveItem(data = {}) {', 'async function createZip(data = {}) {', saveItem, 'saveItem');
}

if (!src.includes('V4_4_59_STRICT_ZIP_INPUTS')) {
  const zip = [
    '// V4_4_59_STRICT_ZIP_INPUTS',
    'function _isValidMp4File(filePath) {',
    '    try {',
    '        const fd = fs.openSync(filePath, "r");',
    '        try {',
    '            const header = Buffer.alloc(12);',
    '            const bytesRead = fs.readSync(fd, header, 0, header.length, 0);',
    '            return bytesRead >= 8 && header.subarray(4, 8).toString("ascii") === "ftyp";',
    '        } finally { fs.closeSync(fd); }',
    '    } catch (_) { return false; }',
    '}',
    '',
    'async function createZip(data = {}) {',
    '    const folder = resolveTaskFolder(data.baseFolder, data.taskName);',
    '    const formats = Array.isArray(data.formats) && data.formats.length ? data.formats : ["mp3"];',
    '    const files = Array.isArray(data.files) ? data.files : [];',
    '    if (!files.length) throw new Error("没有可打包的文件。");',
    '    await fs.promises.mkdir(folder, { recursive: true });',
    '    const used = new Set();',
    '    const entries = [];',
    '    const missing = [];',
    '    for (const item of files) {',
    '        for (const format of formats) {',
    '            const fmt = format === "mp4" ? "mp4" : format === "srt" ? "srt" : "mp3";',
    '            const sourcePath = String(item.paths?.[fmt] || "").trim();',
    '            const label = `${item.baseName || item.fileName || "voice"} (${fmt.toUpperCase()})`;',
    '            if (!sourcePath || !fs.existsSync(sourcePath)) { missing.push(`${label} 文件不存在`); continue; }',
    '            if (fmt === "mp4" && !_isValidMp4File(sourcePath)) { missing.push(`${label} 不是有效 MP4 容器`); continue; }',
    '            const buf = await fs.promises.readFile(sourcePath);',
    '            const baseName = safeSegment(item.baseName || path.parse(item.fileName || "voice").name, "voice");',
    '            entries.push({ name: _uniqueName(`${baseName}.${fmt}`, used), data: buf });',
    '        }',
    '    }',
    '    if (missing.length) {',
    '        const preview = missing.slice(0, 5).join("；");',
    '        const more = missing.length > 5 ? `；另有 ${missing.length - 5} 个` : "";',
    '        throw new Error(`ZIP 未创建：有 ${missing.length} 个请求文件缺失或格式无效。${preview}${more}`);',
    '    }',
    '    if (!entries.length) throw new Error("没有可打包的文件。");',
    '    const zipName = safeFileName(data.zipName || "tts_batch.zip", "tts_batch.zip");',
    '    const finalName = zipName.toLowerCase().endsWith(".zip") ? zipName : `${zipName}.zip`;',
    '    const zipPath = path.join(folder, finalName);',
    '    await fs.promises.writeFile(zipPath, createZipBuffer(entries));',
    '    return { zipPath, folder, count: entries.length };',
    '}',
    '',
  ].join('\n');
  src = section(src, 'async function createZip(data = {}) {', 'module.exports = {', zip, 'createZip');
}

new vm.Script(src, { filename: file });
if (before !== src) fs.writeFileSync(file, src, 'utf8');
for (const marker of ['V4_4_59_REAL_MP4_ONLY', 'V4_4_59_STRICT_ZIP_INPUTS']) if (!src.includes(marker)) throw new Error(`4.4.59 TTS backend patch incomplete: ${marker}`);
const saveStart = src.indexOf('async function saveItem(data = {}) {');
const saveEnd = src.indexOf('async function createZip(data = {}) {', saveStart);
const saveBody = src.slice(saveStart, saveEnd);
if (/copyFile\(mp3Path,\s*mp4Path\)/.test(saveBody)) throw new Error('fake MP4 fallback still present');
if (saveBody.includes('audio_base64')) throw new Error('saveItem still retains full Base64 audio');
console.log('[4.4.59-ms-tts-backend] MP4 and ZIP outputs are strict and container-valid.');
