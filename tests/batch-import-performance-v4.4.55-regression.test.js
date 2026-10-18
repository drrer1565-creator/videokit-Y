const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('batch import refreshes are coalesced instead of redrawing per file', () => {
  const src = read('src/reels-batch-table.js');
  assert.ok(src.includes('V4_4_55_BATCH_IMPORT_REFRESH_GUARD'));
  assert.ok(src.includes('function _rbtRequestImportRefresh(options = {})'));
  assert.ok(src.includes('async function _rbtWithImportBatch(work)'));
  assert.ok(src.includes('V4_4_55_MIXED_DROP_BATCH_RENDER'));
  assert.ok(src.includes('_rbtRequestImportRefresh({ taskList: true, selectCurrent: true })'));

  const srtStart = src.indexOf('function _readSrtFileToTask(task, file, options = {})');
  const srtEnd = src.indexOf('function _parseSrtContent', srtStart);
  assert.ok(srtStart >= 0 && srtEnd > srtStart);
  const srtBlock = src.slice(srtStart, srtEnd);
  assert.equal(srtBlock.includes('_renderBatchTable();'), false, 'SRT reader must not rebuild the whole table directly');
  assert.equal(srtBlock.includes('_renderTaskList();'), false, 'SRT reader must not rebuild the task list directly');
  assert.ok(srtBlock.includes('refreshUI'));

  const txtStart = src.indexOf('function _readTxtFileToTask(task, file, options = {})');
  const txtEnd = src.indexOf('function _rbtSmartLineBreak', txtStart);
  assert.ok(txtStart >= 0 && txtEnd > txtStart);
  const txtBlock = src.slice(txtStart, txtEnd);
  assert.equal(txtBlock.includes('_renderBatchTable();'), false, 'TXT reader must not rebuild the whole table directly');
  assert.ok(txtBlock.includes('refreshUI'));
});

test('batch SRT and TXT assignment waits for parsing and suppresses per-file refresh', () => {
  const src = read('src/reels-batch-table.js');
  const start = src.indexOf('async function _batchAssignFiles(files, field, options = {})');
  const end = src.indexOf('async function _batchAssignTxtFiles(files)', start);
  assert.ok(start >= 0 && end > start);
  const block = src.slice(start, end);
  assert.ok(block.includes('await Promise.resolve(_assignFileToTask('));
  assert.ok(block.includes('{ refreshUI: false }'));
  assert.ok(block.includes('_rbtRequestImportRefresh({ taskList: true, selectCurrent: true })'));

  const txtBatchStart = src.indexOf('async function _batchAssignTxtFiles(files)');
  const txtBatchEnd = src.indexOf('async function _assignSingleFile', txtBatchStart);
  assert.ok(txtBatchStart >= 0 && txtBatchEnd > txtBatchStart);
  const txtBatch = src.slice(txtBatchStart, txtBatchEnd);
  assert.ok(txtBatch.includes('await _readTxtFileToTask(targetTask, file, { refreshUI: false })'));
  assert.ok(txtBatch.includes('_rbtRequestImportRefresh({ taskList: true })'));
});

test('folder imports use async text reads and do not redraw for every companion SRT', () => {
  const src = read('src/reels-batch-table.js');
  const preload = read('electron/preload.js');

  assert.ok(preload.includes('V4_4_55_ASYNC_TEXT_READ'));
  assert.ok(preload.includes('readFileTextAsync: async (filePath)'));
  assert.ok(preload.includes("fs.promises.readFile(filePath, 'utf-8')"));

  assert.ok(src.includes('async function _rbtReadTextPath(filePath)'));
  assert.ok(src.includes('await _readSrtViaElectronAPI(task, group.srtPath, { refreshUI: false })'));
  assert.ok(src.includes('task.txtContent = await _rbtReadTextPath(group.txtPath)'));
  assert.ok(src.includes('await _readSrtViaElectronAPI(task, subtitleFile.path, { refreshUI: false })'));
  assert.ok(src.includes('task.txtContent = await _rbtReadTextPath(group.txt.path)'));
});

test('single-file imports still refresh once after awaited parsing', () => {
  const src = read('src/reels-batch-table.js');
  const start = src.indexOf('async function _assignSingleFile(idx, field, file)');
  const end = src.indexOf('V4_4_55_SRT_ASYNC_BATCH_READ', start);
  assert.ok(start >= 0 && end > start);
  const block = src.slice(start, end);
  assert.ok(block.includes('await _readSrtFileToTask(task, file, { refreshUI: false })'));
  assert.ok(block.includes('await _readTxtFileToTask(task, file, { refreshUI: false })'));
  assert.ok(block.includes('_renderBatchTable();'));
});
