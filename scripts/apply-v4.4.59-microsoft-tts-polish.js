const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src', 'microsoft-tts.js');
const read = () => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
const replaceOnce = (src, before, after, label) => {
  if (src.includes(after)) return src;
  if (!src.includes(before)) throw new Error(`4.4.59 TTS polish marker missing: ${label}`);
  return src.replace(before, after);
};

const before = read();
let src = before;
if (!src.includes('V4_4_59_TTS_PLAYBACK_LIFECYCLE')) throw new Error('v4.4.59 frontend patch must run before polish');

if (!src.includes('V4_4_59_TTS_POLISH')) {
  src = replaceOnce(
    src,
    "                voice: $('voice')?.value || 'edge:en-US-AvaMultilingualNeural',",
    "                // V4_4_59_TTS_POLISH\n                voice: $('voice')?.value || '',",
    'do not persist Ava for an empty filtered voice list'
  );

  src = replaceOnce(
    src,
    "                row._dirtyPreview = true;\n                row._dirtyFull = true;\n                row.state = 'waiting';\n                const newRows = lines.slice(1).map((line, idx) => ({",
    "                row._dirtyPreview = true;\n                row._dirtyFull = true;\n                row.state = 'waiting';\n                row.warning = '';\n                const newRows = lines.slice(1).map((line, idx) => ({",
    'clear stale warning after multi-line paste'
  );

  src = replaceOnce(
    src,
    "            textarea.addEventListener('input', () => {\n                row.text = textarea.value;\n                row._dirtyPreview = true;\n                row._dirtyFull = true;",
    "            textarea.addEventListener('input', () => {\n                row.text = textarea.value;\n                row._dirtyPreview = true;\n                row._dirtyFull = true;\n                row.warning = '';",
    'clear stale warning after editing text'
  );

  const duplicatedRefresh = "        $('refresh').onclick = () => loadVoices(true);        $('refresh').onclick = () => loadVoices(true);";
  const singleRefresh = "        $('refresh').onclick = () => loadVoices(true);";
  if (src.includes(duplicatedRefresh)) src = src.replace(duplicatedRefresh, singleRefresh);
}

new vm.Script(src, { filename: file });
if (before !== src) fs.writeFileSync(file, src, 'utf8');
if (!src.includes('V4_4_59_TTS_POLISH')) throw new Error('v4.4.59 TTS polish incomplete');
if (src.includes("$('refresh').onclick = () => loadVoices(true);        $('refresh').onclick")) throw new Error('duplicate refresh handler remains');
if (src.includes("voice: $('voice')?.value || 'edge:en-US-AvaMultilingualNeural'")) throw new Error('empty voice still persists Ava');
console.log('[4.4.59-ms-tts-polish] Empty voice persistence, stale warnings and duplicate handlers fixed.');
