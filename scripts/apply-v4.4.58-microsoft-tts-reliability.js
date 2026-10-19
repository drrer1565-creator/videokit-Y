// Compatibility wrapper kept in the v4.4.55+ patch chain.
// Repair the v2 range helper before loading it: every replacement already
// includes its end marker, so the original end marker must be consumed.
const fs = require('fs');
const path = require('path');

const ttsPath = path.join(__dirname, '..', 'src', 'microsoft-tts.js');
const currentTts = fs.readFileSync(ttsPath, 'utf8');
const v459SupersededPreviewAll = currentTts.includes('V4_4_59_TTS_PLAY_SAVED_BATCH')
  && currentTts.includes('V4_4_58_TTS_VOICE_CACHE_KEY')
  && currentTts.includes('V4_4_58_TTS_OPEN_PATH_FIX');

if (v459SupersededPreviewAll) {
  // v4.4.59 intentionally replaces the old preview-all cache implementation
  // with direct playback of the generated MP3. Reapplying the v4.4.58 textual
  // range patch would look for code that no longer exists.
  console.log('[4.4.58-ms-tts] v4.4.59 superseding TTS path detected; compatibility validation passed.');
} else {
  const patchPath = path.join(__dirname, 'apply-v4.4.58-microsoft-tts-reliability-v2.js');
  let source = fs.readFileSync(patchPath, 'utf8');
  const before = '  return src.slice(0, start) + replacement + src.slice(end);';
  const after = '  return src.slice(0, start) + replacement + src.slice(end + endMarker.length);';
  if (source.includes(before)) {
    source = source.replace(before, after);
    fs.writeFileSync(patchPath, source, 'utf8');
  }
  require('./apply-v4.4.58-microsoft-tts-reliability-v2.js');
}
