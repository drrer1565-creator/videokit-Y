const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const batchPath = path.join(root, 'src', 'reels-batch-table.js');
const preloadPath = path.join(root, 'electron', 'preload.js');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function write(file, before, after) {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.55-batch-import-performance] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.55-batch-import-performance] no changes needed for ${path.relative(root, file)}`);
  }
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`4.4.55 patch marker missing: ${label}`);
  return source.replace(before, after);
}

function syntax(source, file) {
  new vm.Script(source, { filename: file });
}

let preloadBefore = read(preloadPath);
let preload = preloadBefore;
if (!preload.includes('V4_4_55_ASYNC_TEXT_READ')) {
  preload = replaceOnce(
    preload,
    `    // 读取文件内容\n    readFileText: (filePath) => {\n        try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }\n    },\n`,
    `    // 读取文件内容\n    // V4_4_55_ASYNC_TEXT_READ: batch imports should not block the renderer on fs.readFileSync.\n    readFileTextAsync: async (filePath) => {\n        try { return await fs.promises.readFile(filePath, 'utf-8'); } catch { return ''; }\n    },\n    // Keep the synchronous bridge for legacy callers; batch import paths prefer the async API above.\n    readFileText: (filePath) => {\n        try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }\n    },\n`,
    'async text bridge'
  );
}

let batchBefore = read(batchPath);
let batch = batchBefore;

if (!batch.includes('V4_4_55_BATCH_IMPORT_REFRESH_GUARD')) {
  const marker = 'function _rbtFileExists(filePath) {';
  if (!batch.includes(marker)) throw new Error('batch import refresh helper insertion marker missing');
  const helper = `// V4_4_55_BATCH_IMPORT_REFRESH_GUARD\n// Heavy batch imports may complete many asynchronous file reads.  Coalesce all\n// UI work so a whole import burst rebuilds the large table/task list only once.\nlet _rbtImportRenderDepth = 0;\nlet _rbtImportRenderPending = false;\nlet _rbtImportTaskListPending = false;\nlet _rbtImportSelectPending = false;\n\nfunction _rbtBeginImportBatch() {\n    _rbtImportRenderDepth++;\n}\n\nfunction _rbtRequestImportRefresh(options = {}) {\n    const taskList = options.taskList !== false;\n    const selectCurrent = options.selectCurrent === true;\n    if (_rbtImportRenderDepth > 0) {\n        _rbtImportRenderPending = true;\n        if (taskList) _rbtImportTaskListPending = true;\n        if (selectCurrent) _rbtImportSelectPending = true;\n        return;\n    }\n    if (_batchTableState.visible) _renderBatchTable();\n    if (taskList && typeof _renderTaskList === 'function') _renderTaskList();\n    if (selectCurrent && window._reelsState && window._reelsState.selectedIdx >= 0 && typeof reelsSelectTask === 'function') {\n        reelsSelectTask(window._reelsState.selectedIdx);\n    }\n}\n\nfunction _rbtEndImportBatch() {\n    if (_rbtImportRenderDepth <= 0) return;\n    _rbtImportRenderDepth--;\n    if (_rbtImportRenderDepth > 0) return;\n    const shouldRender = _rbtImportRenderPending;\n    const shouldTaskList = _rbtImportTaskListPending;\n    const shouldSelect = _rbtImportSelectPending;\n    _rbtImportRenderPending = false;\n    _rbtImportTaskListPending = false;\n    _rbtImportSelectPending = false;\n    if (!shouldRender) return;\n    if (_batchTableState.visible) _renderBatchTable();\n    if (shouldTaskList && typeof _renderTaskList === 'function') _renderTaskList();\n    if (shouldSelect && window._reelsState && window._reelsState.selectedIdx >= 0 && typeof reelsSelectTask === 'function') {\n        reelsSelectTask(window._reelsState.selectedIdx);\n    }\n}\n\nasync function _rbtWithImportBatch(work) {\n    _rbtBeginImportBatch();\n    try {\n        return await work();\n    } finally {\n        _rbtEndImportBatch();\n    }\n}\n\nasync function _rbtReadTextPath(filePath) {\n    if (!filePath || !window.electronAPI) return '';\n    if (typeof window.electronAPI.readFileTextAsync === 'function') {\n        return await window.electronAPI.readFileTextAsync(filePath);\n    }\n    if (typeof window.electronAPI.readFileText === 'function') {\n        return window.electronAPI.readFileText(filePath);\n    }\n    return '';\n}\n\n`;
  batch = batch.replace(marker, helper + marker);
}

