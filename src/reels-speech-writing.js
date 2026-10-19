/* VideoKit v4.4.57 — speech-synchronised title/body writing extension. */
(function () {
    'use strict';

    function graphemes(text) {
        text = String(text || '');
        return typeof Intl.Segmenter === 'function'
            ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), item => item.segment)
            : Array.from(text);
    }
    const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');

    function getSpeechWritingTokens(seg, text, syncSpeech = true) {
        const chars = graphemes(text);
        const start = Number(seg?.start) || 0;
        const end = Math.max(start + 0.001, Number(seg?.end) || start + 0.001);
        const duration = end - start;
        const fallback = chars.map((ch, i) => ({ text: ch, start: start + duration * i / Math.max(1, chars.length), end: start + duration * (i + 1) / Math.max(1, chars.length) }));
        if (!syncSpeech || !Array.isArray(seg?.words) || !seg.words.length) return fallback;
        const words = seg.words.map(w => ({ text: normalize(w.word ?? w.text), start: Number(w.start), end: Number(w.end) })).filter(w => w.text);
        if (!words.length || words.some((w, i) => !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end < w.start || (i && w.start < words[i - 1].end - 0.001))) return fallback;
        if (words.map(w => w.text).join('') !== chars.map(normalize).join('')) return fallback;
        let ci = 0;
        for (const word of words) {
            const indices = [];
            let collected = '';
            while (ci < chars.length && collected.length < word.text.length) {
                const n = normalize(chars[ci]);
                if (n) { indices.push(ci); collected += n; }
                ci++;
            }
            if (collected !== word.text) return fallback;
            indices.forEach((index, i) => {
                fallback[index].start = word.start + (word.end - word.start) * i / indices.length;
                fallback[index].end = word.start + (word.end - word.start) * (i + 1) / indices.length;
            });
        }
        let previous = words[0]?.start || start;
        for (const token of fallback) {
            if (!normalize(token.text)) token.start = token.end = previous;
            else previous = token.end;
        }
        return fallback;
    }

    function sentenceSpans(text) {
        text = String(text || '');
        const spans = [];
        const rx = /[^.!?。！？\n]+(?:[.!?。！？]+|\n+|$)/g;
        let match;
        while ((match = rx.exec(text))) {
            const value = match[0];
            if (value.trim()) spans.push({ text: value, startIndex: match.index, endIndex: match.index + value.length });
        }
        if (!spans.length && text.trim()) spans.push({ text, startIndex: 0, endIndex: text.length });
        return spans;
    }

    function getSplitWritingParts(segments, style = {}, originalScript = '') {
        const list = Array.isArray(segments) ? segments : [];
        const texts = list.map(seg => String(seg.edited_text ?? seg.text ?? ''));
        const spoken = texts.map(normalize).join('');
        const scriptTitle = sentenceSpans(originalScript)[0]?.text.trim();
        const custom = style.fullpage_typewriter_title_auto === false ? String(style.fullpage_typewriter_title_text || '').trim() : '';
        const candidate = custom || scriptTitle || sentenceSpans(texts.join(' '))[0]?.text.trim() || '';
        const boundary = normalize(candidate);
        if (!boundary) return { title: [], body: list.map(seg => ({ ...seg })), titleEnd: 0 };

        let consumed = 0;
        let titleStart = null;
        let titleEnd = 0;
        const titleWords = [];
        const body = [];
        for (let si = 0; si < list.length; si++) {
            const seg = list[si];
            const text = texts[si];
            const tokens = getSpeechWritingTokens(seg, text, style.fullpage_typewriter_speech_sync !== false);
            let cut = 0;
            let charsSeen = 0;
            for (const token of tokens) {
                const n = normalize(token.text);
                charsSeen += token.text.length;
                if (consumed < boundary.length) {
                    consumed += n.length;
                    cut = charsSeen;
                    if (n) {
                        if (titleStart == null) titleStart = token.start;
                        titleEnd = token.end;
                        titleWords.push({ word: token.text, start: token.start, end: token.end });
                    }
                }
            }
            if (cut < text.length) {
                const tail = text.slice(cut);
                const tailTokens = tokens.filter(token => token.end >= titleEnd - 0.0001 && normalize(token.text));
                body.push({ ...seg, text: tail, edited_text: tail, start: tailTokens[0]?.start ?? Math.max(Number(seg.start) || 0, titleEnd), words: tailTokens.map(t => ({ word: t.text, start: t.start, end: t.end })) });
            }
        }
        const titleText = candidate;
        const title = titleText ? [{ text: titleText, edited_text: titleText, start: titleStart ?? 0, end: titleEnd, words: titleWords }] : [];
        const titleDelay = Number(style.fullpage_typewriter_title_delay) || 0;
        const automatic = style.fullpage_typewriter_auto_sequence !== false;
        const gate = titleEnd + titleDelay;
        const shift = (seg, amount) => ({ ...seg, start: (Number(seg.start) || 0) + amount, end: (Number(seg.end) || 0) + amount, words: seg.words?.map(w => ({ ...w, start: Number(w.start) + amount, end: Number(w.end) + amount })) });
        const bodyDelay = automatic ? 0 : (Number(style.fullpage_typewriter_body_delay) || 0);
        const shiftedBody = body.map(seg => shift(seg, bodyDelay));
        if (automatic) {
            for (const seg of shiftedBody) {
                const delta = Math.max(0, gate - (Number(seg.start) || 0));
                if (delta) Object.assign(seg, shift(seg, delta));
            }
        }
        return { title: title.map(seg => shift(seg, titleDelay)), body: shiftedBody, titleEnd: gate };
    }

    function getWritingVisualStyle(style) {
        if (!style?.fullpage_typewriter || style.fullpage_typewriter_keep_background === false) return style;
        return { ...style, global_mask_enabled: false, ambient_lighting_enabled: false, ambient_glow_enabled: false };
    }

    const TIP_GLYPHS = {
        quill: '🪶', rose: '🌹', fountain_pen: '🖋️', brush: '🖌️', pencil: '✏️', sparkle_wand: '✨',
        butterfly: '🦋', candle_flame: '🕯️', dove: '🕊️', heart: '❤️', leaf: '🍃', sakura: '🌸', crown: '👑',
        music_note: '♪', cross_light: '✝', feather_gold: '🪶'
    };
    function isImageOrVectorWritingTip(kind) { return kind === 'image' || Object.prototype.hasOwnProperty.call(TIP_GLYPHS, kind); }

    const imageCache = new Map();
    async function loadWritingImage(source) {
        if (!source) throw new Error('请先上传出字图片。');
        if (imageCache.has(source)) return imageCache.get(source);
        const entry = { image: null, frames: null, duration: 0, promise: null };
        entry.promise = (async () => {
            if (/\.gif(?:[?#]|$)/i.test(source) && typeof ImageDecoder !== 'undefined' && window.electronAPI?.readWritingCursorImage) {
                const bytes = window.electronAPI.readWritingCursorImage(source);
                const decoder = new ImageDecoder({ data: new Uint8Array(bytes), type: 'image/gif', preferAnimation: true });
                const frames = [];
                let duration = 0;
                try {
                    await decoder.tracks.ready;
                    const count = decoder.tracks.selectedTrack?.frameCount || 1;
                    for (let i = 0; i < count; i++) {
                        const decoded = await decoder.decode({ frameIndex: i });
                        const bitmap = await createImageBitmap(decoded.image);
                        const frameDuration = Math.max(0.02, Number(decoded.image.duration || 100000) / 1000000);
                        duration += frameDuration;
                        frames.push({ image: bitmap, end: duration });
                        decoded.image.close();
                    }
                    entry.frames = frames; entry.duration = duration || 0.1;
                } finally { decoder.close(); }
                return entry;
            }
            const image = new Image();
            await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('出字图片无法读取')); image.src = window.electronAPI?.toFileUrl?.(source) || source; });
            entry.image = image;
            return entry;
        })();
        imageCache.set(source, entry);
        await entry.promise;
        return entry;
    }

    function drawTip(ctx, kind, x, y, size, angle, style, time) {
        if (!ctx || !kind) return;
        if (kind === 'image') {
            const entry = imageCache.get(style.fullpage_typewriter_cursor_image || '');
            let image = entry?.image;
            if (entry?.frames?.length) {
                const t = Math.max(0, Number(time) || 0) % entry.duration;
                image = (entry.frames.find(frame => t < frame.end) || entry.frames[entry.frames.length - 1]).image;
            }
            if (!image) return;
            const iw = image.naturalWidth || image.width || 1;
            const ih = image.naturalHeight || image.height || 1;
            const factor = size / Math.max(iw, ih);
            const w = iw * factor, h = ih * factor;
            const ax = Math.max(0, Math.min(100, Number(style.fullpage_typewriter_cursor_image_anchor_x ?? 50))) / 100;
            const ay = Math.max(0, Math.min(100, Number(style.fullpage_typewriter_cursor_image_anchor_y ?? 50))) / 100;
            ctx.save(); ctx.translate(x, y); ctx.rotate(angle * Math.PI / 180); ctx.drawImage(image, -w * ax, -h * ay, w, h); ctx.restore();
            return;
        }
        const glyph = TIP_GLYPHS[kind];
        if (!glyph) return;
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle * Math.PI / 180); ctx.font = `${Math.max(10, size)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`; ctx.textBaseline = 'bottom'; ctx.textAlign = 'center'; ctx.fillText(glyph, 0, 0); ctx.restore();
    }

    function install() {
        const Klass = window.ReelsCanvasRenderer;
        if (!Klass?.prototype || Klass.prototype.__v4457SpeechWritingInstalled) return;
        const proto = Klass.prototype;
        proto.__v4457SpeechWritingInstalled = true;

        const originalSetContext = proto.setContextSegments;
        proto.setContextSegments = function (segments, originalScript = '') {
            this._writingOriginalScript = originalScript || '';
            return originalSetContext.call(this, segments);
        };
        proto.prepareWritingCursorImage = async function (style) {
            if (style?.fullpage_typewriter_cursor_kind !== 'image') return;
            await loadWritingImage(style.fullpage_typewriter_cursor_image);
        };
        proto._drawSpeechWritingTip = function (style, position, time) {
            if (!position) return;
            const kind = style.fullpage_typewriter_cursor_kind || 'char';
            const scale = Math.max(0.2, Math.min(4, Number(style.fullpage_typewriter_cursor_scale) || 1));
            const x = position.x + (Number(style.fullpage_typewriter_cursor_offset_x) || 0);
            const y = position.y + position.size * 0.9 + (Number(style.fullpage_typewriter_cursor_offset_y) || 0);
            drawTip(this.ctx, kind, x, y, position.size * scale, Number(style.fullpage_typewriter_cursor_angle) || 0, style, time);
        };

        const originalRender = proto._renderFullpageTypewriter;
        proto._renderFullpageTypewriter = function (style, currentTime, videoW, videoH) {
            if (!style?.fullpage_typewriter_split || style._writingPart) return originalRender.call(this, style, currentTime, videoW, videoH);
            const originalSegments = this._contextSegments || [];
            const parts = getSplitWritingParts(originalSegments, style, this._writingOriginalScript || '');
            const common = { ...style, _writingPart: true, fullpage_typewriter_first_line_scale: 1, fullpage_typewriter_first_line_color: '', fullpage_typewriter_first_line_bold: false, _writingDeferCursor: true };
            let titlePos = null, bodyPos = null;
            try {
                if (parts.title.length) {
                    this._contextSegments = parts.title;
                    const titleStyle = { ...common,
                        font_family: style.fullpage_typewriter_title_font_follow !== false ? (style.font_family || 'Arial') : (style.fullpage_typewriter_title_font || style.font_family || 'Arial'),
                        font_weight: style.fullpage_typewriter_title_weight || 700,
                        fontsize: Number(style.fullpage_typewriter_title_size) || 56,
                        color_text: style.fullpage_typewriter_title_color || '#FFD700',
                        pos_x: (Number(style.fullpage_typewriter_title_x) || 50) / 100,
                        pos_y: (Number(style.fullpage_typewriter_title_y) || 20) / 100,
                        fullpage_typewriter_reveal_type: style.fullpage_typewriter_title_reveal || 'char',
                        fullpage_typewriter_cursor: style.fullpage_typewriter_title_cursor !== false,
                        use_stroke: style.fullpage_typewriter_title_stroke_independent ? style.fullpage_typewriter_title_stroke_enabled !== false : style.use_stroke,
                        color_outline: style.fullpage_typewriter_title_stroke_independent ? (style.fullpage_typewriter_title_stroke_color || '#3e2723') : style.color_outline,
                        border_width: style.fullpage_typewriter_title_stroke_independent ? (Number(style.fullpage_typewriter_title_stroke_width) || 0) : style.border_width,
                        use_box: style.fullpage_typewriter_title_box_enabled ?? style.use_box,
                        color_bg: style.fullpage_typewriter_title_box_color || style.color_bg,
                        opacity_bg: style.fullpage_typewriter_title_box_opacity ?? style.opacity_bg,
                    };
                    originalRender.call(this, titleStyle, currentTime, videoW, videoH);
                    titlePos = this._writingTipPosition;
                }
                if (parts.body.length) {
                    this._contextSegments = parts.body;
                    const bodyStyle = { ...common,
                        pos_x: (Number(style.fullpage_typewriter_body_x) || 50) / 100,
                        pos_y: (Number(style.fullpage_typewriter_body_y) || 60) / 100,
                        fullpage_typewriter_reveal_type: style.fullpage_typewriter_body_reveal || 'sentence',
                        fullpage_typewriter_cursor: style.fullpage_typewriter_body_cursor !== false,
                        use_stroke: style.fullpage_typewriter_body_stroke_independent ? style.fullpage_typewriter_body_stroke_enabled !== false : style.use_stroke,
                        color_outline: style.fullpage_typewriter_body_stroke_independent ? (style.fullpage_typewriter_body_stroke_color || '#3e2723') : style.color_outline,
                        border_width: style.fullpage_typewriter_body_stroke_independent ? (Number(style.fullpage_typewriter_body_stroke_width) || 0) : style.border_width,
                        use_box: style.fullpage_typewriter_body_box_enabled ?? style.use_box,
                        color_bg: style.fullpage_typewriter_body_box_color || style.color_bg,
                        opacity_bg: style.fullpage_typewriter_body_box_opacity ?? style.opacity_bg,
                    };
                    originalRender.call(this, bodyStyle, currentTime, videoW, videoH);
                    bodyPos = this._writingTipPosition;
                }
            } finally { this._contextSegments = originalSegments; }
            const useBody = parts.body.length && currentTime >= parts.titleEnd;
            const position = useBody && style.fullpage_typewriter_body_cursor !== false ? bodyPos : (style.fullpage_typewriter_title_cursor !== false ? titlePos : null);
            const kind = style.fullpage_typewriter_cursor_kind || 'char';
            if (kind !== 'char' && position) this._drawSpeechWritingTip(style, position, currentTime);
        };
    }

    Object.assign(window, { getSpeechWritingTokens, getSplitWritingParts, getWritingVisualStyle, isImageOrVectorWritingTip });
    install();
})();
