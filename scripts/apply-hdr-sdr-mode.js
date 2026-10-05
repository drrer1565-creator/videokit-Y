const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ffmpegPath = path.join(root, 'electron', 'services', 'ffmpeg.js');
const indexPath = path.join(root, 'src', 'index.html');
const testPath = path.join(root, 'tests', 'hdr-sdr-mode-regression.test.js');

function fail(message) {
  throw new Error(`[HDR-SDR patch] ${message}`);
}

function writeIfChanged(filePath, content) {
  const before = fs.readFileSync(filePath, 'utf8');
  if (before !== content) fs.writeFileSync(filePath, content, 'utf8');
}

let ffmpeg = fs.readFileSync(ffmpegPath, 'utf8');

if (!ffmpeg.includes('async function probeHdrForRec709(filePath)')) {
  const mediaMarker = '/**\n * 媒体转换\n */\nasync function mediaConvert';
  const helper = `/**\n * 自动检测视频是否为 HDR，并返回色彩元数据。\n * 优先依据 HLG/PQ transfer characteristic；同时兼容 HDR10/Dolby Vision side data，\n * 以及部分只写入 BT.2020 + 10/12bit、却缺失 transfer 标记的手机素材。\n */\nasync function probeHdrForRec709(filePath) {\n    try {\n        const { stdout } = await runCommand('ffprobe', [\n            '-v', 'error',\n            '-select_streams', 'v:0',\n            '-show_streams',\n            '-of', 'json',\n            filePath\n        ], { timeout: PROBE_TIMEOUT });\n\n        const stream = JSON.parse(stdout || '{}').streams?.[0] || {};\n        const transfer = String(stream.color_transfer || '').toLowerCase();\n        const primaries = String(stream.color_primaries || '').toLowerCase();\n        const matrix = String(stream.color_space || '').toLowerCase();\n        const pixelFormat = String(stream.pix_fmt || '').toLowerCase();\n        const bitDepth = Number.parseInt(stream.bits_per_raw_sample || '', 10) ||\n            (/p(10|12)|10le|12le|10be|12be/.test(pixelFormat) ? 10 : 8);\n        const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];\n        const sideDataTypes = sideData.map(item => String(item?.side_data_type || '')).filter(Boolean);\n\n        const isHlg = transfer === 'arib-std-b67';\n        const isPq = transfer === 'smpte2084' || transfer === 'smpte-st-2084';\n        const hasHdrSideData = sideDataTypes.some(type =>\n            /mastering display|content light level|hdr10|dovi|dolby vision/i.test(type)\n        );\n        const looksLikeUnlabelledHdr = primaries === 'bt2020' && bitDepth >= 10 &&\n            !['bt709', 'iec61966-2-1', 'smpte170m'].includes(transfer);\n        const isHdr = isHlg || isPq || hasHdrSideData || looksLikeUnlabelledHdr;\n\n        let hdrType = 'SDR';\n        if (isHlg) hdrType = 'HLG';\n        else if (isPq) hdrType = 'PQ/HDR10';\n        else if (hasHdrSideData) hdrType = 'HDR metadata';\n        else if (looksLikeUnlabelledHdr) hdrType = 'BT.2020 10bit HDR';\n\n        return {\n            isHdr,\n            hdrType,\n            transfer,\n            primaries,\n            matrix,\n            pixelFormat,\n            bitDepth,\n            sideDataTypes,\n            probeFailed: false,\n        };\n    } catch (error) {\n        return {\n            isHdr: false,\n            hdrType: 'unknown',\n            transfer: '',\n            primaries: '',\n            matrix: '',\n            pixelFormat: '',\n            bitDepth: 0,\n            sideDataTypes: [],\n            probeFailed: true,\n            error: error?.message || String(error),\n        };\n    }\n}\n\n`;
  if (!ffmpeg.includes(mediaMarker)) fail('找不到 mediaConvert 插入点');
  ffmpeg = ffmpeg.replace(mediaMarker, `${helper}${mediaMarker}`);
}

if (!ffmpeg.includes("'hdr_sdr': { outputExt: '_sdr709.mp4', type: 'video' }")) {
  const modeMarker = "    const modeConfigs = {\n        'mp3': { outputExt: '.mp3', type: 'audio' },";
  const modeReplacement = "    const modeConfigs = {\n        'hdr_sdr': { outputExt: '_sdr709.mp4', type: 'video' },\n        'mp3': { outputExt: '.mp3', type: 'audio' },";
  if (!ffmpeg.includes(modeMarker)) fail('找不到 modeConfigs 插入点');
  ffmpeg = ffmpeg.replace(modeMarker, modeReplacement);
}

