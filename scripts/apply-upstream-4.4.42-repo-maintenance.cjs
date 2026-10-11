const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const pins = new Map([
  ['actions/checkout@v4', 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4'],
  ['actions/setup-node@v4', 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4'],
  ['actions/setup-python@v5', 'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065 # v5'],
  ['actions/upload-artifact@v4', 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4'],
  ['actions/download-artifact@v4', 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4'],
  ['actions/attest-build-provenance@v2', 'actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be # v2'],
  ['softprops/action-gh-release@v2', 'softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65 # v2'],
  ['github/codeql-action/init@v3', 'github/codeql-action/init@9f759ee644a3e7c15c1390abf49868036c00067b # v3'],
  ['github/codeql-action/analyze@v3', 'github/codeql-action/analyze@9f759ee644a3e7c15c1390abf49868036c00067b # v3'],
]);

for (const rel of [
  '.github/workflows/build.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/main-regression.yml',
  '.github/workflows/release-windows.yml',
]) {
  const file = path.join(root, rel);
  let src = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pins) src = src.split(from).join(to);
  fs.writeFileSync(file, src, 'utf8');
}

const lockPath = path.join(root, 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const updates = {
  'node_modules/http-cache-semantics': {
    version: '4.3.0',
    resolved: 'https://registry.npmjs.org/http-cache-semantics/-/http-cache-semantics-4.3.0.tgz',
    integrity: 'sha512-M5t5LlJpS1UHMjvwRQVdFHvPISGeLAxNcrWuJkeGh0KxsqCHZ1O3NXZU/8x7cD0BDcGW8kapxMKTvwlqrNkHkA==',
  },
  'node_modules/source-map-js': {
    version: '1.2.2',
    resolved: 'https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.2.tgz',
    integrity: 'sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==',
  },
};
for (const [key, values] of Object.entries(updates)) {
  if (!lock.packages?.[key]) throw new Error(`Missing lockfile package: ${key}`);
  Object.assign(lock.packages[key], values);
}
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');

console.log('Applied upstream v4.4.42 repository maintenance pins');
