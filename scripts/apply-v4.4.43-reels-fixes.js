const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const batchPath = path.join(root, 'src', 'reels-batch-table.js');
const overlayPath = path.join(root, 'src', 'reels-overlay-panel.js');
const preloadPath = path.join(root, 'electron', 'preload.js');

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function writeIfChanged(file, before, after) {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[ReelsPatch] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[ReelsPatch] no changes needed for ${path.relative(root, file)}`);
  }
}

function assertSyntax(source, filename) {
  try {
    new vm.Script(source, { filename });
  } catch (error) {
    throw new Error(`[ReelsPatch] syntax check failed for ${path.relative(root, filename)}: ${error.message}`);
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

// 2b) Multiple files dropped on a Background cell must remember that exact row.
// Previously merge_multi used state.selectedIdx, so dropping on row 2/3/... could still replace row 1.
if (!batch.includes('V4_4_43_MULTI_BG_TARGET_ROW')) {
  const eol = eolOf(batch);

  if (batch.includes('async function _batchAssignFiles(files, field) {')) {
    batch = batch.replace(
      'async function _batchAssignFiles(files, field) {',
      'async function _batchAssignFiles(files, field, options = {}) {'
    );
  }

  const assignmentMarker = /([ \t]*)for \(const \[field, fieldFiles\] of assignments\) \{\r?\n[ \t]*await _batchAssignFiles\(fieldFiles, field\);\r?\n[ \t]*\}/;
  const assignmentMatch = batch.match(assignmentMarker);
  if (!assignmentMatch) {
    throw new Error('Could not find external-drop batch assignment loop in reels-batch-table.js');
  }
  const assignmentIndent = assignmentMatch[1] || '            ';
  const assignmentBlock = [
    `${assignmentIndent}// V4_4_43_MULTI_BG_TARGET_ROW: preserve the row where files were actually dropped.`,
    `${assignmentIndent}const droppedRow = dropCell?.closest('.rbt-row');`,
    `${assignmentIndent}const droppedRowIdx = droppedRow ? parseInt(droppedRow.dataset.idx, 10) : NaN;`,
    `${assignmentIndent}for (const [field, fieldFiles] of assignments) {`,
    `${assignmentIndent}    await _batchAssignFiles(fieldFiles, field, {`,
    `${assignmentIndent}        targetIdx: Number.isInteger(droppedRowIdx) && droppedRowIdx >= 0 ? droppedRowIdx : null,`,
    `${assignmentIndent}    });`,
    `${assignmentIndent}}`,
  ].join(eol);
  batch = batch.replace(assignmentMarker, assignmentBlock);

  const mergeMarker = /([ \t]*)\/\/ 多素材拼接：合并所有文件到当前选中行（或第一行）的多素材背景池\r?\n[ \t]*let targetIdx = state\.selectedIdx >= 0 \? state\.selectedIdx : 0;/;
  const mergeMatch = batch.match(mergeMarker);
  if (!mergeMatch) {
    throw new Error('Could not find merge_multi target-row logic in reels-batch-table.js');
  }
  const mergeIndent = mergeMatch[1] || '        ';
  const mergeBlock = [
    `${mergeIndent}// 多素材拼接：优先使用实际拖放到的行；非定点批量导入时才回退到当前选中行。`,
    `${mergeIndent}const requestedTargetIdx = Number.isInteger(options?.targetIdx) ? options.targetIdx : null;`,
    `${mergeIndent}let targetIdx = requestedTargetIdx != null ? requestedTargetIdx : (state.selectedIdx >= 0 ? state.selectedIdx : 0);`,
  ].join(eol);
  batch = batch.replace(mergeMarker, mergeBlock);
}

