const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const ffmpegPath = path.join(root, 'electron', 'services', 'ffmpeg.js');
const indexPath = path.join(root, 'src', 'index.html');
const testPath = path.join(root, 'tests', 'hdr-sdr-mode-regression.test.js');

function fail(message) {
  throw new Error(`[HDR-SDR patch] ${message}`);
}

function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function writeIfChanged(filePath, content) {
  const before = fs.readFileSync(filePath, 'utf8');
  if (before !== content) fs.writeFileSync(filePath, content, 'utf8');
}

function findTagByDataMode(html, tagName, mode) {
  const re = new RegExp(`<${tagName}\\b(?=[^>]*\\bdata-mode=["']${mode}["'])[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'i');
  return html.match(re);
}

let ffmpeg = fs.readFileSync(ffmpegPath, 'utf8');
const ffmpegEol = detectEol(ffmpeg);

if (!ffmpeg.includes('async function probeHdrForRec709(filePath)')) {
  const mediaMatch = /async function mediaConvert\s*\(/.exec(ffmpeg);
  if (!mediaMatch) fail('找不到 mediaConvert 函数');

  const helper = `/**${ffmpegEol} * 自动检测视频是否为 HDR，并返回色彩元数据。${ffmpegEol} * 优先依据 HLG/PQ transfer characteristic；同时兼容 HDR10/Dolby Vision side data，${ffmpegEol} * 以及部分只写入 BT.2020 + 10/12bit、却缺失 transfer 标记的手机素材。${ffmpegEol} */${ffmpegEol}async function probeHdrForRec709(filePath) {${ffmpegEol}    try {${ffmpegEol}        const { stdout } = await runCommand('ffprobe', [${ffmpegEol}            '-v', 'error',${ffmpegEol}            '-select_streams', 'v:0',${ffmpegEol}            '-show_streams',${ffmpegEol}            '-of', 'json',${ffmpegEol}            filePath${ffmpegEol}        ], { timeout: PROBE_TIMEOUT });${ffmpegEol}${ffmpegEol}        const stream = JSON.parse(stdout || '{}').streams?.[0] || {};${ffmpegEol}        const transfer = String(stream.color_transfer || '').toLowerCase();${ffmpegEol}        const primaries = String(stream.color_primaries || '').toLowerCase();${ffmpegEol}        const matrix = String(stream.color_space || '').toLowerCase();${ffmpegEol}        const pixelFormat = String(stream.pix_fmt || '').toLowerCase();${ffmpegEol}        const bitDepth = Number.parseInt(stream.bits_per_raw_sample || '', 10) ||${ffmpegEol}            (/p(10|12)|10le|12le|10be|12be/.test(pixelFormat) ? 10 : 8);${ffmpegEol}        const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];${ffmpegEol}        const sideDataTypes = sideData.map(item => String(item?.side_data_type || '')).filter(Boolean);${ffmpegEol}${ffmpegEol}        const isHlg = transfer === 'arib-std-b67';${ffmpegEol}        const isPq = transfer === 'smpte2084' || transfer === 'smpte-st-2084';${ffmpegEol}        const hasHdrSideData = sideDataTypes.some(type =>${ffmpegEol}            /mastering display|content light level|hdr10|dovi|dolby vision/i.test(type)${ffmpegEol}        );${ffmpegEol}        const looksLikeUnlabelledHdr = primaries === 'bt2020' && bitDepth >= 10 &&${ffmpegEol}            !['bt709', 'iec61966-2-1', 'smpte170m'].includes(transfer);${ffmpegEol}        const isHdr = isHlg || isPq || hasHdrSideData || looksLikeUnlabelledHdr;${ffmpegEol}${ffmpegEol}        let hdrType = 'SDR';${ffmpegEol}        if (isHlg) hdrType = 'HLG';${ffmpegEol}        else if (isPq) hdrType = 'PQ/HDR10';${ffmpegEol}        else if (hasHdrSideData) hdrType = 'HDR metadata';${ffmpegEol}        else if (looksLikeUnlabelledHdr) hdrType = 'BT.2020 10bit HDR';${ffmpegEol}${ffmpegEol}        return { isHdr, hdrType, transfer, primaries, matrix, pixelFormat, bitDepth, sideDataTypes, probeFailed: false };${ffmpegEol}    } catch (error) {${ffmpegEol}        return {${ffmpegEol}            isHdr: false, hdrType: 'unknown', transfer: '', primaries: '', matrix: '',${ffmpegEol}            pixelFormat: '', bitDepth: 0, sideDataTypes: [], probeFailed: true,${ffmpegEol}            error: error?.message || String(error),${ffmpegEol}        };${ffmpegEol}    }${ffmpegEol}}${ffmpegEol}${ffmpegEol}`;

  ffmpeg = ffmpeg.slice(0, mediaMatch.index) + helper + ffmpeg.slice(mediaMatch.index);
}

if (!ffmpeg.includes("'hdr_sdr': { outputExt: '_sdr709.mp4', type: 'video' }")) {
  const modeMatch = /const modeConfigs\s*=\s*\{/.exec(ffmpeg);
  if (!modeMatch) fail('找不到 modeConfigs');
  const insertAt = modeMatch.index + modeMatch[0].length;
  ffmpeg = ffmpeg.slice(0, insertAt) + `${ffmpegEol}        'hdr_sdr': { outputExt: '_sdr709.mp4', type: 'video' },` + ffmpeg.slice(insertAt);
}

if (!ffmpeg.includes("case 'hdr_sdr': {")) {
  const mediaStart = ffmpeg.search(/async function mediaConvert\s*\(/);
  if (mediaStart < 0) fail('找不到 mediaConvert 函数');
  const switchRe = /switch\s*\(\s*mode\s*\)\s*\{/g;
  switchRe.lastIndex = mediaStart;
  const switchMatch = switchRe.exec(ffmpeg);
  if (!switchMatch) fail('找不到 mediaConvert 中的 mode switch');
  const insertAt = switchMatch.index + switchMatch[0].length;

  const hdrCase = `${ffmpegEol}            case 'hdr_sdr': {${ffmpegEol}                const hdrInfo = await probeHdrForRec709(filePath);${ffmpegEol}                if (hdrInfo.probeFailed) {${ffmpegEol}                    throw new Error(\`HDR 自动检测失败：\${hdrInfo.error || '无法读取视频色彩元数据'}\`);${ffmpegEol}                }${ffmpegEol}${ffmpegEol}                const sourceSummary = [${ffmpegEol}                    hdrInfo.hdrType, hdrInfo.primaries || 'primaries?', hdrInfo.transfer || 'transfer?',${ffmpegEol}                    hdrInfo.matrix || 'matrix?', hdrInfo.pixelFormat || 'pix_fmt?'${ffmpegEol}                ].join(' / ');${ffmpegEol}${ffmpegEol}                const commonOutputArgs = [${ffmpegEol}                    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',${ffmpegEol}                    '-pix_fmt', 'yuv420p',${ffmpegEol}                    '-c:a', 'aac', '-b:a', '192k',${ffmpegEol}                    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',${ffmpegEol}                    '-movflags', '+faststart'${ffmpegEol}                ];${ffmpegEol}${ffmpegEol}                if (hdrInfo.isHdr) {${ffmpegEol}                    const toneMapFilter = [${ffmpegEol}                        'zscale=t=linear:npl=100',${ffmpegEol}                        'format=gbrpf32le',${ffmpegEol}                        'zscale=p=bt709',${ffmpegEol}                        'tonemap=tonemap=mobius:param=0.3:desat=0',${ffmpegEol}                        'zscale=t=bt709:m=bt709:r=tv',${ffmpegEol}                        'format=yuv420p'${ffmpegEol}                    ].join(',');${ffmpegEol}                    console.log(\`[HDR→SDR] 检测到 HDR：\${path.basename(filePath)} | \${sourceSummary}；开始转换为 SDR Rec.709\`);${ffmpegEol}                    args = ['-y', '-i', filePath, '-map', '0:v:0', '-map', '0:a?', '-vf', toneMapFilter, ...commonOutputArgs, outputPath];${ffmpegEol}                } else {${ffmpegEol}                    console.log(\`[HDR→SDR] 未检测到 HDR：\${path.basename(filePath)} | \${sourceSummary}；跳过 Tone Mapping，按 SDR Rec.709 兼容输出\`);${ffmpegEol}                    args = ['-y', '-i', filePath, '-map', '0:v:0', '-map', '0:a?', ...commonOutputArgs, outputPath];${ffmpegEol}                }${ffmpegEol}                break;${ffmpegEol}            }`;

  ffmpeg = ffmpeg.slice(0, insertAt) + hdrCase + ffmpeg.slice(insertAt);
}

try {
  new vm.Script(ffmpeg, { filename: ffmpegPath });
} catch (error) {
  fail(`ffmpeg.js 注入后语法校验失败：${error.message}`);
}
writeIfChanged(ffmpegPath, ffmpeg);

let html = fs.readFileSync(indexPath, 'utf8');
const htmlEol = detectEol(html);

if (!/data-mode=["']hdr_sdr["']/i.test(html)) {
  const h264Match = findTagByDataMode(html, 'button', 'h264');
  if (!h264Match) fail('找不到视频格式转换中的 H.264 菜单按钮');
  const h264Button = h264Match[0];
  const actionMatch = h264Button.match(/\bdata-action=["']([^"']+)["']/i);
  const action = actionMatch ? actionMatch[1] : 'format';
  const hdrButton = `<button class="sidebar-item" data-action="${action}" data-mode="hdr_sdr" title="自动检测 HLG/PQ/HDR10；HDR 转 SDR Rec.709，普通 SDR 自动跳过 Tone Mapping">HDR → SDR Rec.709</button>`;
  html = html.slice(0, h264Match.index) + hdrButton + htmlEol + h264Button + html.slice(h264Match.index + h264Button.length);
}

// 只有旧版兼容 UI 确实存在 format_mode 单选项时才补充；当前 UI 不依赖它。
if (/name=["']format_mode["']/i.test(html) && !/name=["']format_mode["'][^>]*value=["']hdr_sdr["']/i.test(html)) {
  const h264RadioRe = /<label\b[^>]*>[\s\S]*?<input\b(?=[^>]*\bname=["']format_mode["'])(?=[^>]*\bvalue=["']h264["'])[^>]*>[\s\S]*?<\/label>/i;
  const radioMatch = html.match(h264RadioRe);
  if (radioMatch) {
    const hdrRadio = `<label class="mode-option">${htmlEol}  <input type="radio" name="format_mode" value="hdr_sdr">${htmlEol}  <span>HDR → SDR Rec.709</span>${htmlEol}</label>`;
    html = html.slice(0, radioMatch.index) + hdrRadio + htmlEol + radioMatch[0] + html.slice(radioMatch.index + radioMatch[0].length);
  }
}

const hdrButtonMatch = findTagByDataMode(html, 'button', 'hdr_sdr');
const h264ButtonMatch = findTagByDataMode(html, 'button', 'h264');
if (!hdrButtonMatch || !h264ButtonMatch) fail('HDR/H.264 菜单按钮校验失败');
if (hdrButtonMatch.index > h264ButtonMatch.index) fail('HDR → SDR Rec.709 没有位于 H.264 之前');
if (!/data-action=["']format["']/i.test(hdrButtonMatch[0])) fail('HDR 菜单按钮缺少 data-action="format"');
writeIfChanged(indexPath, html);

const testContent = String.raw`const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function findButton(html, mode) {
  const re = new RegExp('<button\\b(?=[^>]*\\bdata-mode=["\\\']' + mode + '["\\\'])[^>]*>[\\s\\S]*?<\\/button>', 'i');
  return html.match(re);
}

test('HDR → SDR Rec.709 appears before H.264 and uses current media-format action', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const hdr = findButton(html, 'hdr_sdr');
  const h264 = findButton(html, 'h264');
  assert.ok(hdr, 'HDR mode button is missing');
  assert.ok(h264, 'H.264 mode button is missing');
  assert.ok(hdr.index < h264.index, 'HDR mode must appear before H.264');
  assert.match(hdr[0], /data-action=["']format["']/i);
});

test('HDR converter auto-detects HLG/PQ and performs real Rec.709 tone mapping', () => {
  const source = fs.readFileSync(path.join(root, 'electron', 'services', 'ffmpeg.js'), 'utf8');
  assert.match(source, /probeHdrForRec709/);
  assert.match(source, /arib-std-b67/);
  assert.match(source, /smpte2084/);
  assert.match(source, /case 'hdr_sdr'/);
  assert.match(source, /zscale=t=linear:npl=100/);
  assert.match(source, /tonemap=tonemap=mobius:param=0\.3:desat=0/);
  assert.match(source, /zscale=t=bt709:m=bt709:r=tv/);
  assert.match(source, /'_sdr709\.mp4'/);
  assert.doesNotThrow(() => new vm.Script(source));
});

test('HDR patch is idempotent when applied a second time', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'apply-hdr-sdr-mode.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'second patch run failed');
});
`;
fs.writeFileSync(testPath, testContent, 'utf8');

console.log('[HDR-SDR patch] 完成：自动检测 HDR → SDR Rec.709 已注入，并兼容当前媒体转换 UI。');
