const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Export-only color handling. Preview code never imports this module.
// The cache key includes file metadata so replaced/updated source files are re-probed.
const colorProbeCache = new Map();

const UNKNOWN_VALUES = new Set(['', 'unknown', 'unspecified', 'reserved', 'n/a']);
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67', 'hlg']);
const WIDE_GAMUT_PRIMARIES = new Set(['bt2020', 'smpte431', 'smpte432']);

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

function _cleanColorValue(value) {
    const clean = String(value || '').trim().toLowerCase();
    return UNKNOWN_VALUES.has(clean) ? '' : clean;
}

function _readFirstFrameColor(ffprobePath, cleanPath) {
    try {
        const output = execFileSync(ffprobePath, [
            '-v', 'error',
            '-read_intervals', '%+#1',
            '-select_streams', 'v:0',
            '-show_frames',
            '-show_entries', 'frame=color_space,color_transfer,color_primaries,color_range,pix_fmt',
            '-of', 'json',
            cleanPath,
        ], {
            timeout: 15000,
            windowsHide: true,
            maxBuffer: 2 * 1024 * 1024,
        }).toString('utf8');
        return JSON.parse(output || '{}')?.frames?.[0] || {};
    } catch (_) {
        return {};
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
        isWideGamut: false,
        isHdr: false,
        probeFailed: false,
        probeSource: '',
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
        const values = {
            colorSpace: _cleanColorValue(stream.color_space),
            colorTransfer: _cleanColorValue(stream.color_transfer),
            colorPrimaries: _cleanColorValue(stream.color_primaries),
            colorRange: _cleanColorValue(stream.color_range),
            pixelFormat: _cleanColorValue(stream.pix_fmt),
        };

        // Some containers omit stream-level colour fields while the decoded frame still carries them.
        // Only probe one frame and only fill missing values, so good stream metadata always wins.
        const missingCore = !values.colorSpace || !values.colorTransfer || !values.colorPrimaries || !values.colorRange;
        let probeSource = 'stream';
        if (missingCore) {
            const frame = _readFirstFrameColor(ffprobePath, cleanPath);
            const frameValues = {
                colorSpace: _cleanColorValue(frame.color_space),
                colorTransfer: _cleanColorValue(frame.color_transfer),
                colorPrimaries: _cleanColorValue(frame.color_primaries),
                colorRange: _cleanColorValue(frame.color_range),
                pixelFormat: _cleanColorValue(frame.pix_fmt),
            };
            for (const field of Object.keys(values)) {
                if (!values[field] && frameValues[field]) values[field] = frameValues[field];
            }
            if (Object.values(frameValues).some(Boolean)) probeSource = 'stream+frame';
        }

        const isBt2020 = values.colorPrimaries === 'bt2020' || values.colorSpace.startsWith('bt2020');
        const isWideGamut = WIDE_GAMUT_PRIMARIES.has(values.colorPrimaries) || isBt2020;
        const isHdr = HDR_TRANSFERS.has(values.colorTransfer);
        const result = {
            path: cleanPath,
            ...values,
            isBt2020,
            isWideGamut,
            isHdr,
            probeFailed: false,
            probeSource,
        };
        colorProbeCache.set(key, result);
        return result;
    } catch (error) {
        const result = { ...empty, probeFailed: true, error: error.message || String(error) };
        colorProbeCache.set(key, result);
        return result;
    }
}

function _zscalePrimaries(value) {
    const v = _cleanColorValue(value);
    return new Set([
        'bt709', 'bt470m', 'bt470bg', 'smpte170m', 'smpte240m', 'film',
        'bt2020', 'smpte428', 'smpte431', 'smpte432', 'jedec-p22', 'ebu3213',
    ]).has(v) ? v : '';
}

function _zscaleTransfer(value) {
    const v = _cleanColorValue(value);
    if (v === 'hlg') return 'arib-std-b67';
    if (v === 'srgb') return 'iec61966-2-1';
    return new Set([
        'bt709', 'bt470m', 'bt470bg', 'smpte170m', 'smpte240m', 'linear',
        'log100', 'log316', 'bt2020-10', 'bt2020-12', 'smpte2084',
        'iec61966-2-4', 'iec61966-2-1', 'bt1361e', 'smpte428', 'arib-std-b67',
    ]).has(v) ? v : '';
}

function _zscaleMatrix(value, pixelFormat = '') {
    const v = _cleanColorValue(value);
    if (new Set([
        'gbr', 'bt709', 'fcc', 'bt470bg', 'smpte170m', 'smpte240m', 'ycgco',
        'bt2020nc', 'bt2020c', 'chroma-derived-nc', 'chroma-derived-c', 'ictcp',
    ]).has(v)) return v;

    // RGB pixel formats do not use a YUV matrix; declaring GBR is deterministic and safe.
    const pix = _cleanColorValue(pixelFormat);
    if (/^(gbr|rgb|bgr)/.test(pix)) return 'gbr';
    return '';
}

