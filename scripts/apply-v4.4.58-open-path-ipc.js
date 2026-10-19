const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const mainPath = path.join(root, 'electron', 'main.js');
let src = fs.readFileSync(mainPath, 'utf8').replace(/\r\n?/g, '\n');
const before = src;

if (!src.includes('V4_4_58_OPEN_PATH_IPC')) {
  const needle = "ipcMain.handle('select-directory'";
  const at = src.indexOf(needle);
  if (at < 0) throw new Error('v4.4.58 open-path IPC insertion marker missing');
  const lineStart = src.lastIndexOf('\n', at) + 1;
  const indentMatch = src.slice(lineStart, at).match(/^\s*/);
  const indent = indentMatch ? indentMatch[0] : '    ';
  const handler = [
    `${indent}// V4_4_58_OPEN_PATH_IPC`,
    `${indent}ipcMain.handle('open-path', async (_event, targetPath) => {`,
    `${indent}    const value = String(targetPath || '').trim();`,
    `${indent}    if (!value) return '路径为空';`,
    `${indent}    try {`,
    `${indent}        const result = await shell.openPath(path.resolve(value));`,
    `${indent}        return result || '';`,
    `${indent}    } catch (error) {`,
    `${indent}        return error?.message || '无法打开路径';`,
    `${indent}    }`,
    `${indent}});`,
    '',
  ].join('\n');
  src = src.slice(0, lineStart) + handler + src.slice(lineStart);
}

new vm.Script(src, { filename: mainPath });
if (!src.includes("ipcMain.handle('open-path'")) throw new Error('v4.4.58 open-path IPC patch incomplete');
if (src !== before) fs.writeFileSync(mainPath, src, 'utf8');
console.log('[4.4.58-open-path] System file/folder opening IPC is available.');
