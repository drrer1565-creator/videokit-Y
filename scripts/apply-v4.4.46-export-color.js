const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const ffmpegPath = path.join(root, 'electron', 'services', 'ffmpeg.js');
const rawPath = path.join(root, 'electron', 'services', 'ffmpeg-rawvideo.js');
const mainPath = path.join(root, 'electron', 'main.js');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, before, after) {
  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[4.4.46] patched ${path.relative(root, file)}`);
  } else {
    console.log(`[4.4.46] no changes needed for ${path.relative(root, file)}`);
  }
}
function syntax(source, file) { new vm.Script(source, { filename: file }); }

// ─────────────────────────────────────────────────────────────
// ffmpeg.js: fallback compose path. Color conversion is placed before ASS.
// ─────────────────────────────────────────────────────────────
let ffBefore = read(ffmpegPath);
let ff = ffBefore;
if (!ff.includes('V4_4_46_EXPORT_COLOR_BEFORE_SUBTITLES')) {
  ff = ff.replace(
    "const { formatMediaError, formatProcessStartError } = require('./media-error');",
    "const { formatMediaError, formatProcessStartError } = require('./media-error');\nconst { getExportColorPlan, describeColorPlan } = require('./export-color-space');"
  );

  const imageMarker = "    const imageBackground = isImageMedia(backgroundPath);\n";
  if (!ff.includes(imageMarker)) throw new Error('composeReel imageBackground marker missing');
  ff = ff.replace(imageMarker, imageMarker + [
    "    // V4_4_46_EXPORT_COLOR_BEFORE_SUBTITLES: inspect only when the user actually exports.",
    "    // Preview/import paths remain untouched. For BT.2020, conversion happens before ASS rendering.",
    "    const exportColorPlan = imageBackground",
    "        ? { needsConversion: false, filter: '', outputArgs: [] }",
    "        : getExportColorPlan(backgroundPath, resolveCommand('ffprobe'));",
    "    const exportColorPrefix = exportColorPlan.needsConversion ? `${exportColorPlan.filter},` : '';",
    "    if (exportColorPlan.needsConversion) {",
    "        console.log(`[composeReel] Export color conversion: ${describeColorPlan(exportColorPlan)}`);",
    "    }",
  ].join('\n') + '\n');

  ff = ff.replace(
    "            const filterGraph = ['[0:v]setpts=PTS-STARTPTS[v0]'];",
    "            const filterGraph = [`[0:v]${exportColorPrefix}setpts=PTS-STARTPTS[v0]`];"
  );
  ff = ff.replace(
    "                filterGraph.push(`[${i}:v]setpts=PTS-STARTPTS[${inLabel}]`);",
    "                filterGraph.push(`[${i}:v]${exportColorPrefix}setpts=PTS-STARTPTS[${inLabel}]`);"
  );

  ff = ff.replace(
    "            const vf = forcePortrait ? `${portraitCoverFilter},${subtitleFilter}` : subtitleFilter;",
    "            const vf = `${exportColorPrefix}${forcePortrait ? `${portraitCoverFilter},` : ''}${subtitleFilter}`;"
  );
  ff = ff.replace(
    "                '-vf', forcePortrait ? `${portraitCoverFilter},${subtitleFilter}` : subtitleFilter,",
    "                '-vf', `${exportColorPrefix}${forcePortrait ? `${portraitCoverFilter},` : ''}${subtitleFilter}`,"
  );

  const outputMarker = "        '-pix_fmt', 'yuv420p',\n        '-c:a', 'aac',";
  if (!ff.includes(outputMarker)) throw new Error('composeReel output marker missing');
  ff = ff.replace(outputMarker,
    "        '-pix_fmt', 'yuv420p',\n" +
    "        '-color_range', 'tv',\n" +
    "        '-colorspace', 'bt709',\n" +
    "        '-color_primaries', 'bt709',\n" +
    "        '-color_trc', 'bt709',\n" +
    "        '-c:a', 'aac',"
  );

  const exportMarker = "    escapeAssPathForFilter,\n    formatMediaError,";
  if (!ff.includes(exportMarker)) throw new Error('ffmpeg module export marker missing');
  ff = ff.replace(exportMarker,
    "    escapeAssPathForFilter,\n    getExportColorPlan,\n    describeColorPlan,\n    formatMediaError,"
  );
}
if (!ff.includes('V4_4_46_EXPORT_COLOR_BEFORE_SUBTITLES') || !ff.includes('getExportColorPlan(backgroundPath')) {
  throw new Error('composeReel BT.2020 export patch incomplete');
}
syntax(ff, ffmpegPath);
write(ffmpegPath, ffBefore, ff);

// ─────────────────────────────────────────────────────────────
// ffmpeg-rawvideo.js: main WYSIWYG path. Convert source video to BT.709
// while preparing frames, before Canvas renders subtitles. The alpha fast path
// converts the source background before overlaying the Canvas foreground.
// ─────────────────────────────────────────────────────────────
let rawBefore = read(rawPath);
let raw = rawBefore;
if (!raw.includes('V4_4_46_WYSIWYG_EXPORT_COLOR')) {
  raw = raw.replace(
    "const { formatMediaError, formatProcessStartError } = require('./media-error');",
    "const { formatMediaError, formatProcessStartError } = require('./media-error');\nconst { getExportColorPlan, describeColorPlan } = require('./export-color-space');"
  );

  const normalizeMarker = "function normalizeDisplayAspectFilter() {\n    return 'scale=trunc(iw*sar/2)*2:ih:flags=lanczos,setsar=1';\n}\n\n";
  if (!raw.includes(normalizeMarker)) throw new Error('rawvideo normalizeDisplayAspectFilter marker missing');
  raw = raw.replace(normalizeMarker, normalizeMarker + [
    '// V4_4_46_WYSIWYG_EXPORT_COLOR: export-only source conversion before Canvas subtitle rendering.',
    'function exportColorAwareFilter(filePath, baseFilter) {',
    '    if (!filePath || isImageMedia(filePath)) return baseFilter;',
    "    const plan = getExportColorPlan(filePath, findFFprobe());",
    '    if (!plan.needsConversion) return baseFilter;',
    '    console.log(`[WYSIWYG-COLOR] ${path.basename(filePath)}: ${describeColorPlan(plan)}`);',
    '    return `${plan.filter},${baseFilter}`;',
    '}',
    '',
  ].join('\n'));

  // Single background paths all receive the conversion before scale/crop/frame extraction.
  raw = raw.replace(
    "            const filterParts = [`[0:v]${scaleCropFilter},${ptsFilter}[v0]`];",
    "            const singleBgFilter = exportColorAwareFilter(backgroundPath, scaleCropFilter);\n            const filterParts = [`[0:v]${singleBgFilter},${ptsFilter}[v0]`];"
  );
  raw = raw.replace(
    "                filterParts.push(`[${i}:v]${scaleCropFilter},${ptsFilter}[${inLabel}]`);",
    "                filterParts.push(`[${i}:v]${singleBgFilter},${ptsFilter}[${inLabel}]`);"
  );
  raw = raw.replace(
    /extractSimpleLoop\(ffmpeg, backgroundPath, framesDir, scaleCropFilter, fps, duration, ptsFactor,/g,
    "extractSimpleLoop(ffmpeg, backgroundPath, framesDir, exportColorAwareFilter(backgroundPath, scaleCropFilter), fps, duration, ptsFactor,"
  );

  // Multi-background clips can mix BT.709 and BT.2020, so probe each actual input independently.
  raw = raw.replace(
    "                    const normalizeVideoFilter = `${scaleCropFilter},fps=${fps},setsar=1,format=yuv420p,settb=AVTB,${clipPtsFilter}`;",
    "                    const clipBaseFilter = exportColorAwareFilter(clip.path, scaleCropFilter);\n                    const normalizeVideoFilter = `${clipBaseFilter},fps=${fps},setsar=1,format=yuv420p,settb=AVTB,${clipPtsFilter}`;"
  );
  raw = raw.replace(
    /extractSimpleLoopWithTrim\(ffmpeg, clip\.path, framesDir, scaleCropFilter, fps,/g,
    "extractSimpleLoopWithTrim(ffmpeg, clip.path, framesDir, exportColorAwareFilter(clip.path, scaleCropFilter), fps,"
  );

  // Content/overlay video frames are also converted before Canvas composition. GIF remains RGBA as-is.
  const overlayVf = "        '-vf', isAnimatedGif ? `format=rgba,${normalizeDisplayAspectFilter()}` : normalizeDisplayAspectFilter(),";
  if (!raw.includes(overlayVf)) throw new Error('prepareOverlay vf marker missing');
  raw = raw.replace(overlayVf,
    "        '-vf', isAnimatedGif ? `format=rgba,${normalizeDisplayAspectFilter()}` : exportColorAwareFilter(overlayPath, normalizeDisplayAspectFilter()),"
  );

  // Direct alpha-background fast path: convert the original background before Canvas foreground overlay.
  const directFn = "function normalizedDirectBackgroundFilter(inputIndex, scaleCropFilter, ptsFilter, fps, outputLabel) {\n    const safeFps = Math.max(1, Number(fps) || 30);\n    return `[${inputIndex}:v]${scaleCropFilter},${ptsFilter},fps=${safeFps},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[${outputLabel}]`;\n}";
  if (!raw.includes(directFn)) throw new Error('normalizedDirectBackgroundFilter marker missing');
  raw = raw.replace(directFn,
    "function normalizedDirectBackgroundFilter(inputIndex, sourcePath, scaleCropFilter, ptsFilter, fps, outputLabel) {\n" +
    "    const safeFps = Math.max(1, Number(fps) || 30);\n" +
    "    const sourceFilter = exportColorAwareFilter(sourcePath, scaleCropFilter);\n" +
    "    return `[${inputIndex}:v]${sourceFilter},${ptsFilter},fps=${safeFps},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[${outputLabel}]`;\n" +
    "}"
  );
  raw = raw.replace(
    /normalizedDirectBackgroundFilter\(i, scaleCropFilter, ptsFilter, fps,/g,
    "normalizedDirectBackgroundFilter(i, opts.alphaOverlayBgPath, scaleCropFilter, ptsFilter, fps,"
  );
  raw = raw.replace(
    /normalizedDirectBackgroundFilter\(0, scaleCropFilter, ptsFilter, fps,/g,
    "normalizedDirectBackgroundFilter(0, opts.alphaOverlayBgPath, scaleCropFilter, ptsFilter, fps,"
  );
}
if (!raw.includes('V4_4_46_WYSIWYG_EXPORT_COLOR') || !raw.includes('exportColorAwareFilter(clip.path')) {
  throw new Error('WYSIWYG BT.2020 export patch incomplete');
}
if (!raw.includes('normalizedDirectBackgroundFilter(0, opts.alphaOverlayBgPath')) {
  throw new Error('Alpha fast path does not carry export color conversion');
}
syntax(raw, rawPath);
write(rawPath, rawBefore, raw);

// ─────────────────────────────────────────────────────────────
// main.js burn-subtitles fallback: same ordering, color first and ASS second.
// ─────────────────────────────────────────────────────────────
let mainBefore = read(mainPath);
let main = mainBefore;
if (!main.includes('V4_4_46_BURN_SUBTITLES_COLOR_FIRST')) {
  const argsMarker = "            const args = [\n                '-i', videoPath,\n                '-vf', `ass='${ffmpegService.escapeAssPathForFilter(assPath)}'`,";
  if (!main.includes(argsMarker)) throw new Error('burn-subtitles args marker missing');
  main = main.replace(argsMarker, [
    "            // V4_4_46_BURN_SUBTITLES_COLOR_FIRST: export-only BT.2020 conversion before libass.",
    "            const colorPlan = ffmpegService.getExportColorPlan(videoPath, ffmpegService.resolveCommand('ffprobe'));",
    "            const assFilter = `ass='${ffmpegService.escapeAssPathForFilter(assPath)}'`;",
    "            const videoFilter = colorPlan.needsConversion ? `${colorPlan.filter},${assFilter}` : assFilter;",
    "            if (colorPlan.needsConversion) log(`[Reels] Export color conversion: ${ffmpegService.describeColorPlan(colorPlan)}`);",
    "            const args = [",
    "                '-i', videoPath,",
    "                '-vf', videoFilter,",
  ].join('\n'));

  const mainOut = "                ...encoderArgs,\n                '-y',\n                outputPath";
  if (!main.includes(mainOut)) throw new Error('burn-subtitles output marker missing');
  main = main.replace(mainOut,
    "                ...encoderArgs,\n" +
    "                '-pix_fmt', 'yuv420p',\n" +
    "                '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',\n" +
    "                '-y',\n                outputPath"
  );
}
if (!main.includes('V4_4_46_BURN_SUBTITLES_COLOR_FIRST')) throw new Error('burn-subtitles BT.2020 patch incomplete');
syntax(main, mainPath);
write(mainPath, mainBefore, main);

console.log('[4.4.46] Export-time BT.2020 -> BT.709 conversion is ready; preview remains unchanged.');
