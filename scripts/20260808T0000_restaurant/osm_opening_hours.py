#!/usr/bin/env python3
"""#1666 OSM の `opening_hours` タグを `restaurant_opening_hours` の行へ変換する。

## なぜこれが要るか

営業時間の供給元は 2 つある。

1. **OSM の `opening_hours`** … 既に BigQuery へ取り込み済み（24,419 件）。追加のネットワーク不要
2. 公式サイトのクロール … #1273 側の fetch 基盤に相乗りする（別途）

OSM 側は **仕様が決まった構造化テキスト**なので、HTML から読むより桁違いに素直である。
ここはその変換だけを持つ純粋関数で、ネットワークにも DB にも触らない。

## 変換先（`infra/supabase/migrations/20260903T0000_create_restaurant_opening_hours.sql`）

`(day_of_week, opens_at, closes_at, crosses_midnight)`。
- `day_of_week` は **0 = 日曜 … 6 = 土曜**（PostgreSQL の `EXTRACT(DOW)` と同じ並び）
- 1 日に複数コマ（昼・夜）があるので、同じ曜日に複数行が出る
- `crosses_midnight` は `closes_at <= opens_at` のとき True（DB 側の CHECK と同じ規則）

## ⚠️ 分からないものは «推測しない»

OSM の文法は広く、月指定・日付指定・`sunrise`/`sunset`・第 n 週などがある。
**扱える形だけを扱い、それ以外は `None` を返す。**

理由は #1666 の 3 値判定（open / closed / **unknown**）にある。
unknown は «今までどおり候補に残る» なので**害が無い**が、間違って closed にすると
**開いている店が検索から消える**。分からないものを推測で埋めると、静かに店が消える。

対応している形:

    24/7
    Mo-Fr 11:00-14:00
    Mo-Fr 11:00-14:00,17:00-22:00     … 1 日に複数コマ
    Mo-Fr 09:00-17:00; Sa,Su 12:00-15:00  … 複数ルール
    Mo-Su 18:00-02:00                 … 深夜営業（日をまたぐ）
    Mo-Su 18:00-26:00                 … 24 時超え表記（26:00 = 翌 2:00）
    Mo-Fr 09:00-17:00; Su off         … 休業日の指定
    11:00-23:00                       … 曜日を書かない形は «毎日»（OSM 仕様）
    PH off                            … 祝日は «曜日» ではないので無視する

対応していない形（`None` を返す）:

    Jan-Mar Mo-Fr 09:00-17:00         … 月・季節の指定
    Mo[1] 09:00-17:00                 … 第 n 月曜
    Mo-Fr sunrise-sunset              … 日の出・日の入り
    Mo-Fr 09:00+                      … 終了時刻なし
    "by appointment"                  … 自由記述

## 使い方

    from osm_opening_hours import parse_osm_opening_hours

    rows = parse_osm_opening_hours("Mo-Fr 11:00-14:00,17:00-22:00; Sa 12:00-15:00")
    # rows is None なら «この文字列は扱えない»（unknown のまま残す）

単体テスト（DB もネットワークも不要）:

    python3 -m unittest scripts/20260808T0000_restaurant/test_osm_opening_hours.py -v
"""

from __future__ import annotations

import re
from typing import NamedTuple

# 0 = 日曜 … 6 = 土曜（PostgreSQL の EXTRACT(DOW) と同じ並び）
_DAY_TO_DOW = {
    "su": 0,
    "mo": 1,
    "tu": 2,
    "we": 3,
    "th": 4,
    "fr": 5,
    "sa": 6,
}
# 曜日の «並び順»。Mo-Su のような範囲を展開するために使う（OSM は Mo 始まり）
_ORDER = ["mo", "tu", "we", "th", "fr", "sa", "su"]

# 「祝日」「学校の休み」は曜日ではないので、この変換では捨てる
_NON_WEEKDAY_SELECTORS = {"ph", "sh", "easter"}

_TIME_SPAN_RE = re.compile(r"^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$")
_DAY_RANGE_RE = re.compile(r"^([A-Za-z]{2})(?:-([A-Za-z]{2}))?$")


class OpeningHourRow(NamedTuple):
    """`restaurant_opening_hours` へ入れる 1 行ぶん（restaurant_id / source は呼び出し側が付ける）"""

    day_of_week: int
    opens_at: str  # "HH:MM"
    closes_at: str  # "HH:MM"
    crosses_midnight: bool


def _parse_time_span(token: str) -> tuple[str, str, bool] | None:
    """"11:00-14:00" → ("11:00", "14:00", False)。扱えなければ None。"""
    m = _TIME_SPAN_RE.match(token)
    if not m:
        return None
    oh, om, ch, cm = (int(x) for x in m.groups())

    if not (0 <= oh <= 23 and 0 <= om <= 59):
        return None
    # ⚠️ OSM は «翌日へ食い込む閉店» を 24 時超えで書く（26:00 = 翌 2:00）。
    #    24:00 は «その日の終わり» なので 00:00 と同じ扱いになる。
    #    47:00 を超えるものは書き間違いとみなして扱わない。
    if not (0 <= ch <= 47 and 0 <= cm <= 59):
        return None

    opens = f"{oh:02d}:{om:02d}"
    closes = f"{ch % 24:02d}:{cm:02d}"
    # DB 側の CHECK と同じ規則: closes <= opens は日をまたぐ（= は 24 時間営業）
    crosses = closes <= opens
    return opens, closes, crosses