function _zscaleRange(value) {
    const v = _cleanColorValue(value);
    if (['tv', 'mpeg', 'limited'].includes(v)) return 'limited';
    if (['pc', 'jpeg', 'full'].includes(v)) return 'full';
    return '';
}

function buildSourceToBt709Filter(profile) {
    if (!profile) return '';

    const primaries = _zscalePrimaries(profile.colorPrimaries);
    const transfer = _zscaleTransfer(profile.colorTransfer);
    const matrix = _zscaleMatrix(profile.colorSpace, profile.pixelFormat);
    const range = _zscaleRange(profile.colorRange);
    const isHdr = HDR_TRANSFERS.has(_cleanColorValue(profile.colorTransfer));
    const isWideGamut = WIDE_GAMUT_PRIMARIES.has(_cleanColorValue(profile.colorPrimaries))
        || _cleanColorValue(profile.colorSpace).startsWith('bt2020')
        || profile.isBt2020 === true
        || profile.isWideGamut === true;

    // Normal BT.709 SDR stays on the existing export path; do not add an extra colour transform.
    if (!isHdr && !isWideGamut) return '';

    // Never guess missing colour metadata. A wrong matrix/transfer produces exactly the saturation
    // shift this path is meant to prevent. Incomplete/unsupported sources fall back to passthrough.
    if (!primaries || !transfer || !matrix || !range) return '';

    const input = `primariesin=${primaries}:transferin=${transfer}:matrixin=${matrix}:rangein=${range}`;

    if (isHdr) {
        // Match the visually verified HLG batch pipeline, but parameterise the actual detected input.
        // HLG/PQ: decode explicitly -> linear float -> BT.709 primaries -> Hable SDR tone-map -> BT.709 TV range.
        return [
            `zscale=${input}:transfer=linear:npl=100`,
            'format=gbrpf32le',
            'zscale=primaries=bt709',
            'tonemap=tonemap=hable:desat=0',
            'zscale=transfer=bt709:matrix=bt709:range=limited',
            'format=yuv420p',
        ].join(',');
    }

    // Wide-gamut SDR: explicit source metadata, gamut/matrix/range conversion only. No HDR tone-map.
    return [
        `zscale=${input}:primaries=bt709:transfer=bt709:matrix=bt709:range=limited`,
        'format=yuv420p',
    ].join(',');
}

// Backward-compatible name used by the 4.4.46 export patch and regression tests.
function buildBt2020ToBt709Filter(profile) {
    return buildSourceToBt709Filter(profile);
}

function getExportColorPlan(filePath, ffprobePath = 'ffprobe') {
    const profile = probeVideoColorProfile(filePath, ffprobePath);
    const filter = buildSourceToBt709Filter(profile);
    const metadataComplete = Boolean(
        _zscalePrimaries(profile.colorPrimaries)
        && _zscaleTransfer(profile.colorTransfer)
        && _zscaleMatrix(profile.colorSpace, profile.pixelFormat)
        && _zscaleRange(profile.colorRange)
    );
    const candidateForConversion = profile.isHdr || profile.isWideGamut || profile.isBt2020;
    let mode = 'passthrough';
    let reason = 'already-bt709-or-standard-sdr';
    if (filter) {
        mode = profile.isHdr ? 'hdr-to-bt709-sdr' : 'wide-gamut-sdr-to-bt709';
        reason = 'explicit-source-metadata';
    } else if (profile.probeFailed) {
        reason = 'probe-failed';
    } else if (candidateForConversion && !metadataComplete) {
        mode = 'metadata-incomplete-passthrough';
        reason = 'missing-or-unsupported-color-metadata';
    }

    return {
        ...profile,
        metadataComplete,
        needsConversion: Boolean(filter),
        mode,
        reason,
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
    if (!plan?.needsConversion) {
        return plan?.mode === 'metadata-incomplete-passthrough'
            ? 'wide-gamut/HDR metadata incomplete; passthrough to avoid guessing'
            : 'BT.709/standard SDR passthrough';
    }
    const source = [plan.colorPrimaries, plan.colorSpace, plan.colorTransfer, plan.colorRange, plan.pixelFormat]
        .filter(Boolean).join('/');
    return `${source || 'wide-gamut/HDR'} -> BT.709${plan.isHdr ? ' SDR tone-map' : ''}`;
}

module.exports = {
    normalizeMediaPath,
    probeVideoColorProfile,
    buildSourceToBt709Filter,
    buildBt2020ToBt709Filter,
    getExportColorPlan,
    describeColorPlan,
};
