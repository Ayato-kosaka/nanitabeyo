#!/usr/bin/env python3
"""#1947（親 #1273）4_18 が確定させた店を、**投稿へ貼る**（Google も IG も 1 回も叩かない）。

## なぜ要るか

`4_18_resolve_place_id_by_name.py` は «(店名, 都道府県, 市区町村) → google_place_id» の
**辞書**を作るところで止まっている（あの module docstring の «投稿への貼り付けは別ステップ»）。
辞書は `sns_name_place_lookup` に貯まっているのに、貼り先の
`sns_name_place_post_link` は 0 行のままで、**確定した店が 1 投稿にも届いていない**。

BigQuery 実測（2026-09-10、リーダー計測）:

| 指標 | 値 |
| --- | ---: |
| `decision='city_box_unique_strict'` の行 | 21,322 |
| それが覆う投稿 / 異なり店 | 30,979 / 19,866 |
| うち `restaurant_catalog` に居てまだ配信していない店 | **5,461**（配信中 26,351 に対し +20.7%） |

外部 API を 1 回も呼ばずに供給が増える。ここがこの script の存在理由である。

## やること（4_17 と同じ規律）

1. 4_18 と **同じ対象集合・同じ抽出**で投稿を (店名, 市区町村) キーへ畳む
   （`load_posts` / `build_name_keys` を 4_18 から **import して使う**。写経しない）
2. `sns_name_place_lookup` から辞書を作る。使う判定は次の **2 つだけ**
   - `decision='city_box_unique_strict'`（4_18 が確定させたもの）
   - `decision='city_box_not_unique'` のうち、**箱の候補で `restaurant_catalog` に
     居るものがちょうど 1 件**のもの（下記「箱の中で 1 店だけ飲食店だったら採る」）
3. 当たった投稿へ `discovery_seed_place_id` を後入れする
   - **既に値がある行は上書きしない**（収集時に分かっている店の方が強い）
   - 1 投稿に **2 店以上**当たったら書かない（«決まらない» は «間違えて入れる» より良い）
   - **看板の identity key を持つ経路には書かない**（下記の ⚠️）
4. 貼った実績を `sns_name_place_post_link` へ残す（append-only の台帳）

## 箱の中で 1 店だけ飲食店だったら採る（`box_one_in_catalog`）

`city_box_not_unique` は «市区町村の矩形の中に、その店名で 2 件以上ヒットした» という
理由で 4_18 が捨てた行である。ただし Google が返す候補には**飲食店ではない場所**
（同名のビル・駅・美容室・チェーンの別業態）が混ざる。`box_place_ids` のうち
**`restaurant_catalog` に居るのが 1 件しかない**なら、料理の投稿が指しているのは
その 1 件である — これがこの規則の全てで、**2 件以上あるなら今までどおり捨てる**。

BigQuery 実測（2026-09-10、リーダー計測。`city_box_not_unique` のキーを catalog と突き合わせた）:

| `box_place_ids` のうち catalog に居る数 | キー | この script の扱い |
| --- | ---: | --- |
| 0 件 | 7,049 | **採らない**（飲食店として知らない） |
| **ちょうど 1 件** | **3,064** | **採る**（＋4,432 投稿） |
| 2 件以上 | 5,453 | **採らない**（どちらか決められない） |

安全側に倒れている理由は 3 つある。

- **判定を緩めたのではなく、候補を絞る辞書を足しただけ**である。4_18 の «矩形の中に
  1 件だけ» は Google の検索結果に対する条件で、こちらは «その候補が飲食店か» を
  こちらの catalog で見ている。2 件以上残る（＝飲食店が複数ある）ものは採らない
- 採った place_id は **必ず `restaurant_catalog` に居る**。配信に出る店であり、
  «Google には有るがこちらは知らない場所» を新しく持ち込まない
- 後段のガード（既存 seed を上書きしない / 1 投稿 2 店なら書かない /
  identity key を持つ経路へ書かない）は strict と **1 つも変えずに**通す

## 出所を混ぜないための印

後入れした seed は `seed_source` を立てる。4_18 の実測精度は
**95.0%（catalog と照合できた 40 件中 38 件）**で、収集時に確定した seed
（そのアカウント＝その店）とは確度が違う。印が無いと監査も巻き戻しもできない。

**2 つの規則は別の値にする**（混ぜると «新しい規則だけ巻き戻す» ができなくなる）。

| 規則 | 台帳の `link_rule` | `sns_post_raw.seed_source` |
| --- | --- | --- |
| 4_18 が確定させた | `city_box_unique_strict` | `name_place_lookup` |
| 箱の中で catalog に 1 店 | `box_one_in_catalog` | `name_place_box_one_in_catalog` |

⚠️ **`discovery_method` / `discovery_route` は書き換えない。** あれは «どうやってこの投稿を
見つけたか» であって «店をどう決めたか» ではない（`4_0b_add_caption_column.py` の設計コメント）。
«この経路専用の新しい値» は `seed_source` の側に置く。

## ⚠️ 既存の identity key を壊さないための除外（#1846 を読んでから書いた）

`common_sns.SEED_IDENTITY_KEY_SQL` は «その seed はどの看板が名乗ったものか» を
`discovery_route` で決め、`post_store_cte_sql` は **1 つの看板が 2 店以上の place_id を
指していたらその看板の seed を全部捨てる**。

つまり `store_site_embed`（看板＝サイトのドメイン）の投稿へ、名前由来の別の店を
後入れすると、**そのドメインの n_place が 2 になり、同じドメインで採れた他の投稿の
seed まで丸ごと無効化される**。1 投稿を増やして数十投稿を殺す形なので、
`SEED_IDENTITY_ROUTES` の経路は最初から対象にしない
（`store_account` は収集時点で必ず seed を持つので実際には候補に入らないが、
**経路ではなく «identity key を持つか» で切る**。切り方を «たまたま今そうなっている»
事実に寄せると、経路が増えたときに黙って壊れる）。

その他の経路（cc_index / cc_wat / gourmet_media / hashtag_search / wayback_cdx …）は
identity key を持たない＝共有度で落とされないので、後入れしても既存の判定に影響しない。

## 使い方

```bash
# 何件貼ることになるかを数える（BigQuery へ 1 行も書かない）
python3 4_21_link_name_place_to_posts.py --run-id sns-2026-09-10-namelink --dry-run

# 新しい規則（箱の中で catalog に 1 店）だけを 500 件貼って、サンプルを人が見る
python3 4_21_link_name_place_to_posts.py --run-id sns-2026-09-10-namelink \
    --execute --only-rule box_one_in_catalog --limit 500 \
    --sample-out out/name_place_link_sample.tsv

# 全量
python3 4_21_link_name_place_to_posts.py --run-id sns-2026-09-10-namelink --execute
```

`--limit` は **貼る投稿数**の上限（post_id 昇順）。4_18 の `--limit` と違って
**繰り返すと先へ進む**: 貼った投稿は seed が埋まるので、次の run の対象集合
（`4_18.POSTS_SQL` は seed が空の投稿しか返さない）から自動的に外れる。
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import logging
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Iterable, Mapping

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
# 4_18 は #1276 の課金ガード client を import するので、その置き場所も通しておく
sys.path.insert(0, str(HERE / "1276_place_id_free_poc"))

from common_sns import SEED_IDENTITY_ROUTES, TABLE_POST_RAW  # noqa: E402
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now  # noqa: E402

LOGGER = logging.getLogger(__name__)

TABLE_NAME_PLACE = "sns_name_place_lookup"
TABLE_NAME_PLACE_LINK = "sns_name_place_post_link"
TABLE_CATALOG = "restaurant_catalog"

# 4_18 が «矩形の中で一意にならなかった» と書いた行の decision。
# ⚠️ 4_18 側は判定関数の中の文字列リテラルで、定数になっていない（あの file は触らない）。
# 写した文字列が古くなると、この規則が **黙って 1 件も拾わなくなる**（例外も出ない）ので、
# test で `resolver.decide_name_match` を実際に呼んで «今もこの値を返すか» を固定する。
DECISION_BOX_NOT_UNIQUE = "city_box_not_unique"

# 台帳の `link_rule`。«どちらの規則で決まった店か» を 1 行ごとに残す
# （strict 側の値は 4_18 の定数をそのまま使う。下の `resolver` を読んでから決まる）。
LINK_RULE_BOX_ONE = "box_one_in_catalog"

# `seed_source` に立てる印。**この経路だけの値**にする（既存の値へ相乗りしない）。
# 4_17 の 'caption_bare_handles' と同じ列・同じ作法で、出所だけが違う。
# 2 つの規則で値を分けるのは、片方だけを巻き戻せるようにするため（→ module docstring）。
SEED_SOURCE = "name_place_lookup"
SEED_SOURCE_BOX_ONE = "name_place_box_one_in_catalog"
SEED_SOURCES = (SEED_SOURCE, SEED_SOURCE_BOX_ONE)


def _load_resolver():
    """4_18 を module として読む（数字始まりのファイル名は `import` できない）。

    **抽出も対象集合も 4_18 が唯一の正**である。こちらで書き直すと、
    «Google へ聞いた投稿» と «貼る投稿» が別の集合になり、辞書と貼り先がずれる。
    """
    path = HERE / "4_18_resolve_place_id_by_name.py"
    spec = importlib.util.spec_from_file_location("resolve_place_id_by_name", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["resolve_place_id_by_name"] = module
    spec.loader.exec_module(module)
    return module


resolver = _load_resolver()

LINK_RULE_STRICT = resolver.DECISION_MATCHED


# ---------------------------------------------------------------------------
# 純粋な判定（BigQuery から切り離してテストで固定する。4_18 の decide_name_match と同じ思想）
# ---------------------------------------------------------------------------


def build_link_rows(
    keys: Mapping[Any, Mapping[str, Any]],
    lookup_rows: Iterable[Mapping[str, Any]],
    *,
    identity_route_posts: frozenset[str] | set[str],
    run_id: str,
    linked_at: str,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """«どの投稿へどの店を貼るか» を決める唯一の関数。戻り値は (貼る行, 落とした内訳)。

    キーを店へ落とす規則は 2 つだけで、**強い方（strict）が常に勝つ**。

    - `decision='city_box_unique_strict'` — 4_18 が確定させたもの
    - `decision='city_box_not_unique'` で、`catalog_box_place_ids`
      （箱の候補のうち `restaurant_catalog` に居るもの）が **ちょうど 1 件**のもの

    それ以外の «捨てた理由»（`area_query_not_unique` / `probes_disagree` / `api_error` …）は
    «決まらなかった» であって «たぶんこれ» ではないので使わない。実測で判定そのものを
    緩めた場合の精度は 79% → 64% まで落ちる（4_18 の module docstring）。

    ここで守る 4 つ（どれも «決まらないなら書かない» 側へ倒す）:

    1. 上の 2 規則に当たらない行は使わない。
    2. 同じキーに **2 つ以上の place_id** が付いていたら使わない。判定を変えた再実行が
       同じ (店名, 市, 県) に別の place_id を書き残していることがあり、
       «新しい方» を選ぶ根拠はこちらには無い。**箱の規則でも同じ**で、行をまたいで
       和集合を取り、2 件以上になったキーは丸ごと捨てる。
    3. strict の判断があるキーへ、箱の規則を **足さない・上書きしない**。strict が
       «2 店で曖昧» と言っているキーを、緩い方で救い直さない。
    4. 1 投稿に **2 店以上**当たったら書かない。

    さらに `identity_route_posts`（看板の identity key を持つ経路の投稿）を外す
    （→ module docstring の ⚠️）。
    """
    stats = {"lookup_rows": 0, "non_strict": 0, "ambiguous_keys": 0, "matched_keys": 0,
             "box_zero_in_catalog": 0, "box_many_in_catalog": 0, "box_one_keys": 0,
             "ambiguous_posts": 0, "identity_route_posts": 0,
             "linked_posts": 0, "linked_posts_box_one": 0}

    # 1: キー → 候補（規則ごとに別の箱へ入れる。strict と混ぜない）
    places_by_key: dict[tuple[str, str, str], set[str]] = {}
    box_places_by_key: dict[tuple[str, str, str], set[str]] = {}
    versions: dict[tuple[str, str, str], str] = {}
    for row in lookup_rows:
        stats["lookup_rows"] += 1
        decision = row.get("decision")
        key = (row["store_name"], row["area_pref"], row["area_city"])
        version = row.get("algorithm_version") or resolver.ALGORITHM_VERSION
        if decision == resolver.DECISION_MATCHED:
            place_id = (row.get("google_place_id") or "").strip()
            if not place_id:
                # strict なら place_id は必ずあるが、無い行を «当たり» に数えない
                stats["non_strict"] += 1
                continue
            places_by_key.setdefault(key, set()).add(place_id)
            versions[key] = version
            continue
        if decision == DECISION_BOX_NOT_UNIQUE:
            # 箱の候補のうち catalog に居るものは SQL 側で絞ってある（→ LOOKUP_SQL）。
            # ここでは «ちょうど 1 件か» だけを見る（0 件と 2 件以上は同じく «採らない»）
            in_catalog = {(p or "").strip() for p in (row.get("catalog_box_place_ids") or [])}
            in_catalog.discard("")
            if not in_catalog:
                stats["box_zero_in_catalog"] += 1
                stats["non_strict"] += 1
                continue
            box_places_by_key.setdefault(key, set()).update(in_catalog)
            versions.setdefault(key, version)
            continue
        stats["non_strict"] += 1

    # 2 + 3: キー → 店（1 キー 1 店だけ。strict が先に決め、残ったキーだけ箱の規則を見る）
    place_by_key: dict[tuple[str, str, str], str] = {}
    rule_by_key: dict[tuple[str, str, str], str] = {}
    for key, places in places_by_key.items():
        if len(places) != 1:
            stats["ambiguous_keys"] += 1
            continue
        place_by_key[key] = next(iter(places))
        rule_by_key[key] = LINK_RULE_STRICT
    stats["matched_keys"] = len(place_by_key)

    for key, places in box_places_by_key.items():
        if key in places_by_key:
            # strict の行があるキーは strict の判断に従う（曖昧で捨てたキーも救い直さない）
            continue
        if len(places) != 1:
            stats["box_many_in_catalog"] += 1
            continue
        place_by_key[key] = next(iter(places))
        rule_by_key[key] = LINK_RULE_BOX_ONE
    stats["box_one_keys"] = sum(1 for r in rule_by_key.values() if r == LINK_RULE_BOX_ONE)

    # 4: 投稿 → 店（1 店に決まったものだけ）
    candidates: dict[str, dict[str, Any]] = {}
    for name_key, entry in keys.items():
        key = (name_key.store_name, name_key.pref, name_key.city)
        place_id = place_by_key.get(key)
        if place_id is None:
            continue
        for post_id in entry["post_ids"]:
            found = candidates.setdefault(post_id, {"places": set(), "key": key,
                                                    "name_source": entry.get("name_source")})
            found["places"].add(place_id)
            if (rule_by_key[key] == LINK_RULE_STRICT
                    and rule_by_key[found["key"]] != LINK_RULE_STRICT):
                # 同じ店を strict と箱の規則の両方が指したときは、強い方を記録に残す
                found["key"] = key
                found["name_source"] = entry.get("name_source")

    rows: list[dict[str, Any]] = []
    for post_id in sorted(candidates):
        found = candidates[post_id]
        if len(found["places"]) != 1:
            stats["ambiguous_posts"] += 1
            continue
        if post_id in identity_route_posts:
            stats["identity_route_posts"] += 1
            continue
        store_name, area_pref, area_city = found["key"]
        rows.append({
            "post_id": post_id,
            "google_place_id": next(iter(found["places"])),
            "store_name": store_name,
            "area_pref": area_pref,
            "area_city": area_city,
            "name_source": found["name_source"],
            # «どちらの規則で決まった店か»。seed_source もこれで決まる（→ BACKFILL_SQL）
            "link_rule": rule_by_key[found["key"]],
            # 「どの判定で確定した店か」は 4_18 側の version をそのまま持ち回る
            "algorithm_version": versions[found["key"]],
            "linked_at": linked_at,
            "run_id": run_id,
        })
    stats["linked_posts"] = len(rows)
    stats["linked_posts_box_one"] = sum(1 for r in rows if r["link_rule"] == LINK_RULE_BOX_ONE)
    return rows, stats


# ---------------------------------------------------------------------------
# BigQuery 入出力
# ---------------------------------------------------------------------------


LOOKUP_SQL = """
  WITH lookup AS (
    SELECT store_name, area_pref, area_city, google_place_id, decision, algorithm_version,
           box_place_ids
    FROM `__TABLE__`
    WHERE decision IN UNNEST(@decisions)
  ),
  catalog AS (
    -- «こちらが飲食店として知っている place_id» の全体。これが箱の候補を絞る辞書になる
    SELECT DISTINCT google_place_id AS pid
    FROM `__CATALOG__`
    WHERE run_id = @catalog_run_id AND google_place_id IS NOT NULL
  ),
  in_catalog AS (
    SELECT l.store_name, l.area_pref, l.area_city, l.decision, l.algorithm_version,
           ARRAY_AGG(DISTINCT c.pid) AS catalog_box_place_ids
    FROM lookup l
    CROSS JOIN UNNEST(l.box_place_ids) AS p
    JOIN catalog c ON c.pid = p
    WHERE l.decision = @box_not_unique
    GROUP BY 1, 2, 3, 4, 5
  )
  SELECT l.store_name, l.area_pref, l.area_city, l.google_place_id, l.decision,
         l.algorithm_version,
         IFNULL(i.catalog_box_place_ids, ARRAY<STRING>[]) AS catalog_box_place_ids
  FROM lookup l
  LEFT JOIN in_catalog i
    USING (store_name, area_pref, area_city, decision, algorithm_version)
