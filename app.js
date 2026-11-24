// Learn Your Words — plain static app.
// Data: words.json (hand-edited), pokemon.json (curated, with pinyin),
// pokedex.json (national dex: PokéAPI slug + official zh-Hans),
// evolutions.json (lazy, ids only; built by scripts/build_pokemon.py).

const HOME_WORDS = ['cat', 'dog', 'apple', 'panda', 'ice cream', 'dragon', 'star', 'flower', 'rabbit', 'banana', 'heart', 'duck'];
const PROXY_URL = '/api/lookup';
const API_KEY = '';
const POKE_LIMIT = 1025;
const COLS = 3;
const OVERSCAN = 5;

const $ = (id) => document.getElementById(id);

const ui = {
  q: $('q'),
  app: $('app-screen'),
  title: $('app-title'),
  sub: $('app-sub'),
  emoji: $('app-emoji'),
  mic: $('btn-mic'),
  micEn: $('btn-mic-en'),
  micZh: $('btn-mic-zh'),
  listen: $('mic-listen'),
  micMsg: $('mic-msg'),
  looking: $('looking'),
  result: $('result'),
  badge: $('result-badge'),
  art: $('result-art'),
  en: $('result-en'),
  zhLine: $('zh-line'),
  zh: $('result-zh'),
  py: $('result-py'),
  evo: $('result-evo'),
  signRow: $('result-sign'),
  signLabel: $('sign-label'),
  ex: $('result-ex'),
  exEn: $('result-ex-en'),
  exZh: $('result-ex-zh'),
  notFound: $('not-found'),
  suggestions: $('suggestions'),
  service: $('service-error'),
  home: $('home'),
  homeLabel: $('home-label'),
  catWords: $('btn-cat-words'),
  catPoke: $('btn-cat-poke'),
  wordGrid: $('word-grid'),
  pokeWrap: $('poke-wrap'),
  pokeSpacer: $('poke-spacer'),
  pokeWindow: $('poke-window'),
  signModal: $('sign-modal'),
  signTitle: $('sign-title'),
  signOpen: $('sign-open'),
  signStage: $('sign-stage'),
  matches: $('poke-matches'),
  matchLabel: $('match-label'),
  matchGrid: $('match-grid'),
};

const state = {
  screen: 'app',
  query: '',
  result: null,
  matches: [],
  recording: false,
  micLang: 'en',
  notFound: false,
  serviceError: false,
  cat: 'words',
  looking: false,
  micMsg: '',
  pokeErr: false,
  signOpen: false,
  signVideo: null,
  signEmbed: null,
  signLoading: false,
};

let words = [];
let curated = [];
let pokedex = [];
let liveList = null;
let curatedById = new Map();
let richCurated = [];
let species = [];
let dexItems = [];
let dexGen = 0;
let ready = false;
let aiCache = {};
let reqId = 0;
let timer = null;
let lookupAbort = null;
let signReq = 0;
let signKey = '';
let rec = null;
let livePromise = null;
let resultKey = '';
let pokeKey = '';
let wordKey = '';
let suggestKey = '';

function artUrl(id) {
  return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/' + id + '.png';
}
function spriteUrl(id) {
  return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + id + '.png';
}
function titleName(slug) {
  return String(slug || '').split('-').filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}
