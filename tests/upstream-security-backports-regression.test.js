const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('upstream 4.4.42 backport patch is idempotent', () => {
    execFileSync(process.execPath, [path.join(root, 'scripts/apply-upstream-4.4.42-security-backports.js')], {
        cwd: root,
        stdio: 'pipe',
    });
});

test('trusted renderer allowlist accepts only app-owned renderer pages', () => {
    const { isTrustedRendererUrl } = require('../electron/services/trustedRenderer');
    assert.equal(isTrustedRendererUrl(pathToFileURL(path.join(root, 'dist/index.html')).href + '#template=x'), true);
    assert.equal(isTrustedRendererUrl('http://localhost:5173/', { packaged: false }), true);
    assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/index.html', { packaged: false }), true);
    for (const url of [
        'https://evil.example/',
        'file:///C:/Users/User/Downloads/evil.html',
        'data:text/html,hello',
        'http://localhost.evil.example:5173/',
        'http://user:pass@localhost:5173/',
    ]) assert.equal(isTrustedRendererUrl(url, { packaged: false }), false, url);
});

test('privileged IPC, navigation and imported overlay labels are hardened', () => {
    const main = read('electron/main.js');
    const api = read('electron/apiRouter.js');
    const organizer = read('electron/localOrganizerService.js');
    const overlay = read('src/reels-overlay-panel.js');
    assert.match(main, /function handleTrusted\(/);
    assert.match(main, /will-navigate/);
    assert.match(main, /setWindowOpenHandler/);
    assert.match(main, /handleTrusted\('reels-compose-wysiwyg'/);
    assert.match(main, /assertTrustedRenderer\(event\).*persistentPresetStore\.hydrate/s);
    assert.match(api, /assertTrustedRenderer\(event\)/);
    assert.match(organizer, /rawIpcMain\.handle/);
    const start = overlay.indexOf("const bindSelect = this.container.querySelector('#rop-bind-scroll-target')");
    const end = overlay.indexOf("if (ov.type === 'textcard' || ov.type === 'solid_mask')", start);
    const binding = overlay.slice(start, end);
    assert.match(binding, /bindSelect\.replaceChildren\(new Option/);
    assert.match(binding, /bindSelect\.add\(new Option\(String\(label\)/);
    assert.doesNotMatch(binding, /innerHTML/);
});

test('portable updater, archive extraction and dev server keep security boundaries', () => {
    const updater = read('electron/updater.js');
    const extract = read('electron/services/safeExtract.js');
    const vite = read('vite.config.js');
    assert.match(updater, /parsed\.protocol !== 'https:'/);
    assert.match(updater, /redirects > 10/);
    assert.match(updater, /new URL\(response\.headers\.location, url\)/);
    assert.match(updater, /assertTrustedRenderer/);
    assert.match(extract, /fs\.realpathSync\(requestedRoot\)/);
    assert.match(extract, /fs\.lstatSync\(current\)/);
    assert.match(vite, /host: 'localhost'/);
    assert.match(vite, /cors: false/);
});

test('dependency floors and pinned CI actions are present', () => {
    const lock = read('package-lock.json');
    const req = read('requirements-edge.txt');
    const constraints = read('constraints-security.txt');
    assert.match(lock, /"node_modules\/http-cache-semantics"[\s\S]*?"version": "4\.3\.0"/);
    assert.match(lock, /"node_modules\/source-map-js"[\s\S]*?"version": "1\.2\.2"/);
    assert.match(req, /-c constraints-security\.txt/);
    assert.match(constraints, /multidict>=6\.9\.1,<7/);

    for (const rel of [
        '.github/workflows/build.yml',
        '.github/workflows/codeql.yml',
        '.github/workflows/main-regression.yml',
        '.github/workflows/release-windows.yml',
    ]) {
        const workflow = read(rel);
        assert.doesNotMatch(workflow, /uses:\s+(actions\/checkout|actions\/setup-node|actions\/setup-python|actions\/upload-artifact|actions\/download-artifact|actions\/attest-build-provenance|github\/codeql-action\/(?:init|analyze)|softprops\/action-gh-release)@v\d+/);
    }
});
