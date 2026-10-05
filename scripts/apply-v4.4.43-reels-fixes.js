const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

function assertSyntax(source, filename) {
  try {
    new vm.Script(source, { filename });
  } catch (error) {
    throw new Error(`[4.4.43] syntax check failed for ${path.relative(root, filename)}: ${error.message}`);
  }
}

function eolOf(source) {
  return source.includes('\r\n') ? '\r\n' : '\n';
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
// Locate the generic external-file drop block semantically instead of matching literal LF newlines.
// GitHub's Windows checkout can convert source files to CRLF, so all multiline markers here accept \r?\n.
if (!batch.includes('V4_4_43_DIRECT_BG_DROP')) {
  const eol = eolOf(batch);
  const dropMarker = /([ \t]*const files = Array\.from\(e\.dataTransfer\.files \|\| \[\]\);\r?\n[ \t]*if \(!files\.length\) return;\r?\n[ \t]*e\.preventDefault\(\);\r?\n\r?\n)([ \t]*\/\/ In Electron with context isolation)/;
  const match = batch.match(dropMarker);
  if (!match) {
    throw new Error('Could not find main batch drop handler marker in reels-batch-table.js');
  }

  const indent = (match[1].match(/(^|\n)([ \t]*)const files/) || [null, null, '        '])[2] || '        ';
  const lines = [
    `${indent}// V4_4_43_DIRECT_BG_DROP: dropping one media file onto a Background cell assigns only that row.`,
    `${indent}const directBgCell = e.target.closest && e.target.closest('.rbt-droppable[data-field="bg"]');`,
    `${indent}if (directBgCell && files.length === 1) {`,
    `${indent}    const row = directBgCell.closest('.rbt-row');`,
    `${indent}    const file = files[0];`,
    `${indent}    const isBackgroundMedia = /\\.(mp4|mov|mkv|avi|wmv|flv|webm|jpg|jpeg|png|webp|gif|bmp)$/i.test(file?.name || '');`,
    `${indent}    if (row && isBackgroundMedia) {`,
    `${indent}        const idx = parseInt(row.dataset.idx, 10);`,
    `${indent}        if (Number.isInteger(idx) && idx >= 0) {`,
    `${indent}            e.stopPropagation();`,
    `${indent}            await _assignSingleFile(idx, 'bg', file);`,
    `${indent}            return;`,
    `${indent}        }`,
    `${indent}    }`,
    `${indent}}`,
    '',
  ].join(eol);

  batch = batch.replace(dropMarker, (whole, prefix, nextComment) => prefix + lines + nextComment);
}

if (!batch.includes('files.sort(_naturalSortByName);')) {
  throw new Error('Natural numeric sorting patch was not applied');
}
if (batch.includes("files.sort((a, b) => (a.name || '').localeCompare(b.name || ''));")) {
  throw new Error('Lexicographic batch file sorting still remains');
}
if (!batch.includes('V4_4_43_DIRECT_BG_DROP') || !batch.includes("await _assignSingleFile(idx, 'bg', file);")) {
  throw new Error('Direct Background-cell drop patch was not applied completely');
}
assertSyntax(batch, batchPath);
writeIfChanged(batchPath, batchBefore, batch);

// 3) Preset/template name dialog focus reliability.
let overlayBefore = read(overlayPath);
let overlay = overlayBefore;

if (!overlay.includes('V4_4_43_PRESET_NAME_FOCUS_GUARD')) {
  const eol = eolOf(overlay);
  const inputMarker = /([ \t]*)const input = box\.querySelector\('\.rop-tpl-name-input'\);\r?\n[ \t]*const okBtn = box\.querySelector\('\.rop-tpl-ok'\);\r?\n[ \t]*const cancelBtn = box\.querySelector\('\.rop-tpl-cancel'\);\r?\n[ \t]*const groupInput = box\.querySelector\('\.rop-tpl-group-input'\);\r?\n[ \t]*input\.value = defaultName \|\| '';/;
  const inputMatch = overlay.match(inputMarker);
  if (!inputMatch) {
    throw new Error('Could not find preset name input marker in reels-overlay-panel.js');
  }

  const indent = inputMatch[1] || '            ';
  const focusGuard = [
    `${indent}const input = box.querySelector('.rop-tpl-name-input');`,
    `${indent}const okBtn = box.querySelector('.rop-tpl-ok');`,
    `${indent}const cancelBtn = box.querySelector('.rop-tpl-cancel');`,
    `${indent}const groupInput = box.querySelector('.rop-tpl-group-input');`,
    `${indent}input.value = defaultName || '';`,
    '',
    `${indent}// V4_4_43_PRESET_NAME_FOCUS_GUARD: prevent canvas/global shortcuts from stealing typing focus.`,
    `${indent}const focusNameInput = () => {`,
    `${indent}    if (!overlay.isConnected || !input.isConnected) return;`,
    `${indent}    try {`,
    `${indent}        input.focus({ preventScroll: true });`,
    `${indent}        const end = input.value.length;`,
    `${indent}        input.setSelectionRange(end, end);`,
    `${indent}    } catch (_) {`,
    `${indent}        try { input.focus(); } catch (_) {}`,
    `${indent}    }`,
    `${indent}};`,
    `${indent}['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste'].forEach(type => {`,
    `${indent}    input.addEventListener(type, e => e.stopPropagation());`,
    `${indent}});`,
    `${indent}['pointerdown', 'mousedown', 'click'].forEach(type => {`,
    `${indent}    input.addEventListener(type, e => {`,
    `${indent}        e.stopPropagation();`,
    `${indent}        setTimeout(focusNameInput, 0);`,
    `${indent}        setTimeout(focusNameInput, 30);`,
    `${indent}    });`,
    `${indent}});`,
  ].join(eol);

  overlay = overlay.replace(inputMarker, focusGuard);

  const oldFocus = /([ \t]*)\/\/ 多次尝试 focus 确保 Electron 渲染完成后能获得焦点\r?\n[ \t]*setTimeout\(\(\) => input\.focus\(\), 50\);\r?\n[ \t]*setTimeout\(\(\) => \{ if \(document\.activeElement !== input\) input\.focus\(\); \}, 150\);/;
  const focusMatch = overlay.match(oldFocus);
  if (!focusMatch) {
    throw new Error('Could not find preset name delayed-focus marker in reels-overlay-panel.js');
  }
  const focusIndent = focusMatch[1] || indent;
  const newFocus = [
    `${focusIndent}// Electron first render, CSS animation and canvas events may steal focus; re-confirm it in stages.`,
    `${focusIndent}requestAnimationFrame(focusNameInput);`,
    `${focusIndent}setTimeout(focusNameInput, 50);`,
    `${focusIndent}setTimeout(() => { if (document.activeElement !== input) focusNameInput(); }, 150);`,
    `${focusIndent}setTimeout(() => { if (document.activeElement !== input) focusNameInput(); }, 300);`,
  ].join(eol);
  overlay = overlay.replace(oldFocus, newFocus);
}

if (!overlay.includes('V4_4_43_PRESET_NAME_FOCUS_GUARD')) {
  throw new Error('Preset-name focus guard was not applied');
}
if (!overlay.includes('requestAnimationFrame(focusNameInput)')) {
  throw new Error('Preset-name initial focus scheduling was not applied');
}
assertSyntax(overlay, overlayPath);
writeIfChanged(overlayPath, overlayBefore, overlay);

console.log('[4.4.43] Reels fixes ready (LF/CRLF safe).');
