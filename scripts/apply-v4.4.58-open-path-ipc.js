const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const mainPath = path.join(root, 'electron', 'main.js');
let src = fs.readFileSync(mainPath, 'utf8').replace(/\r\n?/g, '\n');
const before = src;

if (!src.includes('V4_4_58_OPEN_PATH_IPC')) {
  const marker = 'app.whenReady().then(async () => {';
  if (!src.includes(marker)) throw new Error('v4.4.58 open-path IPC app-ready marker missing');
  const handler = [
    marker,
    '    // V4_4_58_OPEN_PATH_IPC',
    "    ipcMain.handle('open-path', async (_event, targetPath) => {",
    "        const value = String(targetPath || '').trim();",
    "        if (!value) return '路径为空';",
    '        try {',
    '            const result = await shell.openPath(path.resolve(value));',
    "            return result || '';",
    '        } catch (error) {',
    "            return error?.message || '无法打开路径';",
    '        }',
    '    });',
  ].join('\n');
  src = src.replace(marker, handler);
}

new vm.Script(src, { filename: mainPath });
if (!src.includes("ipcMain.handle('open-path'")) throw new Error('v4.4.58 open-path IPC patch incomplete');
if (src !== before) fs.writeFileSync(mainPath, src, 'utf8');
console.log('[4.4.58-open-path] System file/folder opening IPC is available.');