"""


def load_lookup_rows(pipeline: BigQueryPipeline, path: str | None, *,
                     catalog_table: str | None = None,
                     catalog_run_id: str | None = None) -> list[dict[str, Any]]:
    """4_18 の辞書を読む。**使う 2 つの decision だけ**を SQL 側でも絞る（読む量を減らすため）。

    `city_box_not_unique` の行には、`box_place_ids` のうち `restaurant_catalog` に
    居るものだけを `catalog_box_place_ids` として付けて返す。**この絞り込みが SQL 側に
    あるのは «catalog 全体を Python へ持ってこないため» であって、判定ではない**。
    «ちょうど 1 件か» の判定は `build_link_rows` が持つ。

    ⚠️ 絞りを SQL «だけ» に置かない。実際に書く直前でも `build_link_rows` が
    もう一度 decision を見る（4_14 が «SELECT 側のガードだけでは守られない» で学んだ形）。
    """
    if path:
        import json
        with Path(path).open(encoding="utf-8") as stream:
            return [json.loads(line) for line in stream if line.strip()]
    from google.cloud import bigquery

    sql = (LOOKUP_SQL
           .replace("__TABLE__", pipeline.table(TABLE_NAME_PLACE))
           .replace("__CATALOG__", catalog_table or pipeline.table(TABLE_CATALOG)))
    rows = pipeline.execute(sql, [
        bigquery.ArrayQueryParameter(
            "decisions", "STRING", [resolver.DECISION_MATCHED, DECISION_BOX_NOT_UNIQUE]),
        bigquery.ScalarQueryParameter("box_not_unique", "STRING", DECISION_BOX_NOT_UNIQUE),
        bigquery.ScalarQueryParameter("catalog_run_id", "STRING", catalog_run_id),
    ])
    return [dict(r) for r in rows]


IDENTITY_ROUTE_POSTS_SQL = """
  SELECT DISTINCT post_id FROM `__RAW__` WHERE discovery_route IN UNNEST(@routes)