if (!ffmpeg.includes("case 'hdr_sdr': {")) {
  const switchMarker = "        switch (mode) {\n            case 'mp4':";
  const hdrCase = `        switch (mode) {\n            case 'hdr_sdr': {\n                const hdrInfo = await probeHdrForRec709(filePath);\n                if (hdrInfo.probeFailed) {\n                    throw new Error(\`HDR 自动检测失败：\${hdrInfo.error || '无法读取视频色彩元数据'}\`);\n                }\n\n                const sourceSummary = [\n                    hdrInfo.hdrType,\n                    hdrInfo.primaries || 'primaries?',\n                    hdrInfo.transfer || 'transfer?',\n                    hdrInfo.matrix || 'matrix?',\n                    hdrInfo.pixelFormat || 'pix_fmt?'\n                ].join(' / ');\n\n                const commonOutputArgs = [\n                    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',\n                    '-pix_fmt', 'yuv420p',\n                    '-c:a', 'aac', '-b:a', '192k',\n                    '-colorspace', 'bt709',\n                    '-color_primaries', 'bt709',\n                    '-color_trc', 'bt709',\n                    '-color_range', 'tv',\n                    '-movflags', '+faststart'\n                ];\n\n                if (hdrInfo.isHdr) {\n                    // 在浮点线性光空间中完成 BT.2020 -> BT.709 + Tone Mapping，\n                    // 避免只改色彩标签造成的过曝、发灰或高光剪切。\n                    const toneMapFilter = [\n                        'zscale=t=linear:npl=100',\n                        'format=gbrpf32le',\n                        'zscale=p=bt709',\n                        'tonemap=tonemap=mobius:param=0.3:desat=0',\n                        'zscale=t=bt709:m=bt709:r=tv',\n                        'format=yuv420p'\n                    ].join(',');\n                    console.log(\`[HDR→SDR] 检测到 HDR：\${path.basename(filePath)} | \${sourceSummary}；开始转换为 SDR Rec.709\`);\n                    args = [\n                        '-y', '-i', filePath,\n                        '-map', '0:v:0', '-map', '0:a?',\n                        '-vf', toneMapFilter,\n                        ...commonOutputArgs,\n                        outputPath\n                    ];\n                } else {\n                    // 混合批量素材中遇到普通 SDR 时，不做 HDR Tone Mapping，\n                    // 只做兼容性 H.264/8bit 输出；正常 BT.709 画面不会被二次压亮或压暗。\n                    console.log(\`[HDR→SDR] 未检测到 HDR：\${path.basename(filePath)} | \${sourceSummary}；跳过 Tone Mapping，按 SDR Rec.709 兼容输出\`);\n                    args = [\n                        '-y', '-i', filePath,\n                        '-map', '0:v:0', '-map', '0:a?',\n                        ...commonOutputArgs,\n                        outputPath\n                    ];\n                }\n                break;\n            }\n            case 'mp4':`;
  if (!ffmpeg.includes(switchMarker)) fail('找不到 video switch 插入点');
  ffmpeg = ffmpeg.replace(switchMarker, hdrCase);
}

writeIfChanged(ffmpegPath, ffmpeg);

let html = fs.readFileSync(indexPath, 'utf8');

// 当前媒体转换 UI 使用 sidebar-item + data-mode；把 HDR 模式插在 H.264 前面。
if (!html.includes('data-category="video-format" data-mode="hdr_sdr"')) {
  const sidebarRe = /<button\s+class="sidebar-item\s+active"\s+data-category="video-format"\s+data-mode="h264">H\.264<\/button>/;
  const match = html.match(sidebarRe);
  if (!match) fail('找不到视频格式转换中的 H.264 菜单按钮');
  const h264Button = match[0];
  const hdrButton = '<button class="sidebar-item" data-category="video-format" data-mode="hdr_sdr" title="自动检测 HLG/PQ/HDR10；HDR 转 SDR Rec.709，普通 SDR 自动跳过 Tone Mapping">HDR → SDR Rec.709</button>';
  html = html.replace(h264Button, `${hdrButton}\n              ${h264Button}`);
}

// 同步补上旧版/兼容用的格式单选项，保持 H.264 仍为默认选项。
if (!html.includes('name="format_mode" value="hdr_sdr"')) {
  const radioRe = /<label class="mode-option">\s*<input type="radio" name="format_mode" value="h264" checked>\s*<span>H\.264 \(MP4\)<\/span>\s*<\/label>/;
  const match = html.match(radioRe);
  if (!match) fail('找不到 H.264 格式单选项');
  const h264Radio = match[0];
  const hdrRadio = `<label class="mode-option">\n                      <input type="radio" name="format_mode" value="hdr_sdr">\n                      <span>HDR → SDR Rec.709</span>\n                    </label>`;
  html = html.replace(h264Radio, `${hdrRadio}\n                    ${h264Radio}`);
}

const hdrPos = html.indexOf('data-category="video-format" data-mode="hdr_sdr"');
const h264Pos = html.indexOf('data-category="video-format" data-mode="h264"');
if (hdrPos < 0 || h264Pos < 0 || hdrPos > h264Pos) {
  fail('HDR → SDR Rec.709 没有位于视频格式转换列表的第一个位置');
}
writeIfChanged(indexPath, html);

const testContent = `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\n\nconst root = path.resolve(__dirname, '..');\n\ntest('HDR → SDR Rec.709 appears before H.264 in the video conversion menu', () => {\n  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');\n  const hdr = html.indexOf('data-category="video-format" data-mode="hdr_sdr"');\n  const h264 = html.indexOf('data-category="video-format" data-mode="h264"');\n  assert.ok(hdr >= 0, 'HDR mode button is missing');\n  assert.ok(h264 >= 0, 'H.264 mode button is missing');\n  assert.ok(hdr < h264, 'HDR mode must be the first video conversion option');\n  assert.match(html, /name="format_mode" value="hdr_sdr"/);\n});\n\ntest('HDR converter auto-detects HLG/PQ and performs real Rec.709 tone mapping', () => {\n  const source = fs.readFileSync(path.join(root, 'electron', 'services', 'ffmpeg.js'), 'utf8');\n  assert.match(source, /probeHdrForRec709/);\n  assert.match(source, /arib-std-b67/);\n  assert.match(source, /smpte2084/);\n  assert.match(source, /zscale=t=linear:npl=100/);\n  assert.match(source, /tonemap=tonemap=mobius:param=0\\.3:desat=0/);\n  assert.match(source, /zscale=t=bt709:m=bt709:r=tv/);\n  assert.match(source, /'_sdr709\\.mp4'/);\n});\n`;
fs.writeFileSync(testPath, testContent, 'utf8');

console.log('[HDR-SDR patch] 完成：已加入自动检测 HDR → SDR Rec.709 模式，并置于视频格式转换第一项。');
