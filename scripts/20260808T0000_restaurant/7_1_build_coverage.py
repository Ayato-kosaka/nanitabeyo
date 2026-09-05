#!/usr/bin/env python3
"""#1273 フェーズA成果物: sns_post_resolved(matched) から sns_coverage を作る。

matched（＝resolve が既存店に一意確定した）投稿を、その店の住所（restaurant_catalog.address）から
都道府県×市区町村へ割り当て、異なり google_place_id 数を数える。source_route 内訳と 'all' ロールアップを持つ。
resolve が単一頭脳なので、ここは «集計だけ»。照合や分類はしない。
"""

from __future__ import annotations

import argparse
import logging
import re
from collections import defaultdict

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (LATEST_RESOLVED_QUALIFY, PREF_PATTERN, TABLE_POST_RAW,
                        TABLE_POST_RESOLVED, TABLE_COVERAGE,
                        post_store_cte_sql)

LOGGER = logging.getLogger(__name__)

_PREF = PREF_PATTERN  # 正本は common_sns（同じ列挙を 2 箇所に置かない）
_CITY_RE = re.compile("(" + _PREF + r")(.+?[市区町村])")
_PREF_RE = re.compile("(" + _PREF + ")")


def region_city(address: str | None):
    if not address:
        return None, None
    m = _CITY_RE.search(address)
    if m:
        return m.group(1), m.group(2)
    p = _PREF_RE.search(address)
    return (p.group(1) if p else None), None


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="sns_coverage を作る（カテゴリ×市区町村の異なり店）")
    p.add_argument("--run-id", default=None)
    p.add_argument("--resolved-run-id", default=None, help="読む sns_post_resolved の run_id（省略時は --run-id）")
    # #1273 収集は run_id ごと（fsq / catalog / 08-30 インフル / search / storecap …）に分かれており、
    # 全国カバレッジは «全 run の union» で数える。カンマ区切りで複数 run を渡すと union する。
    p.add_argument("--resolved-run-ids", default=None,
                   help="union する run_id をカンマ区切りで（--resolved-run-id より優先）")
    # KPI は «アプリの 134 カテゴリ限定» で見る（resolve の語彙は 1,577 QID あり、分母が違うと ≥5 セル数が
    # 全く別物になる。2026-09-03 実測: 全 QID 58 セル / 134 限定 32 セル）。
    #
    # ⚠️ #1815 【重要】この 134 を «日本語ラベルで QID を引く» 方法で作ってはいけない。
    # dish_category_catalog には label_ja が同名の別 QID が居る（餃子=Q107014807/Q640769、
    # 焼肉=Q2431975/Q844466、かき氷・タルト・ナポリタン・親子丼も同様）ため、134 ラベルを引くと
    # **140 QID** に膨らむ。膨らんだ 6 QID はアプリの JP ゲートに入っていない＝日本のユーザーが
    # そのカテゴリを検索できないので、数えても**アプリには出ない**（2026-09-04 実測: ≥1 セル
    # 12,411→11,941、≥5 セル 918→898 が «出ないのに数えていた» 分）。
    # 正はアプリと同じ «JP ゲート»（8_1 の target_categories と同じ条件）。
    p.add_argument("--kpi-gate-feature-key", default="region:country:JP",
                   help="KPI 対象カテゴリを決める dish_category_features_catalog の gate key。空文字で KPI 無効")
    p.add_argument("--catalog-run-id", default=None, help="住所を引く restaurant_catalog の run_id（省略時は最新）")
    return p.parse_args()


