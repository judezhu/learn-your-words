// Learn Your Words — plain static app.
// Data: words.json (hand-edited), pokemon.json (curated, with pinyin),
// pokedex.json (national dex: PokéAPI slug + official zh-Hans).

const HOME_WORDS = ['cat', 'dog', 'apple', 'panda', 'ice cream', 'dragon', 'star', 'flower', 'rabbit', 'banana', 'heart', 'duck'];
const PROXY_URL = '/api/lookup';
const API_KEY = '';
const POKE_LIMIT = 1025;
const COLS = 3;
const OVERSCAN = 5;

const $ = (id) => document.getElementById(id);

const ui = {
  q: $('q'),
  welcome: $('welcome'),
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
};

const state = {
  screen: 'welcome',
  mode: 'kid',
  query: '',
  result: null,
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
function kid() { return state.mode === 'kid'; }

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
    exEn: p.en + ' is a Pokémon! Gotta catch it!',
    exZh: (p.zh || '') + '是一只宝可梦！',
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
    });
  }
  dexItems = species.map((s) => ({ id: s.id, enD: s.enD, zh: s.zh, slug: s.slug }));
  dexGen++;
  wordKey = '';
  suggestKey = '';
  pokeKey = '';
}

function curatedFind(raw) {
  const low = raw.toLowerCase();
  const flat = (s) => stripTone(s).toLowerCase().replace(/\s+/g, '');
  const list = words.concat(richCurated);
  let m = list.find((d) => d.en.toLowerCase() === low || d.zh === raw || flat(d.pinyin) === flat(low));
  if (!m) {
    m = list.find((d) => d.en.toLowerCase().startsWith(low) || (d.zh && d.zh.startsWith(raw)) || (d.pinyin && flat(d.pinyin).startsWith(flat(low))));
  }
  if (!m && low.length >= 2) {
    m = list.find((d) => d.en.toLowerCase().includes(low) || (d.zh && d.zh.includes(raw)));
  }
  return m || null;
}

function bestSpecies(arr) {
  return arr.slice().sort((a, b) => a.enD.length - b.enD.length || a.id - b.id)[0];
}

function matchNational(raw, immediate) {
  if (!species.length) return null;
  const low = raw.toLowerCase();
  const flat = normEn(raw);
  const zh = normZh(raw);
  const trimmed = raw.trim();
  const exact = [];
  const pref = [];
  const inc = [];
  for (const s of species) {
    const enExact = (flat && s.enFlats.includes(flat)) || s.enD.toLowerCase() === low || s.slug === low.replace(/\s+/g, '-');
    const zhExact = !!(zh && s.zhNames.some((n) => normZh(n) === zh));
    if (enExact || zhExact) { exact.push(s); continue; }
    if (flat.length >= 2 || trimmed.length >= 2) {
      const enPref = flat.length >= 2 && (s.enFlats.some((f) => f.startsWith(flat)) || s.enD.toLowerCase().startsWith(low));
      const zhPref = trimmed.length >= 2 && s.zhNames.some((n) => n.startsWith(trimmed) || normZh(n).startsWith(zh));
      if (enPref || zhPref) { pref.push(s); continue; }
    }
    if (low.length >= 2) {
      const enInc = s.enD.toLowerCase().includes(low) || (flat && s.enFlats.some((f) => f.includes(flat)));
      const zhInc = trimmed.length >= 2 && s.zhNames.some((n) => n.includes(trimmed));
      if (enInc || zhInc) inc.push(s);
    }
  }
  if (exact.length) return { hit: bestSpecies(exact) };
  if (pref.length === 1) return { hit: pref[0] };
  if (immediate && pref.length) return { hit: bestSpecies(pref) };
  if (immediate && inc.length) return { hit: bestSpecies(inc) };
  if (!immediate && pref.length) return { hold: true };
  return null;
}

