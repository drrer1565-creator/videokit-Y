const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const ffmpegPath = path.join(root, 'electron', 'services', 'ffmpeg-rawvideo.js');
const wysiwygPath = path.join(root, 'src', 'reels-wysiwyg-export.js');
const lines = (items) => items.join('\n');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function write(file, before, after) {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log('[4.4.50-phase1] patched ' + path.relative(root, file));
  } else {
    console.log('[4.4.50-phase1] no changes needed for ' + path.relative(root, file));
  }
}

function syntax(source, file) {
  new vm.Script(source, { filename: file });
}

let ffmpegBefore = read(ffmpegPath);
let ffmpeg = ffmpegBefore;

if (!ffmpeg.includes('V4_4_50_PHASE1_CPU_THREADS')) {
  const probeMarker = 'let _cachedGPUProbeResults = {};';
  if (!ffmpeg.includes(probeMarker)) throw new Error('CPU probe insertion marker missing');
  const cpuProbeBlock = lines([
    probeMarker,
    '',
    '// V4_4_50_PHASE1_CPU_THREADS',
    '// Windows CPU fallback no longer wastes a many-core CPU with a permanent -threads 1.',
    '// We choose a conservative per-job thread budget, then validate that exact thread count',
    '// against the bundled FFmpeg/libx264 before using it. Unsupported/unstable counts fall',
    '// back to a smaller value and ultimately the known-safe single-thread path.',
    'let _cachedCPUThreadProbeResults = {};',
    '',
    'function _adaptiveWindowsCpuThreads(activeJobs = 1, logicalCores = null) {',
    '    const detected = Number(logicalCores) || (Array.isArray(os.cpus()) ? os.cpus().length : 1) || 1;',
    '    const cores = Math.max(1, Math.floor(detected));',
    '    const jobs = Math.max(1, Math.floor(Number(activeJobs) || 1));',
    '    const reserve = cores >= 16 ? 3 : (cores >= 8 ? 2 : 1);',
    '    const usable = Math.max(1, cores - reserve);',
    '    const cap = cores <= 4 ? 2 : (cores <= 8 ? 3 : 4);',
    '    return Math.max(1, Math.min(cap, Math.floor(usable / jobs)));',
    '}',
    '',
    'function _probeCPUEncoderThreads(ffmpegPath, threads, width, height, fps) {',
    "    if (process.platform !== 'win32' || threads <= 1) return true;",
    '    const w = Math.max(64, Math.min(1920, Math.round(Number(width) || 1080)));',
    '    const h = Math.max(64, Math.min(1920, Math.round(Number(height) || 1920)));',
    '    const rate = Math.max(1, Math.min(60, Math.round(Number(fps) || 30)));',
    '    const key = `${threads}|${w}x${h}|${rate}`;',
    '    if (_cachedCPUThreadProbeResults[key] !== undefined) return _cachedCPUThreadProbeResults[key];',
    '    try {',
    '        const testArgs = [',
    "            '-hide_banner', '-loglevel', 'error', '-y',",
    "            '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:r=${rate}`,",
    "            '-frames:v', '4', '-an',",
    "            '-c:v', 'libx264', '-threads', String(threads), '-preset', 'faster',",
    "            '-pix_fmt', 'yuv420p', '-f', 'null', 'NUL',",
    '        ];',
    "        const proc = require('child_process').spawnSync(ffmpegPath, testArgs, {",
    '            timeout: 15000,',
    "            stdio: ['ignore', 'ignore', 'pipe'],",
    '        });',
    '        const ok = proc.status === 0;',
    '        _cachedCPUThreadProbeResults[key] = ok;',
    '        if (!ok) {',
    "            const detail = (proc.stderr || '').toString().slice(-400);",
    '            console.warn(`[WYSIWYG] libx264 ${threads} 线程探测失败，将降低线程数: ${detail}`);',
    '        }',
    '        return ok;',
    '    } catch (e) {',
    '        console.warn(`[WYSIWYG] libx264 多线程探测异常，将回退稳定配置: ${e.message}`);',
    '        _cachedCPUThreadProbeResults[key] = false;',
    '        return false;',
    '    }',
    '}',
    '',
    'function _selectWindowsCpuThreads(ffmpegPath, activeJobs, width, height, fps) {',
    "    if (process.platform !== 'win32') return null;",
    '    const desired = _adaptiveWindowsCpuThreads(activeJobs);',
    '    const candidates = Array.from(new Set([desired, Math.min(2, desired), 1])).filter(v => v >= 1);',
    '    for (const threads of candidates) {',
    '        if (threads === 1 || _probeCPUEncoderThreads(ffmpegPath, threads, width, height, fps)) return threads;',
    '    }',
    '    return 1;',
    '}',
  ]);
  ffmpeg = ffmpeg.replace(probeMarker, cpuProbeBlock);

  const cpuFunction = lines([
    'function cpuH264EncoderArgs(',
    '    qualityPreset,',
    '    crf,',
    '    platform = process.platform,',
    '    targetBitrateMbps = null,',
    '    maxBitrateMbps = null',
    ') {',
    '    return [',
    "        '-c:v', 'libx264',",
    "        ...(platform === 'win32' ? ['-threads', '1'] : []),",
    "        '-preset', qualityPreset,",
    '        ...h264RateControlArgs(crf, targetBitrateMbps, maxBitrateMbps),',
    '    ];',
    '}',
  ]);
  const cpuReplacement = lines([
    'function cpuH264EncoderArgs(',
    '    qualityPreset,',
    '    crf,',
    '    platform = process.platform,',
    '    targetBitrateMbps = null,',
    '    maxBitrateMbps = null,',
    '    threads = null',
    ') {',
    '    const safeThreads = Math.max(1, parseInt(threads, 10) || 1);',
    '    return [',
    "        '-c:v', 'libx264',",
    "        ...(platform === 'win32' ? ['-threads', String(safeThreads)] : []),",
    "        '-preset', qualityPreset,",
    '        ...h264RateControlArgs(crf, targetBitrateMbps, maxBitrateMbps),',
    '    ];',
    '}',
  ]);
  if (!ffmpeg.includes(cpuFunction)) throw new Error('cpuH264EncoderArgs marker missing');
  ffmpeg = ffmpeg.replace(cpuFunction, cpuReplacement);

  const nvencMarker = lines([
    '            {',
    "                codec: 'h264_nvenc',",
    "                label: 'NVENC',",
    "                args: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', ...rateArgs],",
    '            },',
  ]);
  const nvencReplacement = lines([
    '            {',
    '                // First try a quality/throughput tuned NVENC profile. _probeGPUEncoder()',
    '                // validates every option; older drivers automatically fall through to',
    '                // the compatibility profile below instead of losing GPU acceleration.',
    "                codec: 'h264_nvenc',",
    "                label: 'NVENC HQ',",
    '                args: [',
    "                    '-c:v', 'h264_nvenc',",
    "                    '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr',",
    "                    '-multipass', 'qres', '-spatial-aq', '1', '-aq-strength', '8', '-bf', '3',",
    '                    ...rateArgs,',
    '                ],',
    '            },',
    '            {',
    "                codec: 'h264_nvenc',",
    "                label: 'NVENC Compatible',",
    "                args: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', ...rateArgs],",
    '            },',
  ]);
  if (!ffmpeg.includes(nvencMarker)) throw new Error('NVENC candidate marker missing');
  ffmpeg = ffmpeg.replace(nvencMarker, nvencReplacement);

  const cpuCallMarker = lines([
    '    const targetBitrateMbps = opts.targetBitrateMbps;',
    '    const maxBitrateMbps = opts.maxBitrateMbps;',
    '    const cpuFallbackArgs = cpuH264EncoderArgs(',
    '        qualityPreset,',
    '        crf,',
    '        platform,',
    '        targetBitrateMbps,',
    '        maxBitrateMbps',
    '    );',
  ]);
  const cpuCallReplacement = lines([
    '    const targetBitrateMbps = opts.targetBitrateMbps;',
    '    const maxBitrateMbps = opts.maxBitrateMbps;',
    '    // Count active encoder sessions, not queue length. This keeps one export fast',
    '    // while preventing four concurrent tasks from each claiming the whole CPU.',
    '    const activeEncoderJobs = Math.max(1, sessions.size + 1);',
    "    const cpuThreads = platform === 'win32'",
    '        ? _selectWindowsCpuThreads(ffmpeg, activeEncoderJobs, width, height, fps)',
    '        : null;',
    "    if (platform === 'win32') {",
    '        console.log(`[WYSIWYG] CPU 编码线程: ${cpuThreads}（逻辑核心 ${os.cpus().length}, 活跃任务 ${activeEncoderJobs}）`);',
    '    }',
    '    const cpuFallbackArgs = cpuH264EncoderArgs(',
    '        qualityPreset,',
    '        crf,',
    '        platform,',
    '        targetBitrateMbps,',
    '        maxBitrateMbps,',
    '        cpuThreads',
    '    );',
  ]);
  if (!ffmpeg.includes(cpuCallMarker)) throw new Error('CPU fallback call marker missing');
  ffmpeg = ffmpeg.replace(cpuCallMarker, cpuCallReplacement);
}