"""


def load_identity_route_posts(pipeline: BigQueryPipeline | None) -> set[str]:
    """看板の identity key を持つ経路の投稿 ID（→ module docstring の ⚠️）。

    `sns_post_raw` は `CLUSTER BY provider, discovery_route` なので、この 1 列の
    DISTINCT は全表スキャンにならない。
    """
    if pipeline is None:
        return set()
    from google.cloud import bigquery

    sql = IDENTITY_ROUTE_POSTS_SQL.replace("__RAW__", pipeline.table(TABLE_POST_RAW))
    rows = pipeline.execute(sql, [bigquery.ArrayQueryParameter(
        "routes", "STRING", list(SEED_IDENTITY_ROUTES))])
    return {r["post_id"] for r in rows}


CREATE_LINK_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS `__TABLE__` (
  post_id           STRING NOT NULL,
  google_place_id   STRING NOT NULL,
  store_name        STRING NOT NULL,
  area_pref         STRING NOT NULL,
  area_city         STRING NOT NULL,
  name_source       STRING,
  link_rule         STRING,
  algorithm_version STRING NOT NULL,
  linked_at         TIMESTAMP NOT NULL,
  run_id            STRING NOT NULL
)
PARTITION BY DATE(linked_at)
CLUSTER BY google_place_id
OPTIONS (description = 'キャプションの店名から確定した店 (sns_name_place_lookup) を投稿へ貼った実績。append-only の台帳で、同じ post_id が複数行あり得る（読む側は DISTINCT で畳む）。#1947')
"""