// SRT reads now return a Promise and can suppress their own UI refresh while a batch owns refresh timing.
if (!batch.includes('V4_4_55_SRT_ASYNC_BATCH_READ')) {
  const srtRegex = /function _readSrtFileToTask\(task, file\) \{[\s\S]*?\n\}\n\nfunction _readSrtViaElectronAPI\(task, filePath\) \{[\s\S]*?\n\}\n\nfunction _parseSrtContent/;
  if (!srtRegex.test(batch)) throw new Error('SRT reader block not found');
  const srtReplacement = `// V4_4_55_SRT_ASYNC_BATCH_READ\nfunction _readSrtFileToTask(task, file, options = {}) {\n    const filePath = task.srtPath;\n    const refreshUI = options.refreshUI !== false;\n    console.log('[SRT] _readSrtFileToTask called, filePath:', filePath, 'hasFile:', !!file);\n\n    if (file) {\n        return new Promise((resolve) => {\n            const reader = new FileReader();\n            reader.onload = (ev) => {\n                try {\n                    const content = ev.target.result;\n                    console.log('[SRT] FileReader result, content length:', content?.length);\n                    if (!content) { console.warn('[SRT] FileReader returned empty'); resolve(false); return; }\n                    _parseSrtContent(task, content);\n                    console.log('[SRT] ✅ loaded via FileReader, segments:', task.segments?.length);\n                    if (refreshUI) _rbtRequestImportRefresh({ taskList: true });\n                    resolve(true);\n                } catch (error) {\n                    console.warn('[SRT] FileReader parse failed:', error);\n                    resolve(false);\n                }\n            };\n            reader.onerror = async (err) => {\n                console.warn('[SRT] FileReader error:', err, '— trying electronAPI fallback');\n                try {\n                    resolve(await _readSrtViaElectronAPI(task, filePath, { refreshUI }));\n                } catch (_) {\n                    resolve(false);\n                }\n            };\n            reader.readAsText(file);\n        });\n    }\n\n    return _readSrtViaElectronAPI(task, filePath, { refreshUI });\n}\n\nasync function _readSrtViaElectronAPI(task, filePath, options = {}) {\n    const refreshUI = options.refreshUI !== false;\n    if (filePath && window.electronAPI) {\n        try {\n            const content = await _rbtReadTextPath(filePath);\n            if (content) {\n                _parseSrtContent(task, content);\n                console.log('[SRT] ✅ loaded via electronAPI:', filePath, 'segments:', task.segments?.length);\n                if (refreshUI) _rbtRequestImportRefresh({ taskList: true });\n                return true;\n            }\n        } catch (e) {\n            console.warn('[SRT] electronAPI.readFileText error:', e);\n        }\n    }\n    console.warn('[SRT] ❌ Failed to load SRT:', filePath);\n    return false;\n}\n\nfunction _parseSrtContent`;
  batch = batch.replace(srtRegex, srtReplacement);
}

if (!batch.includes('V4_4_55_TXT_ASYNC_BATCH_READ')) {
  const txtRegex = /function _readTxtFileToTask\(task, file\) \{[\s\S]*?\n\}\n\n\/\*\*\n \* 智能断行/;
  if (!txtRegex.test(batch)) throw new Error('TXT reader block not found');
  const txtReplacement = `// V4_4_55_TXT_ASYNC_BATCH_READ\nfunction _readTxtFileToTask(task, file, options = {}) {\n    const refreshUI = options.refreshUI !== false;\n    return new Promise((resolve) => {\n        const reader = new FileReader();\n        reader.onload = (ev) => {\n            task.txtContent = ev.target.result || '';\n            task.aligned = false;\n            if (refreshUI) _rbtRequestImportRefresh({ taskList: false });\n            resolve(true);\n        };\n        reader.onerror = () => resolve(false);\n        reader.readAsText(file);\n    });\n}\n\n/**\n * 智能断行`;
  batch = batch.replace(txtRegex, txtReplacement);
}

// Assignment helper returns the async read Promise for text files; non-text media remains synchronous.
batch = batch.replace(
  'function _assignFileToTask(task, file, field) {',
  'function _assignFileToTask(task, file, field, options = {}) {'
);
batch = batch.replace(
  `    } else if (field === 'srt') {\n        task.srtPath = filePath;\n        _readSrtFileToTask(task, file);\n    } else if (field === 'txt') {\n        task.txtPath = filePath;\n        _readTxtFileToTask(task, file);\n`,
  `    } else if (field === 'srt') {\n        task.srtPath = filePath;\n        return _readSrtFileToTask(task, file, { refreshUI: options.refreshUI !== false }).then(() => true);\n    } else if (field === 'txt') {\n        task.txtPath = filePath;\n        return _readTxtFileToTask(task, file, { refreshUI: options.refreshUI !== false }).then(() => true);\n`
);

