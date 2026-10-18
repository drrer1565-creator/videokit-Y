const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const batchPath = path.join(root, 'src', 'reels-batch-table.js');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function write(file, before, after) {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.56-fast-row-multidrop] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.56-fast-row-multidrop] no changes needed for ${path.relative(root, file)}`);
  }
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`4.4.56 patch marker missing: ${label}`);
  return source.replace(before, after);
}

let before = read(batchPath);
let src = before;

if (!src.includes('V4_4_56_FAST_ROW_BG_DROP')) {
  const dragMarker = '    // ── 拖拽文件到批量表格 ──\n';
  if (!src.includes(dragMarker)) throw new Error('drag/drop section marker missing');

  const helper = `    // V4_4_56_FAST_ROW_BG_DROP\n    // Exact-row background drops are intentionally handled without rebuilding the\n    // whole Batch Reels table. Fast consecutive multi-material drops should only\n    // mutate the target task/cell, while persistence and preview work are debounced.\n    let _rbtLastDragOverCell = null;\n    let _rbtBgDropPersistTimer = null;\n    let _rbtBgDropPreviewTimer = null;\n\n    const _rbtRenderBackgroundCellLight = (idx) => {\n        const task = window._reelsState?.tasks?.[idx];\n        const row = container.querySelector(\`#rbt-tbody tr.rbt-row[data-idx="\${idx}"]\`);\n        const cell = row?.querySelector('td.rbt-col-bg[data-field="bg"]');\n        if (!task || !cell) return;\n\n        const bgMode = task.bgMode || 'single';\n        const pool = Array.isArray(task.bgClipPool) ? task.bgClipPool.filter(Boolean) : [];\n        const bgPath = task.bgPath || task.videoPath || '';\n        const hasBg = !!bgPath || (bgMode === 'multi' && pool.length > 0);\n        let content = '<span class="rbt-placeholder">拖拽/双击</span>';\n\n        if (bgMode === 'multi' && pool.length > 0) {\n            const orderLabel = task.bgClipOrder === 'random' ? '随机' : (task.bgClipOrder === 'sequence' ? '顺序' : (task.bgClipOrder || '顺序'));\n            const firstName = _escHtml(_shortName(pool[0] || ''));\n            content = \`<div style="display:flex;flex-direction:column;gap:2px;min-width:0;">\n                <div style="display:flex;align-items:center;gap:4px;min-width:0;">\n                    <span style="font-size:9px;background:#2a1f5e;color:#b8a0ff;padding:1px 5px;border-radius:3px;font-weight:600;">多素材</span>\n                    <span style="font-size:10px;color:#aaa;white-space:nowrap;">\${pool.length} 个 · \${_escHtml(orderLabel)}</span>\n                </div>\n                <span class="rbt-file-name" style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="\${_escHtml(pool.join('\\n'))}">🎬 \${firstName}\${pool.length > 1 ? ' …' : ''}</span>\n            </div>\`;\n        } else if (bgPath) {\n            const isImg = /\\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(bgPath);\n            content = \`<span class="rbt-file-name" style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="\${_escHtml(bgPath)}">\${isImg ? '🖼️' : '🎬'} \${_escHtml(_shortName(bgPath))}</span>\`;\n        }\n\n        cell.innerHTML = \`<div style="display:flex;align-items:center;gap:2px;">\n            <button class="rbt-bg-pool-manage" data-idx="\${idx}" style="flex:0 0 auto;width:20px;height:20px;border-radius:4px;border:1px solid \${bgMode === 'multi' ? '#7c5cff' : '#333'};background:\${bgMode === 'multi' ? '#2a1f5e' : 'transparent'};color:\${bgMode === 'multi' ? '#b8a0ff' : '#666'};font-size:11px;cursor:pointer;padding:0;line-height:18px;" title="\${bgMode === 'multi' ? '多素材模式 - 点击管理' : '单素材模式 - 点击切换到多素材'}">\${bgMode === 'multi' ? '🎞' : '🔁'}</button>\n            <div style="flex:1;min-width:0;overflow:hidden;">\${content}</div>\n            \${hasBg ? \`<button class="rbt-field-clear" data-idx="\${idx}" data-field="bg" title="清除背景">✕</button>\` : ''}\n        </div>\`;\n    };\n\n    const _rbtScheduleBackgroundDropCommit = (idx) => {\n        clearTimeout(_rbtBgDropPersistTimer);\n        _rbtBgDropPersistTimer = setTimeout(() => {\n            if (typeof _syncTasksToActiveTab === 'function') _syncTasksToActiveTab({ replace: true });\n            if (typeof _batchAutoSave === 'function') _batchAutoSave({ skipSync: true });\n            if (typeof window.reelsSaveHistory === 'function') window.reelsSaveHistory();\n        }, 350);\n\n        if (window._reelsState?.selectedIdx === idx) {\n            clearTimeout(_rbtBgDropPreviewTimer);\n            _rbtBgDropPreviewTimer = setTimeout(() => {\n                const task = window._reelsState?.tasks?.[idx];\n                if (!task) return;\n                if (typeof window.reelsSyncBackgroundTabUI === 'function') window.reelsSyncBackgroundTabUI(task);\n                if (typeof reelsUpdatePreview === 'function') reelsUpdatePreview();\n            }, 120);\n        }\n    };\n\n`;
  src = src.replace(dragMarker, helper + dragMarker);

  src = replaceOnce(
    src,
    `        if (_dragCounter <= 0) {\n            _dragCounter = 0;\n            _hideDropOverlay();\n            panel.querySelectorAll('.rbt-droppable.rbt-drag-over').forEach(c => c.classList.remove('rbt-drag-over'));\n        }\n`,
    `        if (_dragCounter <= 0) {\n            _dragCounter = 0;\n            _hideDropOverlay();\n            if (_rbtLastDragOverCell) _rbtLastDragOverCell.classList.remove('rbt-drag-over');\n            _rbtLastDragOverCell = null;\n        }\n`,
    'dragleave highlight cleanup'
  );

  src = replaceOnce(
    src,
    `        // Highlight logic for specific droppable columns\n        const cell = e.target.closest('.rbt-droppable');\n        panel.querySelectorAll('.rbt-droppable.rbt-drag-over').forEach(c => {\n            if (c !== cell) c.classList.remove('rbt-drag-over');\n        });\n        if (cell) cell.classList.add('rbt-drag-over');\n`,
    `        // Highlight only the previous/current cell. Avoid scanning the whole table\n        // on every dragover event while the pointer moves quickly across many rows.\n        const cell = e.target.closest('.rbt-droppable');\n        if (_rbtLastDragOverCell && _rbtLastDragOverCell !== cell) {\n            _rbtLastDragOverCell.classList.remove('rbt-drag-over');\n        }\n        if (cell && cell !== _rbtLastDragOverCell) cell.classList.add('rbt-drag-over');\n        _rbtLastDragOverCell = cell || null;\n`,
    'dragover highlight scan'
  );

  src = replaceOnce(
    src,
    `        _dragCounter = 0;\n        _hideDropOverlay();\n        panel.querySelectorAll('.rbt-droppable.rbt-drag-over').forEach(c => c.classList.remove('rbt-drag-over'));\n`,
    `        _dragCounter = 0;\n        _hideDropOverlay();\n        if (_rbtLastDragOverCell) _rbtLastDragOverCell.classList.remove('rbt-drag-over');\n        _rbtLastDragOverCell = null;\n`,
    'drop highlight cleanup'
  );

  const exactDropMarker = `        // ── 精确落到 bgm 单元格时，设为配乐或追加到配乐池 ──\n        const dropCell = e.target.closest('.rbt-droppable');\n`;
  if (!src.includes(exactDropMarker)) throw new Error('exact drop routing marker missing');

  const exactBgRoute = `        // ── 精确落到 bg 单元格：直接绑定“鼠标落下的这一行” ──\n        // Multiple media files mean one multi-material background pool for this row.\n        // This exact-row route bypasses generic batch assignment and avoids a whole-table rebuild.\n        const dropCell = e.target.closest('.rbt-droppable');\n        if (dropCell && dropCell.dataset.field === 'bg') {\n            const row = dropCell.closest('.rbt-row');\n            if (row) {\n                const idx = parseInt(row.dataset.idx, 10);\n                const task = window._reelsState?.tasks?.[idx];\n                if (task) {\n                    const mediaFiles = files\n                        .filter(file => /\\.(mp4|mov|mkv|avi|wmv|flv|webm|jpg|jpeg|png|webp)$/i.test(file.name || ''))\n                        .sort(_naturalSortByName);\n                    const filePaths = [...new Set(mediaFiles.map(_rbtGetNativeFilePath).filter(Boolean))];\n                    if (!filePaths.length) {\n                        if (typeof showToast === 'function') showToast('⚠️ 背景素材仅支持视频或图片文件', 'warning');\n                        return;\n                    }\n\n                    if (filePaths.length === 1) {\n                        _setTaskSingleBackground(task, filePaths[0], { clearBgSrcUrl: true });\n                        task.srcUrl = null;\n                    } else {\n                        task.bgMode = 'multi';\n                        task.bgClipPool = filePaths;\n                        task.bgClipActivePool = [];\n                        task.bgClipOrder = task.bgClipOrder || 'sequence';\n                        task.bgTransition = task.bgTransition || 'crossfade';\n                        task.bgTransDur = task.bgTransDur ?? 0.5;\n                        task.bgPath = filePaths[0];\n                        task.videoPath = filePaths[0];\n                        task.bgSrcUrl = '';\n                        task.srcUrl = null;\n                    }\n\n                    // Data is already authoritative. Keep the existing row alive so another\n                    // immediate drop can land safely instead of racing a full-table rebuild.\n                    _skipNextApply = true;\n                    _rbtRenderBackgroundCellLight(idx);\n                    _rbtScheduleBackgroundDropCommit(idx);\n                    if (typeof showToast === 'function') {\n                        showToast(filePaths.length > 1\n                            ? \`🎬 第 \${idx + 1} 行已设置 \${filePaths.length} 个多素材拼接背景\`\n                            : \`✅ 第 \${idx + 1} 行背景素材已更新\`, 'success');\n                    }\n                }\n            }\n            return;\n        }\n\n        // ── 精确落到 bgm 单元格时，设为配乐或追加到配乐池 ──\n`;
  src = src.replace(exactDropMarker, exactBgRoute);
}