# 台帳は既に 30,835 行入っている（strict だけの run）。`CREATE TABLE IF NOT EXISTS` は
# 既存の表に列を足さないので、規則を見分ける列は ALTER で足す。既存行は NULL＝strict
# として読む（→ BACKFILL_SQL の IF）。**既に貼った行の意味を後から書き換えない。**
ALTER_LINK_TABLE_SQL = """
ALTER TABLE `__TABLE__` ADD COLUMN IF NOT EXISTS link_rule STRING
"""

# ⚠️ **run 単位の DELETE で冪等化しない。** 途中で落ちた run を再実行すると、
# 既に seed を埋めた投稿は対象集合（seed が空の投稿だけ）から外れて再出現しない。
# そこで台帳を消すと «seed_source='name_place_lookup' なのに貼った記録が無い» 投稿が
# できて、監査も巻き戻しもできなくなる。台帳は追記だけにして、読む側で畳む。

BACKFILL_SQL = """
  UPDATE `__RAW__` r
  SET discovery_seed_place_id = m.google_place_id,
      seed_source = m.seed_source
  FROM (
    SELECT post_id, ANY_VALUE(google_place_id) AS google_place_id,
           -- どちらの規則で決まった店かを seed_source に残す（片方だけ巻き戻せるように）。
           -- link_rule が NULL なのは列を足す前に貼った行＝strict だけの run である
           ANY_VALUE(IF(link_rule = @box_one_rule, @seed_source_box_one, @seed_source))
             AS seed_source
    FROM `__LINK__`
    WHERE run_id = @run_id
    GROUP BY post_id
    -- 台帳は追記なので同じ投稿が複数行あり得る。2 店以上・2 規則以上なら書かない
    HAVING COUNT(DISTINCT google_place_id) = 1
       AND COUNT(DISTINCT IFNULL(link_rule, @strict_rule)) = 1
  ) m
  WHERE r.post_id = m.post_id
    AND (r.discovery_seed_place_id IS NULL OR r.discovery_seed_place_id = '')
    AND r.discovery_route NOT IN UNNEST(@identity_routes)
"""


