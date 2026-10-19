const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const mainPath = path.join(root, 'electron', 'main.js');
const ttsPath = path.join(root, 'src', 'microsoft-tts.js');
const indexPath = path.join(root, 'src', 'index.html');
const preloadPath = path.join(root, 'electron', 'preload.js');
const edgePath = path.join(root, 'electron', 'services', 'edgeTts.js');
const bridgePath = path.join(root, 'electron', 'services', 'edge_tts_bridge.py');
const historyPath = path.join(root, 'src', 'global-edit-history.js');

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');

test('v4.4.58 keeps main window hidden until a painted frame is ready', () => {
  const src = read(mainPath);
  assert.match(src, /V4_4_58_STARTUP_WINDOW_OPTIONS/);
  assert.match(src, /V4_4_58_STARTUP_REVEAL/);
  assert.match(src, /show:\s*false/);
  assert.match(src, /backgroundColor:\s*'#0b1020'/);
  assert.match(src, /mainWindow\.once\('ready-to-show',\s*revealMainWindow\)/);
  assert.match(src, /setTimeout\(revealMainWindow,\s*8000\)/);
  new vm.Script(src, { filename: mainPath });
});

test('v4.4.58 defers Microsoft TTS queue and voice discovery until its tab is opened', () => {
  const src = read(ttsPath);
  assert.match(src, /V4_4_58_LAZY_MICROSOFT_TTS_INIT/);
  assert.match(src, /const initMicrosoftTts = async \(\) =>/);
  assert.match(src, /lazyTabBtn\.addEventListener\('click'/);
  assert.match(src, /await loadVoices\(false\)/);
  assert.doesNotMatch(src, /setTimeout\(\(\) => loadVoices\(false\),\s*2000\)/);
  new vm.Script(src, { filename: ttsPath });
});

test('v4.4.58 Microsoft TTS preview cache is keyed by selected voice/rate/pitch', () => {
  const src = read(ttsPath);
  assert.match(src, /V4_4_58_TTS_VOICE_CACHE_KEY/);
  assert.match(src, /voiceSettingsKey\(settings = currentVoiceSettings\(\)\)/);
  assert.match(src, /row\._previewSettingsKey === previewKey/);
  assert.match(src, /row\._fullPreviewSettingsKey === previewKey/);
  assert.match(src, /V4_4_58_TTS_PREVIEW_ALL_KEYED/);
  assert.match(src, /invalidateVoicePreviewCache\(\)/);
  new vm.Script(src, { filename: ttsPath });
});

test('v4.4.58 Microsoft TTS output path and open actions are usable', () => {
  const html = read(indexPath);
  const preload = read(preloadPath);
  const tts = read(ttsPath);
  assert.match(html, /V4_4_58_EDITABLE_TTS_OUTPUT/);
  assert.doesNotMatch(html, /id="ms-output"[^>]*\sreadonly(?:\s|>)/);
  assert.match(preload, /V4_4_58_ELECTRON_OPEN_PATH/);
  assert.match(preload, /openPath:\s*safeOpenPath/);
  assert.match(tts, /V4_4_58_TTS_OPEN_PATH_FIX/);
  assert.match(tts, /await openSystemPath\(target\)/);
  assert.match(tts, /window\.electronAPI\?\.fsExists\?\.\(candidate\)/);
  new vm.Script(preload, { filename: preloadPath });
  new vm.Script(tts, { filename: ttsPath });
});

test('v4.4.58 Microsoft TTS never substitutes a generic locale-only voice silently', () => {
  const src = read(edgePath);
  assert.match(src, /V4_4_58_STRICT_MICROSOFT_VOICE/);
  assert.match(src, /engine:\s*'edge-python'/);
  assert.match(src, /engine:\s*'edge-native'/);
  assert.match(src, /voice:\s*shortName/);
  const start = src.indexOf('async function synthesize(text, voice');
  const end = src.indexOf('\nfunction safeSegment', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(src.slice(start, end), /synthesizeCloudFallback/);
  new vm.Script(src, { filename: edgePath });

  const bridge = read(bridgePath);
  assert.match(bridge, /V4_4_58_EDGE_PITCH/);
  assert.match(bridge, /pitch=data\.get\('pitch', '\+0Hz'\)/);
});

test('v4.4.58 moves the initial global-history snapshot to browser idle time', () => {
  const src = read(historyPath);
  assert.match(src, /V4_4_58_IDLE_INITIAL_HISTORY/);
  assert.match(src, /requestIdleCallback\(initialCommit,\{timeout:3500\}\)/);
  assert.doesNotMatch(src, /setTimeout\(\(\)=>commit\(context\(\)\),500\)/);
  new vm.Script(src, { filename: historyPath });
});