syntax(ffmpeg, ffmpegPath);
write(ffmpegPath, ffmpegBefore, ffmpeg);

let wysiwygBefore = read(wysiwygPath);
let wysiwyg = wysiwygBefore;

if (!wysiwyg.includes('V4_4_50_PHASE1_TRANSFER_PIPELINE')) {
  const oldPipeline = lines([
    'function _createFramePipeline(sessionId, batchSize = 3) {',
    '    let frames = [];',
    '    const flush = async () => {',
    '        if (!frames.length) return;',
    '        const batch = frames;',
    '        frames = [];',
    "        const result = await window.electronAPI.reelsComposeWysiwyg('frames', { sessionId, frames: batch });",
    '        const ok = result === true || (result && result.ok);',
    "        if (!ok) throw new Error((result && result.error) || '批量写入视频帧失败');",
    '    };',
    '    return {',
    '        async send(raw) {',
    '            frames.push(raw);',
    '            if (frames.length >= batchSize) await flush();',
    '        },',
    '        async drain() {',
    '            await flush();',
    '        },',
    '    };',
    '}',
  ]);
  const pipelineAddition = lines([
    oldPipeline,
    '',
    '// V4_4_50_PHASE1_TRANSFER_PIPELINE',
    '// Prefer the already-wired MessagePort path so RGBA ArrayBuffers are transferred',
    '// directly instead of repeatedly serialised through ipcRenderer.invoke(). Keep a',
    '// tiny bounded in-flight window to overlap Canvas rendering with FFmpeg stdin while',
    '// capping memory, and retain the old batch IPC path as an automatic fallback.',
    'async function _createPreferredFramePipeline(sessionId, maxInFlight = 3, log = null) {',
    '    const api = window.electronAPI || {};',
    "    const canUseTransferPort = typeof api.createReelsFramePipeline === 'function'",
    "        && typeof api.sendReelsFramePipeline === 'function'",
    "        && typeof api.closeReelsFramePipeline === 'function';",
    '    if (!canUseTransferPort) return _createFramePipeline(sessionId, 3);',
    '',
    '    try {',
    '        const pipelineId = await api.createReelsFramePipeline(sessionId);',
    '        let seq = 0;',
    '        let closed = false;',
    '        let firstError = null;',
    '        const pending = new Set();',
    '        const close = () => {',
    '            if (closed) return;',
    '            closed = true;',
    '            try { api.closeReelsFramePipeline(pipelineId); } catch (_) { }',
    '        };',
    '',
    '        return {',
    '            async send(raw) {',
    '                if (firstError) throw firstError;',
    "                if (closed) throw new Error('帧流水线已关闭');",
    '                const currentSeq = seq++;',
    '                let tracked;',
    '                tracked = api.sendReelsFramePipeline(pipelineId, currentSeq, raw)',
    '                    .then(() => null, (error) => {',
    "                        firstError = firstError || error || new Error('帧流水线写入失败');",
    '                        return firstError;',
    '                    })',
    '                    .finally(() => pending.delete(tracked));',
    '                pending.add(tracked);',
    '                if (pending.size >= Math.max(1, maxInFlight)) {',
    '                    const error = await Promise.race(Array.from(pending));',
    '                    if (error) throw error;',
    '                }',
    '            },',
    '            async drain() {',
    '                const results = await Promise.all(Array.from(pending));',
    '                const error = firstError || results.find(Boolean);',
    '                close();',
    '                if (error) throw error;',
    '            },',
    '            close,',
    "            mode: 'message-port',",
    '        };',
    '    } catch (error) {',
    "        if (typeof log === 'function') log(`高速帧通道不可用，自动回退批量 IPC：${error.message}`);",
    '        return _createFramePipeline(sessionId, 3);',
    '    }',
    '}',
  ]);
  if (!wysiwyg.includes(oldPipeline)) throw new Error('frame pipeline marker missing');
  wysiwyg = wysiwyg.replace(oldPipeline, pipelineAddition);

  const startMarker = lines([
    "    if (normalizedEngine === 'hardware') log('极速硬件模式：正在自动探测系统 H.264 硬件编码器，不可用时回退 CPU。');",
    '    if (wantsPipeline) {',
    '        framePipeline = _createFramePipeline(sessionId, 3);',
    "        log('阶段2.1: 已启用三帧批量流水线（同画布、同 FFmpeg 编码）。');",
    '    }',
  ]);
  const startReplacement = lines([
    "    if (normalizedEngine === 'hardware') log('极速硬件模式：正在自动探测系统 H.264 硬件编码器，不可用时回退 CPU。');",
    '    if (wantsPipeline) {',
    '        framePipeline = await _createPreferredFramePipeline(sessionId, 3, log);',
    "        log(framePipeline?.mode === 'message-port'",
    "            ? '阶段2.1: 已启用三帧零拷贝 MessagePort 流水线。'",
    "            : '阶段2.1: 已启用三帧批量 IPC 流水线。');",
    '    }',
  ]);
  if (!wysiwyg.includes(startMarker)) throw new Error('pipeline start marker missing');
  wysiwyg = wysiwyg.replace(startMarker, startReplacement);

  const catchMarker = lines([
    '        if (canvas) { canvas.width = 1; canvas.height = 1; }',
    '        cvSeqFileList = null;',
    "        try { await window.electronAPI.reelsComposeWysiwyg('abort', { sessionId }); } catch (_) { }",
  ]);
  const catchReplacement = lines([
    '        if (canvas) { canvas.width = 1; canvas.height = 1; }',
    '        cvSeqFileList = null;',
    '        try { framePipeline?.close?.(); } catch (_) { }',
    "        try { await window.electronAPI.reelsComposeWysiwyg('abort', { sessionId }); } catch (_) { }",
  ]);
  if (!wysiwyg.includes(catchMarker)) throw new Error('pipeline cleanup marker missing');
  wysiwyg = wysiwyg.replace(catchMarker, catchReplacement);
}

syntax(wysiwyg, wysiwygPath);
write(wysiwygPath, wysiwygBefore, wysiwyg);

if (!ffmpeg.includes('V4_4_50_PHASE1_CPU_THREADS')
    || !ffmpeg.includes('NVENC Compatible')
    || !ffmpeg.includes('_selectWindowsCpuThreads')
    || !wysiwyg.includes('V4_4_50_PHASE1_TRANSFER_PIPELINE')
    || !wysiwyg.includes('createReelsFramePipeline')
    || !wysiwyg.includes("mode: 'message-port'")) {
  throw new Error('4.4.50 phase-1 performance patch incomplete');
}

console.log('[4.4.50-phase1] adaptive CPU + NVENC compatibility + zero-copy frame pipeline ready.');
