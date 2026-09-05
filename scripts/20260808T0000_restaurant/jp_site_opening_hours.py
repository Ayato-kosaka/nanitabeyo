#!/usr/bin/env python3
"""#1666 店舗公式サイトの **日本語の自由記述**から `restaurant_opening_hours` の行を作る。

## なぜこれが要るか

営業時間の供給元は 2 つある。

1. **OSM の `opening_hours`** … `osm_opening_hours.py`。仕様が決まった構造化テキストなので素直。
   dev へ投入済み（13,065 店 / 100,309 行）だが、**62 万店に対する被覆は約 2%** しかない
2. **店舗公式サイト** … website を持つ店が 282,163 店（45.4%）。ここが本命だが、自由記述である

#843 の[実現性の実測（10 件）](https://github.com/Ayato-kosaka/nanitabeyo/issues/843#issuecomment-5429418172)
では、到達できた 7 件のうち 5 件で営業時間の «記載» が見つかった。ただし記載の形はばらばらで、
**「読める」と「機械で構造化できる」は別**である。このモジュールは後者だけを担う。

## ⚠️ 分からないものは «推測しない»（`osm_opening_hours.py` と同じ規則）

#1666 の 3 値判定（open / closed / **unknown**）では、unknown は «今までどおり候補に残る» ので
**害が無い**。一方、間違って closed にすると **開いている店が検索から消える**。
自由記述は OSM よりはるかに曖昧なので、この規則はここでこそ効く。

**扱える形だけを扱い、少しでも解釈が割れるものは `None` を返す。**

とくに次を守る。

- **営業時間が読めても、定休日が読めなければ全体を `None` にする。**
  «第 1・第 3 月曜定休» を落として時間だけ入れると、**休みの日に開いていることにされる**
- 午前/午後・「〜時閉店」だけの片側記述・「ラストオーダー」しか書かれていない形は読まない

## 対応している形

    営業時間 11:00-14:00                     … 曜日を書かない形は «毎日»
    営業時間 11:30～14:30 18:00～21:00        … 1 日に複数コマ
    平日 11:00-14:30 / 土日 8:00-16:00        … 平日・土日・土日祝の区分
    月曜-金曜 09:00-17:00                     … 曜日の範囲
    月・水・金 18:00-23:00                    … 曜日の列挙
    定休日 月曜、火曜                          … その曜日を落とす
    （木曜定休）                               … 括弧内の定休表記
    18:00-26:00                              … 24 時超え表記（26:00 = 翌 2:00）
    全角（１１：００～１４：３０）              … 全角数字・全角コロン・全角チルダ

## 対応していない形（`None` を返す）

    第1・第3月曜定休          … 第 n 週（OSM 側の Mo[1] と同じ理由で不可）
    不定休 / 年中無休(要確認)  … 曜日へ落とせない
    午後4時〜午後10時         … 午前/午後の自由記述
    11:30〜(L.O.14:00)       … 終了時刻が無い
    ランチ営業のみ            … 時刻が無い
    新春セミナー 13:00-15:00  … 営業時間の話だと読める語が無い（曜日も区分も無い場合）

## 使い方

    from jp_site_opening_hours import parse_jp_site_opening_hours

    rows = parse_jp_site_opening_hours("営業時間 11:30～14:30 18:00～21:00 定休日 月曜、火曜")
    # rows is None なら «この文章は扱えない»（unknown のまま残す）
"""

from __future__ import annotations

import re
import unicodedata

from osm_opening_hours import OpeningHourRow

# 0 = 日曜 … 6 = 土曜（PostgreSQL の EXTRACT(DOW) と同じ並び）
_KANJI_TO_DOW = {
    "日": 0,
    "月": 1,
    "火": 2,
    "水": 3,
    "木": 4,
    "金": 5,
    "土": 6,
}
# 曜日の «並び順»。「月曜-金曜」のような範囲を展開するために使う（日本語は月始まりで書く）
_ORDER = ["月", "火", "水", "木", "金", "土", "日"]

_WEEKDAYS = [1, 2, 3, 4, 5]  # 月〜金
_WEEKEND = [6, 0]  # 土・日

