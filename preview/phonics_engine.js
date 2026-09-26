/**
 * Phonics Bento – separable syllable engine.
 * Lexicon stores { word, ipa, definition }. Cuts are computed live.
 */
(function (root) {
    const OXFORD_RULES = {
        consonantDigraphs: ['tch', 'dge', 'sh', 'ch', 'th', 'ph', 'wh', 'ck', 'ng', 'kn', 'gn', 'wr', 'qu', 'mb', 'sc'],
        vowelDigraphs: ['eigh', 'augh', 'ough', 'igh', 'ai', 'ay', 'ee', 'ea', 'oa', 'oe', 'oo', 'ou', 'ow', 'oi', 'oy', 'au', 'aw', 'ew', 'ue', 'eu', 'ie', 'ei', 'ey', 'ui', 'uy'],
        unbreakableSuffixes: ['tional', 'sional', 'tion', 'sion', 'ture', 'cial', 'tial', 'cian', 'cious', 'tious']
    };

    const AFFIXES = {
        suffixes: ['ship', 'ment', 'ness', 'less', 'ful', 'ly', 'ing', 'ed', 'er', 'est', 'tion', 'sion', 'ture', 'able', 'ible', 'ive', 'ous', 'al', 'ance', 'ence', 'ate', 'ward'],
        prefixes: ['un', 're', 'dis', 'pre', 'mis', 'over', 'under', 'anti', 'out', 'sub', 'inter', 'ac', 'ad', 'ab', 'ex', 'en', 'be', 'de', 'pro', 'com', 'con', 'per', 'im', 'in', 'an']
    };

    const DROP_E_SUFFIXES = new Set(['ing', 'ed', 'er', 'est', 'able', 'ible', 'ous', 'ive', 'al', 'ance', 'ence']);

    const EXCEPTIONAL_BOUND_ROOTS = {
        animal: ['an', 'i', 'mal'],
        finger: ['fin', 'ger'],
        anger: ['an', 'ger'],
        angry: ['an', 'gry'],
        bucket: ['buck', 'et'],
        analyse: ['an', 'a', 'lyse']
    };

    const IPA_VOWEL_SRC = '(?:iː|uː|ɔː|ɑː|ɜː|eɪ|aɪ|ɔɪ|əʊ|aʊ|ɪə|eə|ʊə|ɪ|i|e|ɛ|æ|ʌ|ɒ|ʊ|u|ə)';
    const MIN_COMPOUND_PART = 3;
    const MIN_AFFIX_ROOT = 3;

    function ipaVowelRe() {
        return new RegExp(IPA_VOWEL_SRC, 'g');
    }

    function forAudio(s) {
        return s ? String(s).replace(/ɡ/g, 'g') : s;
    }

    function cleanIPAForCompare(ipaStr) {
        if (!ipaStr) return '';
        return String(ipaStr)
            .replace(/\(r\)/g, '')
            .replace(/[\/ˈˌ.\s()]/g, '')
            .replace(/g/g, 'ɡ');
    }

    function unwrapIpa(ipaStr) {
        if (!ipaStr || ipaStr === 'N/A') return '';
        const t = String(ipaStr).trim();
        return t ? `/${t.replace(/^\/|\/$/g, '')}/` : '';
    }

    function lexiconEntry(lexicon, w) {
        if (!lexicon || !w) return null;
        return lexicon[w] || lexicon[String(w).toLowerCase()] || null;
    }

    function lexiconHas(lexicon, w) {
        return !!lexiconEntry(lexicon, w);
    }

    function lexiconIpa(lexicon, w) {
        const e = lexiconEntry(lexicon, w);
        return e && e.ipa ? e.ipa : '';
    }

    function findIpaVowels(cleanIpa) {
        const vR = ipaVowelRe();
        const vM = [];
        let m;
        while ((m = vR.exec(cleanIpa)) !== null) {
            vM.push({ v: m[0], s: m.index, e: m.index + m[0].length });
        }
        return vM;
    }

    function letterIpaWeight(letters, role) {
        let s = String(letters || '').toLowerCase();
        if (role === 'coda') {
            s = s.replace(/e$/i, '');
            s = s.replace(/r$/i, '');
        }
        return s.length;
    }

    function splitIpaRoles(piece) {
        const cl = String(piece || '').replace(/[ˈˌ.\s]/g, '').replace(/g/g, 'ɡ');
        const vR = ipaVowelRe();
        const mx = vR.exec(cl);
        if (!mx) return { onset: cl || null, vowel: null, coda: null };
        return {
            onset: cl.substring(0, mx.index) || null,
            vowel: mx[0],
            coda: cl.substring(mx.index + mx[0].length) || null
        };
    }

    function applyIpaPiece(chunk, piece) {
        const roles = splitIpaRoles(piece);
        chunk.onset = forAudio(roles.onset) || null;
        chunk.vowel = forAudio(roles.vowel) || null;
        chunk.coda = forAudio(roles.coda) || null;
        chunk.onsetIpa = chunk.onset;
        chunk.vowelIpa = chunk.vowel;
        chunk.codaIpa = chunk.coda;
        return chunk;
    }

    function assignIPAtoChunks(fullIpaRaw, chunks) {
        if (!fullIpaRaw || !chunks.length) return chunks;

        const raw = String(fullIpaRaw).replace(/^\/|\/$/g, '').replace(/\(r\)/g, '').replace(/[()]/g, '');
        const dotted = raw.replace(/[ˈˌ]/g, '').split('.').map((s) => s.trim()).filter(Boolean);
        if (dotted.length === chunks.length) {
            dotted.forEach((piece, i) => applyIpaPiece(chunks[i], piece));
            return chunks;
        }

        const clean = cleanIPAForCompare(fullIpaRaw);
        const vM = findIpaVowels(clean);
        if (vM.length !== chunks.length) return chunks;

        let p = 0;
        for (let i = 0; i < vM.length; i++) {
            let end;
            if (i === vM.length - 1) {
                end = clean.length;
            } else {
                const interStart = vM[i].e;
                const interEnd = vM[i + 1].s;
                const interLen = Math.max(0, interEnd - interStart);
                const codaLen = letterIpaWeight(chunks[i].codaLet || '', 'coda');
                const nextOnsetLen = letterIpaWeight(chunks[i + 1].onsetLet || '', 'onset');
                const totalLet = codaLen + nextOnsetLen;
                let consToCoda;
                if (interLen === 0) consToCoda = 0;
                else if (nextOnsetLen === 0) consToCoda = interLen;
                else if (codaLen === 0) consToCoda = 0;
                else if (totalLet === 0) consToCoda = Math.floor(interLen / 2);
                else {
                    consToCoda = Math.round(interLen * (codaLen / totalLet));
                    consToCoda = Math.max(0, Math.min(interLen, consToCoda));
                }
                end = interStart + consToCoda;
            }
            applyIpaPiece(chunks[i], clean.substring(p, end));
            p = end;
        }
        return chunks;
    }

    function parseTokensWithMapping(chunk, isLastChunk) {
        const letters = chunk.letters || '';
        const tokens = letters.split('').map((c) => ({ char: c, type: 'pending', note: '', ipa: '' }));
        const lowerStr = letters.toLowerCase();
        let onsetLet = chunk.onsetLet || '';
        let vowelLet = chunk.vowelLet || '';
        let codaLet = chunk.codaLet || '';

        if (codaLet.toLowerCase().endsWith('e') && codaLet.length >= 2) {
            tokens[tokens.length - 1].type = 'silent';
            tokens[tokens.length - 1].note = 'Magic e';
        }

        const preMarkedOnset = [];
        if (onsetLet === 'kn' || onsetLet === 'wr' || onsetLet === 'gn' || onsetLet === 'pn' || onsetLet === 'ps') {
            tokens[0].type = 'silent';
            tokens[0].note = `Silent ${tokens[0].char}`;
            tokens[1].type = 'onset';
            preMarkedOnset.push(tokens[1]);
            onsetLet = '';
        } else if (onsetLet === 'wh') {
            tokens[1].type = 'silent';
            tokens[1].note = 'Silent h';
            tokens[0].type = 'onset';
            preMarkedOnset.push(tokens[0]);
            onsetLet = '';
        }

        if ((codaLet.endsWith('mb') || codaLet.endsWith('mn')) && isLastChunk) {
            tokens[tokens.length - 1].type = 'silent';
            tokens[tokens.length - 1].note = `Silent ${tokens[tokens.length - 1].char}`;
            tokens[tokens.length - 2].type = 'coda';
            codaLet = codaLet.slice(0, -2);
        }

        const stlMatch = lowerStr.match(/st(le|en)/);
        if (stlMatch) {
            const tIndex = stlMatch.index + 1;
            if (tokens[tIndex] && tokens[tIndex].char === 't') {
                tokens[tIndex].type = 'silent';
                tokens[tIndex].note = 'Silent t';
                if (/^st/i.test(onsetLet)) onsetLet = onsetLet[0] + onsetLet.slice(2);
            }
        }
        const alkMatch = lowerStr.match(/a(l)(k|m|f)/);
        if (alkMatch) {
            const lIndex = alkMatch.index + 1;
            if (tokens[lIndex] && tokens[lIndex].char === 'l') {
                tokens[lIndex].type = 'silent';
                tokens[lIndex].note = 'Silent l';
            }
        }

        let cIdx = 0;
        const actualOnsetTokens = preMarkedOnset.slice();
        if (onsetLet) {
            for (let i = 0; i < onsetLet.length; i++) {
                while (cIdx < tokens.length && tokens[cIdx].type !== 'pending') cIdx++;
                if (cIdx < tokens.length) {
                    tokens[cIdx].type = 'onset';
                    actualOnsetTokens.push(tokens[cIdx]);
                    cIdx++;
                }
            }
        }
        if (actualOnsetTokens.length > 0 && chunk.onset) actualOnsetTokens[0].ipa = chunk.onset;

        const actualVowelTokens = [];
        if (vowelLet) {
            for (let i = 0; i < vowelLet.length; i++) {
                while (cIdx < tokens.length && tokens[cIdx].type !== 'pending') cIdx++;
                if (cIdx < tokens.length) {
                    tokens[cIdx].type = 'vowel';
                    actualVowelTokens.push(tokens[cIdx]);
                    cIdx++;
                }
            }
        }
        if (actualVowelTokens.length > 0 && chunk.vowel) actualVowelTokens[0].ipa = chunk.vowel;

        const actualCodaTokens = [];
        if (codaLet) {
            for (let i = 0; i < codaLet.length; i++) {
                while (cIdx < tokens.length && tokens[cIdx].type !== 'pending') cIdx++;
                if (cIdx < tokens.length) {
                    if (tokens[cIdx].type === 'pending') {
                        tokens[cIdx].type = 'coda';
                        actualCodaTokens.push(tokens[cIdx]);
                    }
                    cIdx++;
                }
            }
        }
        if (actualCodaTokens.length > 0 && chunk.coda) actualCodaTokens[0].ipa = chunk.coda;

        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type === 'pending') tokens[i].type = 'coda';
        }
        return tokens;
    }

    function ipaConsonantSkeleton(ipaStr) {
        return cleanIPAForCompare(ipaStr).replace(ipaVowelRe(), '');
    }

    function validateCompoundWithIPA(word, part1, part2, lexicon) {
        const wIpa = cleanIPAForCompare(lexiconIpa(lexicon, word));
        const p1Ipa = cleanIPAForCompare(lexiconIpa(lexicon, part1));
        const p2Ipa = cleanIPAForCompare(lexiconIpa(lexicon, part2));
        if (wIpa && p1Ipa && p2Ipa && wIpa === p1Ipa + p2Ipa) return true;
        if (part1.length >= 4 && part2.length >= 4) {
            if (wIpa && p1Ipa && p2Ipa) {
                return ipaConsonantSkeleton(wIpa) === ipaConsonantSkeleton(p1Ipa) + ipaConsonantSkeleton(p2Ipa);
            }
            if (!wIpa) return true;
        }
        return false;
    }

    function morphologicalSplit(word, lexicon) {
        if (word.length <= 3) return [word];
        if (EXCEPTIONAL_BOUND_ROOTS[word]) return EXCEPTIONAL_BOUND_ROOTS[word];

        for (let i = MIN_COMPOUND_PART; i <= word.length - MIN_COMPOUND_PART; i++) {
            const part1 = word.slice(0, i);
            const part2 = word.slice(i);
            if (part1.length >= MIN_COMPOUND_PART && part2.length >= MIN_COMPOUND_PART
                && lexiconHas(lexicon, part1) && lexiconHas(lexicon, part2)
                && validateCompoundWithIPA(word, part1, part2, lexicon)) {
                return [part1].concat(morphologicalSplit(part2, lexicon));
            }
        }

        for (const suf of AFFIXES.suffixes) {
            if (word.endsWith(suf) && word.length > suf.length + 1) {
                const root = word.slice(0, -suf.length);
                if (root.length < MIN_AFFIX_ROOT) continue;
                const rootOk = lexiconHas(lexicon, root);
                const dropEOk = DROP_E_SUFFIXES.has(suf) && lexiconHas(lexicon, root + 'e');
                if (rootOk || dropEOk) {
                    return morphologicalSplit(root, lexicon).concat([suf]);
                }
            }
        }

        for (const pre of AFFIXES.prefixes) {
            if (word.startsWith(pre) && word.length > pre.length + 2) {
                const rest = word.slice(pre.length);
                if (rest.length >= MIN_AFFIX_ROOT && lexiconHas(lexicon, rest)) {
                    const wIpa = cleanIPAForCompare(lexiconIpa(lexicon, word));
                    const pIpa = cleanIPAForCompare(lexiconIpa(lexicon, pre));
                    const rIpa = cleanIPAForCompare(lexiconIpa(lexicon, rest));
                    if (wIpa && pIpa && rIpa && wIpa !== pIpa + rIpa) continue;
                    return [pre].concat(morphologicalSplit(rest, lexicon));
                }
            }
        }
        return [word];
    }

    function locateVowelNuclei(text) {
        const nuclei = [];
        const workingText = text.toLowerCase().replace(/qu/g, 'qq');
        const vPattern = /(?:eigh|augh|ough|igh|ai|ay|ee|ea|oa|oe|oo|ou|ow|oi|oy|au|aw|ew|ue|eu|ie|ei|ey|ui|uy|[aeiouy])/gi;
        let match;
        while ((match = vPattern.exec(workingText)) !== null) {
            let isMagicE = false;
            if (match[0] === 'e' && match.index === workingText.length - 1) {
                if (nuclei.length > 0 && workingText.length >= 3) isMagicE = true;
            }
            if (!isMagicE) nuclei.push({ vowel: match[0], start: match.index, end: match.index + match[0].length });
        }
        return nuclei;
    }

    function analyzeSingleSyllable(text) {
        let onset = '';
        let vowel = '';
        let coda = '';
        let workingText = text;
        const lower = workingText.toLowerCase();
        if (lower.startsWith('squ')) {
            onset = workingText.slice(0, 3);
            workingText = workingText.slice(3);
        } else if (lower.startsWith('qu')) {
            onset = workingText.slice(0, 2);
            workingText = workingText.slice(2);
        } else {
            const onsetMatch = workingText.match(/^([bcdfghjklmnpqrstvwxz]+)/i);
            if (onsetMatch) {
                onset = onsetMatch[1];
                workingText = workingText.slice(onset.length);
            }
            if (!onset && /^y[aeiouy]/i.test(workingText)) {
                onset = workingText.slice(0, 1);
                workingText = workingText.slice(1);
            }
        }
        const vowelMatch = workingText.match(/^([aeiouy]+(?:gh|w)?)/i);
        if (vowelMatch) {
            vowel = vowelMatch[1];
            workingText = workingText.slice(vowel.length);
        } else {
            vowel = workingText;
            workingText = '';
        }
        coda = workingText;
        return { letters: text, onsetLet: onset, vowelLet: vowel, codaLet: coda };
    }

    function phonicsSyllabify(morpheme) {
        let extractedSuffix = null;
        let body = morpheme;
        for (const suf of OXFORD_RULES.unbreakableSuffixes) {
            if (body.length > suf.length && body.endsWith(suf)) {
                extractedSuffix = suf;
                body = body.slice(0, -suf.length);
                break;
            }
        }

        const chunks = [];
        if (!/[aeiouy]/i.test(body)) {
            if (body) chunks.push(analyzeSingleSyllable(body));
        } else {
            const nuclei = locateVowelNuclei(body);
            if (nuclei.length <= 1) {
                chunks.push(analyzeSingleSyllable(body));
            } else {
                let startIndex = 0;
                for (let i = 0; i < nuclei.length - 1; i++) {
                    const cN = nuclei[i];
                    const nN = nuclei[i + 1];
                    const cons = body.substring(cN.end, nN.start);
                    let splitPoint = cN.end;
                    if (cons.length === 1) splitPoint = cN.end;
                    else if (cons.length >= 2) {
                        const isDigraph = OXFORD_RULES.consonantDigraphs.some((d) => cons.startsWith(d));
                        const restAfterCons = body.substring(nN.start);
                        const isSilentTCluster = /^st$/i.test(cons) && /^(en|le)/i.test(restAfterCons);
                        splitPoint = (isDigraph || isSilentTCluster) ? cN.end : cN.end + 1;
                    }
                    chunks.push(analyzeSingleSyllable(body.substring(startIndex, splitPoint)));
                    startIndex = splitPoint;
                }
                chunks.push(analyzeSingleSyllable(body.substring(startIndex)));
            }
        }

        if (extractedSuffix) chunks.push(analyzeSingleSyllable(extractedSuffix));
        return chunks;
    }

    function silentTokensFrom(tokens) {
        return tokens
            .filter((t) => t.type === 'silent')
            .map((t) => ({ char: t.char, note: t.note }));
    }

    function analyze(wordRaw, ipaRaw, lexicon) {
        const word = String(wordRaw || '').toLowerCase().trim();
        const lex = lexicon || {};
        const ipa = unwrapIpa(ipaRaw || lexiconIpa(lex, word));

        if (!word) {
            return { word: '', originalWord: '', ipa: '', ipaRaw: '', morphemesPath: [], chunks: [] };
        }

        const morphemes = morphologicalSplit(word, lex);
        let chunks = [];
        morphemes.forEach((morph) => {
            chunks = chunks.concat(phonicsSyllabify(morph));
        });

        if (ipa) assignIPAtoChunks(ipa, chunks);

        chunks = chunks.map((c, i) => {
            c.tokens = parseTokensWithMapping(c, i === chunks.length - 1);
            c.silentTokens = silentTokensFrom(c.tokens);
            if (!('onset' in c)) { c.onset = null; c.vowel = null; c.coda = null; }
            c.onsetIpa = c.onset || null;
            c.vowelIpa = c.vowel || null;
            c.codaIpa = c.coda || null;
            return c;
        });

        const displayIpa = ipa || ('/' + chunks.map((c) => c.letters).join('.') + '/');
        return {
            word,
            originalWord: word,
            ipa: displayIpa,
            ipaRaw: displayIpa,
            morphemesPath: morphemes,
            chunks
        };
    }

    const PhonicsEngine = {
        analyze,
        processWord: analyze,
        morphologicalSplit,
        phonicsSyllabify,
        analyzeSingleSyllable,
        slimEntry(word, ipa, definition) {
            const w = String(word || '').toLowerCase().trim();
            let ip = ipa ? String(ipa).trim() : '';
            if (ip && !ip.startsWith('/')) ip = '/' + ip.replace(/\//g, '') + '/';
            return { word: w, ipa: ip, definition: definition ? String(definition).trim() : '' };
        }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = PhonicsEngine;
    root.PhonicsEngine = PhonicsEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
