const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const ffmpegPath = path.join(root, 'electron', 'services', 'ffmpeg-rawvideo.js');
const wysiwygPath = path.join(root, 'src', 'reels-wysiwyg-export.js');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function write(file, before, after) {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.50-phase1] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.50-phase1] no changes needed for ${path.relative(root, file)}`);
  }
}

function syntax(source, file) {
  new vm.Script(source, { filename: file });
}

let ffmpegBefore = read(ffmpegPath);
let ffmpeg = ffmpegBefore;

if (!ffmpeg.includes('V4_4_50_PHASE1_CPU_THREADS')) {
  const probeMarker = `let _cachedGPUProbeResults = {};`;
  if (!ffmpeg.includes(probeMarker)) throw new Error('CPU probe insertion marker missing');
  ffmpeg = ffmpeg.replace(probeMarker, `${probeMarker}\n\n// V4_4_50_PHASE1_CPU_THREADS\n// Windows CPU fallback no longer wastes a many-core CPU with a permanent -threads 1.\n// We choose a conservative per-job thread budget, then validate that exact thread count\n// against the bundled FFmpeg/libx264 before using it. Unsupported/unstable counts fall\n// back to a smaller value and ultimately the known-safe single-thread path.\nlet _cachedCPUThreadProbeResults = {};\n\nfunction _adaptiveWindowsCpuThreads(activeJobs = 1, logicalCores = null) {\n    const detected = Number(logicalCores) || (Array.isArray(os.cpus()) ? os.cpus().length : 1) || 1;\n    const cores = Math.max(1, Math.floor(detected));\n    const jobs = Math.max(1, Math.floor(Number(activeJobs) || 1));\n    const reserve = cores >= 16 ? 3 : (cores >= 8 ? 2 : 1);\n    const usable = Math.max(1, cores - reserve);\n    const cap = cores <= 4 ? 2 : (cores <= 8 ? 3 : 4);\n    return Math.max(1, Math.min(cap, Math.floor(usable / jobs)));\n}\n\nfunction _probeCPUEncoderThreads(ffmpegPath, threads, width, height, fps) {\n    if (process.platform !== 'win32' || threads <= 1) return true;\n    const w = Math.max(64, Math.min(1920, Math.round(Number(width) || 1080)));\n    const h = Math.max(64, Math.min(1920, Math.round(Number(height) || 1920)));\n    const rate = Math.max(1, Math.min(60, Math.round(Number(fps) || 30)));\n    const key = `${threads}|${w}x${h}|${rate}`;\n    if (_cachedCPUThreadProbeResults[key] !== undefined) return _cachedCPUThreadProbeResults[key];\n    try {\n        const testArgs = [\n            '-hide_banner', '-loglevel', 'error', '-y',\n            '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:r=${rate}`,\n            '-frames:v', '4', '-an',\n            '-c:v', 'libx264', '-threads', String(threads), '-preset', 'faster',\n            '-pix_fmt', 'yuv420p', '-f', 'null', 'NUL',\n        ];\n        const proc = require('child_process').spawnSync(ffmpegPath, testArgs, {\n            timeout: 15000,\n            stdio: ['ignore', 'ignore', 'pipe'],\n        });\n        const ok = proc.status === 0;\n        _cachedCPUThreadProbeResults[key] = ok;\n        if (!ok) {\n            const detail = (proc.stderr || '').toString().slice(-400);\n            console.warn(`[WYSIWYG] libx264 ${threads} 线程探测失败，将降低线程数: ${detail}`);\n        }\n        return ok;\n    } catch (e) {\n        console.warn(`[WYSIWYG] libx264 多线程探测异常，将回退稳定配置: ${e.message}`);\n        _cachedCPUThreadProbeResults[key] = false;\n        return false;\n    }\n}\n\nfunction _selectWindowsCpuThreads(ffmpegPath, activeJobs, width, height, fps) {\n    if (process.platform !== 'win32') return null;\n    const desired = _adaptiveWindowsCpuThreads(activeJobs);\n    const candidates = Array.from(new Set([desired, Math.min(2, desired), 1])).filter(v => v >= 1);\n    for (const threads of candidates) {\n        if (threads === 1 || _probeCPUEncoderThreads(ffmpegPath, threads, width, height, fps)) return threads;\n    }\n    return 1;\n}`);

  const cpuFunction = `function cpuH264EncoderArgs(\n    qualityPreset,\n    crf,\n    platform = process.platform,\n    targetBitrateMbps = null,\n    maxBitrateMbps = null\n) {\n    return [\n        '-c:v', 'libx264',\n        ...(platform === 'win32' ? ['-threads', '1'] : []),\n        '-preset', qualityPreset,\n        ...h264RateControlArgs(crf, targetBitrateMbps, maxBitrateMbps),\n    ];\n}`;
  const cpuReplacement = `function cpuH264EncoderArgs(\n    qualityPreset,\n    crf,\n    platform = process.platform,\n    targetBitrateMbps = null,\n    maxBitrateMbps = null,\n    threads = null\n) {\n    const safeThreads = Math.max(1, parseInt(threads, 10) || 1);\n    return [\n        '-c:v', 'libx264',\n        ...(platform === 'win32' ? ['-threads', String(safeThreads)] : []),\n        '-preset', qualityPreset,\n        ...h264RateControlArgs(crf, targetBitrateMbps, maxBitrateMbps),\n    ];\n}`;
  if (!ffmpeg.includes(cpuFunction)) throw new Error('cpuH264EncoderArgs marker missing');
  ffmpeg = ffmpeg.replace(cpuFunction, cpuReplacement);

  const nvencMarker = `            {\n                codec: 'h264_nvenc',\n                label: 'NVENC',\n                args: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', ...rateArgs],\n            },`;
  const nvencReplacement = `            {\n                // First try a quality/throughput tuned NVENC profile. _probeGPUEncoder()\n                // validates every option; older drivers automatically fall through to\n                // the compatibility profile below instead of losing GPU acceleration.\n                codec: 'h264_nvenc',\n                label: 'NVENC HQ',\n                args: [\n                    '-c:v', 'h264_nvenc',\n                    '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr',\n                    '-multipass', 'qres', '-spatial-aq', '1', '-aq-strength', '8', '-bf', '3',\n                    ...rateArgs,\n                ],\n            },\n            {\n                codec: 'h264_nvenc',\n                label: 'NVENC Compatible',\n                args: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', ...rateArgs],\n            },`;
  if (!ffmpeg.includes(nvencMarker)) throw new Error('NVENC candidate marker missing');
  ffmpeg = ffmpeg.replace(nvencMarker, nvencReplacement);

  const cpuCallMarker = `    const targetBitrateMbps = opts.targetBitrateMbps;\n    const maxBitrateMbps = opts.maxBitrateMbps;\n    const cpuFallbackArgs = cpuH264EncoderArgs(\n        qualityPreset,\n        crf,\n        platform,\n        targetBitrateMbps,\n        maxBitrateMbps\n    );`;
  const cpuCallReplacement = `    const targetBitrateMbps = opts.targetBitrateMbps;\n    const maxBitrateMbps = opts.maxBitrateMbps;\n    // Count active encoder sessions, not queue length. This keeps one export fast\n    // while preventing four concurrent tasks from each claiming the whole CPU.\n    const activeEncoderJobs = Math.max(1, sessions.size + 1);\n    const cpuThreads = platform === 'win32'\n        ? _selectWindowsCpuThreads(ffmpeg, activeEncoderJobs, width, height, fps)\n        : null;\n    if (platform === 'win32') {\n        console.log(`[WYSIWYG] CPU 编码线程: ${cpuThreads}（逻辑核心 ${os.cpus().length}, 活跃任务 ${activeEncoderJobs}）`);\n    }\n    const cpuFallbackArgs = cpuH264EncoderArgs(\n        qualityPreset,\n        crf,\n        platform,\n        targetBitrateMbps,\n        maxBitrateMbps,\n        cpuThreads\n    );`;
  if (!ffmpeg.includes(cpuCallMarker)) throw new Error('CPU fallback call marker missing');
  ffmpeg = ffmpeg.replace(cpuCallMarker, cpuCallReplacement);
}