def _latest_catalog_run_id(pipeline: BigQueryPipeline) -> str:
    for row in pipeline.execute(
        f"SELECT run_id, COUNT(*) c FROM `{pipeline.table('restaurant_catalog')}` "
        f"GROUP BY run_id ORDER BY c DESC LIMIT 1"
    ):
        return row["run_id"]
    raise RuntimeError("restaurant_catalog に run_id がありません。")


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    resolved_run_id = args.resolved_run_id or run_id
    resolved_run_ids = [x.strip() for x in (args.resolved_run_ids or "").split(",") if x.strip()] or [resolved_run_id]
    pipeline = BigQueryPipeline()
    catalog_run_id = args.catalog_run_id or _latest_catalog_run_id(pipeline)
    now_iso = utc_now().isoformat()

    from google.cloud import bigquery
    # matched な投稿 × 収集ルート × 店住所。post 単位で route を持ち、店住所は catalog から引く。
    # ⚠️ 再解決(非破壊追記)で 1 post に複数 resolve_version 行が並ぶため、**post ごとの最新 version**
    # だけを見る（QUALIFY）。これで «改善後の最新結果» が集計に反映され、古い版は二重計上しない。
    # #1273 【設計】市区町村の確定は SQL 側で行う。
    # catalog の address は 39% が «都道府県で始まらない»（例「中央区北長狭通3-10-1」）ため、
    # 正規表現だけだと usable 店の約 4 割がどのセルにも数えられなかった（2026-09-03 実測:
    # 134 カテゴリ限定で ≥5 店セル 32 → 補完後 134）。都道府県が取れない店は lat/lng の最近傍
    # （1.5km 以内・都道府県付き住所を持つ catalog 店）の市区町村を採用する（検証 99.3% 一致）。
    sql = f"""
      WITH latest AS (
        SELECT provider, post_id, status, google_place_id, dish_category_id
        FROM `{pipeline.table(TABLE_POST_RESOLVED)}`
        WHERE run_id IN UNNEST(@resolved_rids)
        {LATEST_RESOLVED_QUALIFY}
      ),
      -- #1273【重要】既知店ルート（柱1/柱4）は «店» を discovery_seed_place_id で確定する。
      -- resolve は投稿URLからキャプションを取り直して店名照合するが、店の «自分の投稿» は
      -- 店名を書かないことが多く、店照合が外れて status!='matched' になる（実測: 柱1 19,396 投稿の
      -- カテゴリ解決済 9,933 のうち matched は 1,044 だけ＝8,889 を取りこぼしていた）。
      -- 収集時点で店は判明している（discovery_seed_place_id、全て in-catalog・46都道府県）ので、
      -- **店はそれを使い、resolve はカテゴリ専用**にする。これで既存データだけでセルが +37%。
      -- discovery_seed_place_id が無い投稿（柱2 インフル・柱3 検索）は従来どおり status='matched' のみ。
      --
      -- ⚠️ #1846: **店の決め方は `post_store` が唯一の正**（9_1 と同じもの）。ここに
      -- «seed があればそれ» を書き戻すと、チェーンのブランドサイト / ブランドアカウント由来の
      -- 投稿が複数店に計上され、KPI だけが増えて配信されない状態に戻る。
      {post_store_cte_sql(pipeline.table(TABLE_POST_RAW), latest_cte="latest",
                          runs_param="resolved_rids")},
      base AS (
        SELECT DISTINCT
          ps.google_place_id,
          v.dish_category_id, r.discovery_route AS source_route, v.post_id
        FROM latest v
        JOIN post_store ps ON ps.post_id = v.post_id
        JOIN `{pipeline.table(TABLE_POST_RAW)}` r
          ON r.run_id IN UNNEST(@resolved_rids) AND r.provider = v.provider AND r.post_id = v.post_id
        WHERE v.dish_category_id IS NOT NULL
      ),
      cat AS (
        SELECT google_place_id, address, location,
          REGEXP_EXTRACT(address, r'({_PREF})') AS region,
          REGEXP_EXTRACT(address, r'(?:{_PREF})(.+?[市区町村])') AS city
        FROM `{pipeline.table('restaurant_catalog')}`
        WHERE run_id = @crid
      ),
      places AS (SELECT DISTINCT google_place_id FROM base),
      need AS (
        SELECT p.google_place_id, c.location
        FROM places p JOIN cat c USING (google_place_id)
        WHERE c.city IS NULL AND c.location IS NOT NULL
      ),
      ref AS (SELECT location, region, city FROM cat WHERE city IS NOT NULL AND location IS NOT NULL),
      nn AS (
        SELECT n.google_place_id, r.region, r.city, ST_DISTANCE(n.location, r.location) AS d
        FROM need n JOIN ref r ON ST_DWITHIN(n.location, r.location, 1500)
        QUALIFY ROW_NUMBER() OVER (PARTITION BY n.google_place_id ORDER BY d) = 1
      )
      SELECT b.google_place_id, b.dish_category_id, b.source_route, c.address,
             COALESCE(c.region, nn.region) AS region, COALESCE(c.city, nn.city) AS city
      FROM base b
      LEFT JOIN cat c USING (google_place_id)
      LEFT JOIN nn USING (google_place_id)
    """
    params = [
        bigquery.ArrayQueryParameter("resolved_rids", "STRING", resolved_run_ids),
        bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id),
    ]
    kpi_qids: set[str] = set()
    if args.kpi_gate_feature_key:
        try:
            for row in pipeline.execute(
                f"SELECT DISTINCT item_qid FROM `{pipeline.config.dish_dataset_ref}.dish_category_features_catalog` "
                "WHERE feature_type = 'gate' AND feature_key = @key AND score > 0",
                [bigquery.ScalarQueryParameter("key", "STRING", args.kpi_gate_feature_key)],
            ):
                kpi_qids.add(row["item_qid"])
            LOGGER.info("KPI 対象カテゴリ（%s ゲート）: QID %d", args.kpi_gate_feature_key, len(kpi_qids))
        except Exception as e:  # noqa: BLE001 - KPI 表示は付加情報。集計本体は止めない
            LOGGER.warning("KPI ゲートの取得に失敗（%s）。134 限定 KPI は出しません", e)

    with pipeline.step(run_id, "7_1_build_coverage", parameters={
        "resolved_run_ids": resolved_run_ids, "catalog_run_id": catalog_run_id,
    }, repo_root=None) as result:
        # (category, region, city, route) -> [distinct place_id set, post_count]
        agg: dict = defaultdict(lambda: [set(), 0])
        for row in pipeline.execute(sql, params):
            region, city = row["region"], row["city"]
            if not city:
                region, city = region_city(row["address"])
            cat = row["dish_category_id"]
            place = row["google_place_id"]
            for route in (row["source_route"], "all"):
                k = (cat, region, city, route)
                agg[k][0].add(place)
                agg[k][1] += 1

        rows = [{
            "dish_category_id": cat, "region": region, "city": city, "source_route": route,
            "distinct_store_count": len(places), "post_count": posts,
            "computed_at": now_iso, "run_id": run_id,
        } for (cat, region, city, route), (places, posts) in agg.items()]

        pipeline.delete_run_rows(TABLE_COVERAGE, run_id)
        count = pipeline.load_json_rows(TABLE_COVERAGE, rows) if rows else 0
        result["row_count"] = count
        distinct_all = sum(1 for (_, _, _, route) in agg if route == "all")
        LOGGER.info("sns_coverage に %d セルを投入（category×区の 'all' 内訳=%d）", count, distinct_all)

        def _kpi(filter_qids: set[str] | None) -> tuple[int, int, int, int]:
            ge1 = ge3 = ge5 = 0
            stores: set[str] = set()
            for (cat, region, city, route), (places, _) in agg.items():
                if route != "all" or not city:
                    continue
                if filter_qids is not None and cat not in filter_qids:
                    continue
                n = len(places)
                ge1 += 1
                ge3 += n >= 3
                ge5 += n >= 5
                stores |= places
            return ge1, ge3, ge5, len(stores)

        a1, a3, a5, ast = _kpi(None)
        LOGGER.info("KPI(全QID) 市区町村×カテゴリ: ≥1店=%d ≥3店=%d ≥5店=%d usable店=%d", a1, a3, a5, ast)
        if kpi_qids:
            k1, k3, k5, kst = _kpi(kpi_qids)
            LOGGER.info("KPI(%d カテゴリ＝JPゲート限定) 市区町村×カテゴリ: ≥1店=%d ≥3店=%d ≥5店=%d usable店=%d",
                        len(kpi_qids), k1, k3, k5, kst)
            result["kpi134_ge5"] = k5
            # #1815 «ゲート外の同名ラベル QID»（餃子=Q640769 など）へ流れた分を、黙って落とさず数える。
            # ここが 0 でないなら、resolve 側の KPI 優先表（kpi_dish_categories.json の kpi_qids）が
            # アプリのカテゴリと食い違っている＝取ったのに出せないデータが積み上がっている。
            try:
                twin_qids = {
                    r["item_qid"]
                    for r in pipeline.execute(
                        f"SELECT DISTINCT c.item_qid FROM `{pipeline.config.dish_dataset_ref}.dish_category_catalog` c "
                        f"JOIN `{pipeline.config.dish_dataset_ref}.dish_category_catalog` g "
                        "  ON g.label_ja = c.label_ja AND g.item_qid IN UNNEST(@gate) "
                        "WHERE c.item_qid NOT IN UNNEST(@gate)",
                        [bigquery.ArrayQueryParameter("gate", "STRING", sorted(kpi_qids))],
                    )
                }
                if twin_qids:
                    t1, _, t5, tst = _kpi(twin_qids)
                    LOGGER.info("ゲート外の同名ラベル QID(%d 個)に流れたぶん（KPI には数えない）: "
                                "≥1店セル=%d ≥5店セル=%d 店=%d", len(twin_qids), t1, t5, tst)
            except Exception as e:  # noqa: BLE001 - 診断。集計本体は止めない
                LOGGER.warning("同名ラベル QID の診断に失敗（%s）", e)


if __name__ == "__main__":
    main()
