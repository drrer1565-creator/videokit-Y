/* VideoKit v4.4.57 — speech-synchronised title/body writing extension. */
(function () {
    'use strict';

function getWritingGraphemes(text) {
    return typeof Intl.Segmenter === 'function'
        ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), item => item.segment)
        : Array.from(text);
}
function repairCollapsedWritingSegments(segments,totalDuration=0) {
    const first=segments.findIndex(seg=>String(seg.edited_text??seg.text??'').trim()&&!(Number(seg.end)>Number(seg.start)+.0001));
    if(first<0)return segments;
    // Only repair a collapsed trailing run; retain every valid earlier timestamp.
    if(segments.slice(first).some(seg=>Number(seg.end)>Number(seg.start)+.0001))return segments;
    const weight=text=>Math.max(1,getWritingGraphemes(String(text)).filter(ch=>!/^\s+$/.test(ch)).length);
    let index=first;
    const prior=segments.slice(0,first).filter(s=>Number(s.end)>Number(s.start));
    const typical=prior.reduce((n,s)=>n+Number(s.end)-Number(s.start),0)/Math.max(1,prior.length);
    if(first>0&&Number(segments[first-1].end)-Number(segments[first-1].start)<typical*.5)index--;
    const tail=segments.slice(index),start=Number(tail[0].start)||0;
    const units=tail.reduce((n,s)=>n+weight(s.edited_text??s.text??''),0);
    const good=segments.slice(0,index),seconds=good.reduce((n,s)=>n+Math.max(0,Number(s.end)-Number(s.start)),0),letters=good.reduce((n,s)=>n+weight(s.edited_text??s.text??''),0);
    const rate=letters?seconds/letters:.075;
    const end=Number(totalDuration)>start+.1?Number(totalDuration):start+Math.max(.1,units*rate);
    let cursor=start;
    return [...good,...tail.map((seg,i)=>{
        const begin=cursor;cursor=i===tail.length-1?end:cursor+(end-start)*weight(seg.edited_text??seg.text??'')/units;
        const words=seg.words?.map(word=>({...word}));
        if(words?.length){const count=words.reduce((n,w)=>n+weight(w.word??w.text??''),0);let t=begin;for(const word of words){word.start=t;t+=(cursor-begin)*weight(word.word??word.text??'')/count;word.end=t;}words[words.length-1].end=cursor;}
        return {...seg,start:begin,end:cursor,...(words?{words}:{}),_writingTimingEstimated:true};
    })];
}
function getSpeechWritingTokens(seg, text, syncSpeech) {
    const glyphs = getWritingGraphemes(text);
    const start = Number(seg.start) || 0;
    const duration = Math.max(.001, (Number(seg.end) || 0) - start);
    const tokens = glyphs.map((text, i) => ({ text, start: start + duration * i / glyphs.length, end: start + duration * (i + 1) / glyphs.length }));
    if (!syncSpeech || !Array.isArray(seg.words) || !seg.words.length) return tokens;
    const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');
    const words = seg.words.map(w => ({ text: normalize(w.word ?? w.text), start: Number(w.start), end: Number(w.end) })).filter(w => w.text);
    // Only reuse speech timestamps if they still describe the edited script.
    // An SRT or changed script falls back to sentence timing rather than stale words.
    if (!words.length || words.map(w => w.text).join('') !== glyphs.map(normalize).join('') ||
        words.some((w, i) => !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end < w.start || (i && w.start < words[i-1].end - .001))) return tokens;
    let gi = 0;
    for (const word of words) {
        const indices = [];let collected = '';
        while (gi < glyphs.length && collected.length < word.text.length) {
            const normalized = normalize(glyphs[gi]);
            if (normalized) { indices.push(gi); collected += normalized; }
            gi++;
        }
        if (collected !== word.text) return tokens;
        indices.forEach((index, i) => {
            tokens[index].start = word.start + (word.end - word.start) * i / indices.length;
            tokens[index].end = word.start + (word.end - word.start) * (i + 1) / indices.length;
        });
    }
    let previousEnd = words[0].start;
    for (const tok of tokens) {
        if (!normalize(tok.text)) { tok.start = previousEnd; tok.end = previousEnd; }
        else previousEnd = tok.end;
    }
    return tokens;
}

const BUILTIN_WRITING_TIP_KINDS = new Set([
    'quill', 'rose', 'fountain_pen', 'brush', 'pencil', 'sparkle_wand',
    'butterfly', 'candle_flame', 'dove', 'heart', 'leaf', 'sakura',
    'crown', 'music_note', 'cross_light', 'feather_gold'
]);
function isImageOrVectorWritingTip(kind) {
    return kind === 'image' || BUILTIN_WRITING_TIP_KINDS.has(kind);
}
if (typeof window !== 'undefined') {
    window.isImageOrVectorWritingTip = isImageOrVectorWritingTip;
}

