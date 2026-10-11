const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('Windows CPU fallback uses adaptive probed threads instead of permanent single-thread x264', () => {
  const src = read('electron/services/ffmpeg-rawvideo.js');
  assert.ok(src.includes('V4_4_50_PHASE1_CPU_THREADS'));
  assert.ok(src.includes('function _adaptiveWindowsCpuThreads'));
  assert.ok(src.includes('function _probeCPUEncoderThreads'));
  assert.ok(src.includes('function _selectWindowsCpuThreads'));
  assert.ok(src.includes('const activeEncoderJobs = Math.max(1, sessions.size + 1);'));
  assert.ok(src.includes("...(platform === 'win32' ? ['-threads', String(safeThreads)] : [])"));
  assert.equal(
    src.includes("function cpuH264EncoderArgs(\n    qualityPreset,\n    crf,\n    platform = process.platform,\n    targetBitrateMbps = null,\n    maxBitrateMbps = null\n) {\n    return [\n        '-c:v', 'libx264',\n        ...(platform === 'win32' ? ['-threads', '1'] : [])"),
    false,
    'CPU H.264 must not remain hard-coded to one thread'
  );
});

test('NVENC uses tuned profile with compatibility fallback', () => {
  const src = read('electron/services/ffmpeg-rawvideo.js');
  assert.ok(src.includes("label: 'NVENC HQ'"));
  assert.ok(src.includes("'-tune', 'hq'"));
  assert.ok(src.includes("'-multipass', 'qres'"));
  assert.ok(src.includes("'-spatial-aq', '1'"));
  assert.ok(src.includes("label: 'NVENC Compatible'"));
  assert.ok(src.includes("args: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', ...rateArgs]"));
});

test('pipeline and hardware export prefer transferable MessagePort frame path with fallback', () => {
  const src = read('src/reels-wysiwyg-export.js');
  assert.ok(src.includes('V4_4_50_PHASE1_TRANSFER_PIPELINE'));
  assert.ok(src.includes('async function _createPreferredFramePipeline'));
  assert.ok(src.includes('api.createReelsFramePipeline(sessionId)'));
  assert.ok(src.includes('api.sendReelsFramePipeline(pipelineId, currentSeq, raw)'));
  assert.ok(src.includes("mode: 'message-port'"));
  assert.ok(src.includes('return _createFramePipeline(sessionId, 3);'));
  assert.ok(src.includes('framePipeline = await _createPreferredFramePipeline(sessionId, 3, log);'));
  assert.ok(src.includes('try { framePipeline?.close?.(); } catch (_) { }'));
});
