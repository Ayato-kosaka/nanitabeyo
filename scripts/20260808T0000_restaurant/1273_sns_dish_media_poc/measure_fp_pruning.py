#!/usr/bin/env python3
"""#1349 裏取りキー修正で出てきた偽陽性の型を、規則で落とせるか

## なぜ

#1349（裏取りキーの修正）で逆引きは 1.32倍になったが、増分の目視 precision は
**75%**（チャンネル逆走査）だった。落ちている型は揃っている。

| 型 | 例 |
|---|---|
| 地名そのもの／地名＋一般語 | 愛媛松山 / 東京新宿 / 金沢ランチ / sapporo cafe / 横浜中華街 / 新宿御苑 |
| 一般語 | チャンネル / カウンター / タルタル / 小料理屋 / 手打ちうどん |
| 法人格＋方角 | 株式会社西 |
| ラテンの一般英単語 | porta / color / space / orange / smiley / hachi |

**どれも「屋号として辞書に載っているが、本文中では屋号として使われていない語」**である。
精度を上げれば、裏取りキーの修正で増えた分をそのまま使える。

## 規則（決め方を明記する）

屋号から次を順に剥がし、**残りが2文字未満なら辞書から落とす**。

  1. 法人格（株式会社・有限会社・合同会社…）
  2. 地名トークン（母集団の locality / region と、その末尾の行政区画語を落とした形、
     都道府県名、政令市名）
  3. 一般語（業態語・料理の一般名・映像用語などの手書き語彙）

ラテン名は別に、**英語の一般語だけで構成される名前**を落とす。

**手書き語彙なので取りこぼす（＝これは下限の刈り込みである）。**

## 測るもの

  1. 辞書から落ちる屋号の数
  2. **既知の偽陽性19語のうち何語が落ちるか**（狙ったものが落ちるか）
  3. **既知の真陽性のうち何語が落ちるか**（巻き添えが出ないか）
  4. チャンネル逆走査の実測が、刈り込みでどれだけ変わるか

**ネットワークアクセスはしない。**

実行:
    python3 measure_fp_pruning.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import NameMatcher, normalize_ja  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

CORP = re.compile(r"(株式会社|有限会社|合同会社|合資会社|一般社団法人|"
                  r"公益財団法人|農業協同組合|生活協同組合|㈱|㈲)")
PREFS = ("北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木",
         "群馬", "埼玉", "千葉", "東京", "神奈川", "新潟", "富山", "石川", "福井",
         "山梨", "長野", "岐阜", "静岡", "愛知", "三重", "滋賀", "京都", "大阪",
         "兵庫", "奈良", "和歌山", "鳥取", "島根", "岡山", "広島", "山口", "徳島",
         "香川", "愛媛", "高知", "福岡", "佐賀", "長崎", "熊本", "大分", "宮崎",
         "鹿児島", "沖縄")
# 一般語（業態・料理の一般名・映像用語・容器語）。手書きなので下限。
GENERIC_JA = (
    "ランチ", "ディナー", "モーニング", "グルメ", "チャンネル", "カウンター",
    "テイクアウト", "デリバリー", "食べ歩き", "食堂", "レストラン", "カフェ",
    "喫茶", "喫茶店", "居酒屋", "酒場", "バル", "ビストロ", "ダイニング",
    "小料理", "小料理屋", "割烹", "料理店", "専門店", "本店", "支店", "総本店",
    "中華街", "商店街", "市場", "横丁", "御苑", "公園", "庭園", "会館", "ビル",
    "駅前", "駅ナカ", "空港", "本館", "別館", "新館", "売店", "直売所",
    "うどん", "そば", "蕎麦", "ラーメン", "らーめん", "つけ麺", "寿司", "鮨",
    "焼肉", "やきにく", "カレー", "定食", "天ぷら", "とんかつ", "餃子", "パスタ",
    "ピザ", "ステーキ", "ハンバーグ", "丼", "弁当", "パン", "ケーキ", "スイーツ",
    "タルタル", "手打ち", "手打ちうどん", "自家製", "本格", "絶品", "名物",
    "わさび", "山わさび", "ジンギスカン", "ホルモン", "もつ鍋", "おでん",
)
# 英語の一般語（ラテン名がこれだけで構成されるなら屋号として使われていない）
GENERIC_EN = {
    "porta", "color", "colour", "space", "orange", "smiley", "hachi", "cafe",
    "coffee", "bar", "food", "foods", "kitchen", "dining", "restaurant", "shop",
    "store", "house", "home", "table", "plate", "lunch", "dinner", "menu",
    "style", "club", "room", "place", "market", "garden", "green", "blue",
    "red", "white", "black", "gold", "silver", "sun", "moon", "star", "sky",
    "sea", "river", "hill", "park", "city", "town", "village", "one", "two",
    "first", "new", "old", "big", "little", "good", "best", "happy", "fresh",
    "sweet", "hot", "cool", "grill", "grille", "pizza", "pasta", "ramen",
    "sushi", "curry", "steak", "burger", "bakery", "sapporo", "tokyo", "osaka",
    "kyoto", "fukuoka", "nagoya", "kobe", "yokohama", "hiroshima", "sendai",
    "japan", "japanese", "the", "and", "of", "de", "la", "le", "el",
}

# 既知の偽陽性（#1349 / #1345 の目視で偽と判定したもの）
KNOWN_FP = ["チャンネル", "愛媛松山", "sapporo cafe", "株式会社西", "山わさび",
            "みなとみらい", "横浜中華街", "新宿御苑", "東京新宿", "金沢ランチ",
            "カウンター", "タルタル", "小料理屋", "手打ちうどん",
            "porta", "color", "space", "orange", "smiley", "hachi"]
# 既知の真陽性（落としてはいけないもの）
KNOWN_TP = ["珈琲館マドモアゼル", "昭和ゴールデン", "グリル異人館", "肉の天満屋神楽亭",
            "純喫茶ふじ", "松山ソウルフードの店太養軒", "そばと豚丼北堂", "モツの朝立ち",
            "若山食堂", "よあけ食堂", "真一文字", "中華料理若水", "焼肉かなう",
            "新宿うしみつ", "らぁめんほりうち", "讃岐麺房すずめ", "麺花ゆうしょう",
            "日の出うどん", "手打ちうどんかとう", "元祖博多めんたい重",
            "ムシャムシャ食堂本店", "麺酒場朱拉", "ヨコクラうどん",
            "ラーメン山岡家高松中央インター店", "焼肉ふうふう亭西武新宿駅前店",
            "天ぷらとワイン小島広島店", "大衆酒場あかふじ", "加登長総本店"]


def build_geo_tokens(m: NameMatcher) -> set[str]:
    """母集団の locality / region から、屋号から剥がしてよい地名トークンを作る。"""
    tail = re.compile(r"(市|区|町|村|郡|都|道|府|県)$")
    toks: set[str] = set()
    for loc, reg in m.area.values():
        for t in (loc, reg):
            if not t or len(t) < 2:
                continue
            toks.add(t)
            b = tail.sub("", t, count=1)
            if len(b) >= 2:
                toks.add(b)
    for p in PREFS:
        toks.add(p)
        toks.add(p + "県")
    # 長い順に剥がす（「福岡市博多区」を「福岡」より先に消す）
    return toks


def build_stripper(tokens):
    """剥がす語の automaton。1語ずつ replace すると 890,838 × 数千語で終わらない。

    【自戒】最初の版は素朴な二重ループで書いたため、2分でも終わらなかった。
    文字位置の被覆で残余長を出す方式に変える。
    """
    import ahocorasick
    a = ahocorasick.Automaton()
    for t in tokens:
        if t:
            a.add_word(t, len(t))
    a.make_automaton()
    return a


def residual_len(name: str, auto) -> int:
    """剥がす語で覆われていない文字数。"""
    s = CORP.sub("", name)
    if not s:
        return 0
    covered = bytearray(len(s))
    for end, ln in auto.iter(s):
        for i in range(end - ln + 1, end + 1):
            covered[i] = 1
    return len(s) - sum(covered)


def main() -> None:
    m = NameMatcher()
    geo = build_geo_tokens(m)
    gen = {normalize_ja(g) for g in GENERIC_JA}
    stripper = build_stripper(geo | gen)
    print(f"地名トークン {len(geo):,} / 一般語 {len(gen)}", file=sys.stderr)

    def is_latin_generic(k: str) -> bool:
        if re.search(r"[^\x00-\x7f]", k):
            return False
        words = [w for w in re.split(r"[^a-z0-9]+", k) if w]
        return bool(words) and all(w in GENERIC_EN or w.isdigit() for w in words)

    def should_drop(k: str) -> bool:
        if is_latin_generic(k):
            return True
        if re.search(r"[^\x00-\x7f]", k):
            return residual_len(k, stripper) < 2
        return False

    # --- 狙ったものが落ちるか / 巻き添えは出ないか --------------------------
    print(f"\n=== 既知の偽陽性 {len(KNOWN_FP)} 語（落ちてほしい）===", file=sys.stderr)
    hit_fp = 0
    for w in KNOWN_FP:
        k = normalize_ja(w) if re.search(r"[^\x00-\x7f]", w) else w.lower()
        d = should_drop(k)
        hit_fp += d
        print(f"  {w:16} 落ちる={d}", file=sys.stderr)
    print(f"  **{hit_fp}/{len(KNOWN_FP)} = {hit_fp/len(KNOWN_FP)*100:.0f}% を落とせる**",
          file=sys.stderr)

    print(f"\n=== 既知の真陽性 {len(KNOWN_TP)} 語（落ちてはいけない）===", file=sys.stderr)
    lost = [w for w in KNOWN_TP if should_drop(normalize_ja(w))]
    for w in lost:
        print(f"  **巻き添え** {w}", file=sys.stderr)
    print(f"  巻き添え {len(lost)}/{len(KNOWN_TP)} = "
          f"{len(lost)/len(KNOWN_TP)*100:.1f}%", file=sys.stderr)

    # --- 辞書全体で何語落ちるか --------------------------------------------
    keys = list(m.area.keys())
    dropped = [k for k in keys if should_drop(k)]
    print(f"\n=== 辞書全体 ===", file=sys.stderr)
    print(f"  屋号 {len(keys):,} のうち **{len(dropped):,} = "
          f"{len(dropped)/len(keys)*100:.2f}% を落とす**", file=sys.stderr)
    import hashlib
    smp = sorted(dropped, key=lambda k: hashlib.sha256(k.encode()).hexdigest())[:25]
    print(f"  落とす屋号の決定的標本25（**巻き添えが無いか人が見る**）:", file=sys.stderr)
    for k in smp:
        print(f"    {k}", file=sys.stderr)

    # --- チャンネル逆走査の実測への影響 -------------------------------------
    cache = OUT_DIR / "channel_titles_cache.json"
    if cache.exists():
        d = json.loads(cache.read_text(encoding="utf-8"))
        drop = set(dropped)
        n = tot = tot_p = 0
        for c in d.get("channels", []):
            vids = c.get("videos") or []
            if not isinstance(vids, list) or not vids:
                continue
            s: set[str] = set()
            for v in vids:
                t = (v.get("title") or "") if isinstance(v, dict) else ""
                if t:
                    s |= m.match_corroborated(t)
            n += 1
            tot += len(s)
            tot_p += len(s - drop)
        print(f"\n=== チャンネル逆走査 {n}ch（キャッシュ・再アクセスなし）===",
              file=sys.stderr)
        print(f"  刈り込み前 {tot/max(n,1):.2f} 店/ch", file=sys.stderr)
        print(f"  **刈り込み後 {tot_p/max(n,1):.2f} 店/ch**"
              f"（−{(tot-tot_p)/max(tot,1)*100:.1f}%）", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "fp_pruning.json"
    p.write_text(json.dumps(
        {"n_names": len(keys), "n_dropped": len(dropped),
         "known_fp_caught": hit_fp, "known_fp_total": len(KNOWN_FP),
         "known_tp_lost": lost, "known_tp_total": len(KNOWN_TP),
         "sample_dropped": smp,
         "caveat": "語彙は手書きなので刈り込みは下限。落とす屋号の標本を目視で確かめること。"},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