// Single-cell assignment waits for SRT/TXT parsing, then performs its existing one UI refresh.
if (batch.includes('function _assignSingleFile(idx, field, file) {')) {
  batch = batch.replace('function _assignSingleFile(idx, field, file) {', 'async function _assignSingleFile(idx, field, file) {');
}
let singleStart = batch.indexOf('async function _assignSingleFile(idx, field, file) {');
let singleEnd = batch.indexOf('/**\n * 读取 SRT 文件内容到 task.segments', singleStart);
if (singleStart < 0 || singleEnd < 0) throw new Error('single-file assignment block not found');
let singleBlock = batch.slice(singleStart, singleEnd);
singleBlock = singleBlock.replace('_readSrtFileToTask(task, file);', 'await _readSrtFileToTask(task, file, { refreshUI: false });');
singleBlock = singleBlock.replace('_readTxtFileToTask(task, file);', 'await _readTxtFileToTask(task, file, { refreshUI: false });');
batch = batch.slice(0, singleStart) + singleBlock + batch.slice(singleEnd);

// Batch file assignment: await SRT/TXT reads, suppress per-file redraw, and request one final refresh.
let assignStart = batch.indexOf('async function _batchAssignFiles(');
let assignEnd = batch.indexOf('/**\n * 批量分配 TXT 文件到各行', assignStart);
if (assignStart < 0 || assignEnd < 0) throw new Error('batch assignment block not found');
let assignBlock = batch.slice(assignStart, assignEnd);
assignBlock = assignBlock.replace(
  /async function _batchAssignFiles\(files, field(?:, options = \{\})?\) \{/,
  'async function _batchAssignFiles(files, field, options = {}) {'
);
assignBlock = assignBlock.replace(/^([ \t]*)_assignFileToTask\(([^;\n]+)\);/gm, (_m, indent, args) => {
  return `${indent}await Promise.resolve(_assignFileToTask(${args}, { refreshUI: false }));`;
});
const finalRefresh = `    _skipNextApply = true;\n    _renderBatchTable();\n    if (typeof _renderTaskList === 'function') _renderTaskList();\n    if (window._reelsState && window._reelsState.selectedIdx >= 0 && typeof reelsSelectTask === 'function') {\n        reelsSelectTask(window._reelsState.selectedIdx);\n    }\n`;
if (assignBlock.includes(finalRefresh)) {
  assignBlock = assignBlock.replace(
    finalRefresh,
    `    _skipNextApply = true;\n    _rbtRequestImportRefresh({ taskList: true, selectCurrent: true });\n`
  );
} else if (!assignBlock.includes('_rbtRequestImportRefresh({ taskList: true, selectCurrent: true })')) {
  throw new Error('batch assignment final refresh block not found');
}
batch = batch.slice(0, assignStart) + assignBlock + batch.slice(assignEnd);

// Dedicated TXT batch import follows the same rule: read all files first, then rebuild once.
if (batch.includes('function _batchAssignTxtFiles(files) {')) {
  batch = batch.replace('function _batchAssignTxtFiles(files) {', 'async function _batchAssignTxtFiles(files) {');
}
let txtBatchStart = batch.indexOf('async function _batchAssignTxtFiles(files) {');
let txtBatchEnd = batch.indexOf('/**\n * 点击单元格', txtBatchStart);
if (txtBatchStart < 0 || txtBatchEnd < 0) throw new Error('TXT batch assignment block not found');
let txtBatchBlock = batch.slice(txtBatchStart, txtBatchEnd);
txtBatchBlock = txtBatchBlock.replace('_readTxtFileToTask(targetTask, file);', 'await _readTxtFileToTask(targetTask, file, { refreshUI: false });');
txtBatchBlock = txtBatchBlock.replace(
  `    _skipNextApply = true;\n    _renderBatchTable();\n    if (typeof _renderTaskList === 'function') _renderTaskList();\n`,
  `    _skipNextApply = true;\n    _rbtRequestImportRefresh({ taskList: true });\n`
);
batch = batch.slice(0, txtBatchStart) + txtBatchBlock + batch.slice(txtBatchEnd);

// Mixed drag/drop can contain background + audio + SRT + TXT.  Keep all category imports in one render transaction.
if (!batch.includes('V4_4_55_MIXED_DROP_BATCH_RENDER')) {
  const loopRegex = /([ \t]*)for \(const \[field, fieldFiles\] of assignments\) \{\n([\s\S]*?)\n\1\}/;
  const loopMatch = batch.match(loopRegex);
  if (!loopMatch) throw new Error('mixed drop assignment loop not found');
  const indent = loopMatch[1];
  const originalLoop = loopMatch[0];
  const wrapped = `${indent}// V4_4_55_MIXED_DROP_BATCH_RENDER\n${indent}await _rbtWithImportBatch(async () => {\n${originalLoop.split('\n').map(line => `${indent}    ${line.slice(indent.length)}`).join('\n')}\n${indent}});`;
  batch = batch.replace(originalLoop, wrapped);
}

// Material-group import: do not redraw per SRT and prefer asynchronous text I/O.
if (batch.includes('function _importMaterialGroupFolders(rootDir, options = {}) {')) {
  batch = batch.replace('function _importMaterialGroupFolders(rootDir, options = {}) {', 'async function _importMaterialGroupFolders(rootDir, options = {}) {');
}
let materialStart = batch.indexOf('async function _importMaterialGroupFolders(rootDir, options = {}) {');
let materialEnd = batch.indexOf('function _importFoldersAsIndependentQueues', materialStart);
if (materialStart < 0 || materialEnd < 0) throw new Error('material group import block not found');
let materialBlock = batch.slice(materialStart, materialEnd);
materialBlock = materialBlock.replace('_readSrtViaElectronAPI(task, group.srtPath);', 'await _readSrtViaElectronAPI(task, group.srtPath, { refreshUI: false });');
materialBlock = materialBlock.replace("task.txtContent = window.electronAPI.readFileText(group.txtPath) || '';", "task.txtContent = await _rbtReadTextPath(group.txtPath);");
batch = batch.slice(0, materialStart) + materialBlock + batch.slice(materialEnd);

if (batch.includes('function _importFoldersAsIndependentQueues(dirs) {')) {
  batch = batch.replace('function _importFoldersAsIndependentQueues(dirs) {', 'async function _importFoldersAsIndependentQueues(dirs) {');
}
let queueStart = batch.indexOf('async function _importFoldersAsIndependentQueues(dirs) {');
let queueEnd = batch.indexOf('/**\n * 拖入文件夹专用', queueStart);
if (queueStart >= 0 && queueEnd > queueStart) {
  let queueBlock = batch.slice(queueStart, queueEnd);
  queueBlock = queueBlock.replace('const imported = _importMaterialGroupFolders(dir, { mode: \'replace\', silent: true }) || 0;', "const imported = await _importMaterialGroupFolders(dir, { mode: 'replace', silent: true }) || 0;");
  batch = batch.slice(0, queueStart) + queueBlock + batch.slice(queueEnd);
}

// Folder-as-task import is already async; make companion SRT/TXT reads async and refresh only at the end.
let folderTaskStart = batch.indexOf('async function _importFoldersAsFileTaskTabs(dirs) {');
let folderTaskEnd = batch.indexOf('window.reelsImportFoldersAsTaskTabs = _importFoldersAsFileTaskTabs;', folderTaskStart);
if (folderTaskStart < 0 || folderTaskEnd < 0) throw new Error('folder task import block not found');
let folderTaskBlock = batch.slice(folderTaskStart, folderTaskEnd);
folderTaskBlock = folderTaskBlock.replace('_readSrtViaElectronAPI(task, subtitleFile.path);', 'await _readSrtViaElectronAPI(task, subtitleFile.path, { refreshUI: false });');
folderTaskBlock = folderTaskBlock.replace("task.txtContent = await window.electronAPI.readFileText(group.txt.path) || '';", "task.txtContent = await _rbtReadTextPath(group.txt.path);");
batch = batch.slice(0, folderTaskStart) + folderTaskBlock + batch.slice(folderTaskEnd);

// The material-group picker must wait until asynchronous companion reads finish.
batch = batch.replace('_importMaterialGroupFolders(rootDir, options);', 'await _importMaterialGroupFolders(rootDir, options);');

syntax(preload, preloadPath);
syntax(batch, batchPath);
write(preloadPath, preloadBefore, preload);
write(batchPath, batchBefore, batch);

const required = [
  'V4_4_55_BATCH_IMPORT_REFRESH_GUARD',
  'V4_4_55_SRT_ASYNC_BATCH_READ',
  'V4_4_55_TXT_ASYNC_BATCH_READ',
  'V4_4_55_MIXED_DROP_BATCH_RENDER',
  '_rbtRequestImportRefresh({ taskList: true, selectCurrent: true })',
  'await _readSrtViaElectronAPI(task, group.srtPath, { refreshUI: false })',
  'await _rbtReadTextPath(group.txtPath)',
  'await _readSrtViaElectronAPI(task, subtitleFile.path, { refreshUI: false })',
];
for (const marker of required) {
  if (!batch.includes(marker)) throw new Error(`4.4.55 batch import patch incomplete: ${marker}`);
}
if (!preload.includes('V4_4_55_ASYNC_TEXT_READ') || !preload.includes('readFileTextAsync')) {
  throw new Error('4.4.55 async preload text bridge incomplete');
}

console.log('[4.4.55-batch-import-performance] Batch SRT/TXT/folder/media imports now coalesce UI refresh and use async text reads.');