// 2c) Batch-table video thumbnails: keep the table static and only create one real video on hover.
// Existing row templates may still emit <video> thumbnails; they are synchronously replaced with <img>
// before the lazy thumbnail hydrator starts. Thumbnails are generated by the existing FFmpeg cache service.
if (!batch.includes('V4_4_45_STATIC_BATCH_VIDEO_THUMBS')) {
  const eol = eolOf(batch);
  const hydrateMarker = /function _hydrateBatchVideoThumbnails\(container\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction _isBatchWritableOverlay/;
  if (!hydrateMarker.test(batch)) {
    throw new Error('Could not find batch video thumbnail hydrator in reels-batch-table.js');
  }

  const staticThumbCode = [
    '// V4_4_45_STATIC_BATCH_VIDEO_THUMBS: table thumbnails are cached still images; hover owns the only live video.',
    'const _rbtStaticThumbCache = new Map();',
    'const _rbtStaticThumbPending = new Map();',
    'const _rbtStaticThumbQueue = [];',
    'let _rbtStaticThumbActive = 0;',
    'const _RBT_STATIC_THUMB_MAX_CONCURRENCY = 3;',
    '',
    'function _rbtDrainStaticThumbQueue() {',
    '    while (_rbtStaticThumbActive < _RBT_STATIC_THUMB_MAX_CONCURRENCY && _rbtStaticThumbQueue.length > 0) {',
    '        const job = _rbtStaticThumbQueue.shift();',
    '        _rbtStaticThumbActive++;',
    '        (async () => {',
    '            let result = "";',
    '            for (let attempt = 0; attempt < 2 && !result; attempt++) {',
    '                try {',
    '                    const thumbPath = await window.electronAPI?.localFiles?.getVideoThumbnail?.(job.videoSrc, 160);',
    '                    if (thumbPath) result = _rbtMediaUrl(thumbPath);',
    '                } catch (_) {}',
    '                if (!result && attempt === 0) await new Promise(resolve => setTimeout(resolve, 180));',
    '            }',
    '            if (result) _rbtStaticThumbCache.set(job.videoSrc, result);',
    '            job.resolve(result);',
    '        })().finally(() => {',
    '            _rbtStaticThumbActive--;',
    '            _rbtStaticThumbPending.delete(job.videoSrc);',
    '            _rbtDrainStaticThumbQueue();',
    '        });',
    '    }',
    '}',
    '',
    'function _rbtGetStaticVideoThumb(videoSrc) {',
    '    if (!videoSrc) return Promise.resolve("");',
    '    const cached = _rbtStaticThumbCache.get(videoSrc);',
    '    if (cached) return Promise.resolve(cached);',
    '    const pending = _rbtStaticThumbPending.get(videoSrc);',
    '    if (pending) return pending;',
    '    const promise = new Promise(resolve => {',
    '        _rbtStaticThumbQueue.push({ videoSrc, resolve });',
    '        _rbtDrainStaticThumbQueue();',
    '    });',
    '    _rbtStaticThumbPending.set(videoSrc, promise);',
    '    return promise;',
    '}',
    '',
    'function _hydrateBatchVideoThumbnails(container) {',
    '    if (!container) return;',
    '    const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";',
    '',
    '    // Replace every table/list thumbnail video immediately so Chromium does not keep dozens of decoders alive.',
    '    container.querySelectorAll("video.rbt-thumb-previewable").forEach(video => {',
    '        const rawSrc = video.getAttribute("src") || "";',
    '        const videoSrc = rawSrc.split("#")[0];',
    '        const img = document.createElement("img");',
    '        img.className = video.className;',
    '        img.style.cssText = video.style.cssText;',
    '        img.title = video.title || "";',
    '        img.alt = "";',
    '        img.dataset.videoSrc = videoSrc;',
    '        img.dataset.rbtStaticVideoThumb = "1";',
    '        img.style.background = video.style.background || "#000";',
    '        const cached = _rbtStaticThumbCache.get(videoSrc);',
    '        img.src = cached || transparentPixel;',
    '        if (cached) img.dataset.thumbHydrated = "true";',
    '        video.replaceWith(img);',
    '    });',
    '',
    '    const thumbs = container.querySelectorAll("img.rbt-thumb-previewable[data-video-src]");',
    '    if (!thumbs.length) return;',
    '    const root = container.querySelector(".rbt-table-wrap") || null;',
    '    const observer = new IntersectionObserver((entries) => {',
    '        entries.forEach(entry => {',
    '            if (!entry.isIntersecting) return;',
    '            const img = entry.target;',
    '            observer.unobserve(img);',
    '            if (img.dataset.thumbHydrated === "true" || img.dataset.thumbHydrated === "loading") return;',
    '            const videoSrc = img.dataset.videoSrc || "";',
    '            const cached = _rbtStaticThumbCache.get(videoSrc);',
    '            if (cached) {',
    '                img.src = cached;',
    '                img.dataset.thumbHydrated = "true";',
    '                return;',
    '            }',
    '            img.dataset.thumbHydrated = "loading";',
    '            _rbtGetStaticVideoThumb(videoSrc).then(thumbUrl => {',
    '                if (!img.isConnected) return;',
    '                if (thumbUrl) {',
    '                    img.src = thumbUrl;',
    '                    img.dataset.thumbHydrated = "true";',
    '                } else {',
    '                    img.dataset.thumbHydrated = "failed";',
    '                    img.style.background = "#111";',
    '                    img.title = `${img.title || ""} 缩略图生成失败`.trim();',
    '                }',
    '            }).catch(() => {',
    '                if (!img.isConnected) return;',
    '                img.dataset.thumbHydrated = "failed";',
    '                img.style.background = "#111";',
    '            });',
    '        });',
    '    }, { root, rootMargin: "120px", threshold: 0.01 });',
    '',
    '    thumbs.forEach(img => {',
    '        if (img.dataset.thumbHydrated !== "true") observer.observe(img);',
    '    });',
    '}',
    '',
    'function _isBatchWritableOverlay',
  ].join(eol);

  batch = batch.replace(hydrateMarker, staticThumbCode);

  const hoverMarker = /const src = target\.getAttribute\('src'\);\r?\n\s*if \(!src\) return;\r?\n\r?\n\s*const isVideo = target\.tagName === 'VIDEO';\r?\n\s*const pureSrc = src\.split\('#'\)\[0\]; \/\/ strip hash/g;
  const hoverReplacement = [
    'const videoSrc = target.dataset.videoSrc || "";',
    '                const src = videoSrc || target.getAttribute(\'src\');',
    '                if (!src) return;',
    '',
    '                const isVideo = !!videoSrc || target.tagName === \'VIDEO\';',
    '                const pureSrc = (videoSrc || src).split(\'#\')[0]; // static thumbnail keeps original video source in data-video-src',
  ].join(eol);
  const hoverBefore = batch;
  batch = batch.replace(hoverMarker, hoverReplacement);
  if (batch === hoverBefore) {
    throw new Error('Could not update hover preview to use data-video-src');
  }
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
if (!batch.includes('V4_4_43_MULTI_BG_TARGET_ROW') || !batch.includes('async function _batchAssignFiles(files, field, options = {}) {')) {
  throw new Error('Multi-background target-row patch was not applied completely');
}
if (!batch.includes('Number.isInteger(options?.targetIdx)') || !batch.includes('targetIdx: Number.isInteger(droppedRowIdx)')) {
  throw new Error('Multi-background target row is not carried from drop handler to merge_multi');
}
if (!batch.includes('V4_4_45_STATIC_BATCH_VIDEO_THUMBS') || !batch.includes('data-video-src')) {
  throw new Error('Static batch video thumbnail patch was not applied completely');
}
if (!batch.includes('_RBT_STATIC_THUMB_MAX_CONCURRENCY = 3') || !batch.includes('target.dataset.videoSrc')) {
  throw new Error('Static thumbnail queue or hover source handoff is missing');
}
assertSyntax(batch, batchPath);
writeIfChanged(batchPath, batchBefore, batch);

// The existing thumbnail service accepts a native path. Batch static thumbnails carry a local-media URL,
// so normalize it in preload before invoking the already-cached FFmpeg thumbnail service.
let preloadBefore = read(preloadPath);
let preload = preloadBefore;
const oldThumbBridge = "getVideoThumbnail: (filePath, size) => ipcRenderer.invoke('local:video-thumbnail', filePath, size),";
const newThumbBridge = "getVideoThumbnail: (filePath, size) => ipcRenderer.invoke('local:video-thumbnail', localMediaUrlToPath(filePath), size),";
if (preload.includes(oldThumbBridge)) preload = preload.replace(oldThumbBridge, newThumbBridge);
if (!preload.includes(newThumbBridge)) {
  throw new Error('Video-thumbnail preload URL normalization patch was not applied');
}
assertSyntax(preload, preloadPath);
writeIfChanged(preloadPath, preloadBefore, preload);

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

console.log('[ReelsPatch] Reels fixes ready, including static cached batch thumbnails.');
