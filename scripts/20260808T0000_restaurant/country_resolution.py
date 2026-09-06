#!/usr/bin/env python3
"""#1881 住所から ISO 3166-1 alpha-2 の国コードを決める。

## なぜこのモジュールが要るか

`country_code` は長らく **緯度経度の矩形**（20.0〜46.5N / 122.0〜154.0E）で決めていた。
矩形は国境ではないので、朝鮮半島もウラジオストクも丸ごと `'JP'` になっていた
（dev で 86,043 行以上 / #1881）。

オーナー確定（#1881）:

> B で。**住所から割り出して欲しいよ。**

**この 1 本が判定の正本である。** パイプラインも検証スクリプトもここを呼ぶ。
矩形で国を決めるコードを、二度とどこにも書かない。

## ⚠️ «決められない» を返せることが、この関数の一番大事な性質である

矩形の欠陥は「間違えたこと」ではなく「**分からないのに断言したこと**」だった。
手掛かりが無い住所には `None` を返す。呼び出し側は NULL を入れる
（`3_4_build_restaurant_catalog.py` の country_code は NULL 可）。

## 判定の順序（上が強い）

1. **住所に明示された国**（`KR` / `Korea` / `대한민국` / `日本` / `Россия` …）
2. **文字種** — ハングル → KR / キリル → RU / かな・漢字の行政区画 → JP
3. **行政区画の文法** — ローマ字化された韓国住所は `-dong` `-gil` `-ro` `-myeon`
   `-eup` `-gu` `-si` のような接尾辞を持つ。実測した dev の誤ラベル群は
   **ほとんどがこの形**で、国名も文字種も手掛かりが無い
   （例: `26-8 Bupyeong-dong 2(i)-ga` / `374 Palbonghyangsan-gil, Salmi-myeon`）
4. 同じ形で、日本のローマ字住所（`-ku` / `-shi` / `-cho` / `-machi`）
5. 何も当たらなければ `None`

## ⚠️ 3 の «日本のローマ字住所と衝突しないこと» が唯一の危うさである

日本のローマ字住所にも `-cho` `-machi` `-ku` `-shi` は出る。**韓国側にしか無い
接尾辞だけ**を採り、両方に出るものは採らない。ここは
`test_country_resolution.py` が実データの手ラベルで縛っている。
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# 1. 住所に明示された国名 / 国コード
# ---------------------------------------------------------------------------

# ⚠️ 語境界で当てる。`KR` を部分一致にすると `KRAFT` のような店名混じりの住所に当たる。
_EXPLICIT_COUNTRY_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("KR", re.compile(r"(?:^|[\s,])(?:KR|Korea|South Korea|Republic of Korea)(?:$|[\s,.])", re.IGNORECASE)),
    ("KR", re.compile(r"대한민국|한국")),
    ("JP", re.compile(r"(?:^|[\s,])(?:JP|Japan)(?:$|[\s,.])", re.IGNORECASE)),
    ("JP", re.compile(r"日本国?(?:$|[\s,、])")),
    ("RU", re.compile(r"(?:^|[\s,])(?:RU|Russia|Russian Federation)(?:$|[\s,.])", re.IGNORECASE)),
    ("RU", re.compile(r"Росси[яи]")),
    ("CN", re.compile(r"(?:^|[\s,])(?:CN|China)(?:$|[\s,.])", re.IGNORECASE)),
    ("TW", re.compile(r"(?:^|[\s,])(?:TW|Taiwan)(?:$|[\s,.])", re.IGNORECASE)),
    ("KP", re.compile(r"(?:^|[\s,])(?:KP|North Korea)(?:$|[\s,.])", re.IGNORECASE)),
)

# ---------------------------------------------------------------------------
# 2. 文字種
# ---------------------------------------------------------------------------

_HANGUL = re.compile(r"[가-힣]")
_CYRILLIC = re.compile(r"[Ѐ-ӿ]")
_KANA = re.compile(r"[぀-ヿ]")

# 日本の行政区画（漢字）。`市`『区』は中国語圏にも出るので、**日本にしか無い並び**
# （都道府県名 + 市区町村、または 丁目/番地）を要求する。
_JP_ADDRESS = re.compile(
    r"(?:[都道府県]\s*[^\s]*[市区町村郡])"  # 「長崎県対馬市」など
    r"|(?:丁目|番地|字[^\s])"
    r"|(?:^\s*〒?\d{3}-?\d{4})"  # 郵便番号
)

# ---------------------------------------------------------------------------
# 3. ローマ字化された韓国住所の行政区画接尾辞
# ---------------------------------------------------------------------------

# ⚠️ **韓国側にしか無いものだけ**を採る。
#    採らなかったもの: -cho / -machi / -ku / -shi / -gun（日本のローマ字住所と衝突する）
#    -ri は日本語ローマ字にほぼ出ないが、単独では弱いので «他の接尾辞と一緒か
#    行政区画語（-myeon / -eup）と一緒» のときだけ効かせる。
_KR_STRONG_SUFFIXES = (
    "dong",  # 洞
    "gil",  # 길（路地）
    "ro",  # 로（大通り）
    "myeon",  # 면
    "eup",  # 읍
    "gu",  # 구（区）— ローマ字の日本住所は "-ku"
    "si",  # 시（市）— ローマ字の日本住所は "-shi"
)
# 接尾辞の直前は語でも数字でもよい（`Seongseong 2-gil` のような «通り名 + 連番» が実在する）。
_KR_SUFFIX_RE = re.compile(
    r"(?:^|[\s,\-])[A-Za-z0-9][A-Za-z'()0-9]*-(?:" + "|".join(_KR_STRONG_SUFFIXES) + r")(?:$|[\s,.\d])",
    re.IGNORECASE,
)
# 「Bupyeong-dong 2(i)-ga」「beon-gil」のような、番地表記まで含んだ形。
_KR_NUMBERED_RE = re.compile(r"\d\s*\(\s*[a-z]\s*\)\s*-\s*ga\b|beon-?gil\b", re.IGNORECASE)

# ---------------------------------------------------------------------------
# 4. ローマ字化された日本住所の行政区画接尾辞
# ---------------------------------------------------------------------------
#
# ⚠️ 3 と **必ず素で分かれるもの**だけを採る（韓国は -gu / -si、日本は -ku / -shi）。
#    どちらにも出る綴りは、どちらの表にも入れない。
_JP_STRONG_SUFFIXES = ("ku", "shi", "cho", "machi", "gun", "ken", "fu", "to")
_JP_SUFFIX_RE = re.compile(
    r"(?:^|[\s,\-])[A-Za-z][A-Za-z'0-9]*-(?:" + "|".join(_JP_STRONG_SUFFIXES) + r")(?:$|[\s,.\d])",
    re.IGNORECASE,
)


def country_code_from_address(address: str | None) -> str | None:
    """住所の文字列だけから ISO 3166-1 alpha-2 を返す。決められなければ None。

    ⚠️ **緯度経度は見ない。** 座標で国を決めるのが #1881 の欠陥そのものなので、
       この関数へ座標を渡せるようにしてはいけない。
    """
    if not address:
        return None
    text = address.strip()
    if not text:
        return None

    for code, pattern in _EXPLICIT_COUNTRY_PATTERNS:
        if pattern.search(text):
            return code

    if _HANGUL.search(text):
        return "KR"
    if _CYRILLIC.search(text):
        return "RU"
    if _KANA.search(text) or _JP_ADDRESS.search(text):
        return "JP"

    if _KR_SUFFIX_RE.search(text) or _KR_NUMBERED_RE.search(text):
        return "KR"
    if _JP_SUFFIX_RE.search(text):
        return "JP"

    return None
