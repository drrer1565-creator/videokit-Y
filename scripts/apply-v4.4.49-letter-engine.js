const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const animPath = path.join(root, 'src', 'reels-anim-engine.js');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}
function write(file, source) {
  fs.writeFileSync(file, source, 'utf8');
}

let anim = read(animPath);

if (!anim.includes("['逐字上浮', 'char_rise']")) {
  const anchor = /^(\s*)\['逐字弹跳',\s*'char_bounce'\],\s*$/m;
  const match = anim.match(anchor);
  if (!match) throw new Error('char_bounce label anchor missing');
  const indent = match[1] || '    ';
  const labels = [
    `${indent}['逐字弹跳', 'char_bounce'],`,
    `${indent}['逐字上浮', 'char_rise'],`,
    `${indent}['逐字弹性放大', 'char_elastic'],`,
    `${indent}['逐字波浪', 'char_wave'],`,
    `${indent}['逐字落下回弹', 'char_drop'],`,
    `${indent}['逐字挤压弹跳', 'char_squash'],`,
    `${indent}['中心扩散', 'char_center_spread'],`,
  ].join('\n');
  anim = anim.replace(anchor, labels);
}

if (!anim.includes('V4_4_49_CHARACTER_PRESET_TRANSFORM')) {
  const functionAnchor = '/** Return scale factor for the currently-spoken word in letter-jump mode. */';
  if (!anim.includes(functionAnchor)) throw new Error('letter-jump function anchor missing');

  const code = `// V4_4_49_CHARACTER_PRESET_TRANSFORM
// Shared transform calculator for six adjustable per-character subtitle effects.
function computeCharacterPresetTransform(type, currentTime, segStart, charIndex, totalChars, options = {}) {
    const identity = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
    if (currentTime == null) return identity;

    const supported = new Set(['char_rise', 'char_elastic', 'char_wave', 'char_drop', 'char_squash', 'char_center_spread']);
    if (!supported.has(type)) return identity;

    const count = Math.max(1, parseInt(totalChars, 10) || 1);
    const idx = Math.max(0, Math.min(count - 1, parseInt(charIndex, 10) || 0));
    const strength = Math.max(0.25, Math.min(2.5, Number(options.strength ?? 1.0)));
    const duration = Math.max(0.08, Math.min(2.0, Number(options.duration ?? 0.36)));
    const stagger = Math.max(0, Math.min(0.5, Number(options.stagger ?? 0.035)));

    let orderIndex = idx;
    if (type === 'char_center_spread') {
        const center = (count - 1) / 2;
        const evenOffset = count % 2 === 0 ? 0.5 : 0;
        orderIndex = Math.max(0, Math.abs(idx - center) - evenOffset);
    }

    const start = Number(segStart || 0) + orderIndex * stagger;
    const dt = Number(currentTime) - start;
    if (dt >= duration) return identity;
    if (dt < 0 && type === 'char_wave') return identity;

    const p = Math.max(0, Math.min(1, dt / duration));
    const fade = easeOutCubic(p);

    if (type === 'char_rise') {
        const eased = easeOutCubic(p);
        return { dx: 0, dy: (1 - eased) * 32 * strength, scaleX: 1, scaleY: 1, rotation: 0, opacity: eased };
    }

    if (type === 'char_elastic') {
        const eased = easeOutElastic(p);
        const amount = Math.min(0.55, 0.30 * strength);
        const scale = Math.max(0.25, 1 + (eased - 1) * amount);
        return { dx: 0, dy: 0, scaleX: scale, scaleY: scale, rotation: 0, opacity: fade };
    }

    if (type === 'char_wave') {
        const envelope = Math.sin(Math.PI * p);
        const dy = -20 * strength * envelope;
        const rotation = 0.035 * strength * Math.sin(Math.PI * 2 * p);
        return { dx: 0, dy, scaleX: 1, scaleY: 1, rotation, opacity: 1 };
    }

    if (type === 'char_drop') {
        const eased = easeOutBounce(p);
        return { dx: 0, dy: -(1 - eased) * 52 * strength, scaleX: 1, scaleY: 1, rotation: 0, opacity: Math.min(1, p * 3) };
    }

    if (type === 'char_squash') {
        const eased = easeOutBack(p);
        const delta = 1 - eased;
        const scaleX = Math.max(0.35, 1 + 0.30 * strength * delta);
        const scaleY = Math.max(0.35, 1 - 0.26 * strength * delta);
        return { dx: 0, dy: 0, scaleX, scaleY, rotation: 0, opacity: Math.min(1, p * 3) };
    }

    const eased = easeOutCubic(p);
    const targetCenterX = Number(options.targetCenterX || 0);
    const sentenceCenterX = Number(options.sentenceCenterX || 0);
    const spread = Math.min(1, 0.90 * strength);
    const dx = (sentenceCenterX - targetCenterX) * (1 - eased) * spread;
    const startScale = Math.max(0.68, 1 - 0.12 * strength);
    const scale = startScale + (1 - startScale) * eased;
    return { dx, dy: 0, scaleX: scale, scaleY: scale, rotation: 0, opacity: eased };
}

`;
  anim = anim.replace(functionAnchor, code + functionAnchor);
}

if (!anim.includes('    computeCharacterPresetTransform,')) {
  const exportAnchor = /^(\s*)computeLetterJumpScale,\s*$/m;
  const match = anim.match(exportAnchor);
  if (!match) throw new Error('computeLetterJumpScale export anchor missing');
  anim = anim.replace(exportAnchor, `${match[1]}computeLetterJumpScale,\n${match[1]}computeCharacterPresetTransform,`);
}

if (!anim.includes("['逐字上浮', 'char_rise']")
    || !anim.includes('function computeCharacterPresetTransform(')
    || !anim.includes('computeCharacterPresetTransform,')) {
  throw new Error('letter animation engine prepatch incomplete');
}

new vm.Script(anim, { filename: animPath });
write(animPath, anim);
console.log('[4.4.49-letter-engine] animation engine ready');
