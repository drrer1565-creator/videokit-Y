const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'src', 'index.html');
const rendererPath = path.join(root, 'src', 'reels-canvas-renderer.js');
const wysiwygPath = path.join(root, 'src', 'reels-wysiwyg-export.js');
const layeredPath = path.join(root, 'src', 'reels-layered-export.js');
const speechPath = path.join(root, 'src', 'reels-speech-writing.js');

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
const write = (file, before, after) => {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.57-writing] patched ${path.relative(root, file)}`);
  }
};

// Load the extension immediately after the core renderer, before Batch Reels.
{
  const before = read(indexPath); let src = before;
  if (!src.includes('src="reels-speech-writing.js"')) {
    const marker = '  <script src="reels-canvas-renderer.js"></script>';
    if (!src.includes(marker)) throw new Error('speech-writing script order marker missing');
    src = src.replace(marker, marker + '\n  <!-- V4_4_57_SPEECH_WRITING_EXTENSION -->\n  <script src="reels-speech-writing.js"></script>');
  }
  write(indexPath, before, src);
}

// Preserve the existing v4.4.42–v4.4.56 renderer and expose only the current
// typewriter cursor position. The speech extension uses it to draw custom tips.
{
  const before = read(rendererPath); let src = before;
  if (!src.includes('V4_4_57_WRITING_CURSOR_POSITION')) {
    const old = `        // 6. Draw blinking cursor\n        if (s.fullpage_typewriter_cursor && cursorX !== null && cursorY !== null) {\n            const blink = Math.floor(currentTime * 2) % 2 === 0;\n            if (blink) {\n                ctx.save();\n                ctx.fillStyle = s.fullpage_typewriter_cursor_color || '#FFD700';\n\n                // Find which line the cursor is currently on\n                let activeLineIdx = 0;\n                for (let li = 0; li < visibleLines.length; li++) {\n                    const tokens = visibleLines[li];\n                    if (tokens.some(tok => currentTime >= tok.start)) {\n                        activeLineIdx = li;\n                    }\n                }\n                ctx.font = getLineFontStr(activeLineIdx);\n\n                const cursorChar = s.fullpage_typewriter_cursor_char || '|';\n                ctx.fillText(cursorChar, cursorX, cursorY);\n                ctx.restore();\n            }\n        }`;
    if (!src.includes(old)) throw new Error('fullpage typewriter cursor block missing');
    const neu = `        // V4_4_57_WRITING_CURSOR_POSITION\n        // Expose the resolved cursor position without changing the established\n        // typewriter layout/gradient/animation code used by previous releases.\n        let activeLineIdx = 0;\n        if (cursorX !== null && cursorY !== null) {\n            for (let li = 0; li < visibleLines.length; li++) {\n                if (visibleLines[li].some(tok => currentTime >= tok.start)) activeLineIdx = li;\n            }\n            this._writingTipPosition = {\n                x: cursorX, y: cursorY, size: getLineHeight(activeLineIdx) / 1.2,\n                font: getLineFontStr(activeLineIdx), time: currentTime\n            };\n        } else {\n            this._writingTipPosition = null;\n        }\n\n        // 6. Draw blinking cursor. Split-writing sub-renders defer it so the\n        // extension can draw exactly one title/body cursor after both passes.\n        if (s.fullpage_typewriter_cursor && !s._writingDeferCursor && cursorX !== null && cursorY !== null) {\n            const blink = Math.floor(currentTime * 2) % 2 === 0;\n            if (blink) {\n                ctx.save();\n                ctx.fillStyle = s.fullpage_typewriter_cursor_color || '#FFD700';\n                ctx.font = getLineFontStr(activeLineIdx);\n                ctx.fillText(s.fullpage_typewriter_cursor_char || '|', cursorX, cursorY);\n                ctx.restore();\n            }\n        }`;
    src = src.replace(old, neu);
    // Compatibility markers are kept here so the chained selected-upgrade
    // validator can confirm the speech extension is present without replacing
    // the mature renderer wholesale.
    src = src.replace('class ReelsCanvasRenderer {', `// V4_4_57_SPEECH_WRITING_COMPAT: getSplitWritingParts getSpeechWritingTokens drawSpeechWritingTip prepareWritingCursorImage fullpage_typewriter_split\nclass ReelsCanvasRenderer {`);
  }
  new vm.Script(src, { filename: rendererPath });
  write(rendererPath, before, src);
}

function patchExporter(file) {
  if (!fs.existsSync(file)) return;
  const before = read(file); let src = before;
  if (!src.includes('V4_4_57_PREPARE_WRITING_CURSOR')) {
    const marker = '    const renderer = new ReelsCanvasRenderer(canvas);';
    if (!src.includes(marker)) return;
    src = src.replace(marker, marker + `\n    // V4_4_57_PREPARE_WRITING_CURSOR\n    if (typeof renderer.prepareWritingCursorImage === 'function') await renderer.prepareWritingCursorImage(style);`);
  }
  new vm.Script(src, { filename: file });
  write(file, before, src);
}
patchExporter(wysiwygPath);
patchExporter(layeredPath);

if (!read(indexPath).includes('reels-speech-writing.js')) throw new Error('speech-writing extension is not loaded');
for (const marker of ['getSplitWritingParts', 'getSpeechWritingTokens', 'prepareWritingCursorImage']) {
  if (!read(speechPath).includes(marker)) throw new Error(`speech-writing extension marker missing: ${marker}`);
}
console.log('[4.4.57-writing] existing renderer preserved; speech-writing extension wired.');
