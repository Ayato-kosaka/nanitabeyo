#!/usr/bin/env python3
"""#1273 Round4: カテゴリ付与率 62.3% を 表記ゆれ辞書 + OSM cuisine で引き上げる

dish_media = restaurant x dish_category x media の3つ組。restaurant は特定できても
dish_category が付かなければ dish_media にならない。実測 62.3%（店舗特定済み動画のうち
category も付いた割合）がここまでの上限だった。

本スクリプトは3つの改善を積み上げて、それぞれの寄与を分離して測る。

  B  baseline      : measure_dish_media_yield.py の EXTRA_VARIANTS そのまま（再現用）
  +1 span dedup    : 変種の**文字範囲**で包含関係を解消する（「中華そば」が「そば」にも
                     当たる衝突を機械的に潰す）
  +2 variants      : 実データ（カテゴリ未付与だった店舗特定済み動画）から作った表記ゆれ辞書
  +3 osm cuisine   : 特定できた店舗の OSM `cuisine` タグから category を引く

**ネットワークアクセスは一切行わない**（キャッシュ済みタイトル + OSM pbf 由来のCSVのみ）。

実行:
    python3 cuisine-category-boost.py --osm-cuisine /tmp/osm_name_cuisine.csv
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import random
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import ahocorasick  # type: ignore

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from measure_channel_traversal import NameMatcher, normalize_ja, has_cjk, normalize_latin  # noqa: E402
from measure_dish_media_yield import (  # noqa: E402
    load_categories as load_categories_baseline,
    match_categories as match_categories_baseline,
    load_cached_videos,
)

FIXTURES = HERE / "fixtures"

# --------------------------------------------------------------------------
# #1273 【設計】表記ゆれ辞書は「実データを見て」作る。ここに並ぶ語は全て
# out/cuisine-category-boost.json の evidence_titles に実例がある（カテゴリが
# 付かなかった店舗特定済み動画 3,124本を目視 + 文字n-gram頻度から抽出した）。
# 推測で語を足していない。
# --------------------------------------------------------------------------
VARIANTS: dict[str, tuple[str, ...]] = {
    # 麺類。「らぁ麺」「らー麺」「中華そば」「朝ラー」が baseline では全滅していた
    "ラーメン": ("らーめん", "らぁめん", "らあめん", "らぁ麺", "らー麺", "ラー麺", "ら〜めん",
                "拉麺", "中華そば", "支那そば", "朝ラー", "中華蕎麦"),
    "つけ麺": ("つけめん", "つけ麺", "ツケメン", "付け麺"),
    "担担麺": ("担々麺", "坦々麺", "坦坦麺", "タンタンメン", "たんたんめん", "担担麺", "担々麵"),
    "まぜそば": ("まぜそば", "混ぜそば", "マゼソバ", "まぜ麺"),
    "油そば": ("油そば", "あぶらそば", "アブラソバ"),
    "豚骨ラーメン": ("豚骨ラーメン", "とんこつラーメン", "トンコツラーメン", "豚骨らーめん"),
    "味噌ラーメン": ("味噌ラーメン", "みそラーメン", "ミソラーメン", "味噌らーめん"),
    "塩ラーメン": ("塩ラーメン", "塩らーめん"),
    "そば": ("蕎麦", "そば", "ソバ"),
    "うどん": ("饂飩", "うどん", "ウドン"),
    "焼きそば": ("焼きそば", "焼そば", "やきそば", "ヤキソバ"),
    "素麺": ("素麺", "そうめん", "ソーメン", "そーめん"),
    "ちゃんぽん": ("ちゃんぽん", "チャンポン"),
    "冷やし中華": ("冷やし中華", "冷し中華"),
    # 丼・飯もの
    "カツ丼": ("カツ丼", "かつ丼", "かつどん", "カツどん"),
    "牛丼": ("牛丼", "ぎゅうどん"),
    "親子丼": ("親子丼", "おやこどん"),
    "天丼": ("天丼", "てんどん"),
    "海鮮丼": ("海鮮丼", "海鮮どんぶり", "かいせんどん"),
    "チャーハン": ("チャーハン", "炒飯", "焼き飯", "焼めし", "やきめし", "チャーハン"),
    "オムライス": ("オムライス", "おむらいす"),
    # 揚げ物・肉
    "とんかつ": ("豚カツ", "トンカツ", "とんかつ", "とんかつ", "ヒレカツ", "ひれかつ",
                "ロースカツ", "ろーすかつ", "豚かつ"),
    "唐揚げ": ("唐揚げ", "から揚げ", "からあげ", "カラアゲ", "空揚げ", "唐揚", "karaage"),
    "串カツ": ("串カツ", "串かつ", "くしかつ"),
    "焼き鳥": ("焼鳥", "やきとり", "ヤキトリ", "焼き鳥", "焼きとり"),
    "やきとん": ("やきとん", "焼きとん", "焼きトン", "焼トン"),
    "焼肉": ("焼き肉", "やきにく", "ヤキニク", "焼肉"),
    "ホルモン焼き": ("ホルモン焼", "ホルモン焼き", "ほるもん焼"),
    "ステーキ": ("ステーキ", "すてーき"),
    "ハンバーグ": ("ハンバーグ", "はんばーぐ"),
    "ハンバーガー": ("ハンバーガー", "バーガー", "はんばーがー"),
    "牛タン焼き": ("牛タン", "牛たん", "ぎゅうたん"),
    "生姜焼き": ("生姜焼", "生姜焼き", "しょうが焼", "ショウガ焼"),
    "天ぷら": ("天麩羅", "てんぷら", "天ぷら", "天プラ"),
    # 中華
    "餃子": ("ぎょうざ", "ギョーザ", "ギョウザ", "餃子", "ぎょーざ"),
    "麻婆豆腐": ("麻婆豆腐", "マーボー豆腐", "まーぼー豆腐", "麻婆どうふ", "マーボードーフ"),
    "中華料理": ("中華料理", "町中華", "まち中華"),
    "天津飯": ("天津飯", "てんしんはん"),
    "酢豚": ("酢豚", "すぶた"),
    "回鍋肉": ("回鍋肉", "ホイコーロー"),
    # 和・鍋
    "寿司": ("すし", "鮨", "鮓", "スシ", "寿し", "寿司", "sushi"),
    "刺身盛り合わせ": ("刺身盛", "刺身の盛", "お造り"),
    "定食": ("定食", "ていしょく"),
    "和食": ("和食", "日本料理", "おばんざい"),
    "居酒屋": ("居酒屋", "いざかや"),
    "おでん": ("おでん", "オデン", "関東煮"),
    "すき焼き": ("すき焼き", "すき焼", "スキヤキ", "すきやき"),
    "しゃぶしゃぶ": ("しゃぶしゃぶ", "シャブシャブ", "しゃぶ"),
    "もつ鍋": ("もつ鍋", "モツ鍋", "ホルモン鍋"),
    "鍋料理": ("鍋料理", "水炊き", "みずたき"),
    "ウナギ": ("うなぎ", "鰻", "ウナギ", "うな重", "うな丼"),
    "牡蠣料理": ("牡蠣", "牡蛎", "カキ料理", "かき料理"),
    "海鮮料理": ("海鮮料理", "海鮮", "浜焼き"),
    "懐石料理": ("懐石", "会席料理"),
    "釜飯": ("釜飯", "釜めし", "かまめし"),
    "お好み焼き": ("お好み焼", "おこのみやき", "お好み焼き", "オコノミヤキ"),
    "たこ焼き": ("たこ焼", "タコ焼", "たこやき", "たこ焼き", "タコヤキ"),
    "もんじゃ焼き": ("もんじゃ", "モンジャ"),
    "鉄板焼き": ("鉄板焼", "てっぱん焼"),
    "焼き魚定食": ("焼き魚定食", "焼魚定食"),
    # 洋・カフェ
    "カレー": ("カリー", "curry", "カレー", "かれー"),
    "インドカレー": ("インドカレー", "インド料理", "ネパールカレー"),
    "キーマカレー": ("キーマカレー", "キーマ"),
    "カレーうどん": ("カレーうどん", "カレーうどん", "カレー饂飩"),
    "パスタ": ("パスタ", "スパゲッティ", "スパゲティ", "スパゲティー"),
    "ピザ": ("ピザ", "ピッツァ", "pizza"),
    "ナポリタン": ("ナポリタン",),
    "カフェ": ("カフェ", "cafe", "coffee", "珈琲", "喫茶", "コーヒー", "かふぇ"),
    "パンケーキ": ("ホットケーキ", "パンケーキ", "ぱんけーき"),
    "ケーキ": ("ケーキ", "けーき"),
    "パフェ": ("パフェ", "ぱふぇ"),
    "かき氷": ("かき氷", "カキ氷", "氷ぜんざい"),
    "ソフトクリーム": ("ソフトクリーム", "ソフトクリーム"),
    "アイスクリーム": ("アイスクリーム", "アイス"),
    "トースト": ("トースト", "とーすと"),
    "サンドイッチ": ("サンドイッチ", "サンド", "サンドウィッチ"),
    "イタリアン": ("イタリアン", "イタリア料理"),
    "フレンチ": ("フレンチ", "フランス料理"),
    "韓国料理": ("韓国料理", "コリアン"),
    "沖縄料理": ("沖縄料理", "沖縄そば"),
    "タイ料理": ("タイ料理",),
    "ベトナム料理": ("ベトナム料理",),
    "スペイン料理": ("スペイン料理",),
    "四川料理": ("四川料理", "四川"),
}

# #1273 【バグ】「そば」は「駅のそば」「店のそばに」のような位置副詞と同形。
# 実データで確認できた偽陽性なので、直前が「の」の場合だけ機械的に落とす。
NEGATIVE_LEFT: dict[str, tuple[str, ...]] = {"そば": ("の", "ぐ")}

# #1273 【仕様】OSM cuisine 値 -> 134カテゴリ。label_en との機械照合で拾えない
# 別名だけを手で書く（label_en 一致は auto_map_cuisine が自動で行う）。
CUISINE_ALIAS: dict[str, str] = {
    "coffee_shop": "カフェ", "cafe": "カフェ", "coffee": "カフェ", "tea": "カフェ",
    "burger": "ハンバーガー", "hamburger": "ハンバーガー",
    "italian": "イタリアン", "french": "フレンチ", "spanish": "スペイン料理",
    "thai": "タイ料理", "vietnamese": "ベトナム料理", "korean": "韓国料理",
    "indian": "インドカレー", "nepalese": "インドカレー",
    "japanese": "和食", "chinese": "中華料理", "sichuan": "四川料理",
    "beef_bowl": "牛丼", "gyudon": "牛丼", "donburi": "牛丼",
    "steak_house": "ステーキ", "steak": "ステーキ",
    "barbecue": "焼肉", "yakiniku": "焼肉", "horumon": "ホルモン焼き",
    "yakitori": "焼き鳥", "yakiton": "やきとん",
    "savory_pancakes": "お好み焼き", "okonomiyaki": "お好み焼き",
    "takoyaki": "たこ焼き", "monjayaki": "もんじゃ焼き",
    "unagi": "ウナギ", "eel": "ウナギ",
    "seafood": "海鮮料理", "oyster": "牡蠣料理",
    "izakaya": "居酒屋", "pub": "居酒屋",
    "kaiseki": "懐石料理", "teishoku": "定食", "washoku": "和食",
    "tonkatsu": "とんかつ", "katsudon": "カツ丼", "kushikatsu": "串カツ",
    "tempura": "天ぷら", "tendon": "天丼", "oyakodon": "親子丼",
    "sukiyaki": "すき焼き", "shabu_shabu": "しゃぶしゃぶ", "nabe": "鍋料理",
    "hot_pot": "鍋料理", "motsunabe": "もつ鍋", "oden": "おでん",
    "champon": "ちゃんぽん", "tsukemen": "つけ麺", "somen": "素麺",
    "yakisoba": "焼きそば", "fried_rice": "チャーハン", "chahan": "チャーハン",
    "omurice": "オムライス", "hamburg": "ハンバーグ", "hamburger_steak": "ハンバーグ",
    "karaage": "唐揚げ", "fried_chicken": "フライドチキン",
    "gyoza": "餃子", "mapo_tofu": "麻婆豆腐",
    "kamameshi": "釜飯", "kaisendon": "海鮮丼", "sashimi": "刺身盛り合わせ",
    "crepe": "クレープ", "cake": "ケーキ", "pancake": "パンケーキ",
    "waffle": "ワッフル", "parfait": "パフェ", "gelato": "ジェラート",
    "soft_serve": "ソフトクリーム", "shaved_ice": "かき氷", "kakigori": "かき氷",
    "toast": "トースト", "sandwich": "サンドイッチ", "hot_dog": "ホットドッグ",
    "paella": "パエリア", "risotto": "リゾット", "gratin": "グラタン",
    "doria": "ドリア", "napolitan": "ナポリタン", "carbonara": "カルボナーラ",
    "bibimbap": "ビビンバ", "sundubu": "スンドゥブ", "kimchi_jjigae": "キムチチゲ",
    "pho": "フォー", "taco_rice": "タコライス", "okinawan": "沖縄料理",
    # 日本語で書かれている cuisine 値も実在する（焼肉 126件, ラーメン 118件）
    "焼肉": "焼肉", "ラーメン": "ラーメン", "そば": "そば", "うどん": "うどん",
    "寿司": "寿司", "居酒屋": "居酒屋", "カフェ": "カフェ", "定食": "定食",
}


# --------------------------------------------------------------------------
# カテゴリマッチャ（span dedup 版）
# --------------------------------------------------------------------------
def kata_to_hira(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヴ" else c for c in s)


def hira_to_kata(s: str) -> str:
    return "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゔ" else c for c in s)


class CategoryMatcher:
    """134カテゴリの表記ゆれマッチャ。

    #1273 【設計】baseline は「ラベル文字列の包含」で衝突を潰していたため、
    変種経由の衝突（「中華そば」は ラーメン の変種なので、ラベル同士では
    「ラーメン」と「そば」に包含関係が無く両方残る）を潰せなかった。
    ここでは **タイトル上の文字範囲(span)** で包含を判定するので、変種経由でも
    機械的に解消できる。
    """

    def __init__(self, use_extra_variants: bool = True, auto_kana: bool = True) -> None:
        path = FIXTURES / "public_dish_categories_134_gate.csv"
        self.cats = list(csv.DictReader(path.open(encoding="utf-8")))
        self.by_label = {c["label_ja"]: c for c in self.cats}
        self.auto = ahocorasick.Automaton()
        self.variant_of: dict[str, set[str]] = collections.defaultdict(set)
        n_var = 0
        for c in self.cats:
            label = c["label_ja"]
            vs = {label}
            if use_extra_variants:
                vs |= set(VARIANTS.get(label, ()))
            if auto_kana:
                # 機械生成: カタカナ<->ひらがなの相互変換（「ぎょうざ」「ラーメン」等）
                vs |= {kata_to_hira(v) for v in list(vs)}
                vs |= {hira_to_kata(v) for v in list(vs)}
            for v in vs:
                nv = normalize_ja(v)
                if len(nv) < 2:
                    continue
                self.variant_of[nv].add(label)
                n_var += 1
        for nv in self.variant_of:
            self.auto.add_word(nv, nv)
        self.auto.make_automaton()
        self.n_variants = len(self.variant_of)

    def match(self, text: str) -> list[dict]:
        t = normalize_ja(text)
        if not t:
            return []
        spans: list[tuple[int, int, str]] = []
        for end, nv in self.auto.iter(t):
            start = end - len(nv) + 1
            # 直前文字による否定条件（「駅のそば」を落とす）
            neg = NEGATIVE_LEFT.get(nv)
            if neg and start > 0 and t[start - 1] in neg:
                continue
            spans.append((start, end, nv))
        if not spans:
            return []
        # #1273 【設計】span 包含の機械的解消。他の span に真に含まれる span を捨てる。
        kept = [s for s in spans
                if not any(o is not s and o[0] <= s[0] and s[1] <= o[1]
                           and (o[1] - o[0]) > (s[1] - s[0]) for o in spans)]
        labels: set[str] = set()
        for _, _, nv in kept:
            labels |= self.variant_of[nv]
        return [self.by_label[l] for l in sorted(labels)]


# --------------------------------------------------------------------------
# OSM cuisine
# --------------------------------------------------------------------------
def norm_key(name: str) -> str:
    return normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()


def auto_map_cuisine(cats: list[dict]) -> dict[str, str]:
    """cuisine 値 -> label_ja。label_en の機械照合 + CUISINE_ALIAS。"""
    m: dict[str, str] = {}
    for c in cats:
        en = re.sub(r"[^a-z0-9]+", "_", c["label_en"].lower()).strip("_")
        m.setdefault(en, c["label_ja"])
        m.setdefault(en.replace("_", ""), c["label_ja"])
    for k, v in CUISINE_ALIAS.items():
        m[k] = v
    return m


def load_osm_cuisine(path: Path, cuisine_map: dict[str, str]) -> tuple[dict[str, set[str]], dict]:
    """OSM の name/name:ja -> 写像できた dish_category ラベル集合。

    #1273 【仕様】同じ正規化名に矛盾する cuisine が付く場合は捨てる（支店違いで
    業態が違うことがあり、どちらか分からない状態で付けると過剰付与になる）。
    """
    raw: dict[str, set[str]] = collections.defaultdict(set)
    seen_names: set[str] = set()
    n_rows = n_cuisine = 0
    val_counter: collections.Counter = collections.Counter()
    mapped_counter: collections.Counter = collections.Counter()
    with path.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            n_rows += 1
            names = [n for n in (r.get("name"), r.get("name_ja")) if n]
            keys = {norm_key(n) for n in names if norm_key(n)}
            seen_names |= keys
            cu = (r.get("cuisine") or "").strip()
            if not cu:
                continue
            n_cuisine += 1
            labels = set()
            for v in re.split(r"[;,]", cu):
                v = v.strip().lower().replace(" ", "_")
                if not v:
                    continue
                val_counter[v] += 1
                if v in cuisine_map:
                    labels.add(cuisine_map[v])
                    mapped_counter[v] += 1
            if not labels:
                continue
            for k in keys:
                raw[k] |= labels
    # 矛盾（同名で複数カテゴリ）は捨てる
    clean = {k: v for k, v in raw.items() if len(v) == 1}
    stats = {
        "osm_rows": n_rows,
        "rows_with_cuisine": n_cuisine,
        "distinct_names": len(seen_names),
        "names_with_mapped_cuisine": len(raw),
        "names_kept_unambiguous": len(clean),
        "distinct_cuisine_values": len(val_counter),
        "cuisine_values_mapped": len(mapped_counter),
        "cuisine_occurrences": sum(val_counter.values()),
        "cuisine_occurrences_mapped": sum(mapped_counter.values()),
        "top_mapped": mapped_counter.most_common(25),
        "top_unmapped": [(v, n) for v, n in val_counter.most_common(200)
                         if v not in mapped_counter][:25],
    }
    return clean, stats


# --------------------------------------------------------------------------
def load_all_videos() -> tuple[list[dict], set[str]]:
    """22,508本(baseline と同一集合) + snowball 分を合わせた全キャッシュ。"""
    base = {v["id"]: v for v in load_cached_videos()}
    vids = dict(base)
    p = HERE / "out" / "snowball_crawl_state.json"
    if p.exists():
        sn = json.loads(p.read_text(encoding="utf-8"))
        for cid, c in sn.get("channels", {}).items():
            for v in c.get("videos", []):
                if v.get("id") and v.get("title"):
                    vids.setdefault(v["id"], {"id": v["id"], "title": v["title"],
                                              "channel": c.get("channel"), "channel_id": cid})
    return list(vids.values()), set(base)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm-cuisine", type=Path, default=Path("/tmp/osm_name_cuisine.csv"))
    ap.add_argument("--out", type=Path, default=HERE / "out" / "cuisine-category-boost.json")
    args = ap.parse_args()

    videos, baseline_ids = load_all_videos()
    print(f"[input] 全キャッシュ {len(videos):,} 本（うち baseline 集合 {len(baseline_ids):,} 本）",
          file=sys.stderr)

    matcher = NameMatcher()
    base_cats = load_categories_baseline()
    cm_dedup = CategoryMatcher(use_extra_variants=False, auto_kana=False)   # +1
    cm_full = CategoryMatcher(use_extra_variants=True, auto_kana=True)      # +2
    print(f"[cat] baseline variants ~{sum(len(c['_variants']) for c in base_cats)} / "
          f"+1 {cm_dedup.n_variants} / +2 {cm_full.n_variants}", file=sys.stderr)

    cuisine_map = auto_map_cuisine(cm_full.cats)
    osm_cu: dict[str, set[str]] = {}
    osm_stats: dict = {"error": f"not found: {args.osm_cuisine}"}
    if args.osm_cuisine.exists():
        osm_cu, osm_stats = load_osm_cuisine(args.osm_cuisine, cuisine_map)
        print(f"[osm] cuisine 付き店名 {osm_stats['names_kept_unambiguous']:,} 件", file=sys.stderr)

    # ---- 店舗特定（母数）
    rest_hits: dict[str, set[str]] = {}
    for v in videos:
        r = matcher.match_corroborated(v["title"])
        if r:
            rest_hits[v["id"]] = r
    by_id = {v["id"]: v for v in videos}
    print(f"[rest] 店舗特定できた動画 {len(rest_hits):,}", file=sys.stderr)

    stages = ("B_baseline", "S1_span_dedup", "S2_variants", "S3_osm_cuisine")
    hit: dict[str, set[str]] = {s: set() for s in stages}
    assigned: dict[str, dict[str, list[str]]] = {s: {} for s in stages}
    osm_only_ids: list[str] = []
    uncat_titles: list[str] = []

    # #1273 【設計】span dedup が「何を消しているか」を単独で測る。付与率(recall)ではなく
    # **付与ラベルの過剰(precision)** に効く改善なので、ラベル本数で比較する。
    def labels_no_dedup(text: str) -> set[str]:
        t = normalize_ja(text)
        out: set[str] = set()
        for end, nv in cm_full.auto.iter(t):
            start = end - len(nv) + 1
            neg = NEGATIVE_LEFT.get(nv)
            if neg and start > 0 and t[start - 1] in neg:
                continue
            out |= cm_full.variant_of[nv]
        return out

    dedup_removed: collections.Counter = collections.Counter()
    n_lbl_dd = n_lbl_nd = n_video_changed = 0
    dedup_examples: list[dict] = []

    for vid, rkeys in rest_hits.items():
        title = by_id[vid]["title"]
        _dd = {c["label_ja"] for c in cm_full.match(title)}
        _nd = labels_no_dedup(title)
        n_lbl_dd += len(_dd)
        n_lbl_nd += len(_nd)
        if _dd != _nd:
            n_video_changed += 1
            dedup_removed.update(_nd - _dd)
            if len(dedup_examples) < 12:
                dedup_examples.append({"title": title, "removed": sorted(_nd - _dd),
                                       "kept": sorted(_dd)})
        b = match_categories_baseline(base_cats, title)
        s1 = cm_dedup.match(title)
        s2 = cm_full.match(title)
        s3 = list(s2)
        osm_labels: set[str] = set()
        for rk in rkeys:
            osm_labels |= osm_cu.get(rk, set())
        if osm_labels:
            have = {c["label_ja"] for c in s3}
            for l in osm_labels:
                if l not in have and l in cm_full.by_label:
                    s3.append(cm_full.by_label[l])
        for name, res in (("B_baseline", b), ("S1_span_dedup", s1),
                          ("S2_variants", s2), ("S3_osm_cuisine", s3)):
            if res:
                hit[name].add(vid)
                assigned[name][vid] = [c["label_ja"] for c in res]
        if not s2 and s3:
            osm_only_ids.append(vid)
        if not s3:
            uncat_titles.append(title)

    n = len(rest_hits)
    n_base_set = len([i for i in rest_hits if i in baseline_ids])
    rates = {}
    for s in stages:
        rates[s] = {
            "all_cache": {"n": n, "hit": len(hit[s]), "rate_pct": round(100 * len(hit[s]) / n, 2)},
        }
        hb = len([i for i in hit[s] if i in baseline_ids])
        rates[s]["baseline_22508_set"] = {
            "n": n_base_set, "hit": hb, "rate_pct": round(100 * hb / n_base_set, 2)}

    # ---- 目視精度検証用サンプル
    rnd = random.Random(1273)
    newly = sorted(hit["S2_variants"] - hit["B_baseline"])
    sample_new = [{"id": i, "title": by_id[i]["title"],
                   "baseline": assigned["B_baseline"].get(i, []),
                   "improved": assigned["S2_variants"][i],
                   "restaurant": [matcher.original.get(k, k) for k in rest_hits[i]]}
                  for i in rnd.sample(newly, min(15, len(newly)))]
    fixed = sorted(i for i in hit["B_baseline"] & hit["S1_span_dedup"]
                   if assigned["B_baseline"][i] != assigned["S1_span_dedup"][i])
    sample_fixed = [{"id": i, "title": by_id[i]["title"],
                     "baseline": assigned["B_baseline"][i],
                     "dedup": assigned["S1_span_dedup"][i]}
                    for i in rnd.sample(fixed, min(15, len(fixed)))]
    sample_osm = [{"id": i, "title": by_id[i]["title"],
                   "restaurant": [matcher.original.get(k, k) for k in rest_hits[i]],
                   "osm_category": assigned["S3_osm_cuisine"][i]}
                  for i in rnd.sample(osm_only_ids, min(15, len(osm_only_ids)))]
    # 改善後も付かなかった残り（次の打ち手を決めるため）
    sample_uncat = rnd.sample(uncat_titles, min(20, len(uncat_titles)))

    cat_counter = collections.Counter()
    for labels in assigned["S3_osm_cuisine"].values():
        cat_counter.update(labels)

    result = {
        "slug": "cuisine-category-boost",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "corpus": "out/channel_crawl_cache.json + out/channel_titles_cache.json "
                      "+ out/snowball_crawl_state.json（ネットワーク不使用）",
            "restaurant": "NameMatcher.match_corroborated（locality/region 裏取り必須）",
            "stages": {
                "B_baseline": "measure_dish_media_yield.py の EXTRA_VARIANTS + ラベル包含dedup",
                "S1_span_dedup": "ラベルのみ・span包含dedup（衝突解消の効果を単独で見る）",
                "S2_variants": "S1 + 実データ由来の表記ゆれ辞書 + カナ機械変換",
                "S3_osm_cuisine": "S2 + 特定できた店舗の OSM cuisine タグからの補完",
            },
        },
        "corpus": {"videos": len(videos), "baseline_subset_videos": len(baseline_ids),
                   "restaurant_matched": n, "restaurant_matched_in_baseline_subset": n_base_set},
        "category_rates": rates,
        "deltas_pp_on_baseline_subset": {
            s: round(rates[s]["baseline_22508_set"]["rate_pct"]
                     - rates["B_baseline"]["baseline_22508_set"]["rate_pct"], 2) for s in stages},
        "span_dedup_precision_effect": {
            "note": "span dedup は付与率ではなく過剰付与の除去に効く。S2 の変種辞書のまま "
                    "dedup を切って比較したラベル本数の差。",
            "videos_label_set_changed": n_video_changed,
            "videos_label_set_changed_pct": round(100 * n_video_changed / n, 2),
            "labels_with_dedup": n_lbl_dd,
            "labels_without_dedup": n_lbl_nd,
            "labels_removed": n_lbl_nd - n_lbl_dd,
            "labels_removed_pct": round(100 * (n_lbl_nd - n_lbl_dd) / n_lbl_nd, 2) if n_lbl_nd else 0,
            "removed_by_label": dedup_removed.most_common(15),
            "examples": dedup_examples,
        },
        "osm_cuisine_stats": osm_stats,
        "osm_only_contribution": {
            "videos_categorized_only_by_osm": len(osm_only_ids),
            "pp_on_all_cache": round(100 * len(osm_only_ids) / n, 2),
        },
        "variant_dict": {"n_normalized_variants": cm_full.n_variants,
                         "n_hand_curated_labels": len(VARIANTS)},
        "top_categories_after": cat_counter.most_common(20),
        "eyeball_samples": {
            "newly_categorized_by_variants": sample_new,
            "collision_fixed_by_span_dedup": sample_fixed,
            "categorized_only_by_osm_cuisine": sample_osm,
            "still_uncategorized": sample_uncat,
        },
        "counts": {"newly_categorized_by_variants": len(newly),
                   "collision_fixed": len(fixed),
                   "still_uncategorized": len(uncat_titles)},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    print("\n=== カテゴリ付与率（店舗特定済み動画に対して）===", file=sys.stderr)
    for s in stages:
        a, b = rates[s]["all_cache"], rates[s]["baseline_22508_set"]
        print(f"  {s:16} 全キャッシュ {a['rate_pct']:5.2f}% ({a['hit']:,}/{a['n']:,})   "
              f"baseline集合 {b['rate_pct']:5.2f}% ({b['hit']:,}/{b['n']:,})", file=sys.stderr)
    print(f"  OSM cuisine 単独寄与: {len(osm_only_ids)} 本 "
          f"(+{100*len(osm_only_ids)/n:.2f}pp)", file=sys.stderr)
    print(f"Saved: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
