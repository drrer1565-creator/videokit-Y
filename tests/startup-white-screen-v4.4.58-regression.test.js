const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const mainPath = path.join(root, 'electron', 'main.js');
const ttsPath = path.join(root, 'src', 'microsoft-tts.js');
const historyPath = path.join(root, 'src', 'global-edit-history.js');

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');

test('v4.4.58 keeps main window hidden until a painted frame is ready', () => {
  const src = read(mainPath);
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

test('v4.4.58 moves the initial global-history snapshot to browser idle time', () => {
  const src = read(historyPath);
  assert.match(src, /V4_4_58_IDLE_INITIAL_HISTORY/);
  assert.match(src, /requestIdleCallback\(initialCommit,\{timeout:3500\}\)/);
  assert.doesNotMatch(src, /setTimeout\(\(\)=>commit\(context\(\)\),500\)/);
  new vm.Script(src, { filename: historyPath });
});
