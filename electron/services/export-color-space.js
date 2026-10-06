const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Export-only color handling. Preview code never imports this module.
// The cache key includes file metadata so replaced/updated source files are re-probed.
const colorProbeCache = new Map();

function normalizeMediaPath(filePath) {
    let value = String(filePath || '');
    value = value.replace(/^local-media:\/\//i, '').replace(/^file:\/\//i, '');
    try { value = decodeURIComponent(value); } catch (_) {}
    if (process.platform === 'win32' && /^\/[A-Za-z]:[\\/]/.test(value)) value = value.slice(1);
    return value;
}

function _cacheKey(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return `${filePath}|${stat.size}|${stat.mtimeMs}`;
    } catch (_) {
        return filePath;
    }
}

function probeVideoColorProfile(filePath, ffprobePath = 'ffprobe') {
    const cleanPath = normalizeMediaPath(filePath);
    const empty = {
        path: cleanPath,
        colorSpace: '',
        colorTransfer: '',
        colorPrimaries: '',
        colorRange: '',
        pixelFormat: '',
        isBt2020: false,
        isHdr: false,
        probeFailed: false,
    };
    if (!cleanPath || !fs.existsSync(cleanPath)) return { ...empty, probeFailed: true };

    const key = _cacheKey(cleanPath);
    if (colorProbeCache.has(key)) return colorProbeCache.get(key);

    try {
        const output = execFileSync(ffprobePath, [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=color_space,color_transfer,color_primaries,color_range,pix_fmt',
            '-of', 'json',
            cleanPath,
        ], {
            timeout: 15000,
            windowsHide: true,
            maxBuffer: 2 * 1024 * 1024,
        }).toString('utf8');
        const stream = JSON.parse(output || '{}')?.streams?.[0] || {};
        const colorSpace = String(stream.color_space || '').toLowerCase();
        const colorTransfer = String(stream.color_transfer || '').toLowerCase();
        const colorPrimaries = String(stream.color_primaries || '').toLowerCase();
        const colorRange = String(stream.color_range || '').toLowerCase();
        const pixelFormat = String(stream.pix_fmt || '').toLowerCase();
        const isBt2020 = colorPrimaries === 'bt2020' || colorSpace.startsWith('bt2020');
        const isHdr = isBt2020 && [
            'smpte2084',
            'arib-std-b67',
            'hlg',
        ].includes(colorTransfer);
        const result = {
            path: cleanPath,
            colorSpace,
            colorTransfer,
            colorPrimaries,
            colorRange,
            pixelFormat,
            isBt2020,
            isHdr,
            probeFailed: false,
        };
        colorProbeCache.set(key, result);
        return result;
    } catch (error) {
        const result = { ...empty, probeFailed: true, error: error.message || String(error) };
        colorProbeCache.set(key, result);
        return result;
    }
}

function buildBt2020ToBt709Filter(profile) {
    if (!profile?.isBt2020) return '';

    // HDR (PQ/HLG): linearize first, convert BT.2020 primaries to BT.709,
    // tone-map into SDR, then encode as limited-range BT.709.
    if (profile.isHdr) {
        return [
            'zscale=t=linear:npl=100',
            'format=gbrpf32le',
            'zscale=p=709',
            'tonemap=tonemap=hable:desat=0',
            'zscale=t=709:m=709:r=limited',
            'format=yuv420p',
        ].join(',');
    }

    // SDR BT.2020: gamut/matrix conversion only. Do not apply HDR tone mapping.
    return [
        'zscale=p=709:t=709:m=709:r=limited',
        'format=yuv420p',
    ].join(',');
}

function getExportColorPlan(filePath, ffprobePath = 'ffprobe') {
    const profile = probeVideoColorProfile(filePath, ffprobePath);
    const filter = buildBt2020ToBt709Filter(profile);
    return {
        ...profile,
        needsConversion: Boolean(filter),
        mode: filter ? (profile.isHdr ? 'bt2020-hdr-to-bt709-sdr' : 'bt2020-sdr-to-bt709') : 'passthrough',
        filter,
        outputArgs: filter ? [
            '-color_range', 'tv',
            '-colorspace', 'bt709',
            '-color_primaries', 'bt709',
            '-color_trc', 'bt709',
        ] : [],
    };
}

function describeColorPlan(plan) {
    if (!plan?.needsConversion) return 'BT.709/other passthrough';
    const source = [plan.colorPrimaries, plan.colorSpace, plan.colorTransfer, plan.pixelFormat]
        .filter(Boolean).join('/');
    return `${source || 'BT.2020'} -> BT.709${plan.isHdr ? ' SDR tone-map' : ''}`;
}

module.exports = {
    normalizeMediaPath,
    probeVideoColorProfile,
    buildBt2020ToBt709Filter,
    getExportColorPlan,
    describeColorPlan,
};
