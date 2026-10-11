const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, content) {
    fs.writeFileSync(path.join(root, rel), content, 'utf8');
}

function replaceOnce(src, from, to, label) {
    if (src.includes(to)) return src;
    if (!src.includes(from)) throw new Error(`[upstream-4.4.42] missing anchor: ${label}`);
    return src.replace(from, to);
}

function patchApiRouter() {
    const rel = 'electron/apiRouter.js';
    let src = read(rel);
    src = replaceOnce(
        src,
        "const { ipcMain } = require('electron');",
        "const { ipcMain } = require('electron');\nconst { assertTrustedRenderer } = require('./services/trustedRenderer');",
        'apiRouter trusted import',
    );
    src = replaceOnce(
        src,
        "    ipcMain.handle('api-call', async (event, endpoint, data) => {\n        const requestId = String(data?.request_id || '');",
        "    ipcMain.handle('api-call', async (event, endpoint, data) => {\n        assertTrustedRenderer(event);\n        const requestId = String(data?.request_id || '');",
        'api-call trust check',
    );
    src = replaceOnce(
        src,
        "    ipcMain.handle('api-upload', async (event, endpoint, fileBuffer, fileName, formData) => {\n        try {",
        "    ipcMain.handle('api-upload', async (event, endpoint, fileBuffer, fileName, formData) => {\n        assertTrustedRenderer(event);\n        try {",
        'api-upload trust check',
    );
    write(rel, src);
}

function patchLocalOrganizer() {
    const rel = 'electron/localOrganizerService.js';
    let src = read(rel);
    src = replaceOnce(
        src,
        "const { app, dialog, shell, clipboard, nativeImage } = require('electron');",
        "const { assertTrustedRenderer } = require('./services/trustedRenderer');\nconst { app, dialog, shell, clipboard, nativeImage } = require('electron');",
        'local organizer trusted import',
    );
    src = replaceOnce(
        src,
        'function registerLocalOrganizer(ipcMain, getMainWindow) {',
        "function registerLocalOrganizer(rawIpcMain, getMainWindow) {\n    const ipcMain = { handle: (channel, listener) => rawIpcMain.handle(channel, (event, ...args) => { assertTrustedRenderer(event); return listener(event, ...args); }) };",
        'local organizer trusted wrapper',
    );
    write(rel, src);
}

function patchMain() {
    const rel = 'electron/main.js';
    let src = read(rel);
    src = replaceOnce(
        src,
        "const { initAutoUpdater } = require('./updater');",
        "const { initAutoUpdater } = require('./updater');\n\nconst { assertTrustedRenderer, isTrustedRendererUrl } = require('./services/trustedRenderer');\nfunction handleTrusted(channel, listener) {\n    return ipcMain.handle(channel, (event, ...args) => { assertTrustedRenderer(event); return listener(event, ...args); });\n}",
        'main trusted helper',
    );

    src = replaceOnce(
        src,
        '    mainWindow = new BrowserWindow(windowOptions);',
        "    mainWindow = new BrowserWindow(windowOptions);\n    mainWindow.webContents.on('will-navigate', (event, url) => {\n        if (!isTrustedRendererUrl(url, { packaged: app.isPackaged, port: DEV_SERVER_PORT })) event.preventDefault();\n    });\n    mainWindow.webContents.setWindowOpenHandler(({ url }) => {\n        if (/^https?:\\/\\//i.test(url)) shell.openExternal(url).catch(() => {});\n        return { action: 'deny' };\n    });",
        'main navigation guard',
    );

    src = replaceOnce(
        src,
        '        const win = new BrowserWindow(winOpts);',
        "        const win = new BrowserWindow(winOpts);\n        win.webContents.on('will-navigate', (event, url) => {\n            if (!isTrustedRendererUrl(url, { packaged: app.isPackaged, port: DEV_SERVER_PORT })) event.preventDefault();\n        });\n        win.webContents.setWindowOpenHandler(({ url }) => {\n            if (/^https?:\\/\\//i.test(url)) shell.openExternal(url).catch(() => {});\n            return { action: 'deny' };\n        });",
        'template navigation guard',
    );

    src = replaceOnce(
        src,
        "        try { event.returnValue = { ok: true, values: persistentPresetStore.hydrate(values) }; }",
        "        try { assertTrustedRenderer(event); event.returnValue = { ok: true, values: persistentPresetStore.hydrate(values) }; }",
        'persistent preset hydrate trust check',
    );

    const trustedChannels = [
        'persistent-presets:save',
        'export-overlay-preset-package',
        'import-overlay-preset-package',
        'save-overlay-preset-assets',
        'get-app-version',
        'select-directory',
        'select-directories',
        'select-files',
        'save-file',
        'scan-directory',
        'scan-directory-recursive',
        'search-files-recursive',
        'check-files-exist',
        'get-downloads-path',
        'burn-subtitles',
        'reels-compose',
        'reels-compose-wysiwyg',
        'reels-detect-silence',
        'parallel-wysiwyg-export',
        'get-latest-crash-diagnostic',
        'isolated-wysiwyg-export',
        'concat-video',
        'save-rendered-audio',
        'save-png-frame',
        'export-audio-mp3',
        'ensure-directory',
        'collect-reels-project-assets',
        'copy-reels-project-package',
        'get-media-duration',
        'get-media-duration-detail',
        'read-file-buffer',
        'show-item-in-folder',
        'open-external-url',
        'fetch-google-fonts',
        'scan-fonts',
        'get-cache-info',
        'clear-cache',
        'open-cache-folder',
        'set-cache-path',
        'screen-pick-color',
        'open-template-window',
        'get-update-channel',
        'set-update-channel',
    ];
    for (const channel of trustedChannels) {
        const oldText = `ipcMain.handle('${channel}'`;
        const newText = `handleTrusted('${channel}'`;
        if (src.includes(newText)) continue;
        if (!src.includes(oldText)) throw new Error(`[upstream-4.4.42] missing IPC channel: ${channel}`);
        src = src.replace(oldText, newText);
    }

    src = replaceOnce(
        src,
        "    ipcMain.on('reels-frame-pipeline-open', (event, data = {}) => {\n        const { port1, port2 } = new MessageChannelMain();",
        "    ipcMain.on('reels-frame-pipeline-open', (event, data = {}) => {\n        try { assertTrustedRenderer(event); } catch { return; }\n        const { port1, port2 } = new MessageChannelMain();",
        'frame pipeline trust check',
    );
    src = replaceOnce(
        src,
        "    ipcMain.on('cancel-isolated-wysiwyg-export', (_event, requestId) => {\n        const win = isolatedReelsRenderers.get(String(requestId || ''));",
        "    ipcMain.on('cancel-isolated-wysiwyg-export', (_event, requestId) => {\n        try { assertTrustedRenderer(_event); } catch { return; }\n        const win = isolatedReelsRenderers.get(String(requestId || ''));",
        'isolated cancel trust check',
    );
    write(rel, src);
}