# 「平日」「土日」などの区分語。**「祝」は曜日ではないので、含まれていても曜日には足さない**
# （祝日の扱いは restaurant_hours_exceptions の担当で、ここでは曜日だけを作る）
_GROUP_TO_DOWS = {
    "平日": _WEEKDAYS,
    "土日": _WEEKEND,
    "土日祝": _WEEKEND,
    "土・日": _WEEKEND,
    "土日祝日": _WEEKEND,
    "毎日": [0, 1, 2, 3, 4, 5, 6],
    "全日": [0, 1, 2, 3, 4, 5, 6],
    "年中無休": [0, 1, 2, 3, 4, 5, 6],
}

# 時刻の区間。全角は先に正規化してあるので ASCII だけを見る
_TIME_SPAN_RE = re.compile(r"(\d{1,2}):(\d{2})\s*[-~〜～]\s*(\d{1,2}):(\d{2})")

# 「第1・第3月曜」「第2週」など、週の序数が出たら **文章全体を諦める**
_NTH_WEEK_RE = re.compile(r"第\s*\d\s*[,、・･]?\s*(?:第\s*\d\s*)*[週月火水木金土日]")

# 曜日へ落とせない休業表記。出たら諦める
_UNPARSEABLE_CLOSURE_RE = re.compile(r"不定休|臨時休業|要問合せ|要確認|応相談")

# 午前/午後の自由記述。時刻の解釈が割れるので諦める
_AMPM_RE = re.compile(r"午前|午後")

# 「定休日 …」「（木曜定休）」の休業日宣言を拾う
_CLOSED_DECLARATION_RE = re.compile(r"(?:定休日|休業日|定休)")

# 「曜日が書かれていない時刻」を «毎日» と読んでよいと判断するための手がかり。
#
# ⚠️ **ここがこのモジュールで唯一 «書かれていないことを補う» 場所である。**
#    自由記述では、時刻の区間はページ中にいくらでも出てくる（セミナー告知、ラストオーダー、
#    アクセスの電車時刻…）。曜日の手がかりが無いものを無条件に «毎日の営業時間» と読むと、
#    **営業時間ではない数字で全曜日を埋める**（実測: 「新春セミナー 13:00-15:00」で 7 行できた）。
#
#    そこで «営業時間の話をしている» と読める語が本文にあるときだけ、この補完を許す。
#    語が無ければ `None` を返す = unknown のまま残す（候補から消えないので害が無い）。
_OPENING_CONTEXT_RE = re.compile(r"営業時間|営業日|開店|オープン|OPEN|Open|ランチ|ディナー")

# 「この文章はそもそも日本語か」。**このモジュールの一番外側のブレーキ**である。
#
# ⚠️ 上の `_OPENING_CONTEXT_RE` に `OPEN` / `Open` が入っているせいで、
#    **英語・韓国語のページが «営業時間の話をしている» と判定されていた**。
#    このモジュールの休業日の判定（`定休日` / `不定休`）は日本語しか読まないので、
#    いったん非日本語のページが通ると **止める仕組みが 1 つも無い**。実測:
#      `OPEN 11:00-14:00 Closed on Mondays` → 月曜を含む 7 行（ページには休みと書いてある）
#      `영업시간 OPEN 09:00-22:00`          → 7 行
#
#    そこで、時刻を読み始める前に «日本語が 1 つも無い文章» を落とす。
#    判定は 2 本立てにする。仮名だけだと `営業時間 11:00-14:00 定休日 月曜` のような
#    **仮名を 1 文字も含まない日本語ページ**を取りこぼすため、このパーサ自身が
#    手がかりにしている日本語の語も日本語の証拠として数える。
#    （中国語の «营业时间 / 營業時間» は字が違うので当たらない）
#
# ⚠️ 広げすぎても狭すぎても壊れる。**狭いと日本語ページを落として «構造化できた件数» を
#    過小に報告し、広いと非日本語ページを読んで嘘の行を作る**。実際に
#    `[月火水木金土日]曜` だけにしたら `月・水・金 18:00-23:00`（仮名も «曜» も無い
#    正当な日本語）を落とした。曜日を **日本語の区切りで並べた形**も証拠に数える。
_JAPANESE_KANA_RE = re.compile(r"[ぁ-んァ-ヴー]")
_JAPANESE_HOURS_VOCAB_RE = re.compile(
    r"営業時間|営業日|定休|休業|開店|閉店"
    r"|[月火水木金土日]曜"
    r"|[月火水木金土日]\s*[・･]\s*[月火水木金土日]"
    r"|[月火水木金土日]\s*[-~〜～]\s*[月火水木金土日]"
)


