const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
assert.equal(pkg.version, '4.4.60-fix1', 'Unexpected release version');
assert.equal(lock.version, pkg.version, 'Lockfile version mismatch');
assert.equal(lock.packages[''].version, pkg.version, 'Lockfile root package version mismatch');
assert.ok(read('src/index.html').includes(`id="app-version-display">v${pkg.version}</span>`), 'About fallback version mismatch');
if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(process.env.GITHUB_REF_NAME, `v${pkg.version}`, 'Release tag version mismatch');
}
if (process.argv.includes('--packaged')) {
  const asar = require('@electron/asar');
  const archive = path.join(root, 'dist-electron/win-unpacked/resources/app.asar');
  const installed = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  assert.equal(installed.version, pkg.version, 'Packaged Electron version mismatch');
  const html = asar.extractFile(archive, 'dist/index.html').toString('utf8');
  assert.ok(html.includes(`v${pkg.version}</span>`), 'Packaged About version mismatch');
  assert.match(read('dist-electron/latest.yml'), new RegExp(`^version: ${pkg.version.replace(/\./g, '\\.')}\\s*$`, 'm'));
  for (const extension of ['exe', 'zip']) {
    assert.ok(fs.statSync(path.join(root, `dist-electron/VideoKit-Setup-${pkg.version}.${extension}`)).size > 0);
  }
}
console.log(`Verified VideoKit ${pkg.version}${process.argv.includes('--packaged') ? ' Windows artifacts' : ''}`);
