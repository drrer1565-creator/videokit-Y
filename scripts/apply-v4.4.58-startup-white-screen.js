const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = {
  main: path.join(root, 'electron', 'main.js'),
  tts: path.join(root, 'src', 'microsoft-tts.js'),
  history: path.join(root, 'src', 'global-edit-history.js'),
};

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
const write = (file, before, after) => {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.58-startup] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.58-startup] no changes needed for ${path.relative(root, file)}`);
  }
};
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`4.4.58 startup marker missing: ${label}`);
  return source.replace(before, after);
};
const syntax = (source, file) => new vm.Script(source, { filename: file });

// 1) Do not expose Chromium's blank page while the packaged UI is still painting.
{
  const file = files.main;
  const before = read(file);
  let src = before;

  if (!src.includes('V4_4_58_STARTUP_WINDOW_OPTIONS')) {
    src = replaceOnce(
      src,
      `        minHeight: 700,\n        title: 'VideoKit',\n        webPreferences: {`,
      `        minHeight: 700,\n        title: 'VideoKit',\n        // V4_4_58_STARTUP_WINDOW_OPTIONS\n        // Hide Chromium's blank first frame; reveal only after the renderer has\n        // painted. The dark background is a safe fallback for abnormal starts.\n        show: false,\n        backgroundColor: '#0b1020',\n        webPreferences: {`,
      'main BrowserWindow startup visibility'
    );
  }

  if (!src.includes('V4_4_58_STARTUP_REVEAL')) {
    const marker = `    mainWindow = new BrowserWindow(windowOptions);`;
    src = replaceOnce(
      src,
      marker,
      `${marker}\n\n    // V4_4_58_STARTUP_REVEAL\n    let startupRevealTimer = null;\n    const revealMainWindow = () => {\n        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;\n        if (startupRevealTimer) {\n            clearTimeout(startupRevealTimer);\n            startupRevealTimer = null;\n        }\n        mainWindow.show();\n    };\n    mainWindow.once('ready-to-show', revealMainWindow);\n    // Never leave the app invisible forever if renderer readiness fails.\n    startupRevealTimer = setTimeout(revealMainWindow, 8000);\n    startupRevealTimer.unref?.();`,
      'ready-to-show startup reveal'
    );
  }

  syntax(src, file);
  write(file, before, src);
}

// 2) Microsoft TTS should not build a potentially large saved queue or start a
// network voice-list request until the user actually opens the TTS workspace.
{
  const file = files.tts;
  const before = read(file);
  let src = before;

  if (!src.includes('V4_4_58_LAZY_MICROSOFT_TTS_INIT')) {
    src = replaceOnce(
      src,
      `    document.addEventListener('DOMContentLoaded', async () => {\n        voices = FALLBACK_VOICES;`,
      `    document.addEventListener('DOMContentLoaded', () => {\n        // V4_4_58_LAZY_MICROSOFT_TTS_INIT\n        let initialized = false;\n        let initializing = false;\n        const initMicrosoftTts = async () => {\n            if (initialized || initializing) return;\n            initializing = true;\n            try {\n        voices = FALLBACK_VOICES;`,
      'defer Microsoft TTS DOM initialization'
    );

    src = replaceOnce(
      src,
      `        render();\n        setTimeout(() => loadVoices(false), 2000);\n    });\n})();`,
      `        render();\n        // Voice discovery now belongs to the TTS workspace lifecycle instead of\n        // the application's critical first-paint path.\n        await loadVoices(false);\n        initialized = true;\n            } finally {\n                initializing = false;\n            }\n        };\n\n        const lazyTabBtn = document.querySelector('[data-tab="microsoft-tts"]');\n        if (lazyTabBtn) {\n            lazyTabBtn.addEventListener('click', () => {\n                void initMicrosoftTts().catch(error => setStatus('初始化失败：' + error.message));\n            });\n        }\n\n        // If this workspace was restored as the initial panel, initialize it at\n        // browser idle time instead of competing with first paint.\n        const panel = document.getElementById('microsoft-tts-panel');\n        if (panel?.classList.contains('active')) {\n            const schedule = typeof window.requestIdleCallback === 'function'\n                ? cb => window.requestIdleCallback(cb, { timeout: 1800 })\n                : cb => setTimeout(cb, 1200);\n            schedule(() => {\n                void initMicrosoftTts().catch(error => setStatus('初始化失败：' + error.message));\n            });\n        }\n    });\n})();`,
      'remove eager Microsoft TTS startup work'
    );
  }

  syntax(src, file);
  write(file, before, src);
}

// 3) The first global-history snapshot is useful, but it is not first-paint work.
// Move it to browser idle time; direct user interaction still captures a baseline
// immediately via the existing pointerdown/beforeinput hooks.
{
  const file = files.history;
  const before = read(file);
  let src = before;

  if (!src.includes('V4_4_58_IDLE_INITIAL_HISTORY')) {
    src = replaceOnce(
      src,
      `    document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>commit(context()),500));`,
      `    // V4_4_58_IDLE_INITIAL_HISTORY\n    document.addEventListener('DOMContentLoaded',()=>{\n        const initialCommit=()=>{if(!restoring)commit(context());};\n        if(typeof window.requestIdleCallback==='function')window.requestIdleCallback(initialCommit,{timeout:3500});\n        else setTimeout(initialCommit,1800);\n    });`,
      'idle initial global-history snapshot'
    );
  }

  syntax(src, file);
  write(file, before, src);
}

const main = read(files.main);
const tts = read(files.tts);
const history = read(files.history);
const required = [
  [main, 'V4_4_58_STARTUP_WINDOW_OPTIONS'],
  [main, 'V4_4_58_STARTUP_REVEAL'],
  [main, "show: false"],
  [main, "mainWindow.once('ready-to-show', revealMainWindow)"],
  [tts, 'V4_4_58_LAZY_MICROSOFT_TTS_INIT'],
  [tts, 'initMicrosoftTts'],
  [history, 'V4_4_58_IDLE_INITIAL_HISTORY'],
  [history, 'requestIdleCallback'],
];
for (const [source, marker] of required) {
  if (!source.includes(marker)) throw new Error(`4.4.58 startup patch incomplete: ${marker}`);
}
if (tts.includes('setTimeout(() => loadVoices(false), 2000)')) {
  throw new Error('4.4.58 startup patch incomplete: eager TTS voice loading still present');
}

console.log('[4.4.58-startup] First paint is hidden until ready; TTS/history startup work is deferred.');
