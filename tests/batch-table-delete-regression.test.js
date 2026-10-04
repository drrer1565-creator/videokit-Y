const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('batch table deletion uses authoritative tab replacement', () => {
  const src = read('src/reels-batch-table.js');

  assert.match(src, /function _syncTasksToActiveTab\(options = \{\}\)/);
  assert.match(src, /if \(options\.replace === true\)/);

  // Single-row delete must immediately replace active tab state and persist it.
  assert.match(
    src,
    /window\._reelsState\.tasks\.splice\(idx, 1\);[\s\S]*?_syncTasksToActiveTab\(\{ replace: true \}\);[\s\S]*?_batchAutoSave\(\{ skipSync: true \}\);/
  );

  // Bulk delete must also use authoritative replacement.
  assert.match(
    src,
    /确定删除当前标签页中选中的[\s\S]*?_syncTasksToActiveTab\(\{ replace: true \}\);/
  );

  // Applying changes and closing must keep deletion authoritative.
  assert.match(
    src,
    /if \(saveOnClose\) \{[\s\S]*?_applyBatchTableChanges\(\);[\s\S]*?_syncTasksToActiveTab\(\{ replace: true \}\);/
  );
});
