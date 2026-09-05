#!/usr/bin/env python3
"""#1841（親 #1273）キャプションの店名から、**課金されない SKU だけ**で place_id を逆引きする。

## なぜ要るか（実測）

resolve が店を引ける経路は «restaurant_catalog の近傍検索» だけなので、**catalog に無い店は
原理的に当たらない**。2026-09-05 時点で店が決まっていない投稿は 382,386 件あり、そのうち
170,261 件（44.5%）は キャプションに 📍店名 か 『』「」店名 が**書いてある**。
「データが無い」のではなく「書いてある店名を Google へ問い合わせていない」だけである。

## 課金しない構造（ここが第一制約）

Google Places の課金は **endpoint × fieldMask** で決まる。このスクリプトは
`1276_place_id_free_poc/free_places.py` の client をそのまま使う。理由は 1 つで、
**課金ガードを 2 つ持つと片方だけ緩む**からである。あの client は

- fieldMask を引数にせず `places.id` 固定（`FIELD_MASK` は定数）
- 応答に `id` 以外のキーが来たら `BillingGuardError` で実行を止める
- `search_nearby` は呼ばれた時点で `BillableEndpointError`（Nearby に IDs Only の無料枠は無い）

を持ち、`1276_place_id_free_poc/test_place_id_poc.py` の `test_field_mask_is_ids_only` /
`test_billable_field_stops_the_run` が固定している。**このスクリプトのために fieldMask へ
1 フィールドでも足してはいけない**（Pro SKU に切り替わって課金される）。

したがって **Google 由来の店名・住所・座標は 1 件も取得していない**。持ち帰るのは place_id だけ。

## 判定 — #1276 の `box_unique_strict` に相当する厳しさ

#1276 が実測で示したのは「A と B の合意」ではなく「**矩形の中で一意**」が効くということ。
`locationBias` は絞り込まない（大阪の店名を東京の bias で引くと大阪の店が返る）が、
`locationRestriction` の矩形は**外を実際に切り落とす**。

こちらは店の座標を知らない（知っていればそもそも店が決まっている）ので、±25m の矩形は
使えない。代わりに **市区町村の矩形**（restaurant_catalog の住所から作る、上下 2% を落とした
広がり）を使い、次の 2 本だけで決める。

| probe | textQuery | 位置 | 役割 |
| --- | --- | --- | --- |
| `box` | 店名 | `locationRestriction` = 市区町村の矩形 | その市の中に同名が 1 件しか無いこと |
| `area` | 店名 + 都道府県市区町村 | 無し（座標と独立） | その 1 件を名前で指せること |

採用は **両方がちょうど 1 件で、しかも同じ place_id** のときだけ（`city_box_unique_strict`）。
1 件でも多ければ捨てる。#1276 と同じ思想で「確定したものが正しい」を優先し、
確定率は捨てる。**誤帰属は KPI を汚す**（間違った店の投稿が配信される）。

## 実測（2026-09-05、インフルエンサー caption 1,800 件 / `1841_place_id_by_name/`）

| | 数 | 分母 |
| --- | ---: | --- |
| 店名 + 市区町村 が採れた投稿 | 490 | 1,800 件のキャプション（店名なし 983 / 地点なし 327） |
| 異なり (店名, 市区町村) | 365 | 上の投稿を畳んだもの |
| **確定** | **76（20.8%）** | 問い合わせた 365 キー（request 730 本 / 約 2 分） |
| 確定のうち `restaurant_catalog` に既に居た | 38 | 76 |
| **そのうち同じ店だった** | **36（94.7%）** | 目視で 38 件を突き合わせ |

捨てた理由の内訳は `city_box_not_unique` 196 / `no_candidate_in_city_box` 58 /
`area_query_not_unique` 23 / `probes_disagree` 12。**確定率を決めているのは
«市の矩形で 1 件に決まらない»** で、Text Search が店名に対して関連する店を複数返すためである。

誤りは 38 件中 2 件で、どちらも **判定ではなく «抜き出した文字列が店名でない»** ことが原因
（`「」` の中が料理名だった / 同じ施設の別テナント）。同じ原因で駅名・神社を引いていたぶんは
`_is_probeable_name` で落とした（→ その関数のコメント）。残りの 38 件は catalog に**無い**店
＝ この仕組みでしか採れなかった店で、`sample_place_id_by_name.tsv` の Google Maps URL から
人が 1 件ずつ確認できる。

上の 365 キーぶんの応答は `probe_cache.csv.gz` に入れてあるので、採用ルールを緩めたときの
確定数は**課金せずに**測り直せる。同じ 365 キーでの実測: 現行 76 キーに対し、
「area が一意でその place が矩形の中」なら 94 キー、「矩形が一意で area がそれを挙げる」なら
90 キー。**+18 キーのために厳しさを 1 段落とす取引**であり、その誤りは未計測なので採らない。

## 出力

`sns_name_place_lookup` は «(店名, 都道府県, 市区町村) → place_id» の辞書である。
投稿ではなく **店名候補**を単位にするのは、114,107 の異なり店名に対して投稿が 382,386 件
あり、同じ名前を何度も Google へ聞くのが無駄だからである。投稿への貼り付けは別ステップ。

判定を後から見直せるよう、**返ってきた place_id の一覧そのもの**（`box_place_ids` /
`area_place_ids`）も残す。ルールを変えても Google を引き直さずに再評価できる（#1276 と同じ）。

## 使い方

```bash
# 件数だけ数える（API も BigQuery 書き込みも起きない）
python3 4_18_resolve_place_id_by_name.py --run-id sns-2026-09-05-name --limit 2000 --dry-run

# 実行（--execute が無ければ API を叩かない）
python3 4_18_resolve_place_id_by_name.py --run-id sns-2026-09-05-name --limit 2000 \
    --execute --qps 8 --workers 12
```

`--posts-jsonl` / `--city-index-json` / `--out-jsonl` は BigQuery の資格情報が無い環境で
精度検証を回すための入出力。本番（db-script-run.yml）では指定しない。

## 全量の見積り

店が決まっていない投稿は 382,386 件（うち caption 有り 332,258）で、そのうち
**132,243 件（39.8%）にキャプションから店名候補と地域が両方採れる**（2026-09-05 の BigQuery 実測）。
上の実測レート（投稿→キー 0.75、キーの確定 20.8%）を当てると、異なりキーは約 99,000、
Google への request は **約 198,000 本**。実測スループット 8 req/s で **約 7 時間**、
確定は **約 20,000 キー**。1 キーが平均何投稿ぶんかは経路で変わる（この検証では 1.05）ので、
投稿の枚数はキー数以上、としか言えない。
Text Search Essentials (IDs Only) は $0.00 だが 1 日 75,000 request の回数上限があるので
（`free_places.DailyQuotaExhausted`）、3 日に分けるか `--limit` で刻む。

## この隣にあるもの

`1841_place_id_by_name/` は上の実測のエビデンス。`sample_place_id_by_name.tsv` は
365 キーぶんの判定（Google Maps URL 付き。人が 1 件ずつ確認できる）、`probe_cache.csv.gz` は
Google の応答（place_id のみ）で、`cache_io.py load` で戻せば**課金せずに**判定を作り直せる。
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sqlite3
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))
# 課金ガードは #1276 の client が唯一の正。ここで HTTP を書き直さない（→ module docstring）。
sys.path.insert(0, str(Path(__file__).resolve().parent / "1276_place_id_free_poc"))

from common_sns import (TABLE_POST_RAW, TABLE_POST_RESOLVED, build_city_bbox_index,  # noqa: E402
                        build_city_index, city_from_text, city_index_sql)
from free_places import (DailyQuotaExhausted, FreePlacesClient, RateLimiter,  # noqa: E402
                         SearchResult)
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now  # noqa: E402
from sns_html import pin_names_from_text, store_name_from_text, normalize_match_text  # noqa: E402

LOGGER = logging.getLogger(__name__)

TABLE_NAME_PLACE = "sns_name_place_lookup"
# 判定を変えたら上げる。resume は version 単位なので、古い version の行があっても引き直される。
ALGORITHM_VERSION = "city-box-unique-strict-v1"

_METRES_PER_DEGREE = 111_320.0
# 市域が極端に小さい/大きいときの矩形の下限・上限（半辺）。
# 下限が無いと 1 店しか catalog に無い市で矩形が点になり、上限が無いと «市» が県ほど広くなる。
MIN_HALF_SIDE_M = 400.0
MAX_HALF_SIDE_M = 20_000.0

# 確定の理由（採用）と、捨てた理由（棄却）。BigQuery の decision 列に入る。
DECISION_MATCHED = "city_box_unique_strict"


@dataclass(frozen=True)
class NameKey:
    """Google へ 1 回聞く単位。同じ (店名, 市区町村) は 1 回しか聞かない。"""

    store_name: str
    pref: str
    city: str

    @property
    def area_text(self) -> str:
        return f"{self.pref}{self.city}"


@dataclass(frozen=True)
class NameMatchDecision:
    place_id: str | None
    decision: str


# ---------------------------------------------------------------------------
# 純粋な判定（HTTP から切り離してテストで固定する。#1276 の decide_match と同じ思想）
# ---------------------------------------------------------------------------


def build_city_box_payload(name: str, box: tuple[float, float, float, float]) -> dict[str, Any]:
    """店名 + 市区町村の矩形（`locationRestriction`）の request body。

    `locationBias` と違い矩形の外を実際に切り落とすので、「その place は Google 側でも
    この市の中にある」の裏取りになる。fieldMask はここでは決めない（client 側で固定）。
    """
    lat_lo, lng_lo, lat_hi, lng_hi = box
    lat_pad = max(0.0, (MIN_HALF_SIDE_M - (lat_hi - lat_lo) / 2 * _METRES_PER_DEGREE)) / _METRES_PER_DEGREE
    scale = _METRES_PER_DEGREE * max(math.cos(math.radians((lat_lo + lat_hi) / 2)), 0.01)
    lng_pad = max(0.0, (MIN_HALF_SIDE_M - (lng_hi - lng_lo) / 2 * scale)) / scale
    # 上限は中心から切り詰める（広すぎる矩形は «市の中で一意» の意味を失う）
    lat_c, lng_c = (lat_lo + lat_hi) / 2, (lng_lo + lng_hi) / 2
    lat_half = min((lat_hi - lat_lo) / 2 + lat_pad, MAX_HALF_SIDE_M / _METRES_PER_DEGREE)
    lng_half = min((lng_hi - lng_lo) / 2 + lng_pad, MAX_HALF_SIDE_M / scale)
    return {
        "languageCode": "ja",
        "regionCode": "JP",
        # 「ちょうど 5 件」と「40 件」を区別できないと曖昧さを取りこぼす。
        # IDs Only は件数で課金が変わらないので上限まで取る。
        "pageSize": 20,
        "includePureServiceAreaBusinesses": False,
        "textQuery": name,
        "locationRestriction": {
            "rectangle": {
                "low": {"latitude": lat_c - lat_half, "longitude": lng_c - lng_half},
                "high": {"latitude": lat_c + lat_half, "longitude": lng_c + lng_half},
            }
        },
    }


def build_area_query_payload(name: str, area_text: str) -> dict[str, Any]:
    """店名 + «東京都八王子市» の text query。**位置は渡さない**（矩形と独立な証拠にするため）。"""
    return {
        "languageCode": "ja",
        "regionCode": "JP",
        "pageSize": 5,
        "includePureServiceAreaBusinesses": False,
        "textQuery": f"{name} {area_text}",
    }


def decide_name_match(box: SearchResult | None, area: SearchResult | None) -> NameMatchDecision:
    """#1276 `box_unique_strict` の «座標» を «市区町村» に置き換えた唯一の判定関数。

    採用は「市の矩形の中に 1 件だけ」かつ「店名＋市区町村の検索も 1 件だけ」かつ
    「その 2 つが同じ place_id」のときだけ。1 件でも多ければ捨てる。
    """
    if box is None or area is None:
        return NameMatchDecision(None, "probe_missing")
    for result in (box, area):
        if result.http_status != 200:
            return NameMatchDecision(None, "api_error")

    box_ids, area_ids = box.place_ids, area.place_ids
    if not box_ids:
        return NameMatchDecision(None, "no_candidate_in_city_box")
    if len(box_ids) > 1:
        return NameMatchDecision(None, "city_box_not_unique")
    if not area_ids:
        return NameMatchDecision(None, "area_query_empty")
    if len(area_ids) > 1:
        # 名前が市区町村の中で一意でも、同名の別店が近隣にあるなら取り違えうる。
        return NameMatchDecision(None, "area_query_not_unique")
    if box_ids[0] != area_ids[0]:
        return NameMatchDecision(None, "probes_disagree")
    return NameMatchDecision(box_ids[0], DECISION_MATCHED)


# ---------------------------------------------------------------------------
# キャプション → (店名, 市区町村)
# ---------------------------------------------------------------------------

# 店名として短すぎるもの。TS の下限は 2 だが、2 文字の屋号は Google 検索で必ず何かに当たる。
MIN_PROBE_NAME_LENGTH = 3
# 名前ではないことが字面で分かるもの（URL・ハンドルだけの行・数字だけ）
_NOT_A_NAME = ("http://", "https://", "www.")

# **店ではない場所**の名前。実測 90 件の確定のうち 9 件が «北四番丁駅» «池袋駅» のような
# 最寄り駅で、3 件が神社・橋だった。これらは place_id としては正しく引けてしまうが、
# «その投稿の料理を出した店» ではないので、投稿を貼ると誤帰属になる。
# Google の type を買えば一発で分かるが、それは課金される（IDs Only の外）。
# 名前の末尾だけで落とせるものはここで落とす。
#
# ⚠️ 短い綴りを足さないこと。«ic»（インターチェンジのつもり）を入れると `music` `picnic` が
# 巻き添えで落ちる。落とすのは «それ単体で施設名になっている» 語尾だけにする。
_NOT_A_STORE_SUFFIX = ("駅", "神社", "八幡宮", "大社", "公園", "空港", "大学", "高校",
                       "病院", "役所", "図書館", "美術館", "博物館", "体育館", "駐車場",
                       "インター", "橋")


def extract_store_name(caption: str | None) -> tuple[str, str] | None:
    """キャプションから (店名, どこから採ったか) を返す。**規則を新しく作らない。**

    - 📍行: `shared/utils/textNormalize.ts` の `extractPinNames`（Python 版は `sns_html`）
    - 『』「」: `sns_html.store_name_from_text`（#1812 で入れた既存の規則）

    📍 を先に見るのは、4_11 が『』「」から採った店名を «📍店名» としてキャプション先頭へ
    足しているため（同じ店名を 2 経路で採らないよう、先に 📍 を見れば済む）。
    """
    for name in pin_names_from_text(caption):
        if _is_probeable_name(name):
            return name, "pin"
    quoted = store_name_from_text(caption or "")
    if quoted:
        normalized = normalize_match_text(quoted)
        if _is_probeable_name(normalized):
            return normalized, "quoted"
    return None


def _is_probeable_name(name: str) -> bool:
    """Google へ聞く価値があり、聞いても誤帰属しない形かを見る（**抽出規則ではない**）。

    抽出そのものは TS と同じ規則に固定してあり、ここでは «その名前で問い合わせるか» だけを
    決める。実測 94 件のうち唯一の明確な誤帰属は、📍行 のローマ字住所
    （`1-16-11 aobadai, meguro-ku, tokyo, 3f`）を店名として投げたものだった。
    `PIN_ADDRESS_LEAD` は日本語の «住所» にしか当たらないので、数字始まりをここで落とす。
    """
    if len(name) < MIN_PROBE_NAME_LENGTH:
        return False
    if any(marker in name for marker in _NOT_A_NAME):
        return False
    # 数字で始まるものは住所（番地）である。店名として投げると別の店に当たる。
    if name[0].isdigit():
        return False
    # 駅・神社などは «店» ではない。引けてしまうぶん、投稿を貼ると誤帰属になる。
    if name.endswith(_NOT_A_STORE_SUFFIX) or "神社" in name:
        return False
    # 記号と数字だけの «名前» は店名ではない
    return any(ch.isalpha() for ch in name)


def build_name_keys(
    posts: Iterable[dict[str, Any]],
    by_pair: dict,
    uniq: dict,
    pref_of_unique_city: dict,
) -> tuple[dict[NameKey, dict[str, Any]], dict[str, int]]:
    """投稿を (店名, 市区町村) へ畳む。戻り値は (キー→{post_ids, name_source}, 落ちた理由の内訳)。"""
    keys: dict[NameKey, dict[str, Any]] = {}
    reasons = {"no_store_name": 0, "no_area_hint": 0, "ok": 0}
    for post in posts:
        caption = post.get("caption")
        found = extract_store_name(caption)
        if found is None:
            reasons["no_store_name"] += 1
            continue
        name, source = found
        # 地点は «キャプション優先、無ければ検索クエリ»（4_11 と同じ順序）
        area = (city_from_text(caption or "", by_pair, uniq)
                or city_from_text(post.get("discovery_query") or "", by_pair, uniq))
        if area is None:
            reasons["no_area_hint"] += 1
            continue
        pref, city = area
        pref = pref or pref_of_unique_city.get(city)
        if pref is None or (pref, city) not in by_pair:
            reasons["no_area_hint"] += 1
            continue
        reasons["ok"] += 1
        entry = keys.setdefault(NameKey(name, pref, city), {"post_ids": [], "name_source": source})
        entry["post_ids"].append(post["post_id"])
    return keys, reasons


# ---------------------------------------------------------------------------
# probe キャッシュ（#1276 の cache_io と同じ表の形。dump/load をそのまま使える）
# ---------------------------------------------------------------------------


class ProbeCache:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(str(path), check_same_thread=False)
        self._connection.execute(
            """CREATE TABLE IF NOT EXISTS probe (
                seed_id TEXT NOT NULL, probe TEXT NOT NULL, fingerprint TEXT,
                status INTEGER, ids TEXT NOT NULL, error TEXT,
                PRIMARY KEY (seed_id, probe))"""
        )
        self._connection.commit()
        self._lock = threading.Lock()

    def get(self, seed_id: str, probe: str) -> SearchResult | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT status, ids, error FROM probe WHERE seed_id = ? AND probe = ?",
                (seed_id, probe),
            ).fetchone()
        if row is None:
            return None
        return SearchResult(tuple(json.loads(row[1])), row[0], row[2])

    def put(self, seed_id: str, probe: str, result: SearchResult) -> None:
        with self._lock:
            self._connection.execute(
                "INSERT OR REPLACE INTO probe (seed_id, probe, status, ids, error) VALUES (?, ?, ?, ?, ?)",
                (seed_id, probe, result.http_status, json.dumps(list(result.place_ids)),
                 result.error_message),
            )
            self._connection.commit()


# ---------------------------------------------------------------------------
# 実行
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="キャプションの店名から無料 SKU で place_id を逆引きする")
    p.add_argument("--run-id", default=None)
    p.add_argument("--catalog-run-id", default="restaurant-2026-08-23")
    p.add_argument("--limit", type=int, required=True, help="読む投稿の上限。API 呼び出しの上限でもある")
    p.add_argument("--source-run-id", default=None, help="対象を 1 つの収集 run に絞るとき")
    p.add_argument("--execute", action="store_true", help="指定したときだけ Google API を叩く")
    p.add_argument("--dry-run", action="store_true", help="件数だけ数える（API も BigQuery 書き込みも無し）")
    p.add_argument("--qps", type=float, default=8.0)
    p.add_argument("--workers", type=int, default=12)
    p.add_argument("--cache", default="cache/name_probe.sqlite", help="probe キャッシュ（再実行で再課金しないため）")
    p.add_argument("--posts-jsonl", default=None, help="BigQuery の代わりに読む投稿 JSONL（検証用）")
    p.add_argument("--city-index-json", default=None, help="BigQuery の代わりに読む市区町村索引（検証用）")
    p.add_argument("--out-jsonl", default=None, help="BigQuery の代わりに書き出す先（検証用）")
    p.add_argument("--no-bq-write", action="store_true", help="BigQuery へ書かない（--out-jsonl と併用）")
    return p.parse_args()


def api_key() -> str:
    # 本番は db-script-run.yml の PLACES_TEXT_SEARCH_API_KEY。PLACE_API_TEST は #1276 の検証用。
    key = os.getenv("PLACES_TEXT_SEARCH_API_KEY") or os.getenv("PLACE_API_TEST")
    if not key:
        raise RuntimeError("PLACES_TEXT_SEARCH_API_KEY が未設定です（Text Search IDs Only 専用キー）")
    return key


def load_city_index(args: argparse.Namespace, pipeline: BigQueryPipeline | None) -> tuple[dict, dict, dict]:
    if args.city_index_json:
        rows = json.loads(Path(args.city_index_json).read_text(encoding="utf-8"))
    else:
        from google.cloud import bigquery

        assert pipeline is not None
        rows = [dict(r) for r in pipeline.execute(
            city_index_sql(pipeline.table("restaurant_catalog")),
            [bigquery.ScalarQueryParameter("crid", "STRING", args.catalog_run_id)])]
    by_pair, uniq = build_city_index(rows)
    boxes, pref_of_unique_city = build_city_bbox_index(rows)
    LOGGER.info("市区町村 %d 件（全国で一意 %d 件）", len(by_pair), len(uniq))
    return by_pair, uniq, {"boxes": boxes, "pref_of_unique_city": pref_of_unique_city}


POSTS_SQL = """
  WITH r AS (
    SELECT post_id, ANY_VALUE(provider) provider, ANY_VALUE(caption) caption,
           ANY_VALUE(discovery_query) discovery_query,
           ANY_VALUE(discovery_seed_place_id) seed_place_id
    FROM `__RAW__`
    WHERE caption IS NOT NULL AND (@source_run_id IS NULL OR run_id = @source_run_id)
    GROUP BY post_id
  ), v AS (
    SELECT post_id, ANY_VALUE(google_place_id) google_place_id
    FROM `__RESOLVED__` GROUP BY post_id
  )
  SELECT r.post_id, r.provider, r.caption, r.discovery_query
  FROM r LEFT JOIN v USING (post_id)
  -- 柱1（店アカ）は収集時点で店が決まっている。resolve が店を引けた投稿も対象外。
  WHERE (r.seed_place_id IS NULL OR r.seed_place_id = '')
    AND (v.google_place_id IS NULL OR v.google_place_id = '')
  ORDER BY r.post_id
  LIMIT @limit