def is_japanese_text(text: str) -> bool:
    """日本語専用の処理に流してよい文章か。**日本語が 1 つも無ければ False**。

    ⚠️ 判定を «外から与えられた国コード» でやらないこと。dev には `country_code = 'JP'` の
    まま韓国にある店の行がある（#1666 の dry-run で座標まで確認。原因は
    `3_4_build_restaurant_catalog.py` が矩形で国を決めていること）。仮にそれを直しても、
    **日本にある韓国料理店の韓国語サイト**や **日本の店の英語サイト**は残る。
    国は «どこにあるか» であって «何語で書いてあるか» ではない。判断の材料は文章だけにする。
    """
    return bool(_JAPANESE_KANA_RE.search(text) or _JAPANESE_HOURS_VOCAB_RE.search(text))


def _normalize(text: str) -> str:
    """全角を半角へ寄せ、空白を 1 種類に潰す。

    ⚠️ `NFKC` は «１１：３０» を «11:30» にしてくれるが、**〜（U+301C）と～（U+FF5E）は
       別物として残る**ものがあるので、区切り記号は正規表現側で両方受ける。
    """
    normalized = unicodedata.normalize("NFKC", text)
    # 全角スペース・改行・タブをすべて半角スペース 1 個へ
    return re.sub(r"\s+", " ", normalized.replace("　", " ")).strip()


def _expand_day_tokens(token: str) -> list[int] | None:
    """「月曜-金曜」「月・水・金」「土」→ dow のリスト。読めなければ None。"""
    # 範囲: 月曜-金曜 / 月〜金
    range_match = re.fullmatch(r"([月火水木金土日])(?:曜日?)?\s*[-~〜～]\s*([月火水木金土日])(?:曜日?)?", token)
    if range_match:
        start, end = range_match.group(1), range_match.group(2)
        i, j = _ORDER.index(start), _ORDER.index(end)
        span = _ORDER[i : j + 1] if i <= j else _ORDER[i:] + _ORDER[: j + 1]
        return [_KANJI_TO_DOW[d] for d in span]

    # 列挙: 月・水・金 / 月,水,金 / 月曜、火曜
    parts = re.split(r"[・･,、]", token)
    dows: list[int] = []
    for part in parts:
        m = re.fullmatch(r"\s*([月火水木金土日])(?:曜日?)?\s*", part)
        if not m:
            return None
        dows.append(_KANJI_TO_DOW[m.group(1)])
    return dows or None


def _parse_closed_days(text: str) -> list[int] | None:
    """定休日の宣言から «閉まっている曜日» を返す。宣言が無ければ空リスト。

    ⚠️ **読めない定休表記があれば None を返す**（呼び出し側は文章全体を諦める）。
       時間だけ入れて定休日を落とすと、休みの日に開いていることになる。
    """
    if not _CLOSED_DECLARATION_RE.search(text):
        return []

    closed: list[int] = []
    found_any = False

    # 「（木曜定休）」「木曜定休」の形（曜日が先）
    for m in re.finditer(r"([月火水木金土日](?:曜日?)?(?:\s*[・･,、]\s*[月火水木金土日](?:曜日?)?)*)\s*定休", text):
        dows = _expand_day_tokens(m.group(1))
        if dows is None:
            return None
        closed.extend(dows)
        found_any = True

    # 「定休日 月曜、火曜」の形（曜日が後）
    for m in re.finditer(r"(?:定休日|休業日)\s*[:：]?\s*(?:毎週\s*)?([月火水木金土日](?:曜日?)?(?:\s*[・･,、]\s*[月火水木金土日](?:曜日?)?)*)", text):
        dows = _expand_day_tokens(m.group(1))
        if dows is None:
            return None
        closed.extend(dows)
        found_any = True

    if not found_any:
        # 「定休日」と書いてあるのに曜日が読めなかった = 諦める
        return None
    return sorted(set(closed))


