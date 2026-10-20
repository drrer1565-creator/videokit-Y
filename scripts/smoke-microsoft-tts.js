// Explicit online release check; never part of the offline unit-test suite.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'videokit-tts-smoke-'));
const originalHome = os.homedir;

(async () => {
  // Isolate the settings service's Node-only fallback from the user's profile.
  os.homedir = () => tmp;
  try {
    const edge = require('../electron/services/edgeTts');
    const voice = 'en-US-AvaMultilingualNeural';
    const result = await edge.synthesize('VideoKit speech writing test.', `edge:${voice}`);
    assert.equal(result.voice, voice);
    assert.ok(result.audio.length > 1000, 'Missing generated speech audio');
    assert.match(result.srt, /\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);
    assert.match(result.srt, /VideoKit/i);
    console.log(`Microsoft TTS smoke passed: ${result.engine}, ${result.audio.length} audio bytes, timed SRT`);
  } finally {
    os.homedir = originalHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