"""


def load_posts(args: argparse.Namespace, pipeline: BigQueryPipeline | None) -> list[dict[str, Any]]:
    if args.posts_jsonl:
        with Path(args.posts_jsonl).open(encoding="utf-8") as stream:
            return [json.loads(line) for line in stream if line.strip()][: args.limit]
    from google.cloud import bigquery

    assert pipeline is not None
    sql = (POSTS_SQL.replace("__RAW__", pipeline.table(TABLE_POST_RAW))
           .replace("__RESOLVED__", pipeline.table(TABLE_POST_RESOLVED)))
    return [dict(r) for r in pipeline.execute(sql, [
        bigquery.ScalarQueryParameter("source_run_id", "STRING", args.source_run_id),
        bigquery.ScalarQueryParameter("limit", "INT64", args.limit),
    ])]


def load_done_keys(pipeline: BigQueryPipeline | None) -> set[tuple[str, str, str]]:
    """既に確定/棄却した (店名, 県, 市) は聞き直さない（同じ質問へ二度課金しないため）。"""
    if pipeline is None:
        return set()
    from google.api_core.exceptions import NotFound
    from google.cloud import bigquery

    try:
        rows = pipeline.execute(
            f"SELECT store_name, area_pref, area_city FROM `{pipeline.table(TABLE_NAME_PLACE)}` "
            "WHERE algorithm_version = @v AND decision != 'api_error'",
            [bigquery.ScalarQueryParameter("v", "STRING", ALGORITHM_VERSION)])
    except NotFound:
        return set()
    return {(r["store_name"], r["area_pref"], r["area_city"]) for r in rows}


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS `__TABLE__` (
  store_name       STRING NOT NULL,
  area_pref        STRING NOT NULL,
  area_city        STRING NOT NULL,
  name_source      STRING,
  google_place_id  STRING,
  decision         STRING NOT NULL,
  box_place_ids    ARRAY<STRING>,
  area_place_ids   ARRAY<STRING>,
  post_count       INT64 NOT NULL,
  sample_post_id   STRING,
  algorithm_version STRING NOT NULL,
  resolved_at      TIMESTAMP NOT NULL,
  run_id           STRING NOT NULL
)
PARTITION BY DATE(resolved_at)
CLUSTER BY decision, area_pref
OPTIONS (description = 'キャプションの店名 → google_place_id の逆引き辞書。無料 SKU (Text Search IDs Only) のみ。Google 由来の店名/住所/座標は持たない。#1841')
"""


