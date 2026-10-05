const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
for (const relativePath of [
  path.join('electron', 'services', 'ffmpeg.js'),
  path.join('src', 'index.html'),
]) {
  const filePath = path.join(root, relativePath);
  const before = fs.readFileSync(filePath, 'utf8');
  const normalized = before.replace(/\r\n/g, '\n');
  if (before !== normalized) fs.writeFileSync(filePath, normalized, 'utf8');
}

require('./apply-hdr-sdr-mode.js');
