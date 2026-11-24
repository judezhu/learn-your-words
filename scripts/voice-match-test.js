// node scripts/voice-match-test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'voice-match.js'), 'utf8'), sandbox);
const VoiceMatch = sandbox.globalThis.VoiceMatch;
const words = JSON.parse(fs.readFileSync(path.join(root, 'words.json'), 'utf8'));
const poke = JSON.parse(fs.readFileSync(path.join(root, 'pokemon.json'), 'utf8')).map((p) => ({
  id: p.id,
  enD: p.en,
  zh: p.zh,
  zhNames: [p.zh],
  pinyin: p.pinyin,
  slug: String(p.en || '').toLowerCase().replace(/\s+/g, '-'),
}));
const index = VoiceMatch.prepare(words, poke);

const cases = [
  ['皮卡丘', ['皮卡丘'], 'one', 'Pikachu'],
  ['皮卡秋', ['皮卡秋'], 'one', 'Pikachu'],
  ['皮卡丘。', ['皮卡丘。'], 'one', 'Pikachu'],
  ['我想看皮卡丘', ['我想看皮卡丘'], 'one', 'Pikachu'],
  ['show me pikachu', ['show me pikachu'], 'one', 'Pikachu'],
  ['alts', ['皮卡秋', '皮卡丘'], 'one', 'Pikachu'],
  ['小海狮', ['小海狮'], 'one', 'Seel'],
  ['小海狮啊', ['小海狮啊'], 'one', 'Seel'],
  ['猫', ['猫'], 'one', 'Cat'],
  ['猫啊', ['猫啊'], 'one', 'Cat'],
  ['pikachu', ['pikachu'], 'one', 'Pikachu'],
  ['Pikachu!', ['Pikachu!'], 'one', 'Pikachu'],
  ['pikachoo', ['pikachoo'], 'one', 'Pikachu'],
  ['bulbasor', ['bulbasor'], 'one', 'Bulbasaur'],
  ['妙蛙种子', ['妙蛙种子'], 'one', 'Bulbasaur'],
  ['喷火龙', ['喷火龙'], 'one', 'Charizard'],
  ['猫和狗', ['猫和狗'], 'many', 'Cat|Dog'],
  ['皮卡丘和小海狮', ['皮卡丘和小海狮'], 'many', 'Pikachu|Seel'],
  ['none-en', ['zzzzqqqq'], 'none', ''],
  ['none-zh', ['这是一句废话呀'], 'none', ''],
];

let failed = 0;
const lines = [];
for (const [name, alts, status, expect] of cases) {
  const r = VoiceMatch.match(alts, index);
  const got = r.status === 'none' ? '' : r.hits.map((h) => h.en || h.enD || h.zh).sort().join('|');
  const expectSorted = expect.split('|').filter(Boolean).sort().join('|');
  const ok = r.status === status && got === expectSorted;
  if (!ok) failed += 1;
  lines.push((ok ? 'ok  ' : 'FAIL') + '  ' + name + '  →  ' + r.status + (got ? '  ' + got : '') + (r.score ? '  score ' + r.score : '') + (ok ? '' : '  (wanted ' + status + ' ' + expectSorted + ')'));
}
console.log(lines.join('\n'));
console.log(failed ? '\n' + failed + ' failed' : '\nall ' + cases.length + ' passed');
process.exit(failed ? 1 : 0);