def backfill_sql(pipeline: BigQueryPipeline) -> str:
    """貼った投稿へ `discovery_seed_place_id` を後入れする UPDATE。

    選んだ時点のガード（`build_link_rows`）と同じものを **書く側にも**置く。
    選んでから書くまでの間に、別のジョブが同じ投稿へ seed を入れることがある。

    - 既に seed がある行は触らない
    - 1 投稿に 2 店なら書かない
    - 看板の identity key を持つ経路には書かない
    - `discovery_method` / `discovery_route` は **1 列も書き換えない**
    """
    return (BACKFILL_SQL
            .replace("__RAW__", pipeline.table(TABLE_POST_RAW))
            .replace("__LINK__", pipeline.table(TABLE_NAME_PLACE_LINK)))


def backfill_params(run_id: str):
    from google.cloud import bigquery
    return [
        bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        bigquery.ScalarQueryParameter("seed_source", "STRING", SEED_SOURCE),
        bigquery.ScalarQueryParameter("seed_source_box_one", "STRING", SEED_SOURCE_BOX_ONE),
        bigquery.ScalarQueryParameter("box_one_rule", "STRING", LINK_RULE_BOX_ONE),
        bigquery.ScalarQueryParameter("strict_rule", "STRING", LINK_RULE_STRICT),
        bigquery.ArrayQueryParameter("identity_routes", "STRING", list(SEED_IDENTITY_ROUTES)),
    ]


