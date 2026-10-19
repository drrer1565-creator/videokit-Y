const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const ttsPath = path.join(root, 'src', 'microsoft-tts.js');
const edgePath = path.join(root, 'electron', 'services', 'edgeTts.js');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');

test('v4.4.59 resumes only unfinished cards and preserves original row numbering', () => {
  const src = read(ttsPath);
  assert.match(src, /V4_4_59_TTS_RESUMABLE_BATCH/);
  assert.match(src, /item\.row\.state !== "success"/);
  assert.match(src, /const seq = String\(rowIndex \+ 1\)\.padStart\(2, "0"\)/);
  assert.match(src, /剩余 \$\{remaining\} 条可继续/);
  new vm.Script(src, { filename: ttsPath });
});

test('v4.4.59 settles stopped audio and does not accumulate dangling playback promises', () => {
  const src = read(ttsPath);
  assert.match(src, /V4_4_59_TTS_PLAYBACK_LIFECYCLE/);
  assert.match(src, /let currentAudioSettle = null/);
  assert.match(src, /settle\(\{ stopped: true \}\)/);
  assert.match(src, /currentAudioSettle = settle/);
});

test('v4.4.59 uses real saved MP3 files for generated/full and sequential playback', () => {
  const src = read(ttsPath);
  assert.match(src, /V4_4_59_TTS_PREVIEW_DISK_AUDIO/);
  assert.match(src, /await playAudioPath\(row\.audio, button, row, statusEl\)/);
  assert.match(src, /V4_4_59_TTS_PLAY_SAVED_BATCH/);
  const start = src.indexOf('async function previewAllGenerated()');
  const end = src.indexOf('async function createZipArchive()', start);
  const body = src.slice(start, end);
  assert.match(body, /playAudioPath\(row\.audio/);
  assert.doesNotMatch(body, /edge-tts\/preview/);
});

test('v4.4.59 avoids retaining generated full audio as Base64 and trims preview caches', () => {
  const tts = read(ttsPath);
  const edge = read(edgePath);
  assert.match(tts, /row\.audioBase64 = row\.fullAudioBase64 = ""/);
  assert.match(tts, /function trimPreviewCache\(keepRow\)/);
  const saveStart = edge.indexOf('async function saveItem(data = {}) {');
  const saveEnd = edge.indexOf('async function createZip(data = {}) {', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.doesNotMatch(edge.slice(saveStart, saveEnd), /audio_base64/);
});

test('v4.4.59 never silently falls back to Ava when the filtered voice list is empty', () => {
  const src = read(ttsPath);
  assert.match(src, /V4_4_59_TTS_NO_EMPTY_VOICE_FALLBACK/);
  const settingsStart = src.indexOf('function currentVoiceSettings()');
  const settingsEnd = src.indexOf('function reconcileRowFiles', settingsStart);
  const settings = src.slice(settingsStart, settingsEnd);
  assert.match(settings, /voice: String\(\$\("voice"\)\?\.value \|\| ""\)\.trim\(\)/);
  assert.doesNotMatch(settings, /AvaMultilingualNeural/);
  assert.match(src, /当前筛选结果没有可用微软音色/);
});

test('v4.4.59 reconciles moved/deleted generated files and disables missing output buttons', () => {
  const src = read(ttsPath);
  assert.match(src, /V4_4_59_TTS_FILE_RECONCILE/);
  assert.match(src, /原生成音频已不存在，已恢复为待生成/);
  assert.match(src, /V4_4_59_TTS_RECONCILE_RESTORED_ROWS/);
  assert.match(src, /mp4Btn\.disabled = !hasSavedFiles \|\| !row\.mp4 \|\| !fileExists\(row\.mp4\)/);
  assert.match(src, /srtBtn\.disabled = !hasSavedFiles \|\| !row\.srt \|\| !fileExists\(row\.srt\)/);
});

test('v4.4.59 opens the actual sanitized output folder and resets it after directory changes', () => {
  const src = read(ttsPath);
  assert.match(src, /V4_4_59_TTS_ACTUAL_OUTPUT_FOLDER/);
  assert.match(src, /let target = fileExists\(lastOutput\) \? lastOutput : ""/);
  assert.match(src, /\$\('output'\)\.value = dir;\n\s+lastOutput = '';/);
});

test('v4.4.59 saveItem never creates fake MP4 files from MP3 bytes', () => {
  const src = read(edgePath);
  assert.match(src, /V4_4_59_REAL_MP4_ONLY/);
  const start = src.indexOf('async function saveItem(data = {}) {');
  const end = src.indexOf('async function createZip(data = {}) {', start);
  const body = src.slice(start, end);
  assert.match(body, /subarray\(4, 8\)\.toString\("ascii"\) !== "ftyp"/);
  assert.doesNotMatch(body, /copyFile.*mp3Path.*mp4Path/);
  assert.match(body, /validMp4Path = ""/);
});

test('v4.4.59 ZIP refuses missing or fake requested MP4 files instead of silently substituting MP3', async () => {
  const edge = require(edgePath);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-tts-zip-'));
  try {
    const mp3 = path.join(tmp, 'a.mp3');
    const fakeMp4 = path.join(tmp, 'a.mp4');
    fs.writeFileSync(mp3, Buffer.from('ID3fake-mp3-data'));
    fs.writeFileSync(fakeMp4, Buffer.from('ID3still-mp3-data'));
    await assert.rejects(
      edge.createZip({ baseFolder: tmp, taskName: 'zip-test', formats: ['mp4'], files: [{ fileName: 'a.mp3', baseName: 'a', paths: { mp3, mp4: fakeMp4 } }] }),
      /不是有效 MP4 容器/
    );
    await assert.rejects(
      edge.createZip({ baseFolder: tmp, taskName: 'zip-test', formats: ['mp4'], files: [{ fileName: 'a.mp3', baseName: 'a', paths: { mp3, mp4: '' } }] }),
      /文件不存在/
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v4.4.59 ZIP succeeds only when requested files are present and MP4 has an MP4 container header', async () => {
  const edge = require(edgePath);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-tts-zip-ok-'));
  try {
    const mp3 = path.join(tmp, 'a.mp3');
    const mp4 = path.join(tmp, 'a.mp4');
    fs.writeFileSync(mp3, Buffer.from('ID3valid-mp3-data'));
    const header = Buffer.alloc(24); header.writeUInt32BE(24, 0); header.write('ftyp', 4, 'ascii'); header.write('isom', 8, 'ascii');
    fs.writeFileSync(mp4, header);
    const result = await edge.createZip({ baseFolder: tmp, taskName: 'bad:name', formats: ['mp3', 'mp4'], files: [{ fileName: 'a.mp3', baseName: 'a', paths: { mp3, mp4 } }] });
    assert.equal(result.count, 2);
    assert.ok(fs.existsSync(result.zipPath));
    assert.equal(path.basename(result.folder), 'bad_name');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
