const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('batch import uses numeric natural order', () => {
  const src = read('src/reels-batch-table.js');
  assert.ok(src.includes('function _naturalSortByName'));
  assert.ok(src.includes('files.sort(_naturalSortByName);'));
  assert.equal(
    src.includes("files.sort((a, b) => (a.name || '').localeCompare(b.name || ''));"),
    false,
    'lexicographic batch file sorting must not remain'
  );

  const names = ['1.mp3', '11.mp3', '2.mp3', '18.mp3', '3.mp3'];
  const sorted = names.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  assert.deepEqual(sorted, ['1.mp3', '2.mp3', '3.mp3', '11.mp3', '18.mp3']);
});

test('single media file can be dropped directly into a background cell', () => {
  const src = read('src/reels-batch-table.js');
  assert.ok(src.includes('V4_4_43_DIRECT_BG_DROP'));
  assert.ok(src.includes("await _assignSingleFile(idx, 'bg', file);"));
});

test('multi-background drop preserves the exact target row', () => {
  const src = read('src/reels-batch-table.js');
  assert.ok(src.includes('V4_4_43_MULTI_BG_TARGET_ROW'));
  assert.ok(src.includes('Number.isInteger(options?.targetIdx)'));
  assert.ok(src.includes('targetIdx: Number.isInteger(droppedRowIdx)'));
});

test('batch video thumbnails are static and hover keeps the original video source', () => {
  const src = read('src/reels-batch-table.js');
  const preload = read('electron/preload.js');
  assert.ok(src.includes('V4_4_45_STATIC_BATCH_VIDEO_THUMBS'));
  assert.ok(src.includes('_RBT_STATIC_THUMB_MAX_CONCURRENCY = 3'));
  assert.ok(src.includes('img.dataset.videoSrc = videoSrc'));
  assert.ok(src.includes('target.dataset.videoSrc'));
  assert.ok(src.includes('window.electronAPI?.localFiles?.getVideoThumbnail'));
  assert.ok(preload.includes("getVideoThumbnail: (filePath, size) => ipcRenderer.invoke('local:video-thumbnail', localMediaUrlToPath(filePath), size)"));
});

test('wide-gamut export uses explicit detected metadata before subtitles and leaves preview untouched', () => {
  const ffmpeg = read('electron/services/ffmpeg.js');
  const raw = read('electron/services/ffmpeg-rawvideo.js');
  const main = read('electron/main.js');
  const color = require(path.join(root, 'electron', 'services', 'export-color-space.js'));

  assert.ok(ffmpeg.includes('V4_4_46_EXPORT_COLOR_BEFORE_SUBTITLES'));
  assert.ok(raw.includes('V4_4_46_WYSIWYG_EXPORT_COLOR'));
  assert.ok(main.includes('V4_4_46_BURN_SUBTITLES_COLOR_FIRST'));
  assert.ok(raw.includes('exportColorAwareFilter(clip.path'));
  assert.ok(raw.includes('normalizedDirectBackgroundFilter(0, opts.alphaOverlayBgPath'));
  assert.equal(read('src/batch-reels.js').includes('getExportColorPlan('), false, 'preview/import flow must not probe or convert color');

  const hlg2020 = color.buildBt2020ToBt709Filter({
    colorPrimaries: 'bt2020',
    colorTransfer: 'arib-std-b67',
    colorSpace: 'bt2020nc',
    colorRange: 'tv',
    pixelFormat: 'yuv420p10le',
    isBt2020: true,
    isWideGamut: true,
    isHdr: true,
  });
  assert.equal(
    hlg2020,
    'zscale=primariesin=bt2020:transferin=arib-std-b67:matrixin=bt2020nc:rangein=limited:transfer=linear:npl=100,format=gbrpf32le,zscale=primaries=bt709,tonemap=tonemap=hable:desat=0,zscale=transfer=bt709:matrix=bt709:range=limited,format=yuv420p',
    'HLG conversion must match the visually verified batch conversion pipeline'
  );

  const pq2020 = color.buildBt2020ToBt709Filter({
    colorPrimaries: 'bt2020',
    colorTransfer: 'smpte2084',
    colorSpace: 'bt2020nc',
    colorRange: 'tv',
    pixelFormat: 'p010le',
    isBt2020: true,
    isWideGamut: true,
    isHdr: true,
  });
  assert.ok(pq2020.includes('transferin=smpte2084'));
  assert.ok(pq2020.includes('matrixin=bt2020nc'));
  assert.ok(pq2020.includes('rangein=limited'));
  assert.ok(pq2020.includes('tonemap=tonemap=hable:desat=0'));

  const sdr2020 = color.buildBt2020ToBt709Filter({
    colorPrimaries: 'bt2020',
    colorTransfer: 'bt2020-10',
    colorSpace: 'bt2020nc',
    colorRange: 'tv',
    pixelFormat: 'yuv420p10le',
    isBt2020: true,
    isWideGamut: true,
    isHdr: false,
  });
  assert.ok(sdr2020.includes('primariesin=bt2020'));
  assert.ok(sdr2020.includes('transferin=bt2020-10'));
  assert.ok(sdr2020.includes('matrixin=bt2020nc'));
  assert.equal(sdr2020.includes('tonemap='), false, 'SDR BT.2020 must not receive HDR tone mapping');

  const p3 = color.buildSourceToBt709Filter({
    colorPrimaries: 'smpte432',
    colorTransfer: 'iec61966-2-1',
    colorSpace: 'bt709',
    colorRange: 'pc',
    pixelFormat: 'yuv420p',
    isWideGamut: true,
    isHdr: false,
  });
  assert.ok(p3.includes('primariesin=smpte432'));
  assert.ok(p3.includes('rangein=full'));

  assert.equal(color.buildSourceToBt709Filter({
    colorPrimaries: 'bt709',
    colorTransfer: 'bt709',
    colorSpace: 'bt709',
    colorRange: 'tv',
    pixelFormat: 'yuv420p',
    isWideGamut: false,
    isHdr: false,
  }), '', 'normal BT.709 must not receive an extra colour transform');

  assert.equal(color.buildSourceToBt709Filter({
    colorPrimaries: 'bt2020',
    colorTransfer: 'arib-std-b67',
    colorSpace: '',
    colorRange: 'tv',
    pixelFormat: 'yuv420p10le',
    isBt2020: true,
    isWideGamut: true,
    isHdr: true,
  }), '', 'incomplete colour metadata must fall back to passthrough instead of guessing');
});

test('preset name dialog guards typing focus from global handlers', () => {
  const src = read('src/reels-overlay-panel.js');
  assert.ok(src.includes('V4_4_43_PRESET_NAME_FOCUS_GUARD'));
  assert.ok(src.includes("['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste']"));
  assert.ok(src.includes('requestAnimationFrame(focusNameInput)'));
});

test('package version is 4.4.46', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, '4.4.46');
});