syntax(ffmpeg, ffmpegPath);
write(ffmpegPath, ffmpegBefore, ffmpeg);

let wysiwygBefore = read(wysiwygPath);
let wysiwyg = wysiwygBefore;

if (!wysiwyg.includes('V4_4_50_PHASE1_TRANSFER_PIPELINE')) {
  const oldPipeline = `function _createFramePipeline(sessionId, batchSize = 3) {\n    let frames = [];\n    const flush = async () => {\n        if (!frames.length) return;\n        const batch = frames;\n        frames = [];\n        const result = await window.electronAPI.reelsComposeWysiwyg('frames', { sessionId, frames: batch });\n        const ok = result === true || (result && result.ok);\n        if (!ok) throw new Error((result && result.error) || '批量写入视频帧失败');\n    };\n    return {\n        async send(raw) {\n            frames.push(raw);\n            if (frames.length >= batchSize) await flush();\n        },\n        async drain() {\n            await flush();\n        },\n    };\n}`;
  const pipelineReplacement = `${oldPipeline}\n\n// V4_4_50_PHASE1_TRANSFER_PIPELINE\n// Prefer the already-wired MessagePort path so RGBA ArrayBuffers are transferred\n// directly instead of repeatedly serialised through ipcRenderer.invoke(). Keep a\n// tiny bounded in-flight window to overlap Canvas rendering with FFmpeg stdin while\n// capping memory, and retain the old batch IPC path as an automatic fallback.\nasync function _createPreferredFramePipeline(sessionId, maxInFlight = 3, log = null) {\n    const api = window.electronAPI || {};\n    const canUseTransferPort = typeof api.createReelsFramePipeline === 'function'\n        && typeof api.sendReelsFramePipeline === 'function'\n        && typeof api.closeReelsFramePipeline === 'function';\n    if (!canUseTransferPort) return _createFramePipeline(sessionId, 3);\n\n    try {\n        const pipelineId = await api.createReelsFramePipeline(sessionId);\n        let seq = 0;\n        let closed = false;\n        let firstError = null;\n        const pending = new Set();\n        const close = () => {\n            if (closed) return;\n            closed = true;\n            try { api.closeReelsFramePipeline(pipelineId); } catch (_) { }\n        };\n\n        return {\n            async send(raw) {\n                if (firstError) throw firstError;\n                if (closed) throw new Error('帧流水线已关闭');\n                const currentSeq = seq++;\n                let tracked;\n                tracked = api.sendReelsFramePipeline(pipelineId, currentSeq, raw)\n                    .then(() => null, (error) => {\n                        firstError = firstError || error || new Error('帧流水线写入失败');\n                        return firstError;\n                    })\n                    .finally(() => pending.delete(tracked));\n                pending.add(tracked);\n                if (pending.size >= Math.max(1, maxInFlight)) {\n                    const error = await Promise.race(Array.from(pending));\n                    if (error) throw error;\n                }\n            },\n            async drain() {\n                const results = await Promise.all(Array.from(pending));\n                const error = firstError || results.find(Boolean);\n                close();\n                if (error) throw error;\n            },\n            close,\n            mode: 'message-port',\n        };\n    } catch (error) {\n        if (typeof log === 'function') log(`高速帧通道不可用，自动回退批量 IPC：${error.message}`);\n        return _createFramePipeline(sessionId, 3);\n    }\n}`;
  if (!wysiwyg.includes(oldPipeline)) throw new Error('frame pipeline marker missing');
  wysiwyg = wysiwyg.replace(oldPipeline, pipelineReplacement);

  const startMarker = `    if (normalizedEngine === 'hardware') log('极速硬件模式：正在自动探测系统 H.264 硬件编码器，不可用时回退 CPU。');\n    if (wantsPipeline) {\n        framePipeline = _createFramePipeline(sessionId, 3);\n        log('阶段2.1: 已启用三帧批量流水线（同画布、同 FFmpeg 编码）。');\n    }`;
  const startReplacement = `    if (normalizedEngine === 'hardware') log('极速硬件模式：正在自动探测系统 H.264 硬件编码器，不可用时回退 CPU。');\n    if (wantsPipeline) {\n        framePipeline = await _createPreferredFramePipeline(sessionId, 3, log);\n        log(framePipeline?.mode === 'message-port'\n            ? '阶段2.1: 已启用三帧零拷贝 MessagePort 流水线。'\n            : '阶段2.1: 已启用三帧批量 IPC 流水线。');\n    }`;
  if (!wysiwyg.includes(startMarker)) throw new Error('pipeline start marker missing');
  wysiwyg = wysiwyg.replace(startMarker, startReplacement);

  const catchMarker = `        if (canvas) { canvas.width = 1; canvas.height = 1; }\n        cvSeqFileList = null;\n        try { await window.electronAPI.reelsComposeWysiwyg('abort', { sessionId }); } catch (_) { }`;
  const catchReplacement = `        if (canvas) { canvas.width = 1; canvas.height = 1; }\n        cvSeqFileList = null;\n        try { framePipeline?.close?.(); } catch (_) { }\n        try { await window.electronAPI.reelsComposeWysiwyg('abort', { sessionId }); } catch (_) { }`;
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
