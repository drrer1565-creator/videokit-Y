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


test('ffprobe duration requests are cached and coalesced', () => {
    const src = read('electron/services/ffmpeg.js');
    assert.match(src, /const _durationCache = new Map\(\)/);
    assert.match(src, /const _durationInflight = new Map\(\)/);
    assert.match(src, /_mediaProbeSignature/);
    assert.match(src, /if \(signature && _durationInflight\.has\(signature\)\)/);
});

test('media info uses one combined ffprobe path', () => {
    const ffmpeg = read('electron/services/ffmpeg.js');
    const router = read('electron/apiRouter.js');
    assert.match(ffmpeg, /async function getMediaInfo\(filePath\)/);
    assert.match(ffmpeg, /format=duration:stream=width,height,r_frame_rate/);
    assert.match(router, /return await ffmpegService\.getMediaInfo\(data\.file_path\)/);
});

test('Windows FFmpeg child processes yield priority to the UI', () => {
    const ffmpeg = read('electron/services/ffmpeg.js');
    const raw = read('electron/services/ffmpeg-rawvideo.js');
    assert.match(ffmpeg, /PRIORITY_BELOW_NORMAL/);
    assert.match(ffmpeg, /if \(cmd === 'ffmpeg'\) _deprioritizeMediaProcess/);
    assert.match(raw, /function deprioritize\(proc\)/);
});


test('preview WebAudio contexts suspend while idle', () => {
    const legacy = read('src/batch-reels.js');
    const v2 = read('src/reels-preview-v2.js');
    assert.match(legacy, /_audioCtx\?\.state === 'running'/);
    assert.match(legacy, /_audioCtx\.suspend\(\)/);
    assert.match(v2, /state\.audioCtx\?\.state === 'running'/);
    assert.match(v2, /state\.audioCtx\.suspend\(\)/);
});


test('editor windows throttle in background while export renderer stays unthrottled', () => {
    const main = read('electron/main.js');
    assert.match(main, /backgroundThrottling: true/);
    assert.match(main, /isolatedReelsRenderers/);
    assert.match(main, /backgroundThrottling: false/);
});


test('local video thumbnails are concurrency-limited', () => {
    const src = read('electron/localOrganizerService.js');
    assert.match(src, /const LOCAL_THUMBNAIL_CONCURRENCY = 2/);
    assert.match(src, /withLocalThumbnailSlot/);
    assert.match(src, /PRIORITY_BELOW_NORMAL/);
});
