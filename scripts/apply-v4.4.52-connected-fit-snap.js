const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const rendererPath = path.join(root, 'src', 'reels-canvas-renderer.js');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function write(file, before, after) {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.52-connected-fit-snap] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.52-connected-fit-snap] no changes needed for ${path.relative(root, file)}`);
  }
}

function syntax(source, file) {
  new vm.Script(source, { filename: file });
}

let rendererBefore = read(rendererPath);
let renderer = rendererBefore;

if (!renderer.includes('V4_4_51_CONNECTED_SUBTITLE_BOX_GEOMETRY')) {
  throw new Error('4.4.51 connected-fit geometry must be applied before 4.4.52 width snapping');
}

if (!renderer.includes('V4_4_52_CONNECTED_FIT_WIDTH_SNAP')) {
  const marker = `    if (!rects.length) return { rects: [], points: [], corners: [] };\n\n    // Join neighbouring rows at the midpoint between their original boxes.`;
  if (!renderer.includes(marker)) {
    throw new Error('connected-fit width snap insertion marker missing');
  }

  const replacement = `    if (!rects.length) return { rects: [], points: [], corners: [] };\n\n    // V4_4_52_CONNECTED_FIT_WIDTH_SNAP\n    // When neighbouring centered rows differ by less than the available inward\n    // corner radius on BOTH sides, a rounded step has too little horizontal\n    // room and turns into a tiny square-looking ear. Treat those rows as one\n    // visual width instead: every row in a contiguous near-equal group adopts\n    // the widest row's left and right edges. This is recalculated on every\n    // render, so font size, font family, letter spacing, wrapping, padding and\n    // line layout changes are reflected immediately.\n    const snapThreshold = Math.max(0, Number(innerRadius) || 0);\n    if (snapThreshold > 0 && rects.length > 1) {\n        const EPS = 0.001;\n        const snapGroupToWidest = (start, end) => {\n            if (end <= start) return;\n            let widestIndex = start;\n            let widestWidth = rects[start].right - rects[start].left;\n            for (let i = start + 1; i <= end; i++) {\n                const width = rects[i].right - rects[i].left;\n                if (width > widestWidth + EPS) {\n                    widestWidth = width;\n                    widestIndex = i;\n                }\n            }\n            const targetLeft = rects[widestIndex].left;\n            const targetRight = rects[widestIndex].right;\n            for (let i = start; i <= end; i++) {\n                rects[i].left = targetLeft;\n                rects[i].right = targetRight;\n            }\n        };\n\n        let groupStart = 0;\n        for (let i = 0; i < rects.length - 1; i++) {\n            const current = rects[i];\n            const next = rects[i + 1];\n            const nearEqual = Math.abs(current.left - next.left) <= snapThreshold + EPS\n                && Math.abs(current.right - next.right) <= snapThreshold + EPS;\n            if (!nearEqual) {\n                snapGroupToWidest(groupStart, i);\n                groupStart = i + 1;\n            }\n        }\n        snapGroupToWidest(groupStart, rects.length - 1);\n    }\n\n    // Join neighbouring rows at the midpoint between their original boxes.`;

  renderer = renderer.replace(marker, replacement);
}

syntax(renderer, rendererPath);
write(rendererPath, rendererBefore, renderer);

if (!renderer.includes('V4_4_52_CONNECTED_FIT_WIDTH_SNAP')
    || !renderer.includes('snapGroupToWidest')
    || !renderer.includes('Math.abs(current.left - next.left) <= snapThreshold')) {
  throw new Error('4.4.52 connected-fit width snap patch incomplete');
}

console.log('[4.4.52-connected-fit-snap] Near-equal connected subtitle rows now snap to the widest row in real time.');
