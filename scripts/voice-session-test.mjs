// Three voice searches in a row, including after a card and speechSynthesis.
// node scripts/voice-session-test.mjs
// Needs puppeteer-core and Chrome. Headless only; this is not an iPhone.
const puppeteerMod = await import(process.env.PUPPETEER_CORE || 'puppeteer-core');
const puppeteer = puppeteerMod.default || puppeteerMod;

const chrome = process.env.CHROME || '/usr/local/bin/google-chrome';
const url = process.env.VOICE_URL || 'http://127.0.0.1:8765/?voice-session=1';

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => { console.error('PAGEERROR', e.message); process.exitCode = 1; });
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => {
  const origSet = window.setTimeout.bind(window);
  const origClear = window.clearTimeout.bind(window);
  window.__long = [];
  window.setTimeout = (fn, ms, ...args) => {
    if (ms >= 5000) {
      window.__long.push(fn);
      return origSet(() => {}, 0);
    }
    return origSet(fn, ms, ...args);
  };
  window.clearTimeout = (id) => origClear(id);

  let speaking = false;
  const synth = window.speechSynthesis;
  const origCancel = synth.cancel.bind(synth);
  synth.speak = function () {
    speaking = true;
    window.__speaks = (window.__speaks || 0) + 1;
    origSet(() => { speaking = false; }, 200);
  };
  synth.cancel = function () {
    window.__cancels = (window.__cancels || 0) + 1;
    return origCancel();
  };
  try {
    Object.defineProperty(synth, 'speaking', { configurable: true, get() { return speaking; } });
  } catch (e) {
    window.__speakHook = String(e && e.message || e);
  }

  window.__starts = [];
  class FakeSR {
    constructor() { window.__made = (window.__made || 0) + 1; }
    start() {
      this.savedEnd = this.onend;
      window.__starts.push(this);
      window.__mic = this;
    }
    stop() { if (this.onend) this.onend(); }
    abort() { this.aborted = true; }
  }
  window.SpeechRecognition = FakeSR;
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('#poke-window .poke-chip').length > 0);

function fire(texts) {
  return page.evaluate((texts) => {
    const alt = texts.map((t) => ({ transcript: t }));
    alt.isFinal = true;
    window.__mic.onresult({ results: [alt] });
  }, texts);
}
async function waitCard(en) {
  await page.waitForFunction((name) => {
    const node = document.querySelector('#result-en');
    return node && node.textContent === name;
  }, {}, en);
}

const cards = [];

await page.click('#btn-mic');
await fire(['皮卡丘']);
await waitCard('Pikachu');
cards.push('Pikachu');
const first = await page.evaluate(() => window.__starts[0]);
const longAfterFirst = await page.evaluate(() => window.__long.length);

await page.click('#speak-zh');
const beforeSecond = await page.evaluate(() => window.__starts.length);
await page.click('#btn-mic');
const rightAfterTap = await page.evaluate(() => ({
  starts: window.__starts.length,
  speaking: window.speechSynthesis.speaking,
  cancels: window.__cancels || 0,
}));
await page.waitForFunction(() => window.__starts.length >= 2, { timeout: 2000 });
await page.evaluate(() => {
  const first = window.__starts[0];
  if (first && first.savedEnd) first.savedEnd();
  const old = window.__long[0];
  if (old) old();
});
const stillSecond = await page.evaluate(() => ({
  starts: window.__starts.length,
  listening: document.querySelector('#btn-mic').classList.contains('rec'),
  aborted: !!window.__starts[0].aborted,
  distinct: window.__starts[0] !== window.__starts[1],
}));
await fire(['小海狮']);
await waitCard('Seel');
cards.push('Seel');
await page.evaluate(() => { const m = window.__mic; if (m && m.onend) m.onend(); });

await page.click('#btn-mic');
await page.waitForFunction(() => window.__starts.length >= 3);
await fire(['猫']);
await waitCard('Cat');
cards.push('Cat');

await page.click('#btn-mic');
await page.waitForFunction(() => window.__starts.length >= 4);
await fire(['狗']);
await waitCard('Dog');
cards.push('Dog');

const end = await page.evaluate(() => ({
  made: window.__made,
  starts: window.__starts.length,
  speaks: window.__speaks || 0,
}));
console.log(JSON.stringify({ cards, longAfterFirst, beforeSecond, rightAfterTap, stillSecond, end }, null, 2));
const ok = cards.join() === 'Pikachu,Seel,Cat,Dog'
  && rightAfterTap.starts === 1
  && rightAfterTap.cancels >= 1
  && stillSecond.starts === 2
  && stillSecond.listening
  && stillSecond.aborted
  && stillSecond.distinct
  && end.starts >= 4;
if (!ok) process.exitCode = 1;
await browser.close();
process.exit(process.exitCode || 0);
