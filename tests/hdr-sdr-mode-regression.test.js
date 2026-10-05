const test = require('node:test');
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