def _expand_days(token: str) -> list[int] | None:
    """"Mo-Fr" → [1,2,3,4,5]。"Sa" → [6]。扱えなければ None。"""
    m = _DAY_RANGE_RE.match(token)
    if not m:
        return None
    start, end = m.group(1).lower(), (m.group(2) or "").lower()
    if start in _NON_WEEKDAY_SELECTORS:
        return []  # 祝日等は曜日として展開しない（捨てる）
    if start not in _DAY_TO_DOW:
        return None
    if not end:
        return [_DAY_TO_DOW[start]]
    if end not in _DAY_TO_DOW:
        return None

    # Mo 始まりの並びで、端をまたぐ範囲（Fr-Mo など）も回り込んで展開する
    i, j = _ORDER.index(start), _ORDER.index(end)
    span = _ORDER[i : j + 1] if i <= j else _ORDER[i:] + _ORDER[: j + 1]
    return [_DAY_TO_DOW[d] for d in span]


def _parse_rule(rule: str) -> list[OpeningHourRow] | None:
    """"Mo-Fr 11:00-14:00,17:00-22:00" のような 1 ルールを行へ。扱えなければ None。"""
    rule = rule.strip()
    if not rule:
        return []

    # ⚠️ "11:00-15:00, 17:00-22:00" のようにカンマの後ろに空白が入る書き方がある。
    #    先に潰しておかないと、空白で分割したときに «曜日 + 時刻» と誤読する。
    rule = re.sub(r"\s*,\s*", ",", rule)

    parts = rule.split()
    if len(parts) == 1:
        token = parts[0]
        if token.lower() in ("off", "closed"):
            # "off" 単独 = 全部閉まっている。行を作らない
            return []
        # 曜日を書かない形（"11:00-23:00"）は **OSM 仕様では «毎日»** である。
        # ⚠️ ここを «危ないので扱わない» にしていたが、実データで測ったところ
        #    扱えなかった値のうち最も多いのがこの形だった（上位 3,000 値で 5,935 件中の
        #    大半）。仕様どおり全曜日へ展開する。
        return _parse_all_days_time(token)

    day_token, rest = parts[0], parts[1:]
    # "Mo-Fr,Su 09:00-17:00" のように曜日がカンマで並ぶ形
    days: list[int] = []
    for chunk in day_token.split(","):
        expanded = _expand_days(chunk)
        if expanded is None:
            return None
        days.extend(expanded)

    time_token = " ".join(rest).strip()
    if time_token.lower() in ("off", "closed"):
        # 休業日の指定。行を作らない（= その曜日は営業時間の主張が無い）
        return []
    if not days:
        # 祝日等だけのルール。曜日の行は作らない
        return []

    rows: list[OpeningHourRow] = []
    for span_token in time_token.split(","):
        parsed = _parse_time_span(span_token.strip())
        if parsed is None:
            return None
        opens, closes, crosses = parsed
        for dow in days:
            rows.append(OpeningHourRow(dow, opens, closes, crosses))
    return rows


def _parse_all_days_time(token: str) -> list[OpeningHourRow] | None:
    """曜日を書かない形（"11:00-23:00" / "11:00-14:00,17:00-22:00"）を全曜日へ展開する。

    OSM 仕様では曜日セレクタを省略したルールは «毎日» を意味する。
    """
    rows: list[OpeningHourRow] = []
    for span_token in token.split(","):
        parsed = _parse_time_span(span_token.strip())
        if parsed is None:
            return None
        opens, closes, crosses = parsed
        for dow in range(7):
            rows.append(OpeningHourRow(dow, opens, closes, crosses))
    return rows


def parse_osm_opening_hours(value: str | None) -> list[OpeningHourRow] | None:
    """OSM の `opening_hours` 文字列を行の列へ。

    ⚠️ **扱えない形は `None` を返す。** 呼び出し側はその店を «営業時間不明» のまま
       残すこと（3 値判定の unknown）。推測で埋めると、開いている店が検索から消える。

    戻り値が空リストのときは «扱えたが、曜日の行が 1 つも無い»（全部 off / 祝日のみ）。
    """
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None

    # 自由記述・注釈付きは扱わない（引用符が入るのはコメント構文）
    if '"' in text:
        return None

    if text.lower().replace(" ", "") == "24/7":
        # 0:00-24:00 を全曜日ぶん。closes == opens なので crosses_midnight は True
        return [OpeningHourRow(dow, "00:00", "00:00", True) for dow in range(7)]

    rows: list[OpeningHourRow] = []
    for rule in text.split(";"):
        parsed = _parse_rule(rule)
        if parsed is None:
            return None
        rows.extend(parsed)

    # 同じ (曜日, 開店) が複数ルールから出たら、後のルールを優先する（OSM の意味論）
    deduped: dict[tuple[int, str], OpeningHourRow] = {}
    for row in rows:
        deduped[(row.day_of_week, row.opens_at)] = row
    return sorted(deduped.values())