def probe_key(client: FreePlacesClient, cache: ProbeCache, key: NameKey,
              box: tuple[float, float, float, float]) -> tuple[SearchResult, SearchResult]:
    seed_id = f"{key.store_name}{key.pref}{key.city}"
    results: list[SearchResult] = []
    for probe, payload in (("box", build_city_box_payload(key.store_name, box)),
                           ("area", build_area_query_payload(key.store_name, key.area_text))):
        cached = cache.get(seed_id, probe)
        if cached is None:
            cached = client.search_text(payload)
            # 失敗（429/5xx/切断）は «答え» ではないので残さない。残すと次回のキャッシュ
            # ヒットで永久に api_error のままになる（#1276 で 15,376 件が同じ形で死んだ）。
            if cached.ok:
                cache.put(seed_id, probe, cached)
        results.append(cached)
    return results[0], results[1]


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    offline = bool(args.posts_jsonl and args.city_index_json)
    pipeline = None if offline else BigQueryPipeline()

    by_pair, uniq, geo = load_city_index(args, pipeline)
    posts = load_posts(args, pipeline)
    LOGGER.info("店が決まっていない投稿 %d 件を読みました", len(posts))

    keys, reasons = build_name_keys(posts, by_pair, uniq, geo["pref_of_unique_city"])
    LOGGER.info("店名を採れた投稿 %d 件 / 店名なし %d 件 / 地点なし %d 件",
                reasons["ok"], reasons["no_store_name"], reasons["no_area_hint"])
    LOGGER.info("異なり (店名, 市区町村) = %d 件（Google へ聞く回数はこの 2 倍）", len(keys))

    done = load_done_keys(pipeline) if not args.dry_run else set()
    todo = [k for k in keys if (k.store_name, k.pref, k.city) not in done]
    LOGGER.info("うち未問い合わせ %d 件（済み %d 件は聞き直さない）", len(todo), len(keys) - len(todo))

    if args.dry_run or not args.execute:
        LOGGER.info("--execute が無いので Google API も BigQuery 書き込みも行いません")
        return

    client = FreePlacesClient(api_key(), rate_limiter=RateLimiter(qps=args.qps))
    cache = ProbeCache(Path(args.cache))
    rows: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    now = utc_now().isoformat()

    def work(key: NameKey) -> dict[str, Any]:
        box_result, area_result = probe_key(client, cache, key, geo["boxes"][(key.pref, key.city)])
        decision = decide_name_match(box_result, area_result)
        entry = keys[key]
        return {
            "store_name": key.store_name,
            "area_pref": key.pref,
            "area_city": key.city,
            "name_source": entry["name_source"],
            "google_place_id": decision.place_id,
            "decision": decision.decision,
            "box_place_ids": list(box_result.place_ids),
            "area_place_ids": list(area_result.place_ids),
            "post_count": len(entry["post_ids"]),
            "sample_post_id": entry["post_ids"][0],
            "algorithm_version": ALGORITHM_VERSION,
            "resolved_at": now,
            "run_id": run_id,
        }

    try:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(work, key): key for key in todo}
            for i, future in enumerate(as_completed(futures), start=1):
                row = future.result()
                rows.append(row)
                counts[row["decision"]] = counts.get(row["decision"], 0) + 1
                if i % 200 == 0:
                    LOGGER.info("  %d/%d 件（確定 %d）", i, len(todo), counts.get(DECISION_MATCHED, 0))
    except DailyQuotaExhausted:
        LOGGER.error("Text Search の日次上限に当たりました。ここまでの結果だけ書き出します")

    LOGGER.info("判定の内訳: %s", json.dumps(counts, ensure_ascii=False, sort_keys=True))
    matched = counts.get(DECISION_MATCHED, 0)
    LOGGER.info("確定 %d / %d 件（%.1f%%）", matched, len(rows), 100.0 * matched / max(len(rows), 1))
    LOGGER.info("Google への request 数: %d（すべて Text Search Essentials IDs Only = $0.00）",
                client.request_count)

    if args.out_jsonl:
        with Path(args.out_jsonl).open("w", encoding="utf-8") as stream:
            for row in rows:
                stream.write(json.dumps(row, ensure_ascii=False) + "\n")
        LOGGER.info("%d 行を %s へ書きました", len(rows), args.out_jsonl)

    if pipeline is not None and not args.no_bq_write and rows:
        pipeline.execute(CREATE_TABLE_SQL.replace("__TABLE__", pipeline.table(TABLE_NAME_PLACE)))
        pipeline.load_json_rows(TABLE_NAME_PLACE, rows)
        LOGGER.info("%s へ %d 行を書きました", TABLE_NAME_PLACE, len(rows))


if __name__ == "__main__":
    main()
