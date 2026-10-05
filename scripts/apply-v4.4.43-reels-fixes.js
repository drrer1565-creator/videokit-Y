const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const batchPath = path.join(root, 'src', 'reels-batch-table.js');
const overlayPath = path.join(root, 'src', 'reels-overlay-panel.js');

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function writeIfChanged(file, before, after) {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.43] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.43] no changes needed for ${path.relative(root, file)}`);
  }
}

// 1) Batch file order: use numeric/natural sorting so 1,2,...10,11 stays numeric.
let batchBefore = read(batchPath);
let batch = batchBefore;

batch = batch.replace(
  /files\.sort\(\(a, b\) => \(a\.name \|\| ''\)\.localeCompare\(b\.name \|\| ''\)\);/g,
  'files.sort(_naturalSortByName);'
);

for (const listName of ['audioFiles', 'videoFiles', 'srtFiles', 'txtFiles']) {
  const oldText = `${listName}.sort((a, b) => _getPathBaseName(a).localeCompare(_getPathBaseName(b)));`;
  const newText = `${listName}.sort((a, b) => _getPathBaseName(a).localeCompare(_getPathBaseName(b), undefined, { numeric: true, sensitivity: 'base' }));`;
  batch = batch.split(oldText).join(newText);
}

// 2) Direct single-file drop into the Background cell.
// Intercept before the generic batch-drop distributor so a file dropped on one row stays on that row.
if (!batch.includes('V4_4_43_DIRECT_BG_DROP')) {
  const dropMarker = `        const files = Array.from(e.dataTransfer.files || []);\n        if (!files.length) return;\n        e.preventDefault();\n\n        // In Electron with context isolation`;
  const injected = `        const files = Array.from(e.dataTransfer.files || []);\n        if (!files.length) return;\n        e.preventDefault();\n\n        // V4_4_43_DIRECT_BG_DROP: dropping one media file onto a Background cell assigns only that row.\n        const directBgCell = e.target.closest && e.target.closest('.rbt-droppable[data-field="bg"]');\n        if (directBgCell && files.length === 1) {\n            const row = directBgCell.closest('.rbt-row');\n            const file = files[0];\n            const isBackgroundMedia = /\\.(mp4|mov|mkv|avi|wmv|flv|webm|jpg|jpeg|png|webp|gif|bmp)$/i.test(file?.name || '');\n            if (row && isBackgroundMedia) {\n                const idx = parseInt(row.dataset.idx, 10);\n                if (Number.isInteger(idx) && idx >= 0) {\n                    e.stopPropagation();\n                    await _assignSingleFile(idx, 'bg', file);\n                    return;\n                }\n            }\n        }\n\n        // In Electron with context isolation`;
  if (!batch.includes(dropMarker)) {
    throw new Error('Could not find main batch drop handler marker in reels-batch-table.js');
  }
  batch = batch.replace(dropMarker, injected);
}

writeIfChanged(batchPath, batchBefore, batch);

// 3) Preset/template name dialog focus reliability.
let overlayBefore = read(overlayPath);
let overlay = overlayBefore;

if (!overlay.includes('V4_4_43_PRESET_NAME_FOCUS_GUARD')) {
  const inputMarker = `            const input = box.querySelector('.rop-tpl-name-input');\n            const okBtn = box.querySelector('.rop-tpl-ok');\n            const cancelBtn = box.querySelector('.rop-tpl-cancel');\n            const groupInput = box.querySelector('.rop-tpl-group-input');\n            input.value = defaultName || '';`;
  const focusGuard = `            const input = box.querySelector('.rop-tpl-name-input');\n            const okBtn = box.querySelector('.rop-tpl-ok');\n            const cancelBtn = box.querySelector('.rop-tpl-cancel');\n            const groupInput = box.querySelector('.rop-tpl-group-input');\n            input.value = defaultName || '';\n\n            // V4_4_43_PRESET_NAME_FOCUS_GUARD: prevent canvas/global shortcuts from stealing typing focus.\n            const focusNameInput = () => {\n                if (!overlay.isConnected || !input.isConnected) return;\n                try {\n                    input.focus({ preventScroll: true });\n                    const end = input.value.length;\n                    input.setSelectionRange(end, end);\n                } catch (_) {\n                    try { input.focus(); } catch (_) {}\n                }\n            };\n            ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste'].forEach(type => {\n                input.addEventListener(type, e => e.stopPropagation());\n            });\n            ['pointerdown', 'mousedown', 'click'].forEach(type => {\n                input.addEventListener(type, e => {\n                    e.stopPropagation();\n                    setTimeout(focusNameInput, 0);\n                    setTimeout(focusNameInput, 30);\n                });\n            });`;
  if (!overlay.includes(inputMarker)) {
    throw new Error('Could not find preset name input marker in reels-overlay-panel.js');
  }
  overlay = overlay.replace(inputMarker, focusGuard);

  const oldFocus = `            // 多次尝试 focus 确保 Electron 渲染完成后能获得焦点\n            setTimeout(() => input.focus(), 50);\n            setTimeout(() => { if (document.activeElement !== input) input.focus(); }, 150);`;
  const newFocus = `            // Electron 首次渲染、CSS 动画和画布事件可能抢焦点；分阶段重新确认。\n            requestAnimationFrame(focusNameInput);\n            setTimeout(focusNameInput, 50);\n            setTimeout(() => { if (document.activeElement !== input) focusNameInput(); }, 150);\n            setTimeout(() => { if (document.activeElement !== input) focusNameInput(); }, 300);`;
  if (overlay.includes(oldFocus)) overlay = overlay.replace(oldFocus, newFocus);
}

writeIfChanged(overlayPath, overlayBefore, overlay);
console.log('[4.4.43] Reels fixes ready.');
