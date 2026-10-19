const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const mainPath = path.join(root, 'electron', 'main.js');
const preloadPath = path.join(root, 'electron', 'preload.js');
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

test('v4.4.58 keeps safe open-path integration available for later upstream pages', () => {
  const preload = read(preloadPath);
  const main = read(mainPath);
  assert.match(preload, /V4_4_58_ELECTRON_OPEN_PATH/);
  assert.match(preload, /openPath:\s*safeOpenPath/);
  assert.match(main, /V4_4_58_OPEN_PATH_IPC/);
  assert.match(main, /ipcMain\.handle\('open-path'/);
  assert.match(main, /shell\.openPath\(path\.resolve\(value\)\)/);
  new vm.Script(preload, { filename: preloadPath });
  new vm.Script(main, { filename: mainPath });
});

test('v4.4.58 moves the initial global-history snapshot to browser idle time', () => {
  const src = read(historyPath);
  assert.match(src, /V4_4_58_IDLE_INITIAL_HISTORY/);
  assert.match(src, /requestIdleCallback\(initialCommit,\{timeout:3500\}\)/);
  assert.doesNotMatch(src, /setTimeout\(\(\)=>commit\(context\(\)\),500\)/);
  new vm.Script(src, { filename: historyPath });
});
