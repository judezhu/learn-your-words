#!/usr/bin/env python3
"""Build pokemon.json from PokéAPI data plus the curated entries already in the file.

The handbook-style list is:

* every national species 1–1025, with the official Simplified Chinese name
  (PokéAPI zh-Hans). 52poke is the preferred cross-check for mainland names,
  but wiki.52poke.com answered with a Cloudflare challenge from this environment,
  so new names follow PokéAPI zh-Hans. Existing curated names are kept unless
  they are clearly out of date; those fixes are listed when the script runs.
* alternate forms whose PokéAPI Pokémon id is above 10000 and whose official
  artwork differs from the base species. Totem and other cosmetic duplicates
  that reuse the base artwork are skipped and printed.

Pinyin uses pypinyin (tone marks, syllables separated by spaces). Readings of
长 are forced to cháng ("long"), which is the reading used in these names.
Other polyphonic characters are printed so a person can review them.

Example sentences are original, written for a 7-year-old, and based on each
Pokémon's types. A few well-known species mention a signature trait instead.

Usage (from the repo root, needs network the first time):

    python3 scripts/build_pokemon.py

CSVs are cached under /tmp/poke-build and artwork under /tmp/poke-art.
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "pokemon.json"
CACHE = Path("/tmp/poke-build")
ART_CACHE = Path("/tmp/poke-art")
ART_URL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{id}.png"
CSV_BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/"
CSV_FILES = [
    "pokemon.csv",
    "pokemon_species_names.csv",
    "pokemon_forms.csv",
    "pokemon_form_names.csv",
    "pokemon_types.csv",
    "type_names.csv",
]

# Existing curated Chinese that is clearly behind the current official name.
# Pinyin is regenerated for these.
NAME_FIXES = {
    57: "火暴猴",          # was 火爆猴; current zh-Hans uses 暴
    233: "多边兽２型",       # was 多边兽Ⅱ
}

# Trait that replaces the generic type clause. (english verb phrase, chinese)
SIGNATURE = {
    1: ("has a seed bulb on its back", "背上有一颗种子"),
    2: ("has a bud growing on its back", "背上的花苞正在长大"),
    3: ("has a big flower on its back", "背上开着一朵大花"),
    4: ("has a flame on the tip of its tail", "尾巴尖上有一团火焰"),
    5: ("has a hotter flame on its tail", "尾巴上的火焰更旺了"),
    6: ("flies and breathes a strong flame", "会飞，也能喷出很强的火焰"),
    7: ("hides inside a sturdy shell", "躲在结实的龟壳里"),
    8: ("has a fluffy tail and a hard shell", "有毛茸茸的尾巴和坚硬的壳"),
    9: ("shoots water from cannons on its shell", "龟壳上的炮管能喷水"),
    25: ("stores electricity in its cheeks", "脸颊里存着电"),
    26: ("lets out stronger electricity", "能放出更强的电"),
    39: ("sings a song that makes others sleepy", "唱歌会让别人打瞌睡"),
    52: ("loves shiny coins", "喜欢亮闪闪的金币"),
    54: ("gets a headache when its power wakes up", "力量醒来时会头疼"),
    79: ("is famously slow and relaxed", "出了名地慢吞吞"),
    92: ("is a gas that can slip through walls", "身体像气体，能穿过墙壁"),
    94: ("hides in the dark and grins", "躲在黑暗里笑"),
    129: ("is famous for splashing", "最出名的本事是溅水"),
    130: ("grows from a small fish into a huge dragon", "从小鱼长成巨大的龙"),
    131: ("likes to give people a ride across the water", "喜欢让人骑在背上过河"),
    133: ("can evolve in many different ways", "可以进化成很多不同的样子"),
    143: ("loves to nap and eat", "最爱睡觉和吃东西"),
    144: ("is a legendary bird of freezing wind", "是带来寒风的传说之鸟"),
    145: ("is a legendary bird of lightning", "是带来闪电的传说之鸟"),
    146: ("is a legendary bird of fire", "是带来火焰的传说之鸟"),
    149: ("is a kind dragon that can fly", "是会飞的温柔龙"),
    150: ("was created by science", "是用科学制造出来的"),
    151: ("is a very rare Pokémon", "是非常罕见的宝可梦"),
    196: ("likes the sunlight", "喜欢阳光"),
    197: ("likes the moonlight", "喜欢月光"),
    243: ("is a legendary beast of thunder", "是雷电的传说圣兽"),
    244: ("is a legendary beast of volcanoes", "是火山的传说圣兽"),
    245: ("is a legendary beast of clear water", "是清水的传说圣兽"),
    249: ("is a guardian said to calm the sea", "传说它能让大海平静"),
    250: ("is a rainbow bird of the sky", "是天空中的彩虹之鸟"),
    384: ("flies high above the clouds", "在云层上面飞翔"),
    448: ("can sense a fighting spirit called aura", "能感觉到名叫波导的力量"),
    483: ("is said to watch over time", "传说它掌管时间"),
    484: ("is said to watch over space", "传说它掌管空间"),
    487: ("is said to watch over antimatter", "传说它掌管反物质"),
    700: ("has long ribbon-like feelers", "有丝带一样的长触角"),
}

TYPE_TRAIT = {
    "normal": ("is sturdy and brave", "身体结实，也很勇敢"),
    "fire": ("can breathe hot fire", "能喷出很热的火焰"),
    "water": ("swims very well", "很会游泳"),
    "grass": ("draws power from the sunshine", "能从阳光里得到力量"),
    "electric": ("can make sparks", "能放出电火花"),
    "ice": ("has an icy-cold body", "身体冰冰凉凉的"),
    "fighting": ("is strong in a fight", "打架时非常有力"),
    "poison": ("can spit poison", "能吐出毒液"),
    "ground": ("is mighty on the ground", "在地面上很厉害"),
    "flying": ("can fly through the sky", "能在天上飞"),
    "psychic": ("can use the power of its mind", "能使用心灵的力量"),
    "bug": ("is a quick little bug Pokémon", "是行动敏捷的虫宝可梦"),
    "rock": ("has a body as hard as rock", "身体像岩石一样硬"),
    "ghost": ("can slip through walls", "能穿过墙壁"),
    "dragon": ("is a mighty dragon", "是强大的龙"),
    "dark": ("likes to move at night", "喜欢在夜里活动"),
    "steel": ("has a body of tough metal", "身体像坚硬的金属"),
    "fairy": ("has a gentle fairy charm", "带着温柔的妖精魔力"),
    "stellar": ("shines with crystal power", "身上闪着水晶般的光"),
    "shadow": ("carries a dark shadow", "带着深深的暗影"),
}

# Characters whose reading in a name can go two ways. The script prints every
# new name that contains one, with the syllable it chose.
POLY = set("长重行乐壳藏降觉曲转背只干发了着地数倒乐行")


def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "LearnYourWords/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def ensure_csvs() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    for name in CSV_FILES:
        path = CACHE / name
        if path.exists() and path.stat().st_size > 0:
            continue
        print("downloading", name, file=sys.stderr)
        path.write_bytes(download(CSV_BASE + name))


def read_csv(name: str) -> list[dict]:
    with (CACHE / name).open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def nfkc(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "").replace("’", "'")


def setup_pinyin():
    from pypinyin import load_phrases_dict

    load_phrases_dict({
        "种子": [["zhǒng"], ["zǐ"]],
        "长尾": [["cháng"], ["wěi"]],
        "长毛": [["cháng"], ["máo"]],
        "长耳": [["cháng"], ["ěr"]],
        "长颈": [["cháng"], ["jǐng"]],
        "长鼻": [["cháng"], ["bí"]],
        "长翅": [["cháng"], ["chì"]],
        "长角": [["cháng"], ["jiǎo"]],
        "长牙": [["cháng"], ["yá"]],
        "长舌": [["cháng"], ["shé"]],
        "长手": [["cháng"], ["shǒu"]],
        "长臂": [["cháng"], ["bì"]],
        "长吻": [["cháng"], ["wěn"]],
        "长身": [["cháng"], ["shēn"]],
        "飞行": [["fēi"], ["xíng"]],
        "快乐": [["kuài"], ["lè"]],
        "音乐": [["yīn"], ["yuè"]],
        "探长": [["tàn"], ["zhǎng"]],
        "振翼发": [["zhèn"], ["yì"], ["fà"]],
        "藏玛然特": [["zàng"], ["mǎ"], ["rán"], ["tè"]],
        "三只": [["sān"], ["zhī"]],
        "藏饱": [["cáng"], ["bǎo"]],
    })


def to_pinyin(text: str) -> str:
    from pypinyin import lazy_pinyin, Style

    text = nfkc(text)
    digits = {
        "0": "líng", "1": "yī", "2": "èr", "3": "sān", "4": "sì",
        "5": "wǔ", "6": "liù", "7": "qī", "8": "bā", "9": "jiǔ",
    }
    out: list[str] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if "\u4e00" <= ch <= "\u9fff":
            j = i
            while j < len(text) and "\u4e00" <= text[j] <= "\u9fff":
                j += 1
            hans = text[i:j]
            syls = lazy_pinyin(hans, style=Style.TONE, neutral_tone_with_five=False)
            if len(syls) == len(hans):
                long_next = set("尾毛耳鼻翅角牙舌手臂吻身颈")
                for i, (c, s) in enumerate(zip(hans, syls)):
                    nxt = hans[i + 1] if i + 1 < len(hans) else ""
                    prev = hans[i - 1] if i else ""
                    if c == "长" and nxt in long_next:
                        s = "cháng"
                    elif c == "长" and prev == "探":
                        s = "zhǎng"
                    elif c == "发" and prev == "翼":
                        s = "fà"
                    elif c == "藏" and hans.startswith("藏玛"):
                        s = "zàng"
                    elif c == "只" and prev in "一二三四五六七八九十":
                        s = "zhī"
                    out.append(s)
            else:
                out.extend(syls)
            i = j
            continue
        if ch.isdigit():
            out.append(digits.get(ch, ch))
        elif ch.isascii() and ch.isalpha():
            out.append(ch.upper())
        i += 1
    return " ".join(out)


def article(type_name: str) -> str:
    return "an" if type_name[:1].lower() in "aeiou" else "a"


def type_phrase(types: list[tuple[str, str, str]]) -> tuple[str, str, str]:
    """types are (English name, trait key, Chinese name)."""
    if not types:
        return "Mystery", "normal", "未知"
    en = [t[0] for t in types[:2]]
    zh = [t[2] for t in types[:2]]
    key = types[0][1]
    if len(en) == 1:
        return en[0], key, zh[0] + "系"
    return f"{en[0]} and {en[1]}", key, zh[0] + "系和" + zh[1] + "系"


def sentence(pid: int, en: str, zh: str, types: list[tuple[str, str, str]], use_signature: bool) -> tuple[str, str]:
    en_types, key, zh_types = type_phrase(types)
    if use_signature and pid in SIGNATURE:
        trait_en, trait_zh = SIGNATURE[pid]
    else:
        trait_en, trait_zh = TYPE_TRAIT.get(key, TYPE_TRAIT["normal"])
    art = article(en_types.split()[0])
    ex_en = f"{en} is {art} {en_types} Pokémon that {trait_en}."
    ex_zh = f"{zh}是{zh_types}宝可梦，{trait_zh}。"
    return ex_en, ex_zh


def form_zh(identifier: str, species_zh: str, api_zh: str) -> str:
    api_zh = nfkc(api_zh or "")
    species_zh = nfkc(species_zh or "")
    ident = identifier or ""
    if api_zh and species_zh and species_zh in api_zh and "的样子" not in api_zh:
        return api_zh
    if ident.endswith("-mega-x"):
        return "超级" + species_zh + "X"
    if ident.endswith("-mega-y"):
        return "超级" + species_zh + "Y"
    if "-mega" in ident:
        return "超级" + species_zh
    if "-gmax" in ident:
        return "超极巨化" + species_zh
    if "alola" in ident:
        return "阿罗拉" + species_zh
    if "galar" in ident:
        return "伽勒尔" + species_zh
    if "hisui" in ident:
        return "洗翠" + species_zh
    if "paldea" in ident:
        return "帕底亚" + species_zh
    if ident.endswith("-primal"):
        return "原始" + species_zh
    if api_zh and "的样子" not in api_zh:
        return f"{species_zh}（{api_zh}）"
    pretty = ident.split("-", 1)[-1].replace("-", " ")
    return f"{species_zh}（{pretty}）"


def fetch_art(pid: int) -> bytes | None:
    ART_CACHE.mkdir(parents=True, exist_ok=True)
    path = ART_CACHE / f"{pid}.png"
    if path.exists() and path.stat().st_size > 80:
        data = path.read_bytes()
        if data.startswith(b"\x89PNG"):
            return data
    try:
        data = download(ART_URL.format(id=pid))
    except Exception:
        return None
    if not data.startswith(b"\x89PNG"):
        return None
    path.write_bytes(data)
    return data


def load_curated_locks() -> dict[int, dict]:
    """Keep hand-written names and pinyin from master, not from a previous build."""
    import subprocess
    try:
        raw = subprocess.check_output(
            ["git", "show", "master:pokemon.json"],
            cwd=ROOT,
            stderr=subprocess.DEVNULL,
        )
        data = json.loads(raw)
    except Exception:
        data = json.loads((ROOT / "pokemon.json").read_text(encoding="utf-8"))
    return {p["id"]: p for p in data}


def main() -> None:
    ensure_csvs()
    setup_pinyin()
    pokemon = read_csv("pokemon.csv")
    species_rows = read_csv("pokemon_species_names.csv")
    forms = read_csv("pokemon_forms.csv")
    form_names = read_csv("pokemon_form_names.csv")
    poke_types = read_csv("pokemon_types.csv")
    type_names = read_csv("type_names.csv")

    zh_by_species: dict[int, str] = {}
    en_by_species: dict[int, str] = {}
    for row in species_rows:
        sid = int(row["pokemon_species_id"])
        if row["local_language_id"] == "12":
            zh_by_species[sid] = row["name"]
        elif row["local_language_id"] == "9":
            en_by_species[sid] = nfkc(row["name"])

    en_type: dict[int, str] = {}
    zh_type_key: dict[int, str] = {}
    # English identifier from lang 9, Chinese label from lang 12.
    # type_names columns: type_id, local_language_id, name
    type_ident: dict[int, str] = {}
    for row in type_names:
        tid = int(row["type_id"])
        if row["local_language_id"] == "9":
            en_type[tid] = row["name"]
        elif row["local_language_id"] == "12":
            zh_type_key[tid] = row["name"]

    def type_key(tid: int) -> str:
        name = en_type.get(tid, "Normal").split()[0].lower()
        if name == "???":
            return "normal"
        return name

    types_of: dict[int, list[tuple[str, str]]] = {}
    for row in sorted(poke_types, key=lambda r: (int(r["pokemon_id"]), int(r["slot"]))):
        pid = int(row["pokemon_id"])
        tid = int(row["type_id"])
        en = en_type.get(tid, "Normal")
        en = en[:1].upper() + en[1:] if en else en
        key = type_key(tid)
        if key not in TYPE_TRAIT:
            key = "normal"
        zh = zh_type_key.get(tid, "一般")
        types_of.setdefault(pid, []).append((en, key, zh))

    def types_for(pid: int) -> list[tuple[str, str, str]]:
        return types_of.get(pid) or []

    zh_form: dict[str, str] = {}
    en_form: dict[str, tuple[str, str]] = {}
    for row in form_names:
        if row["local_language_id"] == "12":
            zh_form[row["pokemon_form_id"]] = row["form_name"] or row["pokemon_name"]
        elif row["local_language_id"] == "9":
            en_form[row["pokemon_form_id"]] = (row["form_name"], row["pokemon_name"])
    forms_by_pokemon: dict[str, list[dict]] = {}
    for row in forms:
        forms_by_pokemon.setdefault(row["pokemon_id"], []).append(row)

    old = load_curated_locks()
    by_id = {int(p["id"]): p for p in pokemon}

    # Artwork for every species and every high id.
    ids_needed = list(range(1, 1026)) + [int(p["id"]) for p in pokemon if int(p["id"]) > 10000]
    print(f"checking artwork for {len(ids_needed)} ids...", file=sys.stderr)
    art: dict[int, bytes | None] = {}
    with ThreadPoolExecutor(max_workers=16) as pool:
        futs = {pool.submit(fetch_art, pid): pid for pid in ids_needed}
        done = 0
        for fut in as_completed(futs):
            pid = futs[fut]
            art[pid] = fut.result()
            done += 1
            if done % 200 == 0:
                print(f"  artwork {done}/{len(ids_needed)}", file=sys.stderr)
    hashes = {pid: hashlib.sha256(data).hexdigest() if data else None for pid, data in art.items()}

    changed: list[str] = []
    flagged: list[str] = []
    missing_art: list[int] = []
    skipped: list[str] = []
    entries: list[dict] = []

    def remember_poly(pid: int, zh: str, py: str, generated: bool) -> None:
        if not generated:
            return
        chars = [c for c in zh if c in POLY]
        if not chars:
            return
        flagged.append(f"#{pid} {zh} / {py}  [{''.join(chars)}]")

    def add_entry(pid: int, en: str, zh: str, generated_pinyin: bool, species_id: int) -> None:
        if pid in NAME_FIXES:
            zh = NAME_FIXES[pid]
            py = to_pinyin(zh)
            generated_pinyin = True
            prev = old.get(pid)
            if prev and prev["zh"] != zh:
                changed.append(f"#{pid} {prev['en']}: {prev['zh']} → {zh} (pinyin {prev['pinyin']} → {py})")
        elif pid in old and old[pid]["zh"] == zh:
            py = old[pid]["pinyin"]
            en = old[pid]["en"]
            generated_pinyin = False
        elif pid in old and old[pid]["zh"] != zh and pid not in NAME_FIXES:
            # Keep the curated name; it was an intentional choice.
            prev = old[pid]
            changed.append(f"#{pid} kept curated {prev['zh']} (PokéAPI zh-Hans is {zh})")
            zh = prev["zh"]
            en = prev["en"]
            py = prev["pinyin"]
            generated_pinyin = False
        else:
            py = to_pinyin(zh)
        remember_poly(pid, zh, py, generated_pinyin)
        t_raw = types_for(pid) or types_for(species_id)
        ex_en, ex_zh = sentence(species_id, en, zh, t_raw, use_signature=(pid <= 1025))
        entries.append({
            "id": pid,
            "en": en,
            "zh": zh,
            "pinyin": py,
            "exEn": ex_en,
            "exZh": ex_zh,
        })

    for sid in range(1, 1026):
        poke = by_id.get(sid)
        if poke is None:
            missing_art.append(sid)
            continue
        zh = zh_by_species.get(sid, "")
        en = en_by_species.get(sid) or poke["identifier"]
        if hashes.get(sid) is None:
            missing_art.append(sid)
        add_entry(sid, en, zh, True, sid)

    for poke in pokemon:
        pid = int(poke["id"])
        if pid <= 10000:
            continue
        sid = int(poke["species_id"])
        ident = poke["identifier"]
        base_hash = hashes.get(sid)
        this_hash = hashes.get(pid)
        curated = pid in old
        if this_hash is None and not curated:
            skipped.append(f"#{pid} {ident}: no official artwork")
            continue
        if this_hash is None and curated:
            missing_art.append(pid)
        if base_hash and this_hash == base_hash and not curated:
            skipped.append(f"#{pid} {ident}: artwork identical to species #{sid}")
            continue
        species_zh = zh_by_species.get(sid, "")
        species_en = en_by_species.get(sid, "")
        api_zh = ""
        api_en = ""
        for form in forms_by_pokemon.get(str(pid), []):
            api_zh = api_zh or zh_form.get(form["id"], "")
            en_pair = en_form.get(form["id"])
            if en_pair and en_pair[1]:
                api_en = en_pair[1]
            elif en_pair and en_pair[0] and not api_en:
                api_en = en_pair[0]
        zh = form_zh(ident, species_zh, api_zh)
        en = nfkc(api_en) if api_en else ident
        add_entry(pid, en, zh, True, sid)

    entries.sort(key=lambda e: e["id"])
    # De-duplicate ids (should not happen).
    seen = set()
    unique = []
    for e in entries:
        if e["id"] in seen:
            continue
        seen.add(e["id"])
        unique.append(e)
    entries = unique

    lines = ["["]
    for i, row in enumerate(entries):
        comma = "," if i < len(entries) - 1 else ""
        lines.append("  " + json.dumps(row, ensure_ascii=False) + comma)
    lines.append("]")
    lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf-8")

    base = sum(1 for e in entries if e["id"] <= 1025)
    forms_n = sum(1 for e in entries if e["id"] > 10000)
    print(f"wrote {OUT} entries={len(entries)} species={base} forms={forms_n}")
    print(f"bytes={OUT.stat().st_size}")
    print("\n== name changes ==")
    print("\n".join(changed) if changed else "(none)")
    print(f"\n== flagged pinyin ({len(flagged)}) ==")
    print("\n".join(flagged))
    print(f"\n== missing species artwork ({len(missing_art)}) ==")
    print(", ".join(str(i) for i in missing_art) or "(none)")
    print(f"\n== skipped forms ({len(skipped)}) ==")
    print("\n".join(skipped))


if __name__ == "__main__":
    main()
