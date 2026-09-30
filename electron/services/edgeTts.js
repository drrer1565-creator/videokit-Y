const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const settings = require('./settings');

function pythonPath() {
    if (process.env.VIDEOKIT_EDGE_PYTHON) return process.env.VIDEOKIT_EDGE_PYTHON;
    const root = path.join(__dirname, '..', '..');
    const candidates = [
        path.join(root, '.venv-edge', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
        ...(process.resourcesPath ? [path.join(process.resourcesPath, 'vendor', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3')] : []),
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (!found) throw new Error('尚未安装微软配音环境，请运行 VideoKit 目录的 setup-edge-tts.cmd 后重试');
    return found;
}
function invoke(payload, timeout = 600000) {
    return new Promise((resolve, reject) => {
        let python;
        try { python = pythonPath(); } catch (error) { reject(error); return; }
        const packagedBridge = process.resourcesPath && path.join(process.resourcesPath, 'edge-tts', 'edge_tts_bridge.py');
        const bridge = packagedBridge && fs.existsSync(packagedBridge) ? packagedBridge : path.join(__dirname, 'edge_tts_bridge.py');
        const child = spawn(python, ['-u', bridge], {
            windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1' },
        });
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        let out = '', err = '', settled = false;
        const finish = (error, result) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            if (error) reject(error); else resolve(result);
        };
        const timer = setTimeout(() => { child.kill(); finish(new Error('微软在线配音超时，请检查网络后重试')); }, timeout);
        child.on('error', error => finish(new Error(`无法启动微软配音：${error.message}`)));
        child.stdin.on('error', error => finish(error));
        child.stdout.on('data', chunk => { out += chunk.toString('utf8'); });
        child.stderr.on('data', chunk => { err = (err + chunk.toString('utf8')).slice(-3000); });
        child.on('close', code => {
            try {
                const result = JSON.parse(out);
                if (code !== 0 || result.error) throw new Error(result.error || err || '微软配音失败');
                finish(null, result);
            } catch (error) {
                finish(new Error(err.includes('No module named') ? '微软配音依赖缺失，请运行 setup-edge-tts.cmd' : `微软在线朗读失败：${error.message}`));
            }
        });
        child.stdin.end(JSON.stringify(payload));
    });
}
function parseVoice(voice) {
    const shortName = String(voice || '').replace(/^edge:/, '');
    if (!/^[a-z]{2,3}-[A-Za-z0-9-]+Neural$/.test(shortName)) throw new Error('请选择有效的微软 Edge 音色');
    return shortName;
}
let voicesCache = null;
async function listVoices(refresh = false) {
    if (!refresh && voicesCache) return voicesCache;
    const result = await invoke({ action: 'voices' }, 45000);
    if (!Array.isArray(result.voices) || !result.voices.length) throw new Error('微软没有返回可用音色');
    voicesCache = result;
    return result;
}
async function synthesize(text, voice, rate = '+0%') {
    const shortName = parseVoice(voice);
    if (!String(text || '').trim()) throw new Error('配音文案不能为空');
    if (!/^[+-]\d+%$/.test(rate) || Math.abs(parseInt(rate)) > 100) throw new Error('语速必须介于 -100% 与 +100%');
    const output = path.join(settings.getSecureTmpDir(), `edge_${crypto.randomUUID()}.mp3`);
    try {
        const result = await invoke({ action: 'synthesize', text, voice: shortName, rate, output });
        return { audio: fs.readFileSync(output), usedKey: null, srt: result.srt || '' };
    } finally { if (fs.existsSync(output)) fs.unlinkSync(output); }
}
module.exports = { listVoices, synthesize, parseVoice };
