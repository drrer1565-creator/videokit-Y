const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src', 'reels-batch-table.js');
const before = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
let src = before;

if (!src.includes('V4_4_57_NATIVE_DROP_SORT')) {
  const comparator = `function _naturalSortByName(a, b) {\n    return String(a?.name || a || '').localeCompare(String(b?.name || b || ''), undefined, {\n        numeric: true,\n        sensitivity: 'base',\n    });\n}`;
  const upgradedComparator = `function _naturalSortByName(a, b) {\n    const extractName = (item) => {\n        if (item && typeof item === 'object') {\n            const rawPath = item._nativePath || item.path || '';\n            if (rawPath) {\n                const base = String(rawPath).replace(/\\\\/g, '/').split('/').pop();\n                if (base) return base;\n            }\n            if (item.name) return String(item.name);\n            if (item.baseName) return String(item.baseName);\n        }\n        const value = String(item || '');\n        return value.replace(/\\\\/g, '/').split('/').pop() || value;\n    };\n    const nameA = extractName(a), nameB = extractName(b);\n    const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });\n    if (cmp !== 0) return cmp;\n    const fullA = String(a?._nativePath || a?.path || a?.name || a || '');\n    const fullB = String(b?._nativePath || b?.path || b?.name || b || '');\n    return fullA.localeCompare(fullB, undefined, { numeric: true, sensitivity: 'base' });\n}`;
  if (!src.includes(comparator)) throw new Error('natural sort comparator marker missing');
  src = src.replace(comparator, upgradedComparator);

  const startNeedle = '        const files = Array.from(e.dataTransfer.files || []);\n        if (!files.length) return;\n        e.preventDefault();';
  const start = src.indexOf(startNeedle);
  const endNeedle = '        // ── Check if any directory was dropped ──';
  const end = src.indexOf(endNeedle, start);
  if (start < 0 || end < 0) throw new Error('main drop route marker missing after v4.4.56');
  const block = `        // V4_4_57_NATIVE_DROP_SORT\n        // Capture/bind real paths before sorting. Sorting renderer File objects first\n        // can detach 001/002/... names from their native paths under contextIsolation.\n        const rawFiles = Array.from(e.dataTransfer.files || []);\n        const droppedPaths = window.electronAPI?.consumeDroppedFilePaths?.() || [];\n        rawFiles.forEach((item, index) => {\n            if (!item._nativePath && droppedPaths[index]) item._nativePath = droppedPaths[index];\n        });\n        const known = new Set(rawFiles.map(item => item._nativePath).filter(Boolean));\n        for (const nativePath of droppedPaths) {\n            if (!nativePath || known.has(nativePath)) continue;\n            rawFiles.push({ name: String(nativePath).split(/[\\\\/]/).pop() || nativePath, path: nativePath, _nativePath: nativePath });\n        }\n        const files = rawFiles.sort(_naturalSortByName);\n        if (!files.length) return;\n        e.preventDefault();\n\n`;
  src = src.slice(0, start) + block + src.slice(end);

  const audioMarker = `        // ── 精确落到 audio 单元格时，直接设为人声 ──\n        if (dropCell && dropCell.dataset.field === 'audio') {\n`;
  if (src.includes(audioMarker)) {
    src = src.replace(audioMarker, `        // ── 精确落到 audio 单元格时：多文件按自然顺序批量分配 ──\n        if (dropCell && dropCell.dataset.field === 'audio') {\n            if (files.length > 1) {\n                await _batchAssignFiles(files, 'audio');\n                return;\n            }\n`);
  }
  const srtMarker = `        // ── 精确落到 srt 单元格时 ──\n        if (dropCell && dropCell.dataset.field === 'srt') {\n`;
  if (src.includes(srtMarker)) {
    src = src.replace(srtMarker, `        // ── 精确落到 srt 单元格时：多文件按自然顺序批量分配 ──\n        if (dropCell && dropCell.dataset.field === 'srt') {\n            if (files.length > 1) {\n                await _batchAssignFiles(files, 'srt');\n                return;\n            }\n`);
  }
}

new vm.Script(src, { filename: file });
if (!src.includes('V4_4_57_NATIVE_DROP_SORT') || !src.includes("const rawPath = item._nativePath || item.path || ''")) {
  throw new Error('v4.4.57 native drop sorting patch incomplete');
}
fs.writeFileSync(file, src, 'utf8');
console.log('[4.4.57-drop] native paths bind before natural sort; exact audio/SRT multi-drop routing updated.');