def _rows_for(dows: list[int], spans: list[tuple[str, str, bool]]) -> list[OpeningHourRow]:
    return [
        OpeningHourRow(day_of_week=dow, opens_at=o, closes_at=c, crosses_midnight=x)
        for dow in sorted(set(dows))
        for (o, c, x) in spans
    ]


def _parse_spans(segment: str) -> list[tuple[str, str, bool]]:
    """区間をすべて拾う。`26:00` のような 24 時超え表記は翌日へ折り返す。"""
    spans: list[tuple[str, str, bool]] = []
    for m in _TIME_SPAN_RE.finditer(segment):
        oh, om, ch, cm = (int(g) for g in m.groups())
        if oh > 47 or ch > 47 or om > 59 or cm > 59:
            continue
        crosses = False
        if ch >= 24:
            ch -= 24
            crosses = True
        opens = f"{oh:02d}:{om:02d}"
        closes = f"{ch:02d}:{cm:02d}"
        if not crosses and (ch, cm) <= (oh, om):
            crosses = True  # 18:00-02:00 のような深夜営業
        spans.append((opens, closes, crosses))
    return spans


def parse_jp_site_opening_hours(text: str | None) -> list[OpeningHourRow] | None:
    """日本語の自由記述から営業時間の行を作る。扱えない文章は `None`。"""
    if not text:
        return None

    normalized = _normalize(text)
    # 日本語専用パーサなので、日本語でない文章は読まずに諦める（上の注記）
    if not is_japanese_text(normalized):
        return None

    # ── 諦める条件を先に見る（部分的に読めても入れない） ──────────────
    if _NTH_WEEK_RE.search(normalized):
        return None
    if _UNPARSEABLE_CLOSURE_RE.search(normalized):
        return None
    if _AMPM_RE.search(normalized):
        return None

    closed_days = _parse_closed_days(normalized)
    if closed_days is None:
        return None

    # ── 区分ごとに «その区分の文» を切り出して時刻を拾う ───────────────
    # 例: "平日 11:00-14:30 ディナー 17:00-21:30 土日祝 11:00-14:30"
    group_names = sorted(_GROUP_TO_DOWS, key=len, reverse=True)
    group_re = re.compile("(" + "|".join(re.escape(g) for g in group_names) + ")")

    rows: list[OpeningHourRow] = []
    pieces = group_re.split(normalized)

    if len(pieces) > 1:
        # pieces = [先頭, 区分1, 本文1, 区分2, 本文2, ...]
        for i in range(1, len(pieces), 2):
            group, body = pieces[i], pieces[i + 1] if i + 1 < len(pieces) else ""
            spans = _parse_spans(body)
            if spans:
                rows.extend(_rows_for(_GROUP_TO_DOWS[group], spans))
    if not rows:
        # 区分が無い / 区分の後に時刻が無い → 「曜日の明示」→「曜日なし = 毎日」の順で見る
        day_rows: list[OpeningHourRow] = []
        for m in re.finditer(
            r"([月火水木金土日](?:曜日?)?(?:\s*[-~〜～・･,、]\s*[月火水木金土日](?:曜日?)?)*)\s*[:：]?\s*((?:\d{1,2}:\d{2}\s*[-~〜～]\s*\d{1,2}:\d{2}[^月火水木金土日]*)+)",
            normalized,
        ):
            if "定休" in m.group(0):
                continue
            dows = _expand_day_tokens(m.group(1))
            spans = _parse_spans(m.group(2))
            if dows and spans:
                day_rows.extend(_rows_for(dows, spans))
        if day_rows:
            rows = day_rows
        else:
            # 曜日も区分も無い形。**営業時間の話だと読める語が無ければ諦める**（上の注記）
            if not _OPENING_CONTEXT_RE.search(normalized):
                return None
            spans = _parse_spans(normalized)
            if not spans:
                return None
            rows = _rows_for([0, 1, 2, 3, 4, 5, 6], spans)

    # ── 定休日を落とす ────────────────────────────────────────────
    rows = [r for r in rows if r.day_of_week not in closed_days]
    if not rows:
        return None

    # 同じ (曜日, 開始, 終了) が重複しうるので畳む
    seen: set[tuple[int, str, str, bool]] = set()
    unique: list[OpeningHourRow] = []
    for r in sorted(rows):
        key = (r.day_of_week, r.opens_at, r.closes_at, r.crosses_midnight)
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique
