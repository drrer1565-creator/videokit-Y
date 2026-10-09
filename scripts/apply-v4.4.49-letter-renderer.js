const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const rendererPath = path.join(root, 'src', 'reels-canvas-renderer.js');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function replaceOnce(source, pattern, replacement, label) {
  if (typeof pattern === 'string') {
    if (!source.includes(pattern)) throw new Error(`${label} marker missing`);
    return source.replace(pattern, replacement);
  }
  if (!pattern.test(source)) throw new Error(`${label} marker missing`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

let renderer = read(rendererPath);

if (!renderer.includes('V4_4_49_CHARACTER_FX_RENDER')) {
  renderer = replaceOnce(
    renderer,
    /(\s*const cbStagger = s\.char_bounce_stagger \|\| 0\.05;\n)/,
    `$1\n        // V4_4_49_CHARACTER_FX_RENDER\n        const characterFxTypes = ['char_rise', 'char_elastic', 'char_wave', 'char_drop', 'char_squash', 'char_center_spread'];\n        const isCharacterFx = characterFxTypes.includes(animInType);\n        const totalCharacterFxCount = Math.max(1, words.reduce((count, word) => count + Array.from(word).length, 0));\n        const charFxStrength = Math.max(0.5, Math.min(2.0, Number(s.char_fx_strength ?? 1.0)));\n        const charFxDuration = Math.max(0.12, Math.min(0.90, Number(s.char_fx_duration ?? 0.36)));\n        const requestedCharFxStagger = Math.max(0, Math.min(0.12, Number(s.char_fx_stagger ?? 0.035)));\n        const characterFxSegDur = Math.max(0.001, segEnd - segStart);\n        const maxCharFxStagger = totalCharacterFxCount > 1\n            ? Math.max(0, (characterFxSegDur - Math.min(characterFxSegDur, charFxDuration)) / (totalCharacterFxCount - 1))\n            : requestedCharFxStagger;\n        const charFxStagger = Math.min(requestedCharFxStagger, maxCharFxStagger);\n`,
    'character-fx flags'
  );

  renderer = replaceOnce(
    renderer,
    `        const needsPerWordStrokeExpand = s.only_show_active_word || isTypewriter || isMetronome ||\n            isWordPopRandom || isWordPopRandomPulse || isBullet;`,
    `        const needsPerWordStrokeExpand = s.only_show_active_word || isTypewriter || isMetronome ||\n            isWordPopRandom || isWordPopRandomPulse || isBullet || isCharacterFx;`,
    'expanded-stroke prepass'
  );

  renderer = replaceOnce(
    renderer,
    `        let wordCounter = 0;\n        let twCharCounter = 0;`,
    `        let wordCounter = 0;\n        let twCharCounter = 0;\n        let characterFxCounter = 0;`,
    'character counter'
  );

  renderer = replaceOnce(
    renderer,
    `                wordCounter++;\n                const wordIdx = wordCounter - 1;\n                const totalWordCount = Math.max(1, words.length);`,
    `                wordCounter++;\n                const wordIdx = wordCounter - 1;\n                const charFxOffset = characterFxCounter;\n                characterFxCounter += Array.from(wordStr).length;\n                const totalWordCount = Math.max(1, words.length);`,
    'word character offset'
  );

  renderer = replaceOnce(
    renderer,
    `                    if (s.stroke_expand_enabled && needsPerWordStrokeExpand) {`,
    `                    if (s.stroke_expand_enabled && needsPerWordStrokeExpand && !isCharacterFx) {`,
    'local expanded-stroke guard'
  );

  renderer = replaceOnce(
    renderer,
    `                    let currentShadowBlur = shadowBlur;\n                    let currentShadowColor = shadowColor;\n                    if (shadowColor && shadowColor.includes(',')) {\n                        const shadowColors = shadowColor.split(',').map(c => c.trim());\n                        currentShadowColor = isHighlight ? (shadowColors[1] || shadowColors[0]) : shadowColors[0];\n                    }\n\n                    if (typewriterPartial) {`,
    `                    let currentShadowBlur = shadowBlur;\n                    let currentShadowColor = shadowColor;\n                    if (shadowColor && shadowColor.includes(',')) {\n                        const shadowColors = shadowColor.split(',').map(c => c.trim());\n                        currentShadowColor = isHighlight ? (shadowColors[1] || shadowColors[0]) : shadowColors[0];\n                    }\n\n                    const characterFx = isCharacterFx ? {\n                        type: animInType,\n                        currentTime,\n                        segStart,\n                        charOffset: charFxOffset,\n                        totalChars: totalCharacterFxCount,\n                        strength: charFxStrength,\n                        duration: charFxDuration,\n                        stagger: charFxStagger,\n                        sentenceCenterX: cx,\n                    } : null;\n\n                    if (typewriterPartial) {`,
    'character-fx draw config'
  );

  renderer = replaceOnce(
    renderer,
    `                        this._drawWord(ctx, wordStr, drawX, wordY, wordColor,\n                            useStroke && !s.stroke_expand_enabled, wordStrokeColor, borderW, outlineAlpha,\n                            currentShadowBlur, shadowOffX, shadowOffY, currentShadowColor, shadowAlpha, letterSpacing, s, wordGradient);`,
    `                        this._drawWord(ctx, wordStr, drawX, wordY, wordColor,\n                            useStroke && (!s.stroke_expand_enabled || isCharacterFx), wordStrokeColor, borderW, outlineAlpha,\n                            currentShadowBlur, shadowOffX, shadowOffY, currentShadowColor, shadowAlpha, letterSpacing, s, wordGradient, characterFx);`,
    'normal word draw call'
  );
}

if (!renderer.includes('V4_4_49_CHARACTER_DRAW_WORD')) {
  const drawWordPattern = /(    _drawWord\(ctx, text, x, y, fillColor,\n\s*useStroke, strokeColor, strokeWidth, strokeAlpha,\n\s*shadowBlur, shadowOffX, shadowOffY, shadowColor, shadowAlpha, letterSpacing = 0, s = null, sharedGradient = null)\) \{\n\n\s*\/\/ Speed Trail \(motion blur \/ speed lines\)/;
  const match = renderer.match(drawWordPattern);
  if (!match) throw new Error('robust _drawWord signature marker missing');

  const signature = `${match[1]}, charAnim = null) {`;
  const block = `\n\n        // V4_4_49_CHARACTER_DRAW_WORD\n        // Render the six new letter presets character-by-character while reusing\n        // the existing fill/stroke/shadow pipeline for each transformed glyph.\n        const charEngine = (typeof ReelsAnimEngine !== 'undefined') ? ReelsAnimEngine : null;\n        if (charAnim && charEngine && typeof charEngine.computeCharacterPresetTransform === 'function' && text) {\n            const chars = Array.from(text);\n            const wordWidth = this._measureTextWithSpacing(ctx, text, letterSpacing);\n            const fontMatch = String(ctx.font || '').match(/(\\d+(?:\\.\\d+)?)px/);\n            const fontSize = fontMatch ? parseFloat(fontMatch[1]) : 80;\n            const centerY = y + fontSize * 0.5;\n\n            // If this is per-word gradient mode, create one gradient across the\n            // whole word before splitting it into glyphs. Sentence mode already\n            // provides sharedGradient and remains unchanged.\n            let animatedGradient = sharedGradient;\n            if (!animatedGradient && typeof fillColor === 'string' && fillColor.includes(',')) {\n                let gradientDirection = 'horizontal';\n                if (s) {\n                    gradientDirection = fillColor === s.color_high\n                        ? (s.high_gradient_direction || s.text_gradient_direction || 'horizontal')\n                        : (s.text_gradient_direction || 'horizontal');\n                }\n                animatedGradient = this._createTextGradient(ctx, fillColor, gradientDirection, {\n                    x, y, width: Math.max(1, wordWidth), height: Math.max(1, fontSize * 0.95)\n                });\n            }\n\n            let charX = x;\n            for (let localIndex = 0; localIndex < chars.length; localIndex++) {\n                const ch = chars[localIndex];\n                const charW = ctx.measureText(ch).width;\n                const charCenterX = charX + charW / 2;\n                const transform = charEngine.computeCharacterPresetTransform(\n                    charAnim.type, charAnim.currentTime, charAnim.segStart,\n                    (charAnim.charOffset || 0) + localIndex, charAnim.totalChars || chars.length,\n                    {\n                        strength: charAnim.strength,\n                        duration: charAnim.duration,\n                        stagger: charAnim.stagger,\n                        targetCenterX: charCenterX,\n                        sentenceCenterX: charAnim.sentenceCenterX,\n                    }\n                );\n\n                ctx.save();\n                ctx.globalAlpha *= Math.max(0, Math.min(1, Number(transform.opacity ?? 1)));\n                ctx.translate(charCenterX + Number(transform.dx || 0), centerY + Number(transform.dy || 0));\n                if (transform.rotation) ctx.rotate(Number(transform.rotation));\n                ctx.scale(Number(transform.scaleX || 1), Number(transform.scaleY || 1));\n                ctx.translate(-charCenterX, -centerY);\n                this._drawWord(ctx, ch, charX, y, fillColor,\n                    useStroke, strokeColor, strokeWidth, strokeAlpha,\n                    shadowBlur, shadowOffX, shadowOffY, shadowColor, shadowAlpha, 0, s, animatedGradient, null);\n                ctx.restore();\n                charX += charW + letterSpacing;\n            }\n            return;\n        }\n\n        // Speed Trail (motion blur / speed lines)`;

  renderer = renderer.replace(drawWordPattern, signature + block);
}

if (!renderer.includes('V4_4_49_CHARACTER_FX_RENDER')
    || !renderer.includes('V4_4_49_CHARACTER_DRAW_WORD')
    || !renderer.includes('charEngine.computeCharacterPresetTransform(')
    || !renderer.includes('characterFxCounter += Array.from(wordStr).length;')
    || !renderer.includes('wordGradient, characterFx);')) {
  throw new Error('4.4.49 renderer prepatch incomplete');
}

new vm.Script(renderer, { filename: rendererPath });
fs.writeFileSync(rendererPath, renderer, 'utf8');
console.log('[4.4.49-letter-renderer] character renderer ready');