APPLIED_COUNT_SQL = """
  SELECT r.seed_source, COUNT(DISTINCT r.post_id) AS applied
  FROM `__RAW__` r
  JOIN (SELECT DISTINCT post_id FROM `__LINK__` WHERE run_id = @run_id) l
    ON l.post_id = r.post_id
  WHERE r.seed_source IN UNNEST(@seed_sources)
    AND r.discovery_seed_place_id IS NOT NULL AND r.discovery_seed_place_id != ''
  GROUP BY r.seed_source
"""


def count_applied(pipeline: BigQueryPipeline, run_id: str) -> dict[str, int]:
    """**実際に seed が入った投稿数**を数える（«流したから入ったはず» を書かないため）。

    規則ごとに数える。片方だけが 0 なら «その規則が 1 件も通っていない» と分かる。
    """
    from google.cloud import bigquery

    sql = (APPLIED_COUNT_SQL
           .replace("__RAW__", pipeline.table(TABLE_POST_RAW))
           .replace("__LINK__", pipeline.table(TABLE_NAME_PLACE_LINK)))
    rows = pipeline.execute(sql, [
        bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        bigquery.ArrayQueryParameter("seed_sources", "STRING", list(SEED_SOURCES)),
    ])
    applied = {source: 0 for source in SEED_SOURCES}
    for row in rows:
        applied[row["seed_source"]] = int(row["applied"])
    return applied


SAMPLE_SQL = """
  WITH l AS (
    SELECT post_id, ANY_VALUE(google_place_id) AS google_place_id,
           ANY_VALUE(store_name) AS store_name, ANY_VALUE(area_pref) AS area_pref,
           ANY_VALUE(area_city) AS area_city, ANY_VALUE(name_source) AS name_source,
           ANY_VALUE(IFNULL(link_rule, @strict_rule)) AS link_rule
    FROM `__LINK__` WHERE run_id = @run_id GROUP BY post_id
  ),
  picked AS (SELECT * FROM l ORDER BY FARM_FINGERPRINT(post_id) LIMIT @row_limit)
  SELECT p.post_id, p.store_name, p.area_pref, p.area_city, p.name_source, p.link_rule,
         p.google_place_id, r.canonical_url, r.discovery_route,
         SUBSTR(REGEXP_REPLACE(IFNULL(r.caption, ''), r'\\s+', ' '), 1, 240) AS caption_head
  FROM picked p
  JOIN `__RAW__` r ON r.post_id = p.post_id
  QUALIFY ROW_NUMBER() OVER (PARTITION BY p.post_id ORDER BY r.fetched_at DESC) = 1
  ORDER BY p.post_id
"""