new vm.Script(src, { filename: batchPath });
write(batchPath, before, src);

const required = [
  'V4_4_56_FAST_ROW_BG_DROP',
  '_rbtRenderBackgroundCellLight(idx)',
  '_rbtScheduleBackgroundDropCommit(idx)',
  "if (dropCell && dropCell.dataset.field === 'bg')",
  'const idx = parseInt(row.dataset.idx, 10)',
  'task.bgClipPool = filePaths',
  '_rbtLastDragOverCell = cell || null',
];
for (const marker of required) {
  if (!src.includes(marker)) throw new Error(`4.4.56 fast-row drop patch incomplete: ${marker}`);
}

const exactStart = src.indexOf('// ── 精确落到 bg 单元格：直接绑定“鼠标落下的这一行”');
const exactEnd = src.indexOf('// ── 精确落到 bgm 单元格时', exactStart);
const exactBlock = src.slice(exactStart, exactEnd);
if (exactBlock.includes('_renderBatchTable()')) throw new Error('exact-row bg drop must not rebuild the whole table');
if (exactBlock.includes('_batchAssignFiles(')) throw new Error('exact-row bg drop must not route through generic batch assignment');
if (exactBlock.includes('state.selectedIdx')) throw new Error('exact-row bg drop must not target state.selectedIdx');

console.log('[4.4.56-fast-row-multidrop] Exact-row multi-material drops now update only the target cell and debounce persistence/preview work.');
