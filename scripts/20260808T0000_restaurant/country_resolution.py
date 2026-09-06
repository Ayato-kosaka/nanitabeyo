#!/usr/bin/env python3
"""#1881 住所から ISO 3166-1 alpha-2 の国コードを決める。**判定はこの 1 本が正本。**

## なぜこのモジュールが要るか

`country_code` は長らく **緯度経度の矩形**（20.0〜46.5N / 122.0〜154.0E）で決めていた。
矩形は国境ではないので、朝鮮半島もウラジオストクも丸ごと `'JP'` になっていた
（dev で 98,139 行 / #1881）。

オーナー確定（#1881）:

> B で。**住所から割り出して欲しいよ。** あとちゃんとテストしてください。

## ⚠️ 判定を 2 箇所に書かない

#1881 の本当の欠陥は «矩形で決めたこと» ではなく、**同じ矩形が 7 箇所に写経され、
検証もその矩形を使っていた**ことである。作った規則と同じ規則で確かめていたので、
何を作っても緑になった。

だからここでは **順序付きの `RULES` 1 本**だけを定義し、

- Python の `country_code_from_address()`（同期・監査・テストが使う）
- BigQuery の `country_code_sql()`（`3_4_build_restaurant_catalog.py` が使う）

の両方を **そこから作る**。どちらか片方へ規則を書き足せないようにしてある。

## ⚠️ «決められない» を返せることが、この関数の一番大事な性質である

矩形の欠陥は「間違えたこと」より「**分からないのに断言したこと**」である。
手掛かりが無い住所には `None`（SQL では NULL）を返す。`country_code` は NULL 可。

## 正規表現は Python `re` と BigQuery RE2 の共通部分だけで書く

先読み・後方参照・`\\p{...}` は使わない。大文字小文字を無視したいときは
**パターン先頭の `(?i)`** で書く（`re.IGNORECASE` を使うと SQL 側へ運べない）。
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# 判定の正本 — 上から順に当て、最初に当たったものを返す
# ---------------------------------------------------------------------------
#
# 並び順に意味がある:
#   1. 住所に明示された国名・国コード（一番強い）
#   2. 文字種（ハングル / キリル）
#   3. 日本にしか無い住所の書き方
#   4. ローマ字化された行政区画の接尾辞（韓国 → 日本の順）
#
# ⚠️ 4 は «両方の言語に出る綴りを入れない» ことだけが安全性の根拠である。
#    韓国は `-gu` / `-si`、日本は `-ku` / `-shi`。`-cho` `-machi` は日本にしか無い。
#    迷ったら **どちらの表にも入れない**（None を返すほうが、間違えるより良い）。

_KR_ROMAN_SUFFIXES = ("dong", "gil", "ro", "myeon", "eup", "gu", "si")
_JP_ROMAN_SUFFIXES = ("ku", "shi", "cho", "machi", "gun", "ken", "fu", "to")


def _roman_suffix_pattern(suffixes: tuple[str, ...]) -> str:
    """`Bupyeong-dong` `Shibuya-ku` のような «語 or 数字 + ハイフン + 接尾辞» を当てる。"""
    return (
        r"(?i)(?:^|[\s,\-])[A-Za-z0-9][A-Za-z'()0-9]*-(?:"
        + "|".join(suffixes)
        + r")(?:$|[\s,.\d])"
    )


RULES: tuple[tuple[str, str], ...] = (
    # --- 1. 住所に明示された国 -------------------------------------------------
    # ⚠️ 語境界で当てる。`KR` を部分一致にすると `KRAFT ビル` のような住所に当たる。
    (r"(?i)(?:^|[\s,])(?:KR|Korea|South Korea|Republic of Korea)(?:$|[\s,.])", "KR"),
    (r"대한민국|한국", "KR"),
    (r"(?i)(?:^|[\s,])(?:JP|Japan)(?:$|[\s,.])", "JP"),
    (r"日本国?(?:$|[\s,、])", "JP"),
    (r"(?i)(?:^|[\s,])(?:RU|Russia|Russian Federation)(?:$|[\s,.])", "RU"),
    (r"Росси[яи]", "RU"),
    (r"(?i)(?:^|[\s,])(?:CN|China)(?:$|[\s,.])", "CN"),
    (r"(?i)(?:^|[\s,])(?:TW|Taiwan)(?:$|[\s,.])", "TW"),
    (r"(?i)(?:^|[\s,])(?:KP|North Korea)(?:$|[\s,.])", "KP"),
    # --- 2. 文字種 -------------------------------------------------------------
    (r"[가-힣]", "KR"),  # ハングル
    (r"[Ѐ-ӿ]", "RU"),  # キリル
    (r"[぀-ヿ]", "JP"),  # かな・カナ
    # --- 3. 日本にしか無い住所の書き方 ------------------------------------------
    #
    # ⚠️ 当初は「都道府県名 + 市区町村」を要求していたが、dev の実データはそこまで
    #    書いていない行が多く（`高知市追手筋1-3-11` / `根津2-32-8`）、
    #    98,190 行が «決められない» に落ちた（run 34032307384）。
    #    ハングル・キリルは 2 で抜けているので、ここへ来る漢字混じりは日本・中国語圏。
    (r"[都道府県]\s*[^\s]*[市区町村郡]", "JP"),
    (r"[^\s]{1,6}[市区町村郡][^\s]", "JP"),
    (r"丁目|番地", "JP"),
    (r"^\s*〒?\d{3}-?\d{4}", "JP"),  # 郵便番号
    (r"[一-鿿][^\s]*[0-9０-９]+[-−ー][0-9０-９]+", "JP"),
    (r"(?i)\bChome\b", "JP"),  # ローマ字の「丁目」。韓国の住所には出ない
    # --- 4. ローマ字化された行政区画 --------------------------------------------
    (_roman_suffix_pattern(_KR_ROMAN_SUFFIXES), "KR"),
    # 「Bupyeong-dong 2(i)-ga」「beon-gil」のような番地表記
    (r"(?i)(?:\d\s*\(\s*[a-z]\s*\)\s*-\s*ga|beon-?gil)(?:$|[\s,.])", "KR"),
    (_roman_suffix_pattern(_JP_ROMAN_SUFFIXES), "JP"),
)

_COMPILED: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(pattern), code) for pattern, code in RULES
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
    for pattern, code in _COMPILED:
        if pattern.search(text):
            return code
    return None


def country_code_sql(address_expr: str) -> str:
    """同じ `RULES` から BigQuery の CASE 式を組む。

    `3_4_build_restaurant_catalog.py` がこれを埋め込む。**SQL 側へ規則を書かない。**

    Args:
        address_expr: 住所の列を指す SQL 式（例: `s.canonical_address`）
    """
    branches = "\n            ".join(
        # r'''…''' で囲むのは、パターンに `'` が入りうるため。
        f"WHEN REGEXP_CONTAINS({address_expr}, r'''{pattern}''') THEN '{code}'"
        for pattern, code in RULES
    )
    return f"CASE\n            {branches}\n          END"
