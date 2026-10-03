"""公式サイトの `<script type="application/ld+json">` から営業時間を取り出す（#1666）。

## なぜ要るか

`official_site_crawl.html_to_text()` は **`<script>` を丸ごと捨てる**（構造を見ない正規表現の
テキスト化なので、そうしないとコードが本文に混ざる）。その結果、schema.org の
`Restaurant.openingHours` / `openingHoursSpecification` は **1 バイトも見ていない**。

⚠️ **これは «取りこぼしているかもしれない» という仮説であって、まだ量を測っていない。**
この module は **測るために**書いた。取り込みへ使うかどうかは、量を見てから決める
（#1666 で «測る前に断言して 2 回外している»）。

## 読む形

schema.org は同じことを 2 通りで書ける。どちらも実在するので両方読む。

1. `"openingHours": "Mo-Fr 11:00-14:00"` （文字列 or 文字列の配列。Google の例もこの形）
2. `"openingHoursSpecification": [{"dayOfWeek": [...], "opens": "11:00", "closes": "14:00"}]`

⚠️ **`@graph` と配列トップレベルを忘れないこと。** JSON-LD は 1 ファイルに複数の実体を
並べられるので、素直に `data["openingHours"]` を見るだけでは半分取りこぼす。

⚠️ **ここでは «曜日 × 時刻» へ展開しない。** 展開の規則（優先順位・定休日・日またぎ）は
`jp_site_opening_hours` が持っており、2 箇所に分けると必ずずれる。この module は
**「書いてあるか」と「何日ぶんか」**までを返す。
"""

from __future__ import annotations

import json
import re

__all__ = [
    "iter_jsonld_blocks",
    "extract_opening_hours_entries",
    "has_opening_hours",
    "entries_with_times",
    "has_opening_hours_with_times",
]

# `<script type="application/ld+json">…</script>` の中身。
# ⚠️ `type` の前後に他の属性が来ることがあるので、属性の順番を決め打ちしない。
_LD_JSON_RE = re.compile(
    r'(?is)<script[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script>'
)


def iter_jsonld_blocks(html: str):
    """HTML の中の JSON-LD を 1 つずつ返す（壊れているものは黙って飛ばす）。

    ⚠️ **壊れた JSON で例外を投げないこと。** 実サイトの JSON-LD は末尾カンマ・
    生の改行・HTML コメント混入などで普通に壊れている。1 つ壊れているせいで
    そのページ全体を諦めると、**測っているものが «壊れていないサイトの割合» に化ける**。
    """
    for match in _LD_JSON_RE.finditer(html):
        raw = match.group(1).strip()
        # <!-- --> で囲っているサイトがある
        raw = re.sub(r"(?s)^<!--(.*)-->$", r"\1", raw).strip()
        if not raw:
            continue
        try:
            yield json.loads(raw)
        except (ValueError, RecursionError):
            continue


def _walk(node):
    """dict / list を素直に降りる。`@graph` もただの list なのでこれで拾える。"""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


def extract_opening_hours_entries(html: str) -> list[object]:
    """営業時間が書かれている JSON-LD の値をそのまま集めて返す。

    返すのは «生の値» である（文字列 / 文字列の配列 / spec の dict の配列）。
    ⚠️ 曜日 × 時刻へ展開しない（module の docstring の注記）。
    """
    found: list[object] = []
    for block in iter_jsonld_blocks(html):
        for node in _walk(block):
            for key in ("openingHours", "openingHoursSpecification"):
                value = node.get(key)
                if value:
                    found.append(value)
    return found


def has_opening_hours(html: str) -> bool:
    return bool(extract_opening_hours_entries(html))


# `"opens": "11:00"` / `"Mo-Fr 11:00-14:00"` のどちらでも «時刻» はこの形で書かれる。
# ⚠️ ISO 8601 の `11:00:00` / `11:00+09:00` も実在するので、後ろを決め打ちしない。
_TIME_IN_JSONLD_RE = re.compile(r"\d{1,2}:\d{2}")


def _entry_has_times(value) -> bool:
    """その値に **開始と終了の両方**が書かれているか。

    ⚠️ **«書いてある» と «使える» は別である。** 実在する無価値な形が 2 つある。

    - `"openingHours": "Mo-Su"` … 曜日だけ。営業時間が 1 つも無い
    - `"openingHoursSpecification": [{"dayOfWeek": "Monday"}]` … `opens` / `closes` が無い

    これを «取れた» に数えると、測っているものが **«JSON-LD を書いているサイトの割合»**
    に化ける（知りたいのは «営業時間が増えるか» である）。
    """
    if isinstance(value, str):
        # "Mo-Fr 11:00-14:00" は開始と終了で 2 つ出る。1 つだけなら片側記述で使えない
        return len(_TIME_IN_JSONLD_RE.findall(value)) >= 2
    if isinstance(value, list):
        return any(_entry_has_times(item) for item in value)
    if isinstance(value, dict):
        # ⚠️ dict は `opens` / `closes` だけを見る。値を再帰で降りると
        # `validFrom` や無関係な時刻を «営業時間» として数える
        opens, closes = value.get("opens"), value.get("closes")
        return bool(
            isinstance(opens, str)
            and isinstance(closes, str)
            and _TIME_IN_JSONLD_RE.search(opens)
            and _TIME_IN_JSONLD_RE.search(closes)
        )
    return False


def entries_with_times(html: str) -> list[object]:
    """営業時間として **使える**（開始と終了が書かれている）値だけを返す。"""
    return [entry for entry in extract_opening_hours_entries(html) if _entry_has_times(entry)]


def has_opening_hours_with_times(html: str) -> bool:
    return bool(entries_with_times(html))
