const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const batchPath = path.join(root, 'src', 'reels-batch-table.js');
const preloadPath = path.join(root, 'electron', 'preload.js');

const batch = fs.readFileSync(batchPath, 'utf8');
const preload = fs.readFileSync(preloadPath, 'utf8');
const alreadyApplied = batch.includes('V4_4_55_BATCH_IMPORT_REFRESH_GUARD')
  && batch.includes('V4_4_55_SRT_ASYNC_BATCH_READ')
  && batch.includes('V4_4_55_TXT_ASYNC_BATCH_READ')
  && batch.includes('V4_4_55_MIXED_DROP_BATCH_RENDER')
  && preload.includes('V4_4_55_ASYNC_TEXT_READ');

if (!alreadyApplied) {
  require('./apply-v4.4.55-batch-import-performance.js');
} else {
  // The underlying transformation script intentionally targets the pre-4.4.55
  // source shape.  Do not run it twice in the same npm workspace (npm test then
  // npm build); validate the already-patched files instead.
  new vm.Script(batch, { filename: batchPath });
  new vm.Script(preload, { filename: preloadPath });
  const required = [
    '_rbtRequestImportRefresh({ taskList: true, selectCurrent: true })',
    'await _readSrtViaElectronAPI(task, group.srtPath, { refreshUI: false })',
    'await _rbtReadTextPath(group.txtPath)',
    'await _readSrtViaElectronAPI(task, subtitleFile.path, { refreshUI: false })',
  ];
  for (const marker of required) {
    if (!batch.includes(marker)) throw new Error(`4.4.55 chained patch validation failed: ${marker}`);
  }
  if (!preload.includes('readFileTextAsync')) {
    throw new Error('4.4.55 chained patch validation failed: readFileTextAsync');
  }
  console.log('[4.4.55-batch-import-performance] already applied; idempotent validation passed.');
}

// Keep the exact-row multi-material drop performance fix in the same lifecycle chain.
require('./apply-v4.4.56-fast-row-multidrop.js');
// Selected upstream v4.4.57 integrations are deliberately chained last so they
// can wire the final patched 4.4.56 Batch Reels source without undoing its performance fixes.
require('./apply-v4.4.57-selected-upgrades.js');