function showEntry(entry) {
  state.result = entry;
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
    state.notFound = false;
    state.serviceError = false;
    render();
    readyPromise.then(() => { if (id === reqId) search(state.query, immediate); });
    return;
  }
  if (!raw) {
    state.result = null;
    state.looking = false;
    state.notFound = false;
    state.serviceError = false;
    render();
    return;
  }
  const curatedHit = curatedFind(raw);
  if (curatedHit) {
    showEntry(curatedHit);
    return;
  }
  const poke = matchNational(raw, immediate);
  if (poke && poke.hit) {
    presentPokemon(poke.hit, id);
    return;
  }
  if (poke && poke.hold) {
    state.result = null;
    state.looking = false;
    state.notFound = false;
    state.serviceError = false;
    render();
    return;
  }
  const low = raw.toLowerCase();
  if (aiCache[low]) {
    showEntry(aiCache[low]);
    return;
  }
  if (!aiAvailable()) {
    state.result = null;
    state.looking = false;
    state.notFound = true;
    state.serviceError = false;
    render();
    return;
  }
  state.looking = true;
  state.result = null;
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
      state.looking = false;
      state.notFound = true;
      state.serviceError = false;
      render();
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    if (id !== reqId) return;
    state.result = null;
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
    u.rate = kid() ? 0.82 : 0.95;
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

function signWordOf(r) {
  return String((r && (r.en || r.enD)) || '').trim().toLowerCase();
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
  if (!r) return;
  const word = signWordOf(r);
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

function chooseMode(mode) {
  state.screen = 'app';
  state.mode = mode;
  render();
}

function back() {
  claim();
  try { if (rec) rec.stop(); } catch (e) {}
  try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  state.screen = 'welcome';
  state.query = '';
  state.result = null;
  state.notFound = false;
  state.serviceError = false;
  state.recording = false;
  state.looking = false;
  state.micMsg = '';
  state.signOpen = false;
  render();
}

function setCat(cat) {
  state.cat = cat;
  if (cat === 'pokemon') refreshLive();
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
  return state.screen === 'app' && !state.result && !state.looking && !state.notFound && !state.serviceError;
}

function homeLabel() {
  if (state.cat !== 'pokemon') return kid() ? '✨ Word friends to explore' : 'Common words';
  const baseCount = (liveList && liveList.length) || (pokedex && pokedex.length) || 0;
  if (!baseCount) {
    if (state.pokeErr) return kid() ? '⚡ Pokémon (离线名单)' : 'Pokémon (offline list)';
    return kid() ? '⚡ Loading all Pokémon… ✨' : 'Loading Pokémon…';
  }
  return kid() ? ('⚡ ' + baseCount + ' 只宝可梦 — tap one!') : ('Pokémon · ' + baseCount);
}

function render() {
  document.body.dataset.theme = state.mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', kid() ? '#ffe1ec' : '#f3f4f6');

  ui.welcome.hidden = state.screen !== 'welcome';
  ui.app.hidden = state.screen !== 'app';

  if (ui.q.value !== state.query) ui.q.value = state.query;
  ui.q.placeholder = kid() ? 'Type a word, press Enter' : 'English or 中文, press Enter';
  ui.title.textContent = kid() ? 'Learn Your Words' : 'Dictionary';
  ui.sub.textContent = kid() ? 'Tap a friend or search!' : 'English · 中文';
  ui.emoji.textContent = kid() ? '🐾' : '📚';

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
  renderSign();

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
  ui.signLabel.textContent = word ? ('See the sign for "' + (r.enD || r.en) + '"') : 'See the sign';

  const hasEx = !!(r.exEn || r.exZh);
  ui.ex.hidden = !hasEx;
  ui.exEn.textContent = r.exEn || '';
  ui.exZh.textContent = r.exZh || '';
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
  b.className = 'poke-chip';
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
  $('btn-kid').addEventListener('click', () => chooseMode('kid'));
  $('btn-adult').addEventListener('click', () => chooseMode('adult'));
  $('btn-back').addEventListener('click', back);
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
