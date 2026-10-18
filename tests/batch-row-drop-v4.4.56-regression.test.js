const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('exact background drops target the actual row and bypass generic batch assignment', () => {
  const src = read('src/reels-batch-table.js');
  assert.ok(src.includes('V4_4_56_FAST_ROW_BG_DROP'));

  const start = src.indexOf('// ── 精确落到 bg 单元格：直接绑定“鼠标落下的这一行”');
  const end = src.indexOf('// ── 精确落到 bgm 单元格时', start);
  assert.ok(start >= 0 && end > start);
  const block = src.slice(start, end);

  assert.ok(block.includes("if (dropCell && dropCell.dataset.field === 'bg')"));
  assert.ok(block.includes('const idx = parseInt(row.dataset.idx, 10)'));
  assert.ok(block.includes('window._reelsState?.tasks?.[idx]'));
  assert.equal(block.includes('state.selectedIdx'), false, 'drop target must not use selectedIdx');
  assert.equal(block.includes('_batchAssignFiles('), false, 'exact-row drop must not route through generic batch assignment');
  assert.equal(block.includes('_renderBatchTable()'), false, 'exact-row drop must not rebuild the whole table');
});

test('multi-file background drop updates only the target task/cell', () => {
  const src = read('src/reels-batch-table.js');
  const start = src.indexOf('// ── 精确落到 bg 单元格：直接绑定“鼠标落下的这一行”');
  const end = src.indexOf('// ── 精确落到 bgm 单元格时', start);
  const block = src.slice(start, end);

  assert.ok(block.includes("task.bgMode = 'multi'"));
  assert.ok(block.includes('task.bgClipPool = filePaths'));
  assert.ok(block.includes('task.bgPath = filePaths[0]'));
  assert.ok(block.includes('task.videoPath = filePaths[0]'));
  assert.ok(block.includes('_rbtRenderBackgroundCellLight(idx)'));
  assert.ok(block.includes('_rbtScheduleBackgroundDropCommit(idx)'));
});

test('fast dragover highlighting no longer scans every droppable cell', () => {
  const src = read('src/reels-batch-table.js');
  const start = src.indexOf("panel.addEventListener('dragover'");
  const end = src.indexOf("panel.addEventListener('drop'", start);
  assert.ok(start >= 0 && end > start);
  const block = src.slice(start, end);

  assert.ok(block.includes('_rbtLastDragOverCell'));
  assert.ok(block.includes('_rbtLastDragOverCell = cell || null'));
  assert.equal(block.includes("querySelectorAll('.rbt-droppable.rbt-drag-over')"), false,
    'dragover must not query every droppable cell on every pointer event');
});

test('row-drop persistence and selected preview work are debounced', () => {
  const src = read('src/reels-batch-table.js');
  const start = src.indexOf('const _rbtScheduleBackgroundDropCommit = (idx) =>');
  const end = src.indexOf('// ── 拖拽文件到批量表格 ──', start);
  assert.ok(start >= 0 && end > start);
  const block = src.slice(start, end);

  assert.ok(block.includes('clearTimeout(_rbtBgDropPersistTimer)'));
  assert.ok(block.includes('_syncTasksToActiveTab({ replace: true })'));
  assert.ok(block.includes('_batchAutoSave({ skipSync: true })'));
  assert.ok(block.includes('window._reelsState?.selectedIdx === idx'));
  assert.ok(block.includes('clearTimeout(_rbtBgDropPreviewTimer)'));
});
