const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const fontManagerPath = path.join(root, 'src', 'reels-font-manager.js');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function write(file, before, after) {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.53-font-picker-live-groups] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.53-font-picker-live-groups] no changes needed for ${path.relative(root, file)}`);
  }
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`font picker patch marker missing: ${label}`);
  return source.replace(before, after);
}

function syntax(source, file) {
  new vm.Script(source, { filename: file });
}

let before = read(fontManagerPath);
let src = before;

src = replaceOnce(
  src,
  `        this._fontVariants = new Map(); // family -> Set of "weight|style"\n`,
  `        this._fontVariants = new Map(); // family -> Set of "weight|style"\n        // V4_4_53_FONT_PICKER_LIVE_GROUPS\n        // Increment only when the available font catalog actually changes.\n        // Font pickers use this lightweight version token to know whether their\n        // cached groups are stale; opening a picker never rescans Windows fonts\n        // or refetches Google Fonts by itself.\n        this._fontCatalogVersion = 0;\n`,
  'constructor version token'
);

src = replaceOnce(
  src,
  `        this._allowedFonts = Array.from(merged);\n        this._registered = true;\n\n        const googleCount = this._googleFontsFull ? this._googleFontsFull.size : GOOGLE_FONTS.length;\n`,
  `        this._allowedFonts = Array.from(merged);\n        this._registered = true;\n        this._touchFontCatalog();\n\n        const googleCount = this._googleFontsFull ? this._googleFontsFull.size : GOOGLE_FONTS.length;\n`,
  'register catalog invalidation'
);

src = replaceOnce(
  src,
  `            if (!this._allowedFonts.includes(fontFamily)) {\n                this._allowedFonts.push(fontFamily);\n            }\n            for (const w of ['100', '200', '300', '400', '500', '600', '700', '800', '900']) {\n`,
  `            if (!this._allowedFonts.includes(fontFamily)) {\n                this._allowedFonts.push(fontFamily);\n                this._touchFontCatalog();\n            }\n            for (const w of ['100', '200', '300', '400', '500', '600', '700', '800', '900']) {\n`,
  'lazy Google font catalog invalidation'
);

src = replaceOnce(
  src,
  `            if (!this._allowedFonts.includes(familyName)) {\n                this._allowedFonts.push(familyName);\n            }\n            this._recordVariant(familyName, '100 900', 'normal');\n`,
  `            if (!this._allowedFonts.includes(familyName)) {\n                this._allowedFonts.push(familyName);\n            }\n            this._touchFontCatalog();\n            this._recordVariant(familyName, '100 900', 'normal');\n`,
  'uploaded font catalog invalidation'
);

src = replaceOnce(
  src,
  `    _recordVariant(fontFamily, weight = '400', style = 'normal') {\n`,
  `    _touchFontCatalog() {\n        this._fontCatalogVersion = (Number(this._fontCatalogVersion) || 0) + 1;\n        return this._fontCatalogVersion;\n    }\n\n    getFontCatalogVersion() {\n        return Number(this._fontCatalogVersion) || 0;\n    }\n\n    _recordVariant(fontFamily, weight = '400', style = 'normal') {\n`,
  'catalog version helpers'
);

src = replaceOnce(
  src,
  `        groups.google.sort(popularFirst);\n        groups.embedded.sort(popularFirst);\n        groups.system.sort(popularFirst);\n        groups.custom.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));\n\n        const groupDefs = [\n`,
  `        groups.google.sort(popularFirst);\n        groups.embedded.sort(popularFirst);\n        groups.system.sort(popularFirst);\n        groups.custom.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));\n\n        // Keep the newest groups on the select itself. The visible picker button\n        // may have been created before async Google/system registration finished,\n        // so its click handler must read these live values instead of retaining\n        // the first groups object forever.\n        select._fpLiveGroups = groups;\n        select._fpLiveDisplayNames = DISPLAY_NAMES;\n        select._fpCatalogVersion = this.getFontCatalogVersion();\n\n        const groupDefs = [\n`,
  'store live groups on select'
);

src = replaceOnce(
  src,
  `            btn.addEventListener('click', () => {\n                this._openAdvancedFontPicker(select, displayNames, groups);\n            });\n`,
  `            btn.addEventListener('click', () => {\n                // Only rebuild this select when the central font catalog changed.\n                // This is a cheap version comparison; it does not rescan the OS\n                // or refetch Google Fonts on every click.\n                const latestVersion = this.getFontCatalogVersion();\n                if (select._fpCatalogVersion !== latestVersion) {\n                    this.refreshFontSelect(select, select.value);\n                }\n                this._openAdvancedFontPicker(\n                    select,\n                    select._fpLiveDisplayNames || displayNames,\n                    select._fpLiveGroups || groups\n                );\n            });\n`,
  'open picker with live groups'
);

syntax(src, fontManagerPath);
write(fontManagerPath, before, src);

const required = [
  'V4_4_53_FONT_PICKER_LIVE_GROUPS',
  'this._fontCatalogVersion = 0',
  'this._touchFontCatalog();',
  'select._fpLiveGroups = groups',
  'select._fpCatalogVersion = this.getFontCatalogVersion()',
  'if (select._fpCatalogVersion !== latestVersion)',
  'select._fpLiveGroups || groups',
];
for (const marker of required) {
  if (!src.includes(marker)) throw new Error(`4.4.53 font picker patch incomplete: ${marker}`);
}

console.log('[4.4.53-font-picker-live-groups] Overlay and subtitle font pickers now share the latest catalog without repeated rescans.');
