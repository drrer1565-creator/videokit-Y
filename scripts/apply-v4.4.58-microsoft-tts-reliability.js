// Compatibility wrapper kept in the v4.4.55+ patch chain.
// Repair the v2 range helper before loading it: every replacement already
// includes its end marker, so the original end marker must be consumed.
const fs = require('fs');
const path = require('path');
const patchPath = path.join(__dirname, 'apply-v4.4.58-microsoft-tts-reliability-v2.js');
let source = fs.readFileSync(patchPath, 'utf8');
const before = '  return src.slice(0, start) + replacement + src.slice(end);';
const after = '  return src.slice(0, start) + replacement + src.slice(end + endMarker.length);';
if (source.includes(before)) {
  source = source.replace(before, after);
  fs.writeFileSync(patchPath, source, 'utf8');
}
require('./apply-v4.4.58-microsoft-tts-reliability-v2.js');
