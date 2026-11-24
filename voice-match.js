// Match a child's speech transcript to a word or a Pokémon name.
// Loaded as a plain script. Tests call the same VoiceMatch functions in Node.
(function (root) {
  const HAN = /\p{Script=Han}/u;
  const PUNCT = /[。，、！？!?.,~～…·・"'“”‘’()（）\[\]【】:：;；]/g;
  const PARTICLES = new Set([...'的呀啊呢吧嘛哦喔啦喽嘞呗了']);
  const ZH_FILLERS = ['请给我看', '给我看看', '我想看', '我要看', '帮我看', '请给我', '我想要', '给我看', '帮我找', '找一下', '我要', '我想', '看看', '帮我', '给我', '找', '搜', '查'];
  const EN_FILLERS = ['show me', 'i want to see', 'i want', 'i wanna', 'search for', 'look up', 'find me', 'please'];

  function stripTone(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function sylOf(token) {
    return stripTone(token).toLowerCase().replace(/[^a-z]/g, '');
  }
  function normZh(s) {
    return String(s || '').replace(PUNCT, '').replace(/\s+/g, '').replace(/[·・.\-－—]/g, '');
  }
  function normEn(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }
  function cleanHeard(s) {
    return String(s || '').replace(/\s+/g, ' ').replace(/^[\s。，、！？!?.,~～…]+|[\s。，、！？!?.,~～…]+$/g, '').trim();
  }

  function editDistance(a, b, max) {
    const m = a.length;
    const n = b.length;
    if (Math.abs(m - n) > max) return max + 1;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      const cur = new Array(n + 1);
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= n; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[n];
  }

  function learnPinyin(zh, pinyin, counts) {
    const parts = String(pinyin || '').trim().split(/\s+/).filter(Boolean).map(sylOf).filter(Boolean);
    const chars = [...String(zh || '')].filter((ch) => HAN.test(ch));
    if (!parts.length || parts.length !== chars.length) return;
    for (let i = 0; i < chars.length; i++) {
      let bucket = counts.get(chars[i]);
      if (!bucket) { bucket = new Map(); counts.set(chars[i], bucket); }
      bucket.set(parts[i], (bucket.get(parts[i]) || 0) + 1);
    }
  }

  function bestSyllables(counts) {
    const map = new Map();
    for (const [ch, bucket] of counts) {
      let best = '';
      let n = 0;
      for (const [syl, c] of bucket) {
        if (c > n) { best = syl; n = c; }
      }
      if (best) map.set(ch, best);
    }
    return map;
  }

  function syllablesOf(zh, pinyin) {
    const parts = String(pinyin || '').trim().split(/\s+/).filter(Boolean).map(sylOf).filter(Boolean);
    const chars = [...String(zh || '')].filter((ch) => HAN.test(ch));
    if (!parts.length || parts.length !== chars.length) return null;
    return parts;
  }

  function hanziToPy(s, map) {
    const chars = [...String(s || '')].filter((ch) => HAN.test(ch));
    if (!chars.length) return null;
    const parts = chars.map((ch) => map.get(ch) || null);
    const unknown = parts.reduce((n, p) => n + (p ? 0 : 1), 0);
    return { parts, unknown, key: unknown ? '' : parts.join('') };
  }

  function partialPy(heardParts, nameParts) {
    if (!nameParts || heardParts.length !== nameParts.length) return false;
    let unknown = 0;
    let known = 0;
    for (let i = 0; i < heardParts.length; i++) {
      if (!heardParts[i]) unknown += 1;
      else if (heardParts[i] !== nameParts[i]) return false;
      else known += 1;
    }
    if (!unknown || known < 2 || unknown >= known) return false;
    const limit = heardParts.length >= 5 ? 2 : 1;
    return unknown <= limit;
  }

  function stripParticles(s) {
    let out = s;
    for (let i = 0; i < 2 && out.length > 1; i++) {
      const last = out[out.length - 1];
      if (!PARTICLES.has(last)) break;
      out = out.slice(0, -1);
    }
    return out;
  }

  function stripFillers(s) {
    let out = s.trim();
    let lower = out.toLowerCase();
    let changed = true;
    while (changed && out) {
      changed = false;
      for (const f of ZH_FILLERS) {
        if (out.startsWith(f) && out.length > f.length) {
          out = out.slice(f.length).trim();
          lower = out.toLowerCase();
          changed = true;
          break;
        }
      }
      if (changed) continue;
      for (const f of EN_FILLERS) {
        if (lower.startsWith(f) && lower.length > f.length) {
          out = out.slice(f.length).trim();
          lower = out.toLowerCase();
          changed = true;
          break;
        }
      }
    }
    return out;
  }

  function variants(raw) {
    const seen = new Set();
    const out = [];
    function push(s) {
      s = String(s || '').trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    }
    push(raw);
    const spaced = String(raw || '').replace(PUNCT, ' ').replace(/\s+/g, ' ').trim();
    push(spaced);
    push(spaced.replace(/\s+/g, ''));
    const filled = stripFillers(spaced);
    push(filled);
    push(filled.replace(/\s+/g, ''));
    push(stripParticles(filled));
    push(stripParticles(spaced).replace(/\s+/g, ''));
    push(stripParticles(filled).replace(/\s+/g, ''));
    return out;
  }

  function prepare(words, poke) {
    const counts = new Map();
    const entries = [];
    const byZh = new Map();
    const byEn = new Map();
    const byPy = new Map();
    const byLen = new Map();

    function addEntry(entry) {
      entries.push(entry);
      for (const name of entry.zhList) {
        if (!name) continue;
        const list = byZh.get(name) || [];
        list.push(entry);
        byZh.set(name, list);
      }
      if (entry.enFlat) {
        const list = byEn.get(entry.enFlat) || [];
        list.push(entry);
        byEn.set(entry.enFlat, list);
      }
      if (entry.pyKey) {
        const list = byPy.get(entry.pyKey) || [];
        list.push(entry);
        byPy.set(entry.pyKey, list);
      }
      if (entry.pyParts) {
        const n = entry.pyParts.length;
        const list = byLen.get(n) || [];
        list.push(entry);
        byLen.set(n, list);
      }
    }

    for (const w of words || []) {
      learnPinyin(w.zh, w.pinyin, counts);
      const zh = w.zh || '';
      const pyParts = syllablesOf(zh, w.pinyin);
      const en = w.enD || w.en || '';
      addEntry({
        kind: 'word',
        key: 'w:' + (w.en || en),
        zh,
        zhList: zh ? [normZh(zh)] : [],
        en,
        enFlat: normEn(w.en || en),
        enSpaced: String(w.en || en).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
        pyKey: pyParts ? pyParts.join('') : sylOf(String(w.pinyin || '').replace(/\s+/g, '')),
        pyParts,
        word: w,
      });
    }
    for (const p of poke || []) {
      const names = (p.zhNames && p.zhNames.length) ? p.zhNames : (p.zh ? [p.zh] : []);
      learnPinyin(p.zh || names[0] || '', p.pinyin, counts);
      const pyParts = syllablesOf(p.zh || names[0] || '', p.pinyin);
      const en = p.enD || '';
      addEntry({
        kind: 'poke',
        key: 'p:' + p.id,
        id: p.id,
        slug: p.slug || '',
        zh: p.zh || names[0] || '',
        zhList: [...new Set(names.map(normZh).filter(Boolean))],
        en,
        enFlat: normEn(en),
        enSpaced: String(en).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
        pyKey: pyParts ? pyParts.join('') : sylOf(String(p.pinyin || '').replace(/\s+/g, '')),
        pyParts,
      });
    }
    return { entries, byZh, byEn, byPy, byLen, charPy: bestSyllables(counts) };
  }

  function addHit(bag, entry, score) {
    if (!entry || score <= 0) return;
    const prev = bag.get(entry.key);
    if (!prev || score > prev.score) bag.set(entry.key, { entry, score });
  }

  function consider(raw, bag, index) {
    for (const text of variants(raw)) {
      const flatZh = normZh(text);
      const flatEn = normEn(text);
      for (const e of index.byZh.get(flatZh) || []) addHit(bag, e, 100);
      for (const e of index.byEn.get(flatEn) || []) addHit(bag, e, 100);

      if (flatZh.length > 1) {
        for (const part of flatZh.split(/[和跟与]/)) {
          if (!part || part === flatZh) continue;
          for (const e of index.byZh.get(part) || []) addHit(bag, e, 96);
          for (const e of index.byEn.get(normEn(part)) || []) addHit(bag, e, 96);
        }
      }

      const whole = hanziToPy(flatZh, index.charPy);
      if (whole && whole.unknown === 0 && whole.key) {
        for (const e of index.byPy.get(whole.key) || []) addHit(bag, e, 92);
      }

      if (flatZh.length >= 2) {
        for (const e of index.entries) {
          for (const name of e.zhList) {
            if (name.length >= 2 && name !== flatZh && flatZh.includes(name)) addHit(bag, e, 70 + name.length);
          }
        }
      }

      const tokens = (text.toLowerCase().match(/[a-z][a-z]+/g) || []);
      for (const t of tokens) {
        if (t.length < 3) continue;
        for (const e of index.byEn.get(t) || []) addHit(bag, e, 100);
      }
      const spaced = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (spaced.length >= 3) {
        for (const e of index.entries) {
          if (e.enSpaced.length >= 4 && spaced.includes(e.enSpaced)) addHit(bag, e, 70 + e.enSpaced.length);
        }
      }

      const fuzz = new Set();
      if (flatEn.length >= 4) fuzz.add(flatEn);
      for (const t of tokens) if (t.length >= 4) fuzz.add(t);
      for (const t of fuzz) {
        for (const e of index.entries) {
          if (!e.enFlat || e.enFlat.length < 5) continue;
          if (Math.abs(e.enFlat.length - t.length) > 2) continue;
          const d = editDistance(t, e.enFlat, 2);
          if (d > 0 && d <= 2) addHit(bag, e, 64 - d);
        }
      }

      const han = [...flatZh].filter((ch) => HAN.test(ch)).join('');
      const max = Math.min(han.length, 12);
      for (let len = 2; len <= max; len++) {
        const group = index.byLen.get(len) || [];
        const exactPy = index.byPy;
        for (let i = 0; i + len <= han.length; i++) {
          const slice = han.slice(i, i + len);
          const conv = hanziToPy(slice, index.charPy);
          if (!conv) continue;
          if (conv.unknown === 0 && conv.key) {
            for (const e of exactPy.get(conv.key) || []) {
              if (e.zhList.indexOf(slice) === -1) addHit(bag, e, 90);
            }
          } else if (group.length) {
            for (const e of group) {
              if (partialPy(conv.parts, e.pyParts)) addHit(bag, e, 82);
            }
          }
        }
      }
    }
  }

  function match(transcripts, index) {
    const list = (transcripts || []).map((t) => String(t || '')).filter((t) => t.trim());
    const heard = cleanHeard(list[0] || '');
    if (!index || !list.length) return { status: 'none', heard, hits: [] };
    const bag = new Map();
    for (const t of list) consider(t, bag, index);
    const ranked = [...bag.values()].sort((a, b) => b.score - a.score || String(a.entry.zh).localeCompare(String(b.entry.zh), 'zh'));
    if (!ranked.length) return { status: 'none', heard, hits: [] };
    const best = ranked[0].score;
    const hits = ranked.filter((h) => h.score === best).slice(0, 12).map((h) => h.entry);
    return { status: hits.length > 1 ? 'many' : 'one', heard, hits, score: best };
  }

  root.VoiceMatch = {
    prepare,
    match,
    editDistance,
    cleanHeard,
    normZh,
    normEn,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