def write_sample(pipeline: BigQueryPipeline, run_id: str, path: Path, size: int) -> int:
    """人が 1 件ずつ «その店で合っているか» を見られる TSV を書く。

    Google Maps の URL を付けるのは、place_id のままでは人が確認できないため
    （Google 由来の店名・住所は課金されるので持っていない → 4_18 の module docstring）。
    """
    from google.cloud import bigquery

    sql = (SAMPLE_SQL
           .replace("__LINK__", pipeline.table(TABLE_NAME_PLACE_LINK))
           .replace("__RAW__", pipeline.table(TABLE_POST_RAW)))
    rows = [dict(r) for r in pipeline.execute(sql, [
        bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        bigquery.ScalarQueryParameter("strict_rule", "STRING", LINK_RULE_STRICT),
        bigquery.ScalarQueryParameter("row_limit", "INT64", int(size)),
    ])]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, delimiter="\t", quoting=csv.QUOTE_MINIMAL)
        writer.writerow(["post_id", "store_name", "area_pref", "area_city", "name_source",
                         "link_rule", "google_place_id", "maps_url", "canonical_url",
                         "discovery_route", "caption_head"])
        for r in rows:
            writer.writerow([
                r["post_id"], r["store_name"], r["area_pref"], r["area_city"],
                r["name_source"] or "", r["link_rule"] or "", r["google_place_id"],
                f"https://www.google.com/maps/place/?q=place_id:{r['google_place_id']}",
                r["canonical_url"] or "", r["discovery_route"] or "",
                (r["caption_head"] or "").replace("\t", " "),
            ])
    LOGGER.info("確認用サンプルを %d 件書き出しました: %s", len(rows), path)
    return len(rows)