const secureDownloadFile = `function downloadFile(url, destPath, onProgress, redirects = 0) {
    let parsed;
    try { parsed = new URL(url); } catch { return Promise.reject(new Error('更新下载地址无效')); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || redirects > 10) {
        return Promise.reject(new Error('更新下载必须使用 HTTPS，且重定向不能超过 10 次'));
    }
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const request = https.get(url, { headers: { 'User-Agent': 'VideoKit-Updater' } }, (response) => {
            // 处理重定向
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                file.close();
                fs.unlinkSync(destPath);
                response.resume();
                let nextUrl;
                try { nextUrl = new URL(response.headers.location, url).href; } catch { return reject(new Error('更新重定向地址无效')); }
                return downloadFile(nextUrl, destPath, onProgress, redirects + 1).then(resolve).catch(reject);
            }

            if (response.statusCode !== 200) {
                file.close();
                fs.unlinkSync(destPath);
                return reject(new Error(\`下载失败: HTTP \${response.statusCode}\`));
            }

            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloaded = 0;

            response.on('data', (chunk) => {
                downloaded += chunk.length;
                if (onProgress && totalSize > 0) {
                    onProgress(Math.round(downloaded / totalSize * 100), downloaded, totalSize);
                }
            });

            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(destPath);
            });
        });

        file.on('error', (err) => { request.destroy(); reject(err); });
        request.on('error', (err) => {
            file.close();
            try { fs.unlinkSync(destPath); } catch (_) {}
            reject(err);
        });

        request.setTimeout(120000, () => {
            request.destroy();
            reject(new Error('下载超时'));
        });
    });
}`;

function patchUpdater() {
    const rel = 'electron/updater.js';
    let src = read(rel);
    src = replaceOnce(
        src,
        "const { app, ipcMain, dialog } = require('electron');",
        "const { app, ipcMain: rawIpcMain, dialog } = require('electron');\nconst { assertTrustedRenderer } = require('./services/trustedRenderer');\nconst ipcMain = { handle: (channel, listener) => rawIpcMain.handle(channel, (event, ...args) => { assertTrustedRenderer(event); return listener(event, ...args); }) };",
        'updater trusted IPC wrapper',
    );
    if (!src.includes('function downloadFile(url, destPath, onProgress, redirects = 0)')) {
        const start = src.indexOf('function downloadFile(');
        const end = src.indexOf('\n/**\n * HTTPS GET JSON', start);
        if (start < 0 || end < 0) throw new Error('[upstream-4.4.42] updater downloadFile anchors missing');
        src = src.slice(0, start) + secureDownloadFile + src.slice(end);
    }
    write(rel, src);
}

function patchOverlayBinding() {
    const rel = 'src/reels-overlay-panel.js';
    let src = read(rel);
    src = replaceOnce(
        src,
        "                let opts = '<option value=\"\">— 不绑定 —</option>';",
        "                bindSelect.replaceChildren(new Option('— 不绑定 —', ''));",
        'overlay binding initial option',
    );
    src = replaceOnce(
        src,
        "                            const sel = o.id === curVal ? ' selected' : '';\n                            opts += `<option value=\"${o.id}\"${sel}>${label}</option>`;",
        "                            bindSelect.add(new Option(String(label), String(o.id), false, o.id === curVal));",
        'overlay binding text option',
    );
    src = replaceOnce(
        src,
        '                bindSelect.innerHTML = opts;',
        '',
        'overlay binding innerHTML removal',
    );
    write(rel, src);
}

patchApiRouter();
patchLocalOrganizer();
patchMain();
patchUpdater();
patchOverlayBinding();
console.log('Applied upstream v4.4.42 security backports');
