const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('legacy Reels preview does not keep RAF alive while paused', () => {
    const src = read('src/batch-reels.js');
    assert.match(src, /function _shouldContinueLegacyPreviewLoop\(\)/);
    assert.match(src, /if \(_shouldContinueLegacyPreviewLoop\(\)\)/);
    assert.match(src, /document\.hidden/);
});

test('Reels Preview V2 only schedules continuous RAF while playing', () => {
    const src = read('src/reels-preview-v2.js');
    assert.match(src, /if \(state\.isPlaying\) \{\s*state\.raf = requestAnimationFrame\(tick\);/);
    assert.match(src, /if \(!state\.isOpen \|\| document\.hidden\) return;/);
});

test('batch video thumbnails release decoder resources offscreen', () => {
    const src = read('src/reels-batch-table.js');
    assert.match(src, /video\.dataset\.thumbSrc/);
    assert.match(src, /video\.removeAttribute\('src'\)/);
    assert.match(src, /video\.preload = 'none'/);
    assert.match(src, /else release\(entry\.target\)/);
});

test('task list group statistics are precomputed instead of filtered per row', () => {
    const src = read('src/batch-reels.js');
    assert.match(src, /const batchGroupStats = new Map\(\)/);
    assert.match(src, /const folderQueueStats = new Map\(\)/);
    assert.doesNotMatch(src, /const groupTasks = tasks\.filter/);
    assert.doesNotMatch(src, /const queueTasks = tasks\.filter/);
});


test('task selection updates only affected rows', () => {
    const src = read('src/batch-reels.js');
    assert.match(src, /function _updateTaskListSelectionOnly\(prevIdx, nextIdx\)/);
    assert.match(src, /if \(!_updateTaskListSelectionOnly\(prevIdx, idx\)\) _renderTaskList\(\)/);
});

test('periodic autosaves skip hidden windows', () => {
    const reels = read('src/batch-reels.js');
    const table = read('src/reels-batch-table.js');
    const preload = read('electron/preload.js');
    assert.match(reels, /setInterval\(\(\) => \{\s*if \(document\.hidden\) return;/);
    assert.match(table, /setInterval\(\(\) => \{\s*if \(document\.hidden\) return;/);
    assert.match(preload, /requestIdleCallback/);
});