# ---------------------------------------------------------------------------
# 実行
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="4_18 が確定させた店を投稿へ貼る（外部 API を 1 回も使わない）")
    p.add_argument("--run-id", default=None)
    p.add_argument("--catalog-run-id", default="restaurant-2026-08-23")
    p.add_argument("--execute", action="store_true",
                   help="指定したときだけ BigQuery へ書く（既定は数えるだけ）")
    p.add_argument("--dry-run", action="store_true",
                   help="数えるだけ（既定の挙動を明示するための flag）")
    p.add_argument("--limit", type=int, default=0,
                   help="貼る投稿数の上限（post_id 昇順・0 = 全件）。"
                        "貼った投稿は次の run の対象から外れるので、刻むと先へ進む")
    p.add_argument("--source-run-id", default=None, help="対象を 1 つの収集 run に絞るとき")
    p.add_argument("--only-rule", default=None, choices=[LINK_RULE_STRICT, LINK_RULE_BOX_ONE],
                   help="片方の規則で決まった投稿だけを貼る。新しい規則を先にサンプルで"
                        "見たいとき用（既定は両方）")
    p.add_argument("--skip-backfill", action="store_true",
                   help="台帳（sns_name_place_post_link）だけ書き、sns_post_raw は触らない。"
                        "サンプルを人が見てから貼りたいときに使う")
    p.add_argument("--sample-out", default=None, help="確認用サンプル TSV の出力先")
    p.add_argument("--sample-size", type=int, default=200)
    # BigQuery の資格情報が無い環境で判定だけ回すための入出力（本番では指定しない）
    p.add_argument("--posts-jsonl", default=None)
    p.add_argument("--city-index-json", default=None)
    p.add_argument("--lookup-jsonl", default=None)
    p.add_argument("--out-jsonl", default=None)
    return p.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    offline = bool(args.posts_jsonl and args.city_index_json and args.lookup_jsonl)
    pipeline = None if offline else BigQueryPipeline()

    # 対象集合も抽出も 4_18 のものをそのまま使う（`--limit` は貼る側で効かせるので 0 固定）
    loader = SimpleNamespace(posts_jsonl=args.posts_jsonl, city_index_json=args.city_index_json,
                             catalog_run_id=args.catalog_run_id, limit=0,
                             source_run_id=args.source_run_id)
    by_pair, uniq, geo = resolver.load_city_index(loader, pipeline)
    posts = resolver.load_posts(loader, pipeline)
    keys, reasons = resolver.build_name_keys(posts, by_pair, uniq, geo["pref_of_unique_city"])
    LOGGER.info("店が決まっていない投稿 %d 件（店名を採れた %d 件 / 異なりキー %d 件）",
                sum(reasons.values()), reasons["ok"], len(keys))

    lookup_rows = load_lookup_rows(pipeline, args.lookup_jsonl,
                                   catalog_run_id=args.catalog_run_id) \
        if pipeline or args.lookup_jsonl else []
    identity_posts = load_identity_route_posts(pipeline)
    if pipeline is None:
        LOGGER.warning("オフライン入力のため identity key の経路を引けません（除外は効きません）")
    LOGGER.info("辞書 %d 行 / 看板の identity key を持つ投稿 %d 件（対象外）",
                len(lookup_rows), len(identity_posts))

    rows, stats = build_link_rows(keys, lookup_rows, identity_route_posts=identity_posts,
                                  run_id=run_id, linked_at=utc_now().isoformat())
    LOGGER.info("strict で確定しているキー %d 件（使わない %d 行 / 1 キー 2 店 %d 件は不使用）",
                stats["matched_keys"], stats["non_strict"], stats["ambiguous_keys"])
    LOGGER.info("箱の中で catalog に 1 店だけだったキー %d 件"
                "（catalog に 0 件 %d / 2 件以上 %d は採らない）",
                stats["box_one_keys"], stats["box_zero_in_catalog"],
                stats["box_many_in_catalog"])
    LOGGER.info("2 店以上当たって捨てた投稿 %d 件 / identity key の経路で外した投稿 %d 件",
                stats["ambiguous_posts"], stats["identity_route_posts"])
    LOGGER.info("貼れる投稿 %d 件（うち箱の規則 %d 件）/ 異なり店 %d 件",
                len(rows), stats["linked_posts_box_one"],
                len({r["google_place_id"] for r in rows}))

    if args.only_rule:
        rows = [r for r in rows if r["link_rule"] == args.only_rule]
        LOGGER.info("--only-rule %s のため %d 件だけ貼ります", args.only_rule, len(rows))

    if args.limit and len(rows) > args.limit:
        LOGGER.info("--limit %d のため今回は先頭 %d 件だけ貼ります（残り %d 件は次の run）",
                    args.limit, args.limit, len(rows) - args.limit)
        rows = rows[: args.limit]

    if args.out_jsonl:
        import json
        with Path(args.out_jsonl).open("w", encoding="utf-8") as stream:
            for row in rows:
                stream.write(json.dumps(row, ensure_ascii=False) + "\n")
        LOGGER.info("%d 行を %s へ書きました", len(rows), args.out_jsonl)

    if args.dry_run or not args.execute:
        LOGGER.info("--execute が無いので BigQuery へは 1 行も書きません")
        return
    if pipeline is None:
        LOGGER.info("オフライン入力のため BigQuery へは書きません")
        return
    if not rows:
        LOGGER.info("貼る投稿がありません")
        return

    with pipeline.step(run_id, "4_21_link_name_place_to_posts",
                       repo_root=HERE.parents[1]) as result:
        pipeline.execute(CREATE_LINK_TABLE_SQL.replace(
            "__TABLE__", pipeline.table(TABLE_NAME_PLACE_LINK)))
        # 既に台帳がある dataset では CREATE は何もしないので、規則の列は ALTER で足す
        pipeline.execute(ALTER_LINK_TABLE_SQL.replace(
            "__TABLE__", pipeline.table(TABLE_NAME_PLACE_LINK)))
        pipeline.load_json_rows(TABLE_NAME_PLACE_LINK, rows)
        LOGGER.info("%s へ %d 行を書きました", TABLE_NAME_PLACE_LINK, len(rows))
        result["row_count"] = len(rows)

        if args.sample_out:
            write_sample(pipeline, run_id, Path(args.sample_out), args.sample_size)

        if args.skip_backfill:
            LOGGER.info("--skip-backfill のため sns_post_raw は触りません")
            return
        # sns_post_raw は収集ジョブが裏で append している。同時更新の 400 に耐える経路を通す
        pipeline.execute_dml_retrying(backfill_sql(pipeline), backfill_params(run_id))
        applied = count_applied(pipeline, run_id)
        LOGGER.info("seed が入った投稿: 合計 %d 件（4_18 の確定 %d 件 / 箱の規則 %d 件。"
                    "台帳 %d 件との差は «選んでから書くまでに別のジョブが埋めた» ぶん）",
                    sum(applied.values()), applied[SEED_SOURCE], applied[SEED_SOURCE_BOX_ONE],
                    len(rows))
        result["row_count"] = sum(applied.values())


if __name__ == "__main__":
    main()