function stripTone(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normEn(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function normZh(s) {
  return String(s || '').replace(/\s+/g, '').replace(/[·・.\-－—]/g, '');
}
function pyKey(s) {
  return stripTone(s || '').toLowerCase().replace(/\s+/g, '');
}

function claim() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (lookupAbort) {
    try { lookupAbort.abort(); } catch (e) {}
    lookupAbort = null;
  }
  return ++reqId;
}

function toRich(p) {
  return {
    id: p.id,
    en: String(p.en || '').toLowerCase(),
    enD: p.en,
    zh: p.zh || '',
    pinyin: p.pinyin || '',
    emoji: '',
    img: artUrl(p.id),
    sprite: spriteUrl(p.id),
    exEn: p.exEn || (p.en + ' is a Pokémon! Gotta catch it!'),
    exZh: p.exZh || ((p.zh || '') + '是一只宝可梦！'),
  };
}

function rebuild() {
  curatedById = new Map(curated.map((p) => [p.id, p]));
  richCurated = curated.map(toRich);
  const base = (liveList && liveList.length) ? liveList : pokedex.map((p) => ({ id: p.id, en: p.en }));
  const zhById = new Map(pokedex.map((p) => [p.id, p.zh || '']));
  const seen = new Set();
  species = [];
  for (const p of base) {
    if (!p || !p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    const c = curatedById.get(p.id);
    const official = zhById.get(p.id) || '';
    const zhNames = [];
    if (official) zhNames.push(official);
    if (c && c.zh && c.zh !== official) zhNames.push(c.zh);
    const flats = new Set([normEn(p.en), normEn(titleName(p.en))]);
    if (c) flats.add(normEn(c.en));
    species.push({
      id: p.id,
      slug: p.en,
      enD: c ? c.en : titleName(p.en),
      enFlats: [...flats].filter(Boolean),
      zhNames,
      zh: (c && c.zh) || official || '',
      pinyinFlat: c && c.pinyin ? pyKey(c.pinyin) : '',
    });
  }
  for (const p of curated) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    species.push({
      id: p.id,
      slug: String(p.en || '').toLowerCase().replace(/\s+/g, '-'),
      enD: p.en,
      enFlats: [normEn(p.en)].filter(Boolean),
      zhNames: p.zh ? [p.zh] : [],
      zh: p.zh || '',
      pinyinFlat: p.pinyin ? pyKey(p.pinyin) : '',
    });
  }
  dexItems = species.map((s) => ({ id: s.id, enD: s.enD, zh: s.zh, slug: s.slug }));
  dexGen++;
  wordKey = '';
  suggestKey = '';
  pokeKey = '';
}

function matchWord(raw) {
  const low = raw.toLowerCase();
  const flat = pyKey(low);
  let m = words.find((d) => d.en.toLowerCase() === low || d.zh === raw || pyKey(d.pinyin) === flat);
  if (!m) {
    m = words.find((d) => d.en.toLowerCase().startsWith(low) || (d.zh && d.zh.startsWith(raw)) || (d.pinyin && pyKey(d.pinyin).startsWith(flat)));
  }
  if (!m && low.length >= 2) {
    m = words.find((d) => d.en.toLowerCase().includes(low) || (d.zh && d.zh.includes(raw)));
  }
  return m || null;
}

// 0 exact, 1 prefix, 2 contains, -1 none. English ignores spaces and punctuation.
function pokemonRank(s, raw) {
  const low = raw.toLowerCase();
  const flat = normEn(raw);
  const zh = normZh(raw);
  const py = pyKey(raw);
  const trimmed = raw.trim();
  const enExact = (flat && s.enFlats.includes(flat)) || s.enD.toLowerCase() === low || s.slug === low.replace(/\s+/g, '-');
  const zhExact = !!(zh && s.zhNames.some((n) => normZh(n) === zh));
  const pyExact = !!(py && s.pinyinFlat && s.pinyinFlat === py);
  if (enExact || zhExact || pyExact) return 0;
  const longEnough = flat.length >= 2 || trimmed.length >= 2 || py.length >= 2;
  if (!longEnough) return -1;
  const enPref = flat.length >= 2 && (s.enFlats.some((f) => f.startsWith(flat)) || s.enD.toLowerCase().startsWith(low));
  const zhPref = trimmed.length >= 2 && s.zhNames.some((n) => n.startsWith(trimmed) || normZh(n).startsWith(zh));
  const pyPref = py.length >= 2 && s.pinyinFlat && s.pinyinFlat.startsWith(py);
  if (enPref || zhPref || pyPref) return 1;
  const enInc = (flat.length >= 2 && s.enFlats.some((f) => f.includes(flat))) || (low.length >= 2 && s.enD.toLowerCase().includes(low));
  const zhInc = trimmed.length >= 2 && s.zhNames.some((n) => n.includes(trimmed) || (zh && normZh(n).includes(zh)));
  const pyInc = py.length >= 2 && s.pinyinFlat && s.pinyinFlat.includes(py);
  if (enInc || zhInc || pyInc) return 2;
  return -1;
}

function matchPokemonAll(raw) {
  const hits = [];
  for (const s of species) {
    const rank = pokemonRank(s, raw);
    if (rank < 0) continue;
    hits.push({ item: s, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.item.id - b.item.id);
  return hits.map((h) => ({
    id: h.item.id,
    enD: h.item.enD,
    zh: h.item.zh,
    slug: h.item.slug,
    exact: h.rank === 0,
  }));
}

function showEntry(entry) {
  state.result = entry;
  state.matches = [];
  state.looking = false;
  state.notFound = false;
  state.serviceError = false;
  render();
}

function presentPokemon(rec, id) {
  const c = curatedById.get(rec.id);
  if (c) {
    showEntry(richCurated.find((x) => x.id === c.id) || toRich(c));
    return;
  }
  const cached = aiCache['poke_' + rec.id];
  if (cached && cached.img) {
    showEntry(cached);
    return;
  }
  lookupPokemon(rec, id);
}

function search(q, immediate) {
  const raw = (q || '').trim();
  const id = claim();
  if (!ready) {
    state.looking = !!raw;
    state.result = null;
    state.matches = [];
    state.notFound = false;
    state.serviceError = false;
    render();
    readyPromise.then(() => { if (id === reqId) search(state.query, immediate); });
    return;
  }
  if (!raw) {
    state.result = null;
    state.matches = [];
    state.looking = false;
    state.notFound = false;
    state.serviceError = false;
    render();
    return;
  }
  const wordHit = matchWord(raw);
  if (wordHit) {
    showEntry(wordHit);
    return;
  }
  const pokeHits = matchPokemonAll(raw);
  if (pokeHits.length > 1) {
    state.matches = pokeHits;
    state.result = null;
    state.looking = false;
    state.notFound = false;
    state.serviceError = false;
    render();
    return;
  }
  if (pokeHits.length === 1) {
    state.matches = [];
    presentPokemon(pokeHits[0], id);
    return;
  }
  const low = raw.toLowerCase();
  if (aiCache[low]) {
    showEntry(aiCache[low]);
    return;
  }
  if (!aiAvailable()) {
    state.result = null;
    state.matches = [];
    state.looking = false;
    state.notFound = true;
    state.serviceError = false;
    render();
    return;
  }
  state.looking = true;
  state.result = null;
  state.matches = [];
  state.notFound = false;
  state.serviceError = false;
  render();
  if (immediate) aiLookup(raw, id);
  else timer = setTimeout(() => { if (id === reqId) aiLookup(raw, id); }, 800);
}

function pickWord(w) {
  state.query = w.en;
  search(w.en, true);
}

function pickFromDex(item) {
  state.query = item.enD;
  const id = claim();
  if (!ready) {
    readyPromise.then(() => { if (id === reqId) pickFromDex(item); });
    return;
  }
  // claim() above already invalidated in-flight work; don't claim again.
  presentPokemon(item, id);
}

async function lookupPokemon(rec, id) {
  const ac = new AbortController();
  lookupAbort = ac;
  state.looking = true;
  state.result = null;
  state.matches = [];
  state.notFound = false;
  state.serviceError = false;
  render();

  const key = 'poke_' + rec.id;
  let zh = rec.zh || '';
  let enD = rec.enD || '';
  let slug = rec.slug || '';
  try {
    const res = await fetch('https://pokeapi.co/api/v2/pokemon-species/' + rec.id, { signal: ac.signal });
    if (id !== reqId) return;
    if (res.ok) {
      const sp = await res.json();
      if (id !== reqId) return;
      if (sp && sp.name) {
        slug = sp.name;
        enD = titleName(sp.name);
      }
      const names = (sp && sp.names) || [];
      const lc = (x) => ((x && x.language && x.language.name) || '').toLowerCase();
      let n = names.find((x) => lc(x) === 'zh-hans');
      if (!n) n = names.find((x) => lc(x) === 'zh-hant');
      if (n && n.name) zh = n.name;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    if (id !== reqId) return;
  }
  if (id !== reqId) return;
  if (!zh && rec.zh) zh = rec.zh;

  let pinyin = '';
  let exEn = '';
  let exZh = '';
  if (aiAvailable()) {
    try {
      const prompt = 'You help a 7-year-old learn Simplified Chinese. The Pokémon is "' + enD + '" (Pokédex #' + rec.id + ')'
        + (zh ? (' and its official Simplified Chinese name is "' + zh + '".') : '.')
        + ' Reply with ONLY a compact JSON object (no markdown) using exactly these keys: '
        + (zh ? '' : '"zh" (official Simplified Chinese name), ')
        + '"pinyin" (Mandarin pinyin WITH tone marks' + (zh ? (' for ' + zh) : '') + '), '
        + '"exEn" (one short simple kid-friendly English sentence about this Pokémon, no quotation marks), '
        + '"exZh" (that same sentence in Simplified Chinese). JSON only.';
      const o = parseJson(await aiComplete(prompt, ac.signal)) || {};
      if (id !== reqId) return;
      if (!zh && o.zh) zh = o.zh;
      pinyin = o.pinyin || '';
      exEn = o.exEn || '';
      exZh = o.exZh || '';
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (id !== reqId) return;
    }
  }
  if (!enD) enD = 'Pokémon';
  const entry = {
    id: rec.id,
    en: enD.toLowerCase(),
    enD,
    zh,
    pinyin,
    emoji: '',
    img: artUrl(rec.id),
    sprite: spriteUrl(rec.id),
    exEn,
    exZh,
  };
  if (zh || pinyin) {
    aiCache[key] = entry;
    try { localStorage.setItem('lyw_ai_' + key, JSON.stringify(entry)); } catch (e) {}
  }
  if (id !== reqId) return;
  showEntry(entry);
}

function aiAvailable() {
  return !!((window.claude && window.claude.complete) || PROXY_URL || (API_KEY && API_KEY.indexOf('sk-ant') === 0));
}

async function aiComplete(prompt, signal) {
  if (window.claude && window.claude.complete) {
    return await window.claude.complete(prompt);
  }
  if (PROXY_URL) {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || !data || data.error || !String((data && data.text) || '').trim()) {
      throw new Error('lookup failed');
    }
    return data.text;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal,
  });
  if (!res.ok) throw new Error('api ' + res.status);
  const data = await res.json();
  const text = (data && data.content && data.content[0] && data.content[0].text) || '';
  if (!String(text).trim()) throw new Error('empty');
  return text;
}

function parseJson(txt) {
  try {
    let s = (txt || '').trim();
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

async function aiLookup(raw, id) {
  const ac = new AbortController();
  lookupAbort = ac;
  const low = raw.trim().toLowerCase();
  const prompt = 'You are a friendly bilingual picture dictionary for a 7-year-old learning English and Simplified Chinese. The child searched for: "' + raw + '". Figure out if it is English, Chinese, or pinyin, then describe that one word/character. Reply with ONLY a compact JSON object (no markdown, no extra text) using exactly these keys: '
    + '"en" (the English word in lowercase), "enD" (the English word nicely Capitalized), "zh" (Simplified Chinese), "pinyin" (Mandarin pinyin WITH tone marks), "emoji" (ONE single emoji that best fits, or empty string if none fits), "exEn" (one short simple kid-friendly example sentence in English, no quotation marks), "exZh" (that same sentence in Simplified Chinese). '
    + 'If it is not a real word, reply {"en":""}. JSON only.';
  try {
    const txt = await aiComplete(prompt, ac.signal);
    if (id !== reqId) return;
    const o = parseJson(txt);
    if (o && o.en && (o.zh || o.enD)) {
      const entry = {
        en: (o.en || low),
        enD: (o.enD || o.en || raw),
        zh: (o.zh || ''),
        pinyin: (o.pinyin || ''),
        emoji: (o.emoji || ''),
        exEn: (o.exEn || ''),
        exZh: (o.exZh || ''),
        ai: true,
      };
      aiCache[low] = entry;
      try { localStorage.setItem('lyw_ai_' + low, JSON.stringify(entry)); } catch (e) {}
      if (id !== reqId) return;
      showEntry(entry);
    } else {
      if (id !== reqId) return;
      state.result = null;
      state.matches = [];
      state.looking = false;
      state.notFound = true;
      state.serviceError = false;
      render();
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    if (id !== reqId) return;
    state.result = null;
    state.matches = [];
    state.looking = false;
    state.notFound = false;
    state.serviceError = true;
    render();
  }
}

function speak(text, lang) {
  try {
    if (!text || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.82;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

function micErrMsg(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '🎤 需要麦克风权限。请在浏览器地址栏/设置里允许麦克风，iPhone/iPad 还要打开「设置 → 通用 → 键盘 → 启用听写」。';
    case 'no-speech':
      return '没听清，再试一次，靠近麦克风说一个词 🙂';
    case 'audio-capture':
      return '找不到麦克风，请检查设备麦克风。';
    case 'network':
      return '语音识别需要联网，请检查网络连接。';
    case 'aborted':
      return '';
    default:
      return '语音识别暂时用不了，可以直接打字 😊';
  }
}

function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    state.micMsg = '这个浏览器不支持语音搜索 — 可以直接打字 😊（建议用 Safari 或 Chrome 浏览器打开，不要用「添加到主屏幕」的图标）';
    render();
    return;
  }
  if (state.recording && rec) {
    try { rec.stop(); } catch (e) {}
    return;
  }
  try { rec = new SR(); } catch (e) {
    state.micMsg = '无法启动语音识别。';
    render();
    return;
  }
  rec.lang = state.micLang === 'zh' ? 'zh-CN' : 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    const t = (e.results[0][0].transcript || '').replace(/[.。,，!！?？\s]+$/, '').trim();
    state.query = t;
    state.micMsg = '';
    search(t, true);
  };
  rec.onend = () => { state.recording = false; render(); };
  rec.onerror = (e) => {
    state.recording = false;
    state.micMsg = micErrMsg(e && e.error);
    render();
  };
  state.recording = true;
  state.micMsg = '';
  render();
  try { rec.start(); } catch (e) {
    state.recording = false;
    state.micMsg = '无法启动语音识别，请直接打字 😊';
    render();
  }
}

function isPokemonResult(r) {
  if (!r) return false;
  if (typeof r.id === 'number') return true;
  const img = String(r.img || '');
  return img.indexOf('/official-artwork/') !== -1 || img.indexOf('/sprites/pokemon/') !== -1;
}
function signWordOf(r) {
  if (!r || isPokemonResult(r)) return '';
  return String(r.en || r.enD || '').trim().toLowerCase();
}
function signPage(word) {
  return 'https://www.signasl.org/sign/' + encodeURIComponent(word.replace(/\s+/g, '-'));
}
function safeHttp(url) {
  try {
    const u = new URL(url, location.origin);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
  } catch (e) {}
  return '';
}

function openSign() {
  const r = state.result;
  const word = signWordOf(r);
  if (!word) return;
  state.signOpen = true;
  state.signVideo = null;
  state.signEmbed = null;
  state.signLoading = true;
  render();
  const id = (signReq += 1);
  fetch('/api/sign?word=' + encodeURIComponent(word.replace(/\s+/g, '-')))
    .then((res) => (res.ok ? res.json() : Promise.reject()))
    .then((d) => {
      if (id !== signReq) return;
      state.signVideo = d.video || null;
      state.signEmbed = d.video ? null : (d.embed || null);
      state.signLoading = false;
      render();
    })
    .catch(() => {
      if (id !== signReq) return;
      state.signVideo = null;
      state.signEmbed = null;
      state.signLoading = false;
      render();
    });
}

function closeSign() {
  state.signOpen = false;
  state.signVideo = null;
  state.signEmbed = null;
  state.signLoading = false;
  render();
}

function setCat(cat) {
  state.cat = cat;
  if (cat === 'pokemon') {
    refreshLive();
    ensureEvo();
  }
  render();
}

function refreshLive() {
  if (liveList && liveList.length) return;
  if (livePromise) return;
  livePromise = fetch('https://pokeapi.co/api/v2/pokemon?limit=' + POKE_LIMIT)
    .then((r) => { if (!r.ok) throw new Error('poke list'); return r.json(); })
    .then((d) => {
      const list = ((d && d.results) || []).map((p) => {
        const id = Number(String(p.url || '').split('/').filter(Boolean).pop());
        return { id, en: p.name };
      }).filter((p) => p.id >= 1 && p.id < 10000);
      if (list.length) {
        liveList = list;
        state.pokeErr = false;
        rebuild();
        render();
      }
    })
    .catch(() => {
      state.pokeErr = !(pokedex && pokedex.length);
      livePromise = null;
      render();
    });
}

function showHome() {
  return state.screen === 'app' && !state.result && !state.looking && !state.notFound && !state.serviceError && !(state.matches && state.matches.length);
}

function homeLabel() {
  if (state.cat !== 'pokemon') return '✨ Word friends to explore';
  const baseCount = (liveList && liveList.length) || (pokedex && pokedex.length) || 0;
  if (!baseCount) {
    if (state.pokeErr) return '⚡ Pokémon (离线名单)';
    return '⚡ Loading all Pokémon… ✨';
  }
  return '⚡ ' + baseCount + ' 只宝可梦 — tap one!';
}

function render() {
  document.body.dataset.theme = 'kid';

  if (ui.q.value !== state.query) ui.q.value = state.query;
  ui.q.placeholder = 'Type a word, press Enter';
  ui.title.textContent = 'Learn Your Words';
  ui.sub.textContent = 'Tap a friend or search!';
  ui.emoji.textContent = '🐾';

  ui.mic.classList.toggle('rec', state.recording);
  ui.micEn.classList.toggle('on', state.micLang === 'en');
  ui.micZh.classList.toggle('on', state.micLang === 'zh');
  ui.listen.hidden = !state.recording;
  ui.micMsg.hidden = !state.micMsg;
  ui.micMsg.textContent = state.micMsg || '';

  ui.looking.hidden = !state.looking;
  ui.notFound.hidden = !state.notFound;
  ui.service.hidden = !state.serviceError;

  renderResult();
  renderEvo();
  renderSign();
  renderMatches();

  const home = showHome();
  ui.home.hidden = !home;
  ui.catWords.classList.toggle('on', state.cat === 'words');
  ui.catPoke.classList.toggle('on', state.cat === 'pokemon');
  ui.homeLabel.textContent = homeLabel();
  renderWords(home && state.cat === 'words');
  renderSuggestions();
  layoutPoke();
}

function renderResult() {
  const r = state.result;
  const key = r ? [r.enD, r.zh, r.pinyin, r.img || '', r.emoji || '', r.ai ? 1 : 0, r.exEn || '', r.exZh || ''].join('\n') : '';
  ui.result.hidden = !r;
  if (!r) { resultKey = ''; return; }
  if (key === resultKey) return;
  resultKey = key;

  ui.badge.hidden = !r.ai;
  ui.en.textContent = r.enD || r.en || '';
  const zh = r.zh || '';
  const py = r.pinyin || '';
  ui.zh.textContent = zh;
  ui.zhLine.hidden = !zh;
  ui.py.textContent = py;
  ui.py.hidden = !py;

  ui.art.replaceChildren();
  if (r.img) {
    const img = document.createElement('img');
    img.className = 'art-img';
    img.alt = r.enD || r.en || '';
    img.width = 160;
    img.height = 160;
    img.decoding = 'async';
    img.src = r.img;
    img.onerror = () => {
      if (r.sprite && img.src !== r.sprite) { img.src = r.sprite; return; }
      const emo = document.createElement('div');
      emo.className = 'art-emoji';
      emo.textContent = r.emoji || '⚡';
      img.replaceWith(emo);
    };
    ui.art.append(img);
  } else {
    const emo = document.createElement('div');
    emo.className = 'art-emoji';
    emo.textContent = r.emoji || (r.ai ? '📖' : '❓');
    ui.art.append(emo);
  }

  const word = signWordOf(r);
  ui.signRow.hidden = !word;
  if (word) ui.signLabel.textContent = 'See the sign for "' + (r.enD || r.en) + '"';
  if (!word && state.signOpen) {
    state.signOpen = false;
    state.signVideo = null;
    state.signEmbed = null;
    state.signLoading = false;
    signReq += 1;
  }

  const hasEx = !!(r.exEn || r.exZh);
  ui.ex.hidden = !hasEx;
  ui.exEn.textContent = r.exEn || '';
  ui.exZh.textContent = r.exZh || '';
}

// evolutions.json is ids only. b = branches per family, l = labels
// (positive = level, -1 mega, -2 gigantamax, -3 primal),
// m = other pokemon that share a family, h = species to highlight for a costume.
let evoData = null;
let evoPromise = null;
let evoFailed = false;
let evoKey = '';

function ensureEvo() {
  if (evoData) return Promise.resolve(evoData);
  if (evoFailed) return Promise.resolve(null);
  if (!evoPromise) {
    evoPromise = loadJson('evolutions.json').then((d) => {
      evoData = d;
      return d;
    }).catch((e) => {
      console.error(e);
      evoFailed = true;
      evoPromise = null;
      return null;
    });
  }
  return evoPromise;
}

function evoChain(id) {
  if (!evoData || !evoData.b) return null;
  const own = evoData.b[String(id)];
  const root = own ? String(id) : (evoData.m && evoData.m[String(id)] != null ? String(evoData.m[String(id)]) : '');
  const branches = root && evoData.b[root];
  if (!branches || !branches.length) return null;
  const focus = (evoData.h && evoData.h[String(id)] != null) ? evoData.h[String(id)] : id;
  return { branches: branches, levels: (evoData.l && evoData.l[root]) || null, focus: focus };
}

function evoTree(branches, levels) {
  const root = { id: branches[0][0], lv: 0, kids: new Map() };
  for (let p = 0; p < branches.length; p++) {
    const path = branches[p];
    const lv = levels ? levels[p] : null;
    let node = root;
    for (let i = 1; i < path.length; i++) {
      const cid = path[i];
      let child = node.kids.get(cid);
      if (!child) {
        child = { id: cid, lv: lv ? (lv[i] || 0) : 0, kids: new Map() };
        node.kids.set(cid, child);
      }
      node = child;
    }
  }
  return root;
}

const EVO_TAG = {
  '-1': ['超级进化', 'is-mega'],
  '-2': ['超极巨化', 'is-gmax'],
  '-3': ['原始回归', 'is-primal'],
};

function evoArrow(level, down) {
  const s = document.createElement('span');
  s.className = 'evo-arrow' + (down ? ' is-down' : '');
  s.setAttribute('aria-hidden', 'true');
  const mark = document.createElement('i');
  s.append(mark);
  const tag = EVO_TAG[String(level)];
  if (tag) {
    const lv = document.createElement('small');
    lv.className = 'evo-tag ' + tag[1];
    lv.textContent = tag[0];
    s.append(lv);
  } else if (level > 0) {
    const lv = document.createElement('small');
    lv.textContent = 'Lv.' + level;
    s.append(lv);
  }
  return s;
}

function openEvolution(id) {
  const row = curatedById.get(id);
  if (!row || (state.result && state.result.id === id)) return;
  state.query = row.en;
  const req = claim();
  presentPokemon({ id: row.id, enD: row.en, zh: row.zh }, req);
}

function evoStage(id, focus) {
  const row = curatedById.get(id);
  const en = row ? row.en : String(id);
  const zh = row ? (row.zh || '') : '';
  const on = id === focus;
  const b = document.createElement(on ? 'div' : 'button');
  if (!on) b.type = 'button';
  b.className = 'evo-stage' + (on ? ' is-current' : '');
  if (on) b.setAttribute('aria-current', 'true');
  b.setAttribute('aria-label', (zh ? zh + ' ' : '') + en);
  const img = document.createElement('img');
  img.src = spriteUrl(id);
  img.alt = '';
  img.width = 46;
  img.height = 46;
  img.decoding = 'async';
  const zhEl = document.createElement('span');
  zhEl.className = 'zh';
  zhEl.textContent = zh;
  const enEl = document.createElement('span');
  enEl.className = 'en';
  enEl.textContent = en;
  b.append(img, zhEl, enEl);
  if (!on) b.addEventListener('click', () => openEvolution(id));
  return b;
}

function evoLine(node, focus) {
  const line = document.createElement('div');
  line.className = 'evo-line';
  line.append(evoStage(node.id, focus));
  const kids = [...node.kids.values()];
  if (!kids.length) return line;
  if (kids.length === 1) {
    line.append(evoArrow(kids[0].lv, false));
    const rest = evoLine(kids[0], focus);
    while (rest.firstChild) {
      const child = rest.firstChild;
      // A fan of final evolutions belongs to the previous stage, not the
      // whole row. Stack those with sideways arrows so they don't sit under
      // an earlier Pokémon.
      if (child.classList && child.classList.contains('evo-fork') && !child.classList.contains('is-deep')) {
        child.classList.add('is-deep');
        for (const arrow of child.querySelectorAll('.evo-arrow')) arrow.classList.remove('is-down');
      }
      line.append(child);
    }
    return line;
  }
  const deep = kids.some((k) => k.kids.size);
  const fork = document.createElement('div');
  fork.className = 'evo-fork' + (deep ? ' is-deep' : '');
  for (const kid of kids) {
    if (deep) {
      const sub = evoLine(kid, focus);
      sub.prepend(evoArrow(kid.lv, false));
      fork.append(sub);
    } else {
      const leaf = document.createElement('div');
      leaf.className = 'evo-leaf';
      leaf.append(evoArrow(kid.lv, true), evoStage(kid.id, focus));
      fork.append(leaf);
    }
  }
  line.append(fork);
  return line;
}

function renderEvo() {
  const r = state.result;
  if (!r || !isPokemonResult(r)) {
    ui.evo.hidden = true;
    if (evoKey) ui.evo.replaceChildren();
    evoKey = '';
    return;
  }
  if (!evoData) {
    ui.evo.hidden = true;
    if (!evoFailed) {
      const id = r.id;
      ensureEvo().then(() => {
        if (state.result && state.result.id === id) renderEvo();
      });
    }
    return;
  }
  const key = String(r.id);
  if (key === evoKey) return;
  evoKey = key;
  ui.evo.replaceChildren();
  const label = document.createElement('div');
  label.className = 'evo-label';
  label.textContent = '进化 · Evolution';
  ui.evo.append(label);
  const chain = evoChain(r.id);
  if (!chain) {
    const none = document.createElement('p');
    none.className = 'evo-none';
    none.textContent = "不会进化 · Doesn't evolve";
    ui.evo.append(none);
  } else {
    ui.evo.append(evoLine(evoTree(chain.branches, chain.levels), chain.focus));
  }
  ui.evo.hidden = false;
}

function renderSign() {
  ui.signModal.hidden = !state.signOpen;
  if (!state.signOpen) {
    if (signKey) ui.signStage.replaceChildren();
    signKey = '';
    return;
  }
  const r = state.result;
  const word = signWordOf(r);
  const page = word ? signPage(word) : 'https://www.signasl.org/';
  const key = [state.signLoading ? 1 : 0, state.signVideo || '', state.signEmbed || '', word].join('|');
  ui.signTitle.textContent = 'Sign for "' + ((r && (r.enD || r.en)) || '') + '"';
  ui.signOpen.href = page;
  if (key === signKey) return;
  signKey = key;
  ui.signStage.replaceChildren();
  if (state.signLoading) {
    const spin = document.createElement('div');
    spin.className = 'sign-spin';
    ui.signStage.append(spin);
    return;
  }
  const video = safeHttp(state.signVideo);
  const embed = safeHttp(state.signEmbed);
  if (video) {
    const v = document.createElement('video');
    v.src = video;
    v.controls = true;
    v.autoplay = true;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    ui.signStage.append(v);
    return;
  }
  const frame = document.createElement('iframe');
  frame.src = embed || page;
  frame.title = embed ? 'Sign video' : 'Sign language';
  if (embed) frame.allow = 'autoplay; fullscreen';
  ui.signStage.append(frame);
}

let matchKey = '';
function renderMatches() {
  const list = state.matches || [];
  ui.matches.hidden = !list.length;
  if (!list.length) {
    if (matchKey) ui.matchGrid.replaceChildren();
    matchKey = '';
    return;
  }
  const n = list.length;
  ui.matchLabel.textContent = '找到 ' + n + ' 只 — tap one!';
  const key = list.map((s) => s.id + (s.exact ? '!' : '')).join(',');
  if (key === matchKey) return;
  matchKey = key;
  const frag = document.createDocumentFragment();
  for (const item of list) frag.append(pokeChip(item));
  ui.matchGrid.replaceChildren(frag);
}

function wordChip(w, pill) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = pill ? 'suggest' : 'word-chip';
  const emo = document.createElement('span');
  emo.className = pill ? '' : 'emoji';
  emo.textContent = w.emoji || '📘';
  const en = document.createElement('span');
  en.className = pill ? '' : 'en';
  en.textContent = w.enD || w.en;
  b.append(emo, en);
  if (!pill) {
    const zh = document.createElement('span');
    zh.className = 'zh';
    zh.textContent = w.zh || '';
    b.append(zh);
  }
  b.addEventListener('click', () => pickWord(w));
  return b;
}

function renderWords(show) {
  ui.wordGrid.hidden = !show;
  if (!show || !words.length) return;
  if (wordKey === 'ready') return;
  wordKey = 'ready';
  ui.wordGrid.replaceChildren();
  for (const en of HOME_WORDS) {
    const w = words.find((d) => d.en === en);
    if (w) ui.wordGrid.append(wordChip(w, false));
  }
}

function renderSuggestions() {
  if (!state.notFound || !words.length) return;
  if (suggestKey === 'ready') return;
  suggestKey = 'ready';
  ui.suggestions.replaceChildren();
  for (const en of HOME_WORDS) {
    const w = words.find((d) => d.en === en);
    if (w) ui.suggestions.append(wordChip(w, true));
  }
}

function pokeMetrics() {
  const cs = getComputedStyle(ui.pokeWrap);
  const row = parseFloat(cs.getPropertyValue('--poke-row')) || 156;
  const gap = parseFloat(cs.getPropertyValue('--poke-gap')) || 12;
  return { row, gap, stride: row + gap };
}

function layoutPoke() {
  const show = showHome() && state.cat === 'pokemon';
  ui.pokeWrap.hidden = !show;
  if (!show) {
    if (pokeKey) {
      ui.pokeWindow.replaceChildren();
      ui.pokeSpacer.style.height = '0px';
      pokeKey = '';
    }
    return;
  }
  const list = dexItems;
  const { stride, gap } = pokeMetrics();
  const rows = Math.ceil(list.length / COLS);
  const height = rows ? (rows * stride - gap) : 0;
  ui.pokeSpacer.style.height = height + 'px';
  if (!rows) {
    ui.pokeWindow.replaceChildren();
    pokeKey = '';
    return;
  }
  const top = ui.pokeSpacer.getBoundingClientRect().top;
  const startRow = Math.max(0, Math.floor(-top / stride) - OVERSCAN);
  const endRow = Math.min(rows, Math.ceil((-top + window.innerHeight) / stride) + OVERSCAN);
  const start = startRow * COLS;
  const end = Math.min(list.length, endRow * COLS);
  const key = dexGen + ':' + start + ':' + end + ':' + list.length;
  ui.pokeWindow.style.transform = 'translateY(' + (startRow * stride) + 'px)';
  if (key === pokeKey) return;
  pokeKey = key;
  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i++) frag.append(pokeChip(list[i]));
  ui.pokeWindow.replaceChildren(frag);
}

function pokeChip(item) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'poke-chip' + (item.exact ? ' is-exact' : '');
  b.title = item.enD + (item.zh ? ' · ' + item.zh : '');
  const img = document.createElement('img');
  img.src = spriteUrl(item.id);
  img.alt = '';
  img.width = 50;
  img.height = 50;
  img.decoding = 'async';
  const en = document.createElement('span');
  en.className = 'en';
  en.textContent = item.enD;
  const zh = document.createElement('span');
  zh.className = 'zh';
  zh.textContent = item.zh || '';
  b.append(img, en, zh);
  b.addEventListener('click', () => pickFromDex(item));
  return b;
}

function loadCache() {
  try {
    localStorage.removeItem('lyw_mode');
    localStorage.removeItem('lyw_theme');
  } catch (e) {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('lyw_ai_') === 0) {
        try { aiCache[k.slice(7)] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
      }
    }
  } catch (e) {}
}

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' ' + res.status);
  return res.json();
}

