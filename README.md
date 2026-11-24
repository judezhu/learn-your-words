# Learn Your Words · 学单词

A picture dictionary for kids about 7–8 years old. Search an English word, a Chinese word, or pinyin and see both languages, an example sentence, and a button that speaks the word. It opens in the colorful kid theme, with microphone search, sign-language videos, and a Pokémon dex.

给 7–8 岁孩子用的图解词典。可以搜英文、中文或拼音，看到两种语言、例句，以及朗读按钮。打开就是彩色的儿童主题，还有麦克风搜索、手语视频和宝可梦图鉴。

The site is static files. [Cloudflare Pages](https://learn-your-words.pages.dev) serves them and runs the two functions in `functions/`. Production deploys from `master`.

## Files · 文件

| File | What it is |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Kid theme and the small vendored fonts |
| `app.js` | Search, speech, microphone, Pokémon, sign videos |
| `words.json` | The word list. Edit this to add or change words. |
| `pokemon.json` | Curated Pokémon (English, 中文, pinyin). Edit this for the names you want to show with a ready-made pinyin. |
| `pokedex.json` | All 1,025 national-dex Pokémon: PokéAPI slug + official Simplified Chinese. Search uses this so names outside `pokemon.json` still open a Pokémon card. |
| `fonts/` | Fredoka, latin and latin-ext only (for pinyin tone marks). Chinese text uses the phone or computer's own font. |
| `functions/api/lookup.js` | AI lookup. The Anthropic key stays in the `ANTHROPIC_KEY` secret. |
| `functions/api/sign.js` | Looks up a whole-word sign video on signasl.org. |

`words.json` 是单词表，改词就改这个文件。`pokemon.json` 是精选宝可梦（含拼音）。`pokedex.json` 是全国图鉴 1025 只的英文名和官方简体中文名，用来让搜索认出精选名单以外的宝可梦。中文显示用系统字体，不再把整套字体打进页面。

## Edit words · 改单词

Each item in `words.json` is one word:

`words.json` 里每一条是一个词：

```json
{
  "en": "cat",
  "enD": "Cat",
  "zh": "猫",
  "pinyin": "māo",
  "emoji": "🐱",
  "exEn": "The cat is sleeping.",
  "exZh": "猫在睡觉。"
}
```

`en` is the search key (lowercase). `enD` is the label on the card. Keep the file valid JSON.

`en` 用小写，搜索按它匹配。`enD` 是卡片上的写法。改完要仍是合法的 JSON。

The twelve words on the home screen are chosen in `app.js` (`HOME_WORDS`).

首页上的 12 个词在 `app.js` 的 `HOME_WORDS` 里。

## Edit Pokémon · 改宝可梦

`pokemon.json` entries look like:

```json
{"id": 25, "en": "Pikachu", "zh": "皮卡丘", "pinyin": "pí kǎ qiū"}
```

`id` is the PokéAPI number. Forms and costumes use ids above 10000 (Alolan, Mega, Gigantamax, and so on). A curated row wins over `pokedex.json`: it supplies pinyin and the name on the card, and it opens immediately without an extra lookup.

`id` 是 PokéAPI 编号。特殊形态（阿罗拉、Mega、超极巨化等）用大于 10000 的编号。精选名单优先于 `pokedex.json`：有拼音，点开不用再查。

Searching checks curated Pokémon and the full national dex (English, ignoring spaces and punctuation, and Simplified Chinese). One match opens that card. Several matches — `pikachu`, `皮卡丘`, `charizard`, `喷火龙` — show every form as a tappable sprite, with an exact name highlighted first. A normal word such as `cat` still opens the word card. Lucario / 路卡利欧 is not curated; that single match still opens the same artwork card as a tap in the dex. To refresh `pokedex.json` after a new generation:

搜索会对照精选宝可梦和全国图鉴（英文不区分大小写，忽略空格和标点；中文用简体）。只命中一只就打开卡片。命中多只时（比如 pikachu、皮卡丘、charizard、喷火龙）会把每一种形态都画成可以点的小图，完全同名的排在最前面并高亮。普通单词（比如 cat）仍然打开单词卡。路卡利欧不在精选名单里，只命中它一只时，会打开和图鉴里点按相同的卡片。更新图鉴可以重新生成 `pokedex.json`：

```bash
curl -o /tmp/poke.json "https://pokeapi.co/api/v2/pokemon?limit=1025"
curl -o /tmp/names.csv "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv"
python3 - << 'PY'
import json
poke = json.load(open("/tmp/poke.json"))
zh = {}
for line in open("/tmp/names.csv", encoding="utf-8"):
    parts = line.strip().split(",")
    if len(parts) >= 3 and parts[1] == "12":
        zh[int(parts[0])] = parts[2]
rows = []
for p in poke["results"]:
    pid = int(p["url"].rstrip("/").split("/")[-1])
    rows.append({"id": pid, "en": p["name"], "zh": zh.get(pid, "")})
out = ["["] + [("  " + json.dumps(r, ensure_ascii=False) + ("," if i < len(rows) - 1 else "")) for i, r in enumerate(rows)] + ["]", ""]
open("pokedex.json", "w", encoding="utf-8").write("\n".join(out))
print(len(rows))
PY
```

Opening the Pokémon category also refreshes English names from PokéAPI when the network is available. The grid only builds the rows on screen, so the full dex does not create a thousand buttons at once.

打开宝可梦分类时，如果在线，还会用 PokéAPI 刷新英文名。页面只画出屏幕附近的几行，不会一次生成一千多个按钮。

## Local dev · 本地预览

From this folder:

在这个目录里：

```bash
python3 -m http.server 8787
```

Open `http://localhost:8787`. The kid home screen, words, the dex, and Pokémon search work with that. Microphone search needs a browser that supports speech recognition (Safari or Chrome).

打开 `http://localhost:8787`。儿童首页、单词、图鉴和宝可梦搜索都可以这样看。麦克风搜索需要 Safari 或 Chrome。

AI definitions and sign videos need the Pages functions. With [Wrangler](https://developers.cloudflare.com/pages/functions/local-development/):

AI 释义和手语视频要跑 Pages Functions。装了 Wrangler 的话：

```bash
npx wrangler pages dev .
```

Create a `.dev.vars` file with `ANTHROPIC_KEY=sk-ant-...` (do not commit it). Without the key, `/api/lookup` returns an error and the page says the word service is having trouble — that is different from “I don't know that word yet.”

在 `.dev.vars` 里写 `ANTHROPIC_KEY=sk-ant-...`（不要提交）。没有密钥时，查词会提示服务暂时有问题，而不是「还不认识这个词」。

## Deploy · 部署

Cloudflare Pages, production branch `master`, no build command, output directory `/` (the project root). `functions/` is picked up automatically. Set the secret:

Cloudflare Pages，生产分支 `master`，不需要构建命令，输出目录是项目根目录。`functions/` 会自动生效。设置密钥：

```bash
npx wrangler pages secret put ANTHROPIC_KEY
```

Pushing to `master` deploys the site. Work on another branch and open a pull request.

推到 `master` 就会发布。请在别的分支上改，然后开 pull request。

## Fonts · 字体

Fredoka is under the [SIL Open Font License](fonts/OFL-Fredoka.txt). Only the latin and latin-ext slices are included, in weights 500, 600, and 700. Chinese (Noto Sans SC, PingFang, Microsoft YaHei, and similar) comes from the device, so the page does not download a multi-megabyte CJK font.

Fredoka 使用 SIL Open Font License。只带了拉丁文和拉丁文扩展（拼音声调），字重 500、600、700。中文走系统字体，所以不会再下载一整套中文字体文件。
