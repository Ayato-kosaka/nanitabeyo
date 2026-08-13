#!/usr/bin/env python3
"""日本語の店名・住所を比較可能な形へ揃えるための共通処理。

名寄せ側（クエリ組立）と検証側（正解判定）の両方から使う。両者で正規化が
食い違うと「実際は当たっているのに検証で落ちる」ため、1か所にまとめている。
"""

from __future__ import annotations

import re
import unicodedata

PREFECTURE_PATTERN = re.compile(r"(北海道|東京都|京都府|大阪府|..県)")
POSTCODE_PATTERN = re.compile(r"^\s*(\d{3})-?(\d{4})\s*$")
POSTCODE_IN_TEXT = re.compile(r"〒\s*\d{3}-?\d{4}")

CORPORATE_FORMS = (
    "株式会社", "有限会社", "合同会社", "合資会社", "一般社団法人", "公益社団法人",
    "(株)", "(有)", "㈱", "㈲",
)
# 末尾の括弧書き（読み仮名・英字併記）。「Mermaid Cafe（マーメイドカフェ）」等。
BRACKET_TAIL = re.compile(r"[（(【\[][^（()）【】\[\]]{1,40}[)）】\]]\s*$")
# 比較時にだけ落とす業態・支店の語。クエリでは落とさない（支店の取り違えを招くため）。
COMPARISON_NOISE = re.compile(
    r"(店|本店|支店|駅前店|営業所|フードコート|レストラン|居酒屋|カフェ|食堂)"
)


def normalize_for_query(value: str) -> str:
    """Google へ投げる店名。過度に削らず、検索の邪魔になるものだけ落とす。"""

    text = unicodedata.normalize("NFKC", value or "")
    text = POSTCODE_IN_TEXT.sub(" ", text)
    for form in CORPORATE_FORMS:
        text = text.replace(form, " ")
    text = text.replace("|", " ").replace("/", " ").replace("　", " ")
    return re.sub(r"\s+", " ", text).strip()


def strip_bracket_tail(value: str) -> str:
    stripped = BRACKET_TAIL.sub("", value).strip()
    return stripped or value


def normalize_for_comparison(value: str) -> str:
    """似ているかどうかを測るための、最も潰した形。

    比較時は業態語や支店語まで落とす。「百万石うどんこのみ小中店」と
    「このみ百万石うどん 小中店」を同一と見なせるようにするためで、
    語順の違いは後段の文字集合ベースの類似度で吸収する。
    """

    text = unicodedata.normalize("NFKC", value or "").casefold()
    for form in CORPORATE_FORMS:
        text = text.replace(unicodedata.normalize("NFKC", form).casefold(), "")
    text = COMPARISON_NOISE.sub("", text)
    return "".join(character for character in text if character.isalnum())


def character_bigrams(value: str) -> set[str]:
    if len(value) < 2:
        return {value} if value else set()
    return {value[index : index + 2] for index in range(len(value) - 1)}


def name_similarity(left: str, right: str) -> float:
    """0.0〜1.0 の類似度。文字bigramのJaccardに包含関係の救済を足したもの。

    日本語の店名は語順が入れ替わる（「A B店」と「B A 店」）ため、文字順に強く
    依存する編集距離ではなく集合ベースで測る。片方が他方を完全に含む場合は、
    長さ差で不当に下がらないよう 1.0 に寄せる。
    """

    a, b = normalize_for_comparison(left), normalize_for_comparison(right)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if a in b or b in a:
        return max(0.85, min(len(a), len(b)) / max(len(a), len(b)))
    left_grams, right_grams = character_bigrams(a), character_bigrams(b)
    union = left_grams | right_grams
    if not union:
        return 0.0
    return len(left_grams & right_grams) / len(union)