const readyPromise = (async function loadData() {
  try {
    const [w, p, d] = await Promise.all([
      loadJson('words.json'),
      loadJson('pokemon.json'),
      loadJson('pokedex.json'),
    ]);
    words = Array.isArray(w) ? w : [];
    curated = Array.isArray(p) ? p : [];
    pokedex = Array.isArray(d) ? d : [];
    rebuild();
    ready = true;
    render();
  } catch (e) {
    console.error(e);
    ui.homeLabel.textContent = 'Could not load the word lists.';
  }
})();

let scrollRaf = 0;
function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; layoutPoke(); });
}

function bind() {
  ui.q.addEventListener('input', () => { state.query = ui.q.value; search(state.query, false); });
  ui.q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); search(state.query, true); }
  });
  ui.mic.addEventListener('click', toggleMic);
  ui.micEn.addEventListener('click', () => { state.micLang = 'en'; render(); });
  ui.micZh.addEventListener('click', () => { state.micLang = 'zh'; render(); });
  $('speak-en').addEventListener('click', () => state.result && speak(state.result.en, 'en-US'));
  $('speak-zh').addEventListener('click', () => state.result && speak(state.result.zh, 'zh-CN'));
  $('speak-ex-en').addEventListener('click', () => state.result && speak(state.result.exEn, 'en-US'));
  $('speak-ex-zh').addEventListener('click', () => state.result && speak(state.result.exZh, 'zh-CN'));
  $('btn-sign').addEventListener('click', openSign);
  $('btn-retry').addEventListener('click', () => search(state.query, true));
  ui.catWords.addEventListener('click', () => setCat('words'));
  ui.catPoke.addEventListener('click', () => setCat('pokemon'));
  $('sign-backdrop').addEventListener('click', closeSign);
  $('sign-panel').addEventListener('click', (e) => e.stopPropagation());
  $('sign-close').addEventListener('click', closeSign);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.signOpen) closeSign(); });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
}

loadCache();
bind();
render();
