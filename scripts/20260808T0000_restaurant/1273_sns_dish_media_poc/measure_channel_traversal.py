#!/usr/bin/env python3
"""#1273 Round3 アイデアA: チャンネル逆走査の検証

measure_sweep_saturation.py で「1市区町村に134カテゴリを全部投げても45店しか出ない、
1クエリあたり初出は0.91→0.06まで落ちる」という飽和を実測した。ただしこれが意味するのは
**YouTubeの供給が尽きた**ことではなく、**検索ランキングが尽きた**ことかもしれない。
同じ動画でも「その動画を作ったチャンネルの過去動画を全部列挙する」経路なら、
検索順位に一切縛られずに到達できる。

本スクリプトはその仮説を検証する:
  1. 少数のカテゴリ×エリア検索で「実在店舗を名指しした動画」を出したチャンネルを種として集める
  2. そのチャンネルの過去動画を全列挙する（yt-dlp 1コールで数百件）
  3. 全動画タイトルを全国店名辞書に逆引きし、distinct店舗数を数える
  4. 検索経路（134クエリ/市区町村）とのクエリ効率を比較する

実行:
    python3 measure_channel_traversal.py --seed-queries 40 --max-channels 25
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import re
import subprocess
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import ahocorasick  # type: ignore

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
YT_DLP = Path("/tmp/yt-dlp-latest")

# #1279 【仕様】全国辞書は誤マッチが命取りなので、短い名前とチェーン名を落とす。
# 検索経路の検証(MIN_NAME_LEN=3, locality内)より厳しくしているのは、
# 全国789k件を相手にすると3文字では偶然一致が支配的になるため。
MIN_NAME_LEN_NATIONAL = 4
STOPWORD_NAMES = {
    "食堂", "カフェ", "レストラン", "居酒屋", "喫茶店", "ラーメン", "そば", "うどん",
    "寿司", "すし", "焼肉", "定食", "パン屋", "弁当", "cafe", "bar", "restaurant",
    "コーヒー", "ダイニング", "キッチン", "ビストロ", "食事処", "お食事処",
}

MAX_VIDEOS_PER_CHANNEL = 400  # 巨大チャンネルで時間が爆発しないよう上限を置く

# #1273 【バグ】地名を辞書から除外する処理（area_vocab / addr_tail）は**日本語名にしか
# 効いていなかった**。ラテン名は normalize_latin を通るので area_vocab と綴りが合わず、
# ローマ字の地名がそのまま店名として登録されていた。実測 21語（tokyo, hyogo, ginza,
# shinjuku, roppongi ...）。動画タイトル末尾の "(kobe hyogo japan food life)" のような
# 定型ハッシュタグ列に一致し、地名の裏取りも同じ行で満たしてしまうため誤爆が確定する。
# 根拠: out/locality_token_recall.json の目視で「Hyogo」の誤爆を1件確認した。
LATIN_GEO_NAMES = {
    # 都道府県（ローマ字）
    "hokkaido", "aomori", "iwate", "miyagi", "akita", "yamagata", "fukushima", "ibaraki",
    "tochigi", "gunma", "saitama", "chiba", "tokyo", "kanagawa", "niigata", "toyama",
    "ishikawa", "fukui", "yamanashi", "nagano", "gifu", "shizuoka", "aichi", "mie",
    "shiga", "kyoto", "osaka", "hyogo", "nara", "wakayama", "tottori", "shimane",
    "okayama", "hiroshima", "yamaguchi", "tokushima", "kagawa", "ehime", "kochi",
    "fukuoka", "saga", "nagasaki", "kumamoto", "oita", "miyazaki", "kagoshima", "okinawa",
    # 政令市・著名な地名（ローマ字）
    "sapporo", "sendai", "yokohama", "kawasaki", "nagoya", "kobe", "kitakyushu",
    "hamamatsu", "sakai", "sagamihara", "shibuya", "shinjuku", "ginza", "asakusa",
    "ueno", "ikebukuro", "akihabara", "nakameguro", "daikanyama", "roppongi", "odaiba",
    "naha", "ishigaki", "miyakojima", "hakodate", "otaru", "nikko", "kamakura",
    "hakone", "karuizawa", "kanazawa", "takayama", "uji", "kurashiki", "matsuyama",
    "beppu", "yufuin",
}

# #1273 【バグ】`area` は locality を**丸ごと**持ち、match_corroborated は丸ごと一致を
# 要求していた。Overture の locality は「札幌市中央区」「下都賀郡壬生町」のように
# 上位行政区が連結しているため、タイトルに「中央区」「壬生町」とだけ書いてあると
# 裏取りが通らない。measure_seed_youtube_ceiling.py の judge_strict で先に直した罠と同型。
# 実測: キャッシュ 194,315本で distinct 店舗 11,141 -> 12,204（+9.54%）。
# 根拠: out/locality_token_recall.json
_PREF_RE = re.compile(r"^.{2,4}?[都道府県]")
_GUN_RE = re.compile(r"^.{1,4}?郡")
_ADMIN_TOKEN_RE = re.compile(r"\S{1,6}?[市区町村]")


def locality_needle(raw: str) -> str:
    """「北海道札幌市中央区」-> 「中央区」。取れなければ空文字（丸ごと一致に委ねる）。"""
    if not raw:
        return ""
    s = _PREF_RE.sub("", raw, count=1)
    s = _GUN_RE.sub("", s, count=1)
    tokens = _ADMIN_TOKEN_RE.findall(s)
    return tokens[-1] if tokens else ""


# #1273 【バグ】初版は空白を除去してから全国辞書に部分一致させていたため、ラテン文字の
# 店名が英単語の内部に一致する偽陽性が支配的だった（"form"→perform、"ATER"→water、
# "TOBE"→October、"JA・PAN"→japan 等）。日本語名とラテン名で正規化とマッチ規則を分ける。
CJK_RE = re.compile(r"[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]")
MIN_NAME_LEN_LATIN = 5  # ラテン名は語境界を課した上でさらに長さを要求する


def has_cjk(text: str) -> bool:
    return bool(CJK_RE.search(text))


def normalize_ja(text: str) -> str:
    """日本語向け: 語境界が存在しないので空白と記号を全部落とす。"""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    return re.sub(r"[\s　\-‐－—–_,.、。・/／\\|｜!！?？\"'“”'']+", "", text)


def normalize_latin(text: str) -> str:
    """ラテン文字向け: 語境界を残すため、英数字以外は単一の空白に潰す。"""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    return " " + re.sub(r"[^0-9a-z]+", " ", text).strip() + " "


def normalize(text: str) -> str:
    """後方互換用（既存の呼び出し元が使う日本語向け正規化）。"""
    return normalize_ja(text)


def _coarse_coord(row: dict) -> tuple:
    """座標を小数2桁(≒1km)に丸めて場所の識別子にする。ソース間で座標が微妙にずれても同一視できる。"""
    try:
        return (round(float(row.get("latitude")), 2), round(float(row.get("longitude")), 2))
    except (TypeError, ValueError):
        return ()


class NameMatcher:
    """全国店名の逆引き。日本語名とラテン名で別のオートマトンと別の一致規則を持つ。

    #1273 §23 に従い、同名が2件以上ある名前（チェーン）は支店を確定できないため除外する。
    ラテン名は語境界を要求するため、英単語の内部に一致する偽陽性が出ない。
    """

    # #1273 【仕様】母集団は #843 の3ソース（Overture + IFAS + OSM）。
    # OSM は #1306 で「画像ソースとしては却下（image タグ充足率0.080%、実体の94%がリンク切れ）、
    # 逆引き辞書としては採用（新規店名 +63,091件 = +7.62%）」と判定したため辞書としてのみ読む。
    # OSM は ODbL のため内部照合に限る（母集団CSVそのものの外部配布は share-alike に抵触しうる）。
    DEFAULT_SOURCES = ("overture_jp_food.csv", "ifas_jp_food.csv", "osm_jp_food.csv")

    def __init__(self, sources: tuple[str, ...] | None = None) -> None:
        csv.field_size_limit(10**7)
        places_ja: dict[str, set] = {}
        places_la: dict[str, set] = {}
        self.original: dict[str, str] = {}
        # #1273 §22 【設計】地名の裏取りに使う。名前が一意な行しか辞書に残さないので1対1で持てる。
        self.area: dict[str, tuple[str, str]] = {}
        self.source_of: dict[str, str] = {}
        rows = 0
        used = []
        for filename in (sources or self.DEFAULT_SOURCES):
            path = FIXTURES / filename
            if not path.exists():
                print(f"[dict] skip (not found): {filename}", file=sys.stderr)
                continue
            used.append(filename)
            with path.open(encoding="utf-8") as fh:
                for r in csv.DictReader(fh):
                    name = (r.get("name") or "").strip()
                    if not name:
                        continue
                    rows += 1
                    # #1273 【バグ】チェーン判定を「同名の行数 > 1」でやると、3ソース統合後は
                    # **同一店舗が Overture/IFAS/OSM に重複して載っているだけ**でチェーン扱いになり
                    # 辞書から落ちる（実測: 「麺屋 牛神」が原本にあるのにオートマトン未登録）。
                    # 行数ではなく「異なる場所の数」で数える。場所は locality と座標(小数2桁≒1km)で識別する。
                    # 場所の識別は座標を優先する。locality はソースによって空だったり
                    # 表記が違ったりするため、これを混ぜると同一店舗が別場所に割れる。
                    loc_key = _coarse_coord(r) or (normalize_ja(r.get("locality") or ""),)
                    if has_cjk(name):
                        key = normalize_ja(name)
                        places_ja.setdefault(key, set()).add(loc_key)
                    else:
                        key = normalize_latin(name).strip()
                        places_la.setdefault(key, set()).add(loc_key)
                    self.original.setdefault(key, name)
                    self.area.setdefault(key, (normalize_ja(r.get("locality") or ""),
                                               normalize_ja(r.get("region") or "")))
                    self.source_of.setdefault(key, filename)
        self.sources_used = used

        # #1273 【バグ】3ソースの name 列には住所文字列がそのまま入っている行がある
        # （「中区中町」「久留米市」「福岡市中央区」「岡山市中区円山」等）。これが辞書に残ると
        # match_corroborated の locality 裏取りを**自分自身で満たしてしまう**ため、
        # 地名を書いただけの動画が必ず店舗一致になる。Round5 の実測で Shorts のヒット243件中
        # 70件(28.8%)がこの型だった。地名そのものと地名で終わる名前を辞書から除外する。
        # #1273 【バグ】STOPWORD_NAMES は手書きの20語しか無く、**料理カテゴリ語そのものが
        # 店名として登録されている**型を取り逃していた。実測 29語（ハンバーグ / ステーキ /
        # しゃぶしゃぶ / 味噌ラーメン / 沖縄料理 ...）。動画タイトルにはその料理名が必ず出るので、
        # 地名の裏取りが通れば必ず誤爆する。実例:
        #   「ハンバーグ」← 【札幌 中央区】大きなハンバーグのスープカレーに感激！
        # 134カテゴリの変種辞書（dish_category_matcher）をそのまま除外語に使う。
        # 根拠: out/backfill_recall.json の目視で2件の誤爆を確認した。
        try:
            from dish_category_matcher import CategoryMatcher as _CM
            _cm = _CM()
            dish_vocab = {k for k in getattr(_cm, "auto", {}) } if False else set()
            for _attr in ("by_label",):
                _d = getattr(_cm, _attr, None)
                if isinstance(_d, dict):
                    for _label, _vars in _d.items():
                        dish_vocab.add(_label)
                        if isinstance(_vars, (list, tuple, set)):
                            dish_vocab |= {v for v in _vars if isinstance(v, str)}
            dish_vocab = {normalize_ja(v) if has_cjk(v) else normalize_latin(v).strip()
                          for v in dish_vocab if v}
        except Exception:  # 判定器が無い環境でも辞書は作れるようにする
            dish_vocab = set()

        area_vocab = {v for pair in self.area.values() for v in pair if v}
        addr_tail = re.compile(r"(都|道|府|県|市|区|町|村|丁目|番地)$")
        dropped_geo = 0
        dropped_venue = 0

        # #1273 【バグ】目視80対で見つけた誤りのうち2類型が、既存の除外を通り抜けていた。
        #   (1) 容器（施設・場所）を屋号として持つ行
        #       「国際通りのれん街」「唐戸はれて横丁」「アルプス公園」
        #       → 容器の中のテナントの動画に必ず当たる
        #   (2) 住所文字列が屋号になっている行のうち、**末尾が行政区画で終わらない**もの
        #       「港区新橋」「中央区大名」「北区赤羽」「那覇市安里」
        #       → 既存の addr_tail は**末尾しか見ていない**ので通り抜けていた
        # (2) は support の大きい誤り生成源に集中していた
        # （北区赤羽 support 67 / 中央区大名 32 / 那覇市安里 25 / 港区新橋 16）。
        # 「support が厚い店ほど precision が低い」の正体がこれである。
        #
        # 規則は3版書き直した。経過は out/matcher_exclusion_labels.json に残す。
        #   v1 `[市区町村]`1文字で判定 → 誤爆 5/40（「西村麺業」の村を行政区画と誤認）
        #   v2 実在地名と突合に直したが業態語の番人を外した → 誤爆 7件に増加
        #      （町田市が実在するのでチェーン「町田商店」が丸ごと落ちた）
        #   v3 両方同時。未目視40件で 39/40 = 97.5%
        venue_tail = re.compile(
            r"(横丁|のれん街|暖簾街|商店街|フードコート|地下街|公園|百貨店|デパート|"
            r"ショッピングセンター|ショッピングモール|アウトレット|サービスエリア|"
            r"パーキングエリア|道の駅|市場|センター街|銀座街|飲食街|屋台村|"
            r"ターミナル|バスセンター|物産館|直売所)$")
        # #1273 【バグ】規則1を**末尾一致だけ**にしていたため、容器語が先頭や中間に来る型を
        # 取り逃していた。region_only の目視40件で、誤り5件のうち4件がこれだった:
        #   「道の駅上野」「道の駅西条のん太の酒蔵」（末尾は地名なので当たらない）
        #   「伊香保おもちゃと人形自動車博物館」「ベイサイドプレイス博多」
        # 位置に依存しない容器語を別に持つ。館・園は一般の屋号にも出るので、
        # **博物館・美術館・水族館…のように語として閉じている形だけ**を入れる。
        # 【自戒】ここに「イオンモール」「ららぽーと」を入れかけた。**入れてはいけない。**
        # 施設テナントの実測（out/facility_photo_labels.json）で見たとおり、
        # 「築地銀だこ ららぽーと海老名店」のような**実在のテナント**が屋号に館名を持つ。
        # 入れると容器ではなく中身を落とす。容器そのものを指す語だけに限る。
        venue_any = re.compile(
            r"(道の駅|サービスエリア|パーキングエリア|博物館|美術館|水族館|"
            r"動物園|植物園|記念館|資料館|フェリーターミナル|展望台|キャンプ場)")
        # 番人は**住所を剥がした残り**にだけ当てる。名前全体に当てると
        # 「名古屋市中区栄」の屋、「尾道市土堂」の堂で誤作動する。裸の「堂」は入れない。
        biz_word = re.compile(
            r"(店|屋|亭|軒|房|舎|庵|苑|館|坊|処|荘|食堂|酒場|居酒屋|寿司|鮨|丼|麺|"
            r"そば|うどん|ラーメン|らーめん|中華|洋食|和食|カフェ|cafe|バル|バー|"
            r"レストラン|キッチン|kitchen|ダイニング|ベーカリー|パン|菓子|珈琲|喫茶)",
            re.I)
        pref_head = re.compile(r"^.{2,4}?[都道府県]")
        # 実在の市区町村名。**1文字の前置を入れない**（「町田市」から「町」が入ると
        # 「町田商店」が落ちる）。
        known_admin: set[str] = set()
        for _loc, _reg in self.area.values():
            if not _loc:
                continue
            _s = pref_head.sub("", _loc, count=1)
            for _m in re.finditer(r"[市区町村]", _s):
                if _m.end() >= 2:
                    known_admin.add(_s[: _m.end()])
            if len(_s) >= 2:
                known_admin.add(_s)

        def is_address_row(name: str) -> bool:
            s = pref_head.sub("", name, count=1)
            best = 0
            for m in re.finditer(r"[市区町村]", s):
                if s[: m.end()] in known_admin:
                    best = m.end()          # 最長一致
            if best == 0:
                return False
            return not biz_word.search(s[best:])

        stop_ja = {normalize_ja(s) for s in STOPWORD_NAMES}
        stop_la = {normalize_latin(s).strip() for s in STOPWORD_NAMES}
        self.auto_ja = ahocorasick.Automaton()
        self.auto_la = ahocorasick.Automaton()
        self.n_ja = self.n_la = 0
        for key, locs in places_ja.items():
            count = len(locs)
            if len(key) < MIN_NAME_LEN_NATIONAL or count > 1 or key in stop_ja:
                continue
            if key in dish_vocab:   # 料理カテゴリ語そのもの（上記【バグ】参照）
                dropped_geo += 1
                continue
            # 住所文字列そのもの、および地名で終わる名前は除外する（上記【バグ】参照）
            if key in area_vocab or addr_tail.search(key):
                dropped_geo += 1
                continue
            # 容器（施設・場所）と、末尾が行政区画で終わらない住所行（上記【バグ】参照）
            if (venue_tail.search(key) or venue_any.search(key)
                    or is_address_row(key)):
                dropped_venue += 1
                continue
            self.auto_ja.add_word(key, key)
            self.n_ja += 1
        dropped_geo_la = 0
        for key, locs in places_la.items():
            count = len(locs)
            if len(key) < MIN_NAME_LEN_LATIN or count > 1 or key in stop_la:
                continue
            # 上記【バグ】: ローマ字の地名は辞書から落とす（日本語側と同じ規律）
            if key in LATIN_GEO_NAMES or key in dish_vocab:
                dropped_geo_la += 1
                continue
            self.auto_la.add_word(key, key)
            self.n_la += 1
        dropped_geo += dropped_geo_la
        self.auto_ja.make_automaton()
        self.auto_la.make_automaton()
        # 裏取り用の市区町村トークン（上記【バグ】参照）。
        self.needle = {k: locality_needle(loc) for k, (loc, _) in self.area.items()}
        # #1273 【修正】裏取りキーが政令指定都市と特別区で壊れていた。
        # locality_needle は行政区画トークンの**最後**を返すので
        #   「大阪市中央区」-> 「中央区」 / 「静岡市葵区」-> 「葵区」
        # となり、本文に書かれる「大阪」「静岡」と一致しない。特別区も
        #   「新宿区」-> 「新宿区」 で、本文の「新宿」と一致しない。
        # 母集団の 24.82%（287,730店）が政令市型で、最多の needle「中央区」は
        # 10市にまたがるうえ本文には稀にしか出ない。
        # 実測（`measure_needle_fix.py`）: 未目視の第2標本で distinct 34店 -> 161店 = 4.74倍、
        # 増分の目視 precision 15/17 = 88%。開発標本でも 3.88倍 / 16/18 = 89% で再現した。
        # ここでは「市トークン」と「末尾の行政区画語を落とした形」を裏取り語に足す。
        self.corro = {k: self._corroborators(loc, reg, self.needle.get(k, ""))
                      for k, (loc, reg) in self.area.items()}
        self.rows = rows
        print(f"[dict] {'+'.join(self.sources_used)}: {rows:,} rows -> "
              f"日本語名 {self.n_ja:,} (>={MIN_NAME_LEN_NATIONAL}字) + "
              f"ラテン名 {self.n_la:,} (>={MIN_NAME_LEN_LATIN}字, 語境界必須) "
              f"/ 地名として除外 {dropped_geo:,}"
              f" / 容器・住所行として除外 {dropped_venue:,}", file=sys.stderr)

    def match(self, text: str) -> set[str]:
        """店名の生一致だけを返す（地名の裏取りは match_corroborated で課す）。"""
        hits: set[str] = set()
        tja = normalize_ja(text)
        if tja:
            hits |= {found for _, found in self.auto_ja.iter(tja)}
            # 「麺屋武蔵」と「麺屋武」が両方辞書にある場合、包含される短い方を落とす
            hits = {h for h in hits if not any(h != o and h in o for o in hits)}
        # #1273 【バグ】複数語のラテン名が句読点をまたいで一致してしまう
        # （"Mother Coffee" が "mother!? [Coffee shops" に一致）。句読点で区切った
        # セグメント単位でしか一致させないことで防ぐ。
        for segment in re.split(r"[^0-9a-z]{2,}|[\[\]()（）【】!！?？,、。:：]", normalize_latin(text)):
            seg = " " + segment.strip() + " "
            if len(seg) <= 2:
                continue
            for end, found in self.auto_la.iter(seg):
                start = end - len(found) + 1
                if seg[start - 1] == " " and seg[end + 1] == " ":
                    hits.add(found)
        return hits

    _CITY_WARD_RE = re.compile(r"^(?:北海道|京都府|大阪府|東京都|.{2,3}県)?(.+?市)(.+?区)$")
    _ADMIN_TAIL_RE = re.compile(r"(市|区|町|村)$")
    # 行政区画語を落とすと一般語・他地名になってしまうものは足さない
    _BARE_STOP = frozenset({"中央", "北", "南", "東", "西", "港", "緑", "旭", "青葉",
                            "大和", "山手", "本", "新", "上", "下", "中", "白", "泉"})

    @classmethod
    def _bare(cls, token: str) -> str:
        """「新宿区」->「新宿」、「高松市」->「高松」。落とせなければ空文字。"""
        if not token:
            return ""
        b = cls._ADMIN_TAIL_RE.sub("", token, count=1)
        return "" if (len(b) < 2 or b == token or b in cls._BARE_STOP) else b

    @classmethod
    def _corroborators(cls, loc: str, region: str, needle: str) -> frozenset:
        """裏取りに使える語の集合。丸ごと・区名・市名・市名から市を落とした形。"""
        out = {x for x in (loc, needle, region) if x}
        m = cls._CITY_WARD_RE.match(loc or "")
        if m:
            out.add(m.group(1))                     # 「大阪市」
            b = cls._bare(m.group(1))
            if b:
                out.add(b)                          # 「大阪」
        for tok in (loc or "", needle):
            b = cls._bare(tok)
            if b:
                out.add(b)                          # 「新宿区」->「新宿」
        return frozenset(out)

    def match_corroborated(self, text: str) -> set[str]:
        """店名一致に加えて、その店の locality か region が同じテキストに出ることを要求する。

        # #1273 §22 【設計】店名だけの一致は「Value」「Bento」「ブレンド」「四天王寺」のような
        # 一般語・地名が店名になっている場合に偽陽性を量産する（実測 precision 30〜40%）。
        # S の実測が信頼できたのは地名の裏取りを課していたためで、同じ規律をここでも課す。
        # 取りこぼし（地名を書かない動画）は出るが、そちらは下限側に倒れるので許容する。
        """
        tja = normalize_ja(text)
        out = set()
        for key in self.match(text):
            # 【設計】「丸ごと」と「市区町村トークン」の和集合で裏取りする。
            # トークンだけにすると locality から市区町村を取れない店（「〇〇村大字△△」等）が
            # 裏取り手段を失うため、丸ごと一致も残す。上記【バグ】参照。
            # 政令市・特別区の扱いは `_corroborators` の注記を参照。
            for w in self.corro.get(key, ()):
                if w in tja:
                    out.add(key)
                    break
        return out


def yt_json(target: str, extra: list[str], timeout: int) -> tuple[dict | None, str | None]:
    cmd = [sys.executable, str(YT_DLP), "--flat-playlist", "-J", "--no-warnings", *extra, target]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, "timeout"
    if not proc.stdout.strip():
        return None, (proc.stderr.strip().splitlines()[-1][:160] if proc.stderr.strip() else "empty")
    try:
        return json.loads(proc.stdout.splitlines()[-1]), None
    except json.JSONDecodeError:
        return None, "json_decode_error"


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 Round3 idea A: channel traversal")
    ap.add_argument("--seed-queries", type=int, default=40)
    ap.add_argument("--max-channels", type=int, default=25)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--out", type=Path, default=HERE / "out" / "channel_traversal.json")
    ap.add_argument("--cache", type=Path, default=HERE / "out" / "channel_titles_cache.json",
                    help="列挙した動画タイトルのキャッシュ。あればYouTubeを再度叩かずに再集計する")
    args = ap.parse_args()

    matcher = NameMatcher()

    # #1273 【設計】マッチャの判定規則は繰り返し直すことになるので、YouTubeから取った
    # 生タイトルをキャッシュして、再集計時にネットワークを一切使わないようにする。
    cache: dict = {}
    if args.cache.exists():
        cache = json.loads(args.cache.read_text(encoding="utf-8"))
        print(f"[cache] {args.cache.name} を使用（YouTubeへの再アクセスなし）", file=sys.stderr)

    # --- 1. 種取り: カテゴリ×エリア検索で、店名を名指しした動画のチャンネルを集める ---
    cats = list(csv.DictReader((FIXTURES / "public_dish_categories_134_gate.csv").open(encoding="utf-8")))
    cats.sort(key=lambda c: -float(c.get("market_salience_jp") or 0))
    localities = ["大阪市平野区", "さくら市", "札幌市中央区", "松山市"]
    seeds = [
        {"query": f"{cats[i % len(cats)]['label_ja']} {localities[i % len(localities)]}"}
        for i in range(args.seed_queries)
    ]

    def seed_work(s: dict) -> dict:
        data, err = yt_json(f"ytsearch10:{s['query']}", [], 120)
        entries = [e for e in ((data or {}).get("entries") or []) if e]
        return {**s, "error": err,
                "entries": [{"title": e.get("title"), "channel_id": e.get("channel_id"),
                             "channel": e.get("channel") or e.get("uploader")} for e in entries]}

    if "seeds" in cache:
        seed_rows = cache["seeds"]
    else:
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            seed_rows = list(pool.map(seed_work, seeds))
        cache["seeds"] = seed_rows

    for row in seed_rows:
        row["found"] = [
            {"channel_id": e["channel_id"], "channel": e["channel"], "names": sorted(names)}
            for e in row["entries"]
            if e.get("channel_id") and (names := matcher.match_corroborated(e.get("title") or ""))
        ]

    channels: dict[str, dict] = {}
    for row in seed_rows:
        for f in row["found"]:
            ch = channels.setdefault(f["channel_id"], {"channel": f["channel"], "seed_hits": 0})
            ch["seed_hits"] += 1
    ranked = sorted(channels.items(), key=lambda kv: -kv[1]["seed_hits"])[: args.max_channels]
    seed_queries_used = len([r for r in seed_rows if r["error"] is None])
    seed_distinct = {n for row in seed_rows for f in row["found"] for n in f["names"]}
    print(f"[seed] {seed_queries_used} queries -> {len(channels)} channels, "
          f"{len(seed_distinct)} distinct restaurants", file=sys.stderr)

    # --- 2. 各チャンネルの過去動画を全列挙して逆引き ---
    def channel_fetch(item: tuple[str, dict]) -> dict:
        cid, meta = item
        url = f"https://www.youtube.com/channel/{cid}/videos"
        data, err = yt_json(url, ["--playlist-end", str(MAX_VIDEOS_PER_CHANNEL)], 300)
        entries = [e for e in ((data or {}).get("entries") or []) if e]
        return {"channel_id": cid, "channel": meta["channel"], "seed_hits": meta["seed_hits"],
                "error": err,
                "videos": [{"id": e.get("id"), "title": e.get("title")} for e in entries]}

    if "channels" in cache:
        raw_channels = cache["channels"]
    else:
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            raw_channels = list(pool.map(channel_fetch, ranked))
        cache["channels"] = raw_channels
        args.cache.parent.mkdir(parents=True, exist_ok=True)
        args.cache.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    ch_rows = []
    for c in raw_channels:
        found: dict[str, list[str]] = {}
        for v in c["videos"]:
            for n in matcher.match_corroborated(v.get("title") or ""):
                found.setdefault(n, []).append(v.get("id"))
        ch_rows.append({
            "channel_id": c["channel_id"], "channel": c["channel"],
            "seed_hits": c["seed_hits"], "error": c["error"],
            "n_videos": len(c["videos"]), "n_distinct_restaurants": len(found),
            "restaurants": {matcher.original.get(k, k): v[:3] for k, v in found.items()},
        })

    ok = [c for c in ch_rows if c["error"] is None and c["n_videos"] > 0]
    all_found: set[str] = set()
    for c in ok:
        all_found.update(c["restaurants"].keys())
    total_videos = sum(c["n_videos"] for c in ok)

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "hypothesis": "飽和は検索ランキングの枯渇であって供給の枯渇ではない",
            "dictionary": f"Overture全国、同名2件以上(チェーン)と{MIN_NAME_LEN_NATIONAL}文字未満を除外",
            "seed": f"ytsearch10 x {args.seed_queries}",
            "traversal": f"channel/videos flat-playlist, 上限{MAX_VIDEOS_PER_CHANNEL}本/ch",
        },
        "seed": {
            "queries": seed_queries_used,
            "channels_discovered": len(channels),
            "distinct_restaurants": len(seed_distinct),
        },
        "traversal": {
            "channels_attempted": len(ranked),
            "channels_ok": len(ok),
            "total_videos_enumerated": total_videos,
            "distinct_restaurants": len(all_found),
            "restaurants_per_channel_call": len(all_found) / len(ok) if ok else 0,
        },
        "channels": ch_rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n=== チャンネル逆走査 ===", file=sys.stderr)
    print(f"種取り : {seed_queries_used} クエリ -> {len(seed_distinct)} 店 "
          f"({len(seed_distinct)/max(seed_queries_used,1):.2f} 店/クエリ)", file=sys.stderr)
    print(f"逆走査 : {len(ok)} チャンネル呼び出し -> {total_videos:,} 動画列挙 "
          f"-> {len(all_found):,} 店", file=sys.stderr)
    print(f"         = {len(all_found)/max(len(ok),1):.1f} 店 / チャンネル呼び出し", file=sys.stderr)
    print(f"\n上位チャンネル:", file=sys.stderr)
    for c in sorted(ok, key=lambda x: -x["n_distinct_restaurants"])[:10]:
        print(f"  {c['n_distinct_restaurants']:4d}店 / {c['n_videos']:4d}本  {c['channel']}", file=sys.stderr)
    print(f"Saved: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