// The origin is the writing tip. Size/rotation always pivot around that point.
function drawSpeechWritingTip(ctx, kind, x, y, size, angle) {
    ctx.save();
    ctx.translate(x, y);ctx.rotate(angle * Math.PI / 180);ctx.scale(size, size);
    ctx.lineCap = 'round';ctx.lineJoin = 'round';
    const shape = (data, fill, stroke, width = .025) => {
        const p = new Path2D(data);if (fill) { ctx.fillStyle = fill;ctx.fill(p); }
        if (stroke) { ctx.strokeStyle = stroke;ctx.lineWidth = width;ctx.stroke(p); }
    };
    if (kind === 'rose') {
        shape('M0 0 Q.21-.22 .48-.73', null, '#26743c', .045);
        shape('M.19-.27 Q-.09-.47 .04-.61 Q.29-.56 .27-.38 Z', '#39854b', '#17532b', .015);
        shape('M.31-.46 Q.64-.43 .64-.61 Q.37-.67 .31-.46 Z', '#459853', '#17532b', .015);
        shape('M.35-.7 L.37-.88 L.62-.88 L.65-.7 L.5-.62 Z', '#2b7139', null);
        shape('M.32-.72 C.08-.8 .16-1.09 .37-1.03 C.37-1.24 .7-1.24 .71-1.03 C.97-1.08 1-.78 .78-.7 C.67-.5 .41-.55 .32-.72 Z', '#ba173a', '#780e2b', .018);
        shape('M.26-.95 Q.43-.85 .51-.7 Q.43-1.17 .68-1.13 Q.86-.98 .66-.76 Q.82-.88 .88-.91', null, '#f2667f', .035);
        shape('M.43-.92 Q.53-1.03 .65-.94 Q.68-.81 .52-.78 Q.45-.81 .49-.9', '#dc3653', '#8c1734', .02);
    } else if (kind === 'fountain_pen') {
        // 🖋️ 复古黑金钢笔尖
        shape('M.30-.50 L.88-1.08 C.96-1.14 1.06-1.04 1.00-.96 L.42-.38 Z', '#1e2430', '#d4af37', .022);
        shape('M.23-.43 L.43-.23 L.51-.31 L.31-.51 Z', '#ffd700', '#92400e', .016);
        shape('M0 0 L.09-.33 L.25-.41 L.41-.25 L.33-.09 Z', '#f5c542', '#7a5813', .018);
        shape('M0 0 L.20-.20', null, '#3d2b07', .016);
        shape('M.18-.22 A.035 .035 0 1 1 .22-.18 A.035 .035 0 1 1 .18-.22 Z', '#3d2b07', null);
    } else if (kind === 'brush') {
        // 🖌️ 东方水墨毛笔
        shape('M.34-.54 L.92-1.12 C.99-1.17 1.07-1.09 1.02-1.02 L.44-.44 Z', '#c89d54', '#6b4c1b', .02);
        shape('M.58-.78 L.68-.68 M.74-.94 L.84-.84', null, '#6b4c1b', .022);
        shape('M.23-.43 L.37-.29 L.47-.39 L.33-.53 Z', '#b91c1c', '#fbbf24', .016);
        shape('M0 0 C.04-.19 .11-.36 .25-.44 C.38-.33 .43-.22 .35-.10 C.24-.02 .10 0 0 0 Z', '#f5f0e6', '#6e6558', .016);
        shape('M0 0 C.03-.12 .08-.23 .17-.30 C.24-.24 .26-.15 .20-.07 C.12-.02 .05 0 0 0 Z', '#1f242d', '#111827', .012);
    } else if (kind === 'pencil') {
        // ✏️ 经典木质铅笔
        shape('M.86-1.00 C.94-1.08 1.06-.96 .98-.88 L.90-.80 L.78-.92 Z', '#f472b6', '#be185d', .018);
        shape('M.72-.86 L.80-.94 L.92-.82 L.84-.74 Z', '#cbd5e1', '#475569', .016);
        shape('M.22-.36 L.72-.86 L.84-.74 L.34-.24 Z', '#fbbf24', '#b45309', .018);
        shape('M.28-.30 L.78-.80', null, '#d97706', .016);
        shape('M.09-.23 L.22-.36 L.34-.24 L.23-.09 Z', '#f3d2a2', '#9c7644', .015);
        shape('M0 0 L.09-.23 L.23-.09 Z', '#2d3138', '#111827', .014);
    } else if (kind === 'sparkle_wand') {
        // ✨ 星光魔法棒
        shape('M.24-.24 L.94-.94', null, '#b45309', .06);
        shape('M.24-.24 L.94-.94', null, '#fde047', .028);
        shape('M0 0 L.15-.21 L.03-.35 L.21-.29 L.35-.47 L.29-.27 L.47-.21 L.27-.15 Z', '#fde047', '#ca8a04', .018);
        shape('M.13-.15 L.21-.23 L.29-.15 L.21-.07 Z', '#ffffff', null);
        shape('M.56-.28 L.61-.37 L.70-.32 L.61-.23 Z', '#fef08a', '#eab308', .012);
        shape('M.26-.60 L.31-.71 L.42-.66 L.31-.55 Z', '#fef08a', '#eab308', .012);
    } else if (kind === 'butterfly') {
        // 🦋 灵动金粉蝴蝶
        shape('M.20-.22 C.02-.54 .18-.96 .52-.88 C.78-.82 .82-.44 .46-.28 Z', '#60a5fa', '#1e3a8a', .02);
        shape('M.24-.28 C.14-.48 .26-.76 .48-.72 C.64-.68 .64-.46 .42-.32 Z', '#fbbf24', null);
        shape('M.22-.20 C.48-.34 .88-.28 .84-.04 C.80 .16 .44 .12 .22-.20 Z', '#93c5fd', '#1e3a8a', .018);
        shape('M.30-.18 C.48-.26 .70-.22 .68-.06 C.65 .06 .44 .04 .30-.18 Z', '#f472b6', null);
        shape('M.04-.04 L.36-.36', null, '#451a03', .035);
        shape('M.06-.06 Q-.05-.22 .03-.32 M.06-.06 Q.22 .04 .32-.04', null, '#451a03', .015);
    } else if (kind === 'candle_flame') {
        // 🕯️ 温暖摇曳烛火
        shape('M.18-.03 C-.08-.22 -.06-.64 .22-.95 C.48-.64 .50-.22 .18-.03 Z', 'rgba(251,146,60,0.34)', null);
        shape('M0 0 L.18-.12', null, '#78350f', .028);
        shape('M.18-.08 C.01-.24 .03-.56 .22-.82 C.39-.56 .41-.24 .18-.08 Z', '#f97316', '#c2410c', .018);
        shape('M.18-.12 C.07-.26 .09-.48 .21-.66 C.32-.48 .33-.26 .18-.12 Z', '#fde047', null);
        shape('M.18-.14 C.13-.22 .14-.34 .20-.44 C.26-.34 .26-.22 .18-.14 Z', '#ffffff', null);
    } else if (kind === 'dove') {
        // 🕊️ 圣洁和平白鸽
        shape('M0 0 Q.14-.06 .26-.18', null, '#15803d', .024);
        shape('M.06-.03 Q.04-.13 .13-.11 Q.11-.02 .06-.03 Z M.14-.09 Q.23-.07 .21-.16 Q.13-.15 .14-.09 Z', '#22c55e', null);
        shape('M.38-.26 C.32-.58 .54-.90 .88-.96 C.84-.66 .68-.42 .52-.24 Z', '#e2e8f0', '#64748b', .018);
        shape('M.30-.22 C.18-.50 .34-.80 .66-.86 C.64-.58 .52-.38 .40-.22 Z', '#ffffff', '#64748b', .018);
        shape('M.18-.16 C.12-.24 .18-.36 .28-.34 C.36-.32 .40-.24 .48-.26 C.66-.30 .88-.22 .98-.08 C.82-.05 .68-.07 .56-.01 C.38 .05 .24-.06 .18-.16 Z', '#ffffff', '#64748b', .018);
        shape('M.11-.13 L.19-.19 L.18-.11 Z', '#f59e0b', null);
        shape('M.22-.26 A.02 .02 0 1 1 .24-.24 Z', '#1e293b', null);
    } else if (kind === 'heart') {
        // ❤️ 立体发光红心
        shape('M0 0 C-.08-.34 -.38-.66 -.18-.90 C-.02-1.08 .22-.94 .26-.74 C.42-.92 .72-.94 .80-.70 C.90-.42 .44-.14 0 0 Z', '#e11d48', '#881337', .022);
        shape('M.05-.08 C-.02-.34 -.26-.60 -.11-.79 C.01-.93 .20-.82 .24-.64 C.38-.79 .61-.81 .68-.62 C.76-.39 .39-.17 .05-.08 Z', '#fb7185', null);
        shape('M-.08-.62 C-.12-.72 -.04-.82 .06-.78', null, '#ffe4e6', .038);
    } else if (kind === 'leaf') {
        // 🍃 清新翠绿嫩叶
        shape('M0 0 C.06-.38 .32-.78 .84-.92 C.82-.42 .48-.10 0 0 Z', '#22c55e', '#14532d', .02);
        shape('M0 0 C.06-.38 .32-.78 .84-.92 C.52-.56 .26-.28 0 0 Z', '#4ade80', null);
        shape('M0 0 Q.38-.46 .78-.86 M.24-.26 L.20-.46 M.42-.44 L.38-.66 M.30-.32 L.50-.30', null, '#15803d', .02);
        shape('M.48-.24 A.045 .045 0 1 1 .52-.20 A.045 .045 0 1 1 .48-.24 Z', '#e0f2fe', '#0284c7', .01);
    } else if (kind === 'sakura') {
        // 🌸 浪漫粉白樱花
        shape('M0 0 C.02-.16 .15-.26 .27-.21 L.22-.14 L.28-.10 C.21-.02 .09 .02 0 0 Z', '#fbcfe8', '#db2777', .015);
        shape('M.48-.52 C.30-.62 .26-.84 .40-.92 L.46-.84 L.52-.92 C.64-.84 .62-.62 .48-.52 Z', '#f9a8d4', '#be185d', .016);
        shape('M.48-.52 C.60-.68 .82-.70 .88-.56 L.80-.50 L.88-.44 C.80-.32 .58-.36 .48-.52 Z', '#fbcfe8', '#be185d', .016);
        shape('M.48-.52 C.62-.38 .64-.16 .50-.10 L.46-.18 L.40-.10 C.28-.18 .32-.38 .48-.52 Z', '#f9a8d4', '#be185d', .016);
        shape('M.48-.52 C.34-.38 .14-.36 .08-.50 L.16-.54 L.08-.60 C.16-.72 .36-.66 .48-.52 Z', '#fbcfe8', '#be185d', .016);
        shape('M.44-.52 A.05 .05 0 1 1 .52-.52 A.05 .05 0 1 1 .44-.52 Z', '#fde047', '#ca8a04', .014);
    } else if (kind === 'crown') {
        // 👑 璀璨金色皇冠
        shape('M0 0 L.14-.14', null, '#fbbf24', .03);
        shape('M.12-.18 L.74-.18 L.82-.66 L.58-.44 L.43-.78 L.28-.44 L.04-.66 Z', '#fbbf24', '#92400e', .022);
        shape('M.12-.18 L.74-.18 L.71-.08 L.15-.08 Z', '#d97706', '#78350f', .018);
        shape('M.40-.82 A.04 .04 0 1 1 .46-.82 A.04 .04 0 1 1 .40-.82 Z', '#ef4444', '#7f1d1d', .012);
        shape('M.01-.70 A.035 .035 0 1 1 .07-.70 A.035 .035 0 1 1 .01-.70 Z M.79-.70 A.035 .035 0 1 1 .85-.70 A.035 .035 0 1 1 .79-.70 Z', '#3b82f6', '#1e3a8a', .012);
    } else if (kind === 'music_note') {
        // 🎵 律动金色音符
        shape('M.02-.04 C-.02-.14 .08-.26 .22-.24 C.34-.22 .38-.10 .28-.02 C.18 .06 .06 .04 .02-.04 Z', '#fbbf24', '#92400e', .02);
        shape('M.31-.12 L.48-.88', null, '#fbbf24', .055);
        shape('M.31-.12 L.48-.88', null, '#92400e', .016);
        shape('M.48-.88 C.68-.82 .84-.66 .78-.44 C.74-.58 .62-.68 .46-.70 Z', '#f59e0b', '#92400e', .018);
        shape('M.64-.24 A.06 .045 -20 1 1 .76-.24 A.06 .045 -20 1 1 .64-.24 Z', '#fde047', '#ca8a04', .012);
        shape('M.75-.26 L.82-.54 L.92-.50', null, '#fde047', .024);
    } else if (kind === 'cross_light') {
        // ✝️ 光芒十字架
        shape('M.10-.54 L.64-.54 M.37-.84 L.37-.24 M.19-.72 L.55-.36 M.19-.36 L.55-.72', null, 'rgba(253,224,71,0.45)', .035);
        shape('M0 0 L.52-.92 L.62-.86 L.10 .06 Z', '#fbbf24', '#92400e', .02);
        shape('M.14-.68 L.68-.38 L.62-.28 L.08-.58 Z', '#fde047', '#92400e', .02);
    } else if (kind === 'feather_gold') {
        // 🪽 鎏金神圣金羽
        shape('M.04-.06 C.18-.46 .24-.86 .56-1.16 C.70-1.32 .86-1.40 1.00-1.42 C1.06-.98 .82-.52 .42-.26 Z', '#fde047', '#b45309', .018);
        shape('M.08-.12 C.22-.46 .30-.78 .56-1.04 C.72-.78 .64-.46 .36-.28 Z', '#f59e0b', null);
        shape('M0 0 Q.42-.52 .94-1.36', null, '#fef9c3', .03);
        for (let i = 0; i < 6; i++) {
            const a = .22 + i * .09, b = -.34 - i * .145;
            shape(`M${a} ${b} l-.035 -.18 M${a} ${b} l.19 -.025`, null, '#b45309', .012);
        }
    } else {
        // 🪶 默认复古羽毛笔 (quill)
        shape('M.05-.07 C.2-.48 .23-.87 .54-1.15 C.66-1.32 .82-1.4 .97-1.44 C1.04-1.02 .81-.55 .43-.3 Z', '#eee8d9', '#7e7264', .018);
        shape('M.08-.1 Q.43-.54 .91-1.36', null, '#a78d61', .027);
        for (let i=0;i<6;i++) {
            const a=.22+i*.09,b=-.34-i*.145;
            shape(`M${a} ${b} l-.035 -.18 M${a} ${b} l.19 -.025`, null, '#baa98b', .01);
        }
        shape('M0 0 L.04-.19 L.17-.13 Z', '#c99c47', '#71572f', .012);
        shape('M0 0 L.11-.16', null, '#30291f', .012);
    }
    ctx.restore();
}
if (typeof window !== 'undefined') {
    window.drawSpeechWritingTip = drawSpeechWritingTip;
}

function getWritingSentenceSpans(text) {
    const spans=[];
    for (const line of text.matchAll(/[^\n]+(?:\n|$)|\n/g)) {
        const parts = typeof Intl.Segmenter === 'function'
            ? Array.from(new Intl.Segmenter(undefined,{granularity:'sentence'}).segment(line[0]),p=>({text:p.segment,index:p.index}))
            : Array.from(line[0].matchAll(/[^.!?。！？]+(?:[.!?。！？]+|$)/g),p=>({text:p[0],index:p.index}));
        for(const part of parts)if(part.text.trim())spans.push({text:part.text,startIndex:line.index+part.index,endIndex:line.index+part.index+part.text.length});
    }
    const joined=[];
    for(const span of spans){const previous=joined.at(-1);if(previous && /^\s*\d+[.)、]\s*$/u.test(previous.text)){joined[joined.length-1]={...span,text:previous.text+span.text,startIndex:previous.startIndex};}else joined.push(span);}
    return joined;
}
function getSentenceWritingTokens(seg,text,syncSpeech) {
    const tokens=getSpeechWritingTokens(seg,text,syncSpeech);
    let offset=0;const indexed=tokens.map(t=>{const item={...t,index:offset};offset+=t.text.length;return item;});
    for(const sentence of getWritingSentenceSpans(text)) {
        const group=indexed.filter(t=>t.index>=sentence.startIndex&&t.index<sentence.endIndex);
        const spoken=group.filter(t=>!/^[\s\p{P}]+$/u.test(t.text));
        const first=spoken[0]||group[0],last=spoken[spoken.length-1]||group[group.length-1];
        if(!first||!last)continue;
        const start=first.start,end=last.end;
        for(const tok of group){tok.start=start;tok.end=end;tok._sentenceToken=true;}
    }
    return indexed;
}
function mergeWritingSentenceCues(segments) {
    let text='',tokens=[];
    for(const seg of segments){if(text){text+=' ';tokens.push({text:' ',start:tokens.at(-1)?.end||0,end:tokens.at(-1)?.end||0});}const value=String(seg.edited_text??seg.text??'');text+=value;tokens.push(...getSpeechWritingTokens(seg,value,true));}
    let index=0;const indexed=tokens.map(t=>{const v={...t,index};index+=t.text.length;return v;});
    const spans=getWritingSentenceSpans(text),merged=[];
    for(const span of spans){if(merged.length&&/^\s*\d+[.)、]\s*$/u.test(merged.at(-1).text)){const previous=merged.pop();merged.push({...span,text:previous.text+span.text,startIndex:previous.startIndex});}else merged.push(span);}
    return merged.map(span=>{const chars=indexed.filter(t=>t.index>=span.startIndex&&t.index<span.endIndex);const spoken=chars.filter(t=>/[\p{L}\p{N}]/u.test(t.text));return {text:span.text,start:spoken[0]?.start??chars[0]?.start??0,end:spoken.at(-1)?.end??chars.at(-1)?.end??0,words:chars.map(t=>({word:t.text,start:t.start,end:t.end}))};});
}
function getSplitWritingParts(segments,s,originalScript='') {
    const normalize=t=>String(t||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu,'');
    const texts=segments.map(seg=>String(seg.edited_text??seg.text??''));
    const joined=texts.join(' ');
    const spoken=texts.map(normalize).join('');
    const scriptSentence=getWritingSentenceSpans(String(originalScript||''))[0]?.text.trim();
    const custom=s.fullpage_typewriter_title_auto===false?String(s.fullpage_typewriter_title_text??'').trim():null;
    // A sentence can span arbitrary SRT cues. Prefer the complete recording script,
    // and accept a custom heading as the boundary only if it matches spoken words.
    const matchingCustom=custom&&spoken.startsWith(normalize(custom))&&normalize(custom);
    const matchingScript=scriptSentence&&spoken.startsWith(normalize(scriptSentence))&&normalize(scriptSentence);
    const autoTitle=matchingScript?scriptSentence:(getWritingSentenceSpans(joined)[0]?.text.trim()||'');
    const boundary=matchingCustom||matchingScript||normalize(autoTitle);
    if(!boundary)return {title:[],body:segments.map(x=>({...x})),titleEnd:0};
    let consumed=0,titleEnd=0,titleStart=null;const titleWords=[],body=[];
    segments.forEach((seg,index)=>{
        const text=texts[index],timed=getSpeechWritingTokens(seg,text,s.fullpage_typewriter_speech_sync!==false);
        let cut=0,offset=0;
        for(const token of timed){
            if(consumed<boundary.length){
                consumed+=normalize(token.text).length;cut=offset+token.text.length;
                if(normalize(token.text)){titleStart??=token.start;titleEnd=token.end;}
            }else if(cut&&/^[\s\p{P}]+$/u.test(token.text)){cut=offset+token.text.length;}
            else break;
            offset+=token.text.length;
        }
        const titleChars=normalize(text.slice(0,cut)).length;let wordChars=0,wordCut=0;
        for(const word of seg.words||[]){wordChars+=normalize(word.word??word.text).length;if(wordChars<=titleChars)wordCut++;else break;}
        titleWords.push(...(seg.words||[]).slice(0,wordCut).map(w=>({...w})));
        const rest=text.slice(cut).trimStart();
        if(rest){const remainingTokens=getSpeechWritingTokens(seg,text,true);let off=0;const first=remainingTokens.find(t=>{const hit=off>=cut&&normalize(t.text);off+=t.text.length;return hit;});
            body.push({...seg,text:rest,edited_text:rest,start:Math.max(Number(seg.start)||0,cut?(first?.start??titleEnd):Number(seg.start)||0),words:seg.words?.slice(wordCut).map(w=>({...w})),_writingSourceIndex:index,_writingPrefix:text.slice(0,text.length-rest.length)});
        }
    });
    const titleText=custom===null?autoTitle:custom;
    const title=[{text:titleText,edited_text:titleText,start:titleStart??0,end:titleEnd,words:titleWords}];
    const shift=(list,amount)=>list.map(seg=>({...seg,start:Number(seg.start)+amount,end:Number(seg.end)+amount,words:seg.words?.map(w=>({...w,start:Number(w.start)+amount,end:Number(w.end)+amount}))}));
    const titleDelay=Number(s.fullpage_typewriter_title_delay)||0;
    // Automatic mode uses SRT times directly. Old manual offsets must not
    // make the narration drift after enabling the repaired sequential mode.
    const automatic=s.fullpage_typewriter_auto_sequence!==false;
    const shiftedBody=shift(body,automatic?0:Number(s.fullpage_typewriter_body_delay)||0);
    const gate=titleEnd+titleDelay;
    if(automatic)for(const seg of shiftedBody){seg.start=Math.max(seg.start,gate);seg.end=Math.max(seg.end,seg.start);if(seg.words)seg.words=seg.words.map(w=>({...w,start:Math.max(w.start,gate),end:Math.max(w.end,gate)}));}
    return {title:shift(title,titleDelay),body:shiftedBody,titleEnd:gate};
}

function getWritingVisualStyle(style) {
    if(!style?.fullpage_typewriter || style.fullpage_typewriter_keep_background===false)return style;
    return {...style,global_mask_enabled:false,ambient_lighting_enabled:false,ambient_glow_enabled:false};
}

function getFullpageWritingTokens(seg, style, direction) {
    const text = String(seg.edited_text ?? seg.text ?? '');
    const sync = style.fullpage_typewriter_speech_sync !== false;
    let tokens;
    if (style.fullpage_typewriter_reveal_type === 'sentence') {
        tokens = getSentenceWritingTokens(seg, text, sync);
    } else {
        const chars = getSpeechWritingTokens(seg, text, sync);
        if (style.fullpage_typewriter_reveal_type === 'char' && direction !== 'rtl') {
            tokens = chars;
        } else {
            // Group the displayed text, so stale word timings cannot restore old text.
            tokens = [];
            for (const token of chars) {
                const previous = tokens.at(-1);
                if (previous && /^\s+$/.test(previous.text) === /^\s+$/.test(token.text)) {
                    previous.text += token.text;
                    previous.end = token.end;
                } else tokens.push({ ...token });
            }
        }
    }
    // Apply uppercase after timing alignment; expanding glyphs never change source offsets.
    return tokens.map(token => ({ ...token, text: style.uppercase ? token.text.toUpperCase() : token.text }));
}

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
            const source = style.fullpage_typewriter_cursor_image || '';
            const entry = imageCache.get(source);
            if (!entry && source) {
                loadWritingImage(source).then(() => window.reelsRefreshSpeechWritingPreview?.()).catch(() => {});
            }
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
        drawSpeechWritingTip(ctx, kind, x, y, size, angle);
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

        proto._drawWritingCursorImage = function(ctx, style, x, y, size, angle, time) {
            drawTip(ctx, 'image', x, y, size, angle, style, time);
        };
        proto._drawSplitWritingCursor = function (style,parts,time,width,height,bodyStyle) {
        const title=this._writingPartPositions.title,body=this._writingPartPositions.body;
        const titleEnabled=style.fullpage_typewriter_title_cursor!==false;
        const bodyEnabled=style.fullpage_typewriter_body_cursor!==false;
        const hasBody=parts.body.some(seg=>String(seg.edited_text??seg.text??'').trim());
        const bodyStart=hasBody?Math.min(...parts.body.map(seg=>Number(seg.start)||0)):Infinity;
        let position=titleEnabled?title:null;
        if(hasBody&&time>=parts.titleEnd&&bodyEnabled) {
            let target=body;
            if(!target&&titleEnabled&&title) {
                // Measure the body start on a separate canvas without revealing future text.
                const canvas=this._writingCursorMeasureCanvas ||= document.createElement('canvas');
                if(canvas.width!==width)canvas.width=width;
                if(canvas.height!==height)canvas.height=height;
                const previousCtx=this.ctx,previousPosition=this._writingTipPosition;
                try {
                    this.ctx=canvas.getContext('2d');this.ctx.clearRect(0,0,width,height);
                    const firstWordStart=parts.body[0]?.words?.find(word=>String(word.word??word.text??'').trim())?.start;
                    this._renderFullpageTypewriter(bodyStyle,Math.max(bodyStart,Number(firstWordStart)||bodyStart)+.000001,width,height);
                    target=this._writingTipPosition;
                } finally {this.ctx=previousCtx;this._writingTipPosition=previousPosition;}
            }
            if(target) {
                const gap=bodyStart-parts.titleEnd;
                const duration=gap>.02?Math.min(.35,gap):.22;
                let progress=Math.max(0,Math.min(1,(time-parts.titleEnd)/duration));
                progress=progress*progress*(3-2*progress);
                position=titleEnabled&&title?{...target,
                    x:title.x+(target.x-title.x)*progress,
                    y:title.y+(target.y-title.y)*progress,
                    size:title.size+(target.size-title.size)*progress,
                    time,
                }:(time>=bodyStart?body:null);
            } else if(time>=bodyStart)position=null;
        } else if(hasBody&&time>=bodyStart&&!bodyEnabled) {
            position=null;
        }
        this._writingTipPosition=position;
        if(!position)return;
        const ctx=this.ctx,kind=style.fullpage_typewriter_cursor_kind||'char';
        if(isImageOrVectorWritingTip(kind)) {
            const scale=Math.max(.2,Math.min(4,Number(style.fullpage_typewriter_cursor_scale)||1));
            const x=position.x+(Number(style.fullpage_typewriter_cursor_offset_x)||0);
            const y=position.y+position.size*.9+(Number(style.fullpage_typewriter_cursor_offset_y)||0);
            const size=position.size*scale,angle=Number(style.fullpage_typewriter_cursor_angle)||0;
            if(kind==='image')this._drawWritingCursorImage(ctx,style,x,y,size,angle,time);
            else drawSpeechWritingTip(ctx,kind,x,y,size,angle);
        } else if(Math.floor(time*2)%2===0) {
            ctx.save();ctx.fillStyle=style.fullpage_typewriter_cursor_color||'#FFD700';
            ctx.font=position.font;ctx.fillText(style.fullpage_typewriter_cursor_char||'|',position.x,position.y);ctx.restore();
        }
    };

        const originalRender = proto._renderFullpageTypewriter;
        proto._renderFullpageTypewriter = function (s, currentTime, videoW, videoH) {
            const sourceSegments = this._contextSegments;
            this._contextSegments = repairCollapsedWritingSegments(sourceSegments || []);
            try {
        if (s.fullpage_typewriter_split && !s._writingPart) {
            const original = this._contextSegments;
            const parts = getSplitWritingParts(original || [], s, this._writingOriginalScript);
            const common = { ...s, _writingPart: true, fullpage_typewriter_first_line_scale: 1,
                fullpage_typewriter_first_line_color: '', fullpage_typewriter_first_line_bold: false, tw_unrevealed_opacity: 0, _writingDeferCursor: true };
            this._writingPartPositions = {};
            try {
                this._contextSegments = parts.title.map(seg => ({...seg, style_override: {}, subtitle_style: {}}));
                const titleStyle = { ...common,
                    font_family: s.fullpage_typewriter_title_font_follow !== false ? (s.font_family || 'Arial') : (s.fullpage_typewriter_title_font || s.font_family || 'Arial'),
                    use_stroke: s.fullpage_typewriter_title_stroke_independent ? (s.fullpage_typewriter_title_stroke_enabled !== false && Number(s.fullpage_typewriter_title_stroke_width ?? s.border_width ?? 3)>0) : s.use_stroke,
                    color_outline: s.fullpage_typewriter_title_stroke_independent ? (s.fullpage_typewriter_title_stroke_color || s.color_outline || '#3e2723') : s.color_outline,
                    border_width: s.fullpage_typewriter_title_stroke_independent ? (s.fullpage_typewriter_title_stroke_width ?? s.border_width ?? 3) : s.border_width,
                    opacity_outline: s.fullpage_typewriter_title_stroke_independent ? (s.fullpage_typewriter_title_stroke_opacity ?? s.opacity_outline ?? 255) : s.opacity_outline,
                    stroke_expand_enabled: s.fullpage_typewriter_title_stroke_independent ? false : s.stroke_expand_enabled,
                    use_box: s.fullpage_typewriter_title_box_enabled ?? s.use_box,
                    color_bg: s.fullpage_typewriter_title_box_color || s.color_bg || '#000000',
                    opacity_bg: s.fullpage_typewriter_title_box_opacity ?? s.opacity_bg ?? 180,
                    fontsize: Number(s.fullpage_typewriter_title_size) || 56,
                    font_weight: s.fullpage_typewriter_title_weight || '700',
                    color_text: s.fullpage_typewriter_title_color || '#FFD700',
                    advanced_textbox_enabled: false,
                    pos_x: (Number(s.fullpage_typewriter_title_x) || 50) / 100,
                    pos_y: (Number(s.fullpage_typewriter_title_y) || 20) / 100,
                    auto_wrap: true, wrap_width_percent: Math.min(90, Number(s.wrap_width_percent) || 85),
                    fullpage_typewriter_reveal_type: s.fullpage_typewriter_title_reveal || 'char',
                    fullpage_typewriter_cursor: s.fullpage_typewriter_title_cursor !== false,
                };
                this._renderFullpageTypewriter(titleStyle, currentTime, videoW, videoH);
                this._writingPartPositions.title = this._writingTipPosition;
                this._contextSegments = (s.fullpage_typewriter_body_reveal === 'sentence' || !s.fullpage_typewriter_body_reveal ? mergeWritingSentenceCues(parts.body) : parts.body).map(seg => ({...seg, style_override: {}, subtitle_style: {}}));
                const bodyStyle = { ...common,
                    use_stroke: s.fullpage_typewriter_body_stroke_independent ? (s.fullpage_typewriter_body_stroke_enabled !== false && Number(s.fullpage_typewriter_body_stroke_width ?? s.border_width ?? 3)>0) : s.use_stroke,
                    color_outline: s.fullpage_typewriter_body_stroke_independent ? (s.fullpage_typewriter_body_stroke_color || s.color_outline || '#3e2723') : s.color_outline,
                    border_width: s.fullpage_typewriter_body_stroke_independent ? (s.fullpage_typewriter_body_stroke_width ?? s.border_width ?? 3) : s.border_width,
                    opacity_outline: s.fullpage_typewriter_body_stroke_independent ? (s.fullpage_typewriter_body_stroke_opacity ?? s.opacity_outline ?? 255) : s.opacity_outline,
                    stroke_expand_enabled: s.fullpage_typewriter_body_stroke_independent ? false : s.stroke_expand_enabled,
                    use_box: s.fullpage_typewriter_body_box_enabled ?? s.use_box,
                    color_bg: s.fullpage_typewriter_body_box_color || s.color_bg || '#000000',
                    opacity_bg: s.fullpage_typewriter_body_box_opacity ?? s.opacity_bg ?? 180,
                    advanced_textbox_enabled: false,
                    pos_x: (Number(s.fullpage_typewriter_body_x) || 50) / 100,
                    pos_y: (Number(s.fullpage_typewriter_body_y) || 60) / 100,
                    fullpage_typewriter_reveal_type: s.fullpage_typewriter_body_reveal || 'sentence',
                    fullpage_typewriter_cursor: s.fullpage_typewriter_body_cursor !== false,
                };
                this._renderFullpageTypewriter(bodyStyle, currentTime, videoW, videoH);
                this._writingPartPositions.body = this._writingTipPosition;
                this._drawSplitWritingCursor(s, parts, currentTime, videoW, videoH, bodyStyle);
            } finally { this._contextSegments = original; }
            return;
        }

                return originalRender.call(this, s, currentTime, videoW, videoH);
            } finally { this._contextSegments = sourceSegments; }
        };
    }

    Object.assign(window, { getWritingGraphemes, repairCollapsedWritingSegments, getFullpageWritingTokens, getSentenceWritingTokens, mergeWritingSentenceCues, getSpeechWritingTokens, getSplitWritingParts, getWritingVisualStyle, isImageOrVectorWritingTip });
    install();
})();
