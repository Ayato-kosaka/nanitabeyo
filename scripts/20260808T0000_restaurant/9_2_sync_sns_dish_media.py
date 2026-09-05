#!/usr/bin/env python3
"""#1273 フェーズB 最終区間: sns_dish_media_catalog(BigQuery) → PostgreSQL(dev) へ同期する。

9_1_build_sns_dish_media_catalog.py が組んだ «配信可 ready» 行を、アプリが実際に読む
3 つの表へ落とす。ここが繋がるまで、KPI が数えているセルに対してアプリへ届いた行は 0 件である。

    sns_dish_media_catalog          （BigQuery / google_place_id + Wikidata QID で店と料理を指す）
      → dishes                      （restaurant_id × category_id。無ければ作る）
      → dish_media                  （render_type='external_embed' の «器»）
      → dish_media_external_embeddings（provider / 投稿 ID / canonical_url の実体）

【この経路が書く値の正本は API の取り込み実装である】
  api/src/v1/dish-media-imports/dish-media-imports.service.ts が「ユーザーが SNS の URL を
  貼って取り込む」ときに書く値と、**1 列も違えてはいけない**。同じ形の行を 2 つの経路が
  別の値で作ると、アプリ側の分岐がどちらかで必ず壊れる。値の根拠は下の SQL 定数の
  コメントに、参照元のファイルと併せて書いてある。

【dev 専用】
  --schema は dev しか受け付けない（argparse の choices と実行時 assert の二重）。
  public（本番）への適用はリリース手順の一部であり、このスクリプトの守備範囲ではない。

【既定は dry-run】
  --execute を明示しない限り書き込まない。dry-run も本番と同じ DML を同じ transaction で
  流し、FK / UNIQUE / CHECK を全て通してから rollback する（9_1_sync_restaurants.py と同じ作法）。
"""

from __future__ import annotations

import argparse
import csv
import logging
import tempfile
from pathlib import Path
from typing import Any

from google.cloud import bigquery

from common_sns import TABLE_DISH_MEDIA_CATALOG
from normalization import build_dish_media_id
from pg_sync_common import (
    SyncStats,
    backup_table_to_gcs,
    connect_postgres,
    new_sync_id,
    write_sync_log,
)
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now

LOGGER = logging.getLogger(__name__)

# 同期先はこの 3 表だけ。sync log の target_table にもそのまま使う。
TARGET_TABLES = ("dishes", "dish_media", "dish_media_external_embeddings")

# dish_media_external_embeddings.provider の CHECK（dmee_provider_check）と同じ値域。
# infra/supabase/migrations/20260824T0200_create_dish_media_external_embeddings.sql
# ⚠️ DB は 4 種を許すが、アプリが取り込むのは 3 種（X は対象外）。ここは «PG が受け取れるか»
#    を見る側なので DB の CHECK に合わせる。狭めると «PG が受け取れる行を手前で捨てる»。
ALLOWED_PROVIDERS = ("instagram", "tiktok", "youtube", "x")


# =============================================================================
# SQL
#
# テストが ast でこの定数を読み、**本物の SQL のまま**実 PostgreSQL に流す
# （tests/extract_9_2_sql.py）。テストへ写経しないこと。写経した複製は、本番だけが
# 直ったときに緑のまま古い挙動を守り続ける（CLAUDE.md「列を足したら〜」の事故）。
# =============================================================================

SQL_CREATE_STAGING = """
CREATE TEMP TABLE sns_dish_media_staging (
  dish_media_id       UUID NOT NULL,
  provider            TEXT NOT NULL,
  external_content_id TEXT NOT NULL,
  canonical_url       TEXT NOT NULL,
  google_place_id     TEXT NOT NULL,
  dish_category_id    TEXT NOT NULL,
  thumbnail_url       TEXT,
  row_hash            TEXT NOT NULL
) ON COMMIT DROP
"""

# 何行が «入らないか» を、理由ごとに 1 クエリで数える。
# ⚠️ 落ちた行があっても同期は止めない（#1273: catalog に居ない店が実測で出る）。
#    止めると 1 件の取りこぼしで全件が届かなくなる。数えてログに出し、続行する。
SQL_COUNT_PLAN = """
SELECT
  COUNT(*)                                             AS staged_rows,
  COUNT(*) FILTER (WHERE r.id IS NULL)                 AS dropped_no_restaurant,
  COUNT(DISTINCT s.google_place_id) FILTER (WHERE r.id IS NULL)
                                                       AS dropped_store_count,
  COUNT(*) FILTER (WHERE r.id IS NOT NULL AND c.id IS NULL)
                                                       AS dropped_no_dish_category,
  COUNT(DISTINCT s.dish_category_id) FILTER (WHERE r.id IS NOT NULL AND c.id IS NULL)
                                                       AS dropped_category_count,
  COUNT(*) FILTER (WHERE r.id IS NOT NULL AND c.id IS NOT NULL)
                                                       AS eligible_rows
FROM sns_dish_media_staging s
LEFT JOIN restaurants r ON r.google_place_id = s.google_place_id
LEFT JOIN dish_categories c ON c.id = s.dish_category_id
"""

# UUID v5 が既存の «ユーザー投稿» に当たっていないか。
# build_dish_media_id は (provider, 投稿ID) だけから作るので衝突確率は極小だが、
# 当たった場合に起きるのは «ユーザーの投稿へ外部埋め込みを生やす» という取り返しの
# つかない事故なので、確率ではなく構造で止める（旧 POC 版から引き継ぐ唯一の検査）。
SQL_COUNT_UUID_COLLISION = """
SELECT COUNT(*)
FROM sns_dish_media_staging s
JOIN dish_media m ON m.id = s.dish_media_id
LEFT JOIN dish_media_external_embeddings e ON e.dish_media_id = m.id
WHERE e.dish_media_id IS NULL
"""

# 店 × 料理カテゴリの器。**name は入れない**（NULL のまま）。
#   api/src/v1/dish-media-imports/dish-media-imports.service.ts の tx.dishes.upsert が
#   create に restaurant_id / category_id しか渡していない = 取り込み経路の dish に名前は無い。
#   dishes.name は infra/supabase/migrations/20250802T0301_create_dishes.sql:5 で NULL 可
#   （NOT NULL ではない。prisma でも `name String?`）。
# 既存行（ユーザー / Google 由来）は DO NOTHING で一切触らない。
SQL_INSERT_DISHES = """
INSERT INTO dishes (restaurant_id, category_id, data_origin, synced_at)
SELECT DISTINCT r.id, s.dish_category_id, 'restaurant_recommendation', CURRENT_TIMESTAMP
FROM sns_dish_media_staging s
JOIN restaurants r ON r.google_place_id = s.google_place_id
JOIN dish_categories c ON c.id = s.dish_category_id
ON CONFLICT (restaurant_id, category_id) DO NOTHING
"""

# staging を «PG の dish_id» まで解決した実行計画。ここから先は google_place_id を使わない。
SQL_CREATE_PLAN = """
CREATE TEMP TABLE sns_dish_media_plan ON COMMIT DROP AS
SELECT
  s.dish_media_id, d.id AS dish_id, s.provider, s.external_content_id,
  s.canonical_url, s.thumbnail_url, s.row_hash
FROM sns_dish_media_staging s
JOIN restaurants r ON r.google_place_id = s.google_place_id
JOIN dishes d ON d.restaurant_id = r.id AND d.category_id = s.dish_category_id
"""

# insert / skip の内訳。
#   already_present … 同じ投稿が同じ料理へ既に居る（再実行 or アプリからの取り込み）
#   rebound_kept    … 同じ投稿が **別の料理** へ既に紐づいている。動かさない（下記）
SQL_COUNT_APPLY = """
SELECT
  COUNT(*) FILTER (WHERE e.dish_media_id IS NULL AND m.id IS NULL)        AS to_insert,
  COUNT(*) FILTER (WHERE e.dish_media_id IS NOT NULL)                     AS already_present,
  COUNT(*) FILTER (WHERE e.dish_media_id IS NULL AND m.id IS NOT NULL)    AS rebound_kept
FROM sns_dish_media_plan p
LEFT JOIN dish_media_external_embeddings e
  ON e.provider = p.provider
 AND e.external_content_id = p.external_content_id
 AND e.dish_id = p.dish_id
LEFT JOIN dish_media m ON m.id = p.dish_media_id
"""

# dish_media 本体。値はすべて取り込み API と同じ（dish-media-imports.service.ts の
# tx.dish_media.create）。
#   media_path                  = NULL   … 実体は自ストレージに無い。CHECK
#                                          dish_media_media_path_required_for_stored が
#                                          external_embed のときだけ NULL を許す
#   media_type                  = 'image'… CHECK は image/video のみ。API と同じ 'image'
#   thumbnail_path              = ''     … NOT NULL なので空文字。**canonical_url を入れない**
#                                          （assembler の buildCdnUrlFromPath が
#                                           https://cdn/https://... を組む。dish-media.assembler.ts
#                                           が空文字を guard して料理カテゴリ画像へ落とす）
#   media_processing_status     = 'completed'
#                                        … usable-dish-media-filter.ts が
#                                          `= 'completed'` を要求する。ここを 'idle' にすると
#                                          **同期した行がアプリから 1 件残らず消える**
#                                          （migration 20260824T0100 の列コメントは 'idle' と
#                                            書いているが、取り込み API の実装が 'completed' で
#                                            そちらが動いている値である）
#   thumbnail_processing_status = 'completed' … 同上（API と同値）
#   render_type                 = 'external_embed'
#                                        … 列の既定は 'stored'。明示しないと API が子テーブルから
#                                          導出する renderType と列が食い違う
#   user_id                     = NULL   … 投稿者はアプリのユーザーではない
#
# WHERE NOT EXISTS で «既にこの投稿がこの料理へ居る» 行を弾く。これで再実行しても増えない。
# ⚠️ 復活させないこと。dish_media.deleted_at が立っている行（通報対応などで消したもの）は
#    dmee 行が残っているのでここで弾かれる。バッチが moderation を巻き戻してはいけない。
SQL_INSERT_DISH_MEDIA = """
INSERT INTO dish_media (
  id, dish_id, user_id, media_path, media_type, thumbnail_path,
  created_at, updated_at, lock_no, video_duration_ms,
  media_processing_status, thumbnail_processing_status, render_type
)
SELECT
  p.dish_media_id, p.dish_id, NULL, NULL, 'image', '',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, NULL,
  'completed', 'completed', 'external_embed'
FROM sns_dish_media_plan p
WHERE NOT EXISTS (
  SELECT 1 FROM dish_media_external_embeddings e
  WHERE e.provider = p.provider
    AND e.external_content_id = p.external_content_id
    AND e.dish_id = p.dish_id
)
ON CONFLICT (id) DO NOTHING
"""

# 埋め込みの実体。現行 DDL に **embed_html / availability_status / rights_basis は無い**
# （20260824T0200 の設計判断: oEmbed の HTML は SoT にしない）。列は現行スキーマちょうど。
#   embed_status     = 'unknown' … 取り込んだ直後は «生きている» と確認できた状態にない。
#                                  死活監視（#1273 §39）が後から available/unavailable を書く
#   last_verified_at = NULL      … 同上（未検証）
#   playback_*                   … 列 DEFAULT（'unknown' / NULL）のまま。
#                                  usable フィルタは 'not_playable' だけを弾き unknown は通す
#   thumbnail_url                … 参照 URL のみ（複製しない）。9_1 は今のところ常に NULL
# dish_media への JOIN は、複合 FK (dish_media_id, dish_id) → dish_media (id, dish_id) を
# 構造的に満たすため。上の INSERT で作れなかった行（= 同じ投稿が別の料理へ既に居る）は
# ここで自然に落ち、既存の紐づけを動かさない。
SQL_INSERT_EMBEDDINGS = """
INSERT INTO dish_media_external_embeddings (
  dish_media_id, dish_id, provider, external_content_id, canonical_url,
  embed_status, last_verified_at, thumbnail_url, created_at, updated_at
)
SELECT
  p.dish_media_id, p.dish_id, p.provider, p.external_content_id, p.canonical_url,
  'unknown', NULL, p.thumbnail_url, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM sns_dish_media_plan p
JOIN dish_media m ON m.id = p.dish_media_id AND m.dish_id = p.dish_id
ON CONFLICT (provider, external_content_id, dish_id) DO NOTHING
"""

# 同期した行が «アプリから見えるか» を、同じ transaction の中で数え直す。
# 判定は api/src/v1/dish-media/usable-dish-media-filter.ts の 4 条件と同じ形にする。
# 「入れた」ではなく「入れたものが使える」を納品条件にするための検算である。
SQL_COUNT_USABLE = """
SELECT COUNT(*)
FROM sns_dish_media_plan p
JOIN dish_media dm ON dm.id = p.dish_media_id
JOIN dish_media_external_embeddings e ON e.dish_media_id = dm.id
WHERE dm.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = dm.user_id AND u.deleted_at IS NOT NULL)
  AND dm.media_processing_status = 'completed'
  AND dm.render_type = 'external_embed'
  AND NOT EXISTS (
    SELECT 1 FROM dish_media_external_embeddings x
    WHERE x.dish_media_id = dm.id AND x.playback_status = 'not_playable'
  )
"""


# =============================================================================
# 引数
# =============================================================================


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="sns_dish_media_catalog を PostgreSQL(dev) へ同期します"
    )
    parser.add_argument("--run-id", default=None, help="この同期実行の run_id（ログ用）")
    parser.add_argument(
        "--catalog-run-id",
        default=None,
        help="読む sns_dish_media_catalog の run_id。カンマ区切りで複数可。省略時は --run-id",
    )
    parser.add_argument(
        "--all-catalog-runs",
        action="store_true",
        help="sns_dish_media_catalog に載っている全 run_id を読む",
    )
    # dev 固定。choices を 1 個にして argparse の段階で public を弾く（CLAUDE.md「DB を変更するときの規則」）
    parser.add_argument("--schema", choices=["dev"], default="dev")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="実際に書き込む。指定しなければ dry-run（既定）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="既定なので通常は指定不要。--execute と同時指定はエラー",
    )
    parser.add_argument(
        "--skip-backup",
        action="store_true",
        help="復元手段を別に確保した緊急時だけ。通常は使わない",
    )
    return parser.parse_args(argv)


def assert_dev_schema(schema: str) -> None:
    """dev 以外は即エラーで落とす。

    argparse の choices と二重になっているのは意図的である。choices はコードを 1 行
    書き換えるだけで外れるが、この関数は «public へ書く» という結果そのものを止める。
    """
    if schema != "dev":
        raise ValueError(
            f"9_2 は dev 専用です（指定: {schema!r}）。public はリリース手順で別途扱います"
        )


def resolve_dry_run(args: argparse.Namespace) -> bool:
    """既定 dry-run。--execute を明示したときだけ書き込む。"""
    if args.execute and args.dry_run:
        raise ValueError("--execute と --dry-run は同時に指定できません")
    return not args.execute


def parse_catalog_run_ids(args: argparse.Namespace, run_id: str) -> list[str] | None:
    """読む catalog の run_id 集合。None は «全 run»（--all-catalog-runs）。"""
    if args.all_catalog_runs:
        if args.catalog_run_id:
            raise ValueError("--all-catalog-runs と --catalog-run-id は併用できません")
        return None
    raw = args.catalog_run_id or run_id
    ids = [part.strip() for part in raw.split(",") if part.strip()]
    if not ids:
        raise ValueError("--catalog-run-id が空です")
    return ids


# =============================================================================
# BigQuery 側
# =============================================================================


def csv_value(value: Any) -> Any:
    return r"\N" if value is None else value


def catalog_query(pipeline: BigQueryPipeline, run_ids: list[str] | None) -> str:
    """catalog を «1 投稿 1 行» に畳んで読む SQL。

    ⚠️ **1 つの投稿は 1 つの dish_media にしかならない。**
    dish_media の ID は normalization.build_dish_media_id(provider, 投稿ID) で決まり、
    料理カテゴリを含めない（分類が変わっても like / impression の ID を維持するため）。
    したがって «同じ投稿 × 複数の (店, カテゴリ)» を両方入れることは構造的にできない。

    catalog には実際にそれが出る（resolve は run ごとに走るので、同じ投稿が run をまたいで
    別のカテゴリ・別の店に付く）。ここで **built_at が新しいものを勝ちにして畳む**。
    畳んだ件数は呼び出し側がログへ出す。捨てた側は «別の候補があった» という事実なので、
    黙って消えないようにする。
    """
    where = "WHERE run_id IN UNNEST(@run_ids)" if run_ids is not None else ""
    return f"""
      WITH src AS (
        SELECT provider, external_content_id, canonical_url, google_place_id,
               dish_category_id, thumbnail_url, row_hash, built_at
        FROM `{pipeline.table(TABLE_DISH_MEDIA_CATALOG)}`
        {where}
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY provider, external_content_id
          -- built_at 以外も並べるのは、同着で結果が揺れないようにするため（冪等）
          ORDER BY built_at DESC, google_place_id ASC, dish_category_id ASC, row_hash ASC
        ) AS rn
        FROM src
        WHERE canonical_url IS NOT NULL AND canonical_url != ''
          AND google_place_id IS NOT NULL AND google_place_id != ''
          AND dish_category_id IS NOT NULL AND dish_category_id != ''
          AND provider IN UNNEST(@providers)
      )
      SELECT provider, external_content_id, canonical_url, google_place_id,
             dish_category_id, thumbnail_url, row_hash
      FROM ranked
      WHERE rn = 1
      ORDER BY provider, external_content_id
    """


def catalog_stats_query(pipeline: BigQueryPipeline, run_ids: list[str] | None) -> str:
    """catalog の «読む前» の内訳。何を落としたかを理由ごとに数える。"""
    where = "WHERE run_id IN UNNEST(@run_ids)" if run_ids is not None else ""
    return f"""
      WITH src AS (
        SELECT provider, external_content_id, canonical_url, google_place_id,
               dish_category_id
        FROM `{pipeline.table(TABLE_DISH_MEDIA_CATALOG)}`
        {where}
      )
      SELECT
        COUNT(*) AS catalog_rows,
        COUNT(DISTINCT CONCAT(provider, '|', external_content_id)) AS distinct_posts,
        COUNTIF(canonical_url IS NULL OR canonical_url = '') AS missing_canonical_url,
        COUNTIF(google_place_id IS NULL OR google_place_id = '') AS missing_place_id,
        COUNTIF(dish_category_id IS NULL OR dish_category_id = '') AS missing_category,
        COUNTIF(provider NOT IN UNNEST(@providers)) AS unsupported_provider
      FROM src
    """


def query_parameters(run_ids: list[str] | None) -> list[Any]:
    params: list[Any] = [
        bigquery.ArrayQueryParameter("providers", "STRING", list(ALLOWED_PROVIDERS))
    ]
    if run_ids is not None:
        params.append(bigquery.ArrayQueryParameter("run_ids", "STRING", run_ids))
    return params


def export_catalog(
    pipeline: BigQueryPipeline, run_ids: list[str] | None, path: Path
) -> tuple[int, int]:
    """catalog を CSV へ stream する。戻り値は (書いた行数, KPI 134 カテゴリ外の行数)。

    fetchall しない。全国分を一度にメモリへ載せないための作法（9_1_sync_restaurants と同じ）。
    """
    # KPI（アプリの 134 カテゴリ）の判定は common_sns が唯一の正。ここへ写経しない。
    from common_sns import _kpi_tables

    kpi_qids, _ = _kpi_tables()

    job_config = bigquery.QueryJobConfig(query_parameters=query_parameters(run_ids))
    rows = pipeline.client.query(
        catalog_query(pipeline, run_ids),
        job_config=job_config,
        location=pipeline.config.region,
    ).result(page_size=10_000)

    count = 0
    outside_kpi = 0
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        for row in rows:
            if kpi_qids and row["dish_category_id"] not in kpi_qids:
                outside_kpi += 1
            writer.writerow(
                csv_value(value)
                for value in (
                    build_dish_media_id(row["provider"], row["external_content_id"]),
                    row["provider"],
                    row["external_content_id"],
                    row["canonical_url"],
                    row["google_place_id"],
                    row["dish_category_id"],
                    row["thumbnail_url"],
                    row["row_hash"],
                )
            )
            count += 1
    return count, outside_kpi


# =============================================================================
# PostgreSQL 側
# =============================================================================


def load_staging(connection: Any, path: Path) -> None:
    with connection.cursor() as cursor:
        cursor.execute(SQL_CREATE_STAGING)
        with path.open("r", encoding="utf-8", newline="") as stream:
            cursor.copy_expert(
                "COPY sns_dish_media_staging FROM STDIN WITH (FORMAT CSV, NULL '\\N')",
                stream,
            )


def count_plan(connection: Any) -> dict[str, int]:
    with connection.cursor() as cursor:
        cursor.execute(SQL_COUNT_PLAN)
        keys = [column.name for column in cursor.description]
        return dict(zip(keys, cursor.fetchone()))


def assert_no_uuid_collision(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(SQL_COUNT_UUID_COLLISION)
        collisions = cursor.fetchone()[0]
    if collisions:
        raise RuntimeError(
            f"生成した dish_media ID が既存のユーザー投稿と{collisions}件衝突しています。"
            "外部埋め込みをユーザー投稿へ接続する事故になるため同期を中止します"
        )


def apply_sync(connection: Any) -> tuple[SyncStats, dict[str, int]]:
    """dishes → dish_media → dish_media_external_embeddings の順に非破壊で足す。

    既存行は 1 行も UPDATE しない。dish_media_external_embeddings には row_hash を
    置く列が無いので «変わったかどうか» を判定できず、判定できないものを上書きすると
    アプリ側（取り込み API・死活監視・#1641 の playback 判定）が書いた値を静かに壊す。
    """
    counters: dict[str, int] = {}
    with connection.cursor() as cursor:
        cursor.execute(SQL_INSERT_DISHES)
        counters["dishes_inserted"] = cursor.rowcount

        cursor.execute(SQL_CREATE_PLAN)

        cursor.execute(SQL_COUNT_APPLY)
        to_insert, already_present, rebound_kept = cursor.fetchone()

        cursor.execute(SQL_INSERT_DISH_MEDIA)
        counters["dish_media_inserted"] = cursor.rowcount

        cursor.execute(SQL_INSERT_EMBEDDINGS)
        counters["embeddings_inserted"] = cursor.rowcount

        cursor.execute(SQL_COUNT_USABLE)
        counters["usable_after_sync"] = cursor.fetchone()[0]

    counters["planned_insert"] = to_insert or 0
    counters["already_present"] = already_present or 0
    counters["rebound_kept"] = rebound_kept or 0
    stats = SyncStats(
        inserted=counters["embeddings_inserted"],
        updated=0,
        skipped=counters["already_present"] + counters["rebound_kept"],
    )
    return stats, counters


# =============================================================================
# main
# =============================================================================


def main() -> None:
    configure_logging()
    args = parse_args()
    assert_dev_schema(args.schema)
    dry_run = resolve_dry_run(args)
    run_id = require_run_id(args.run_id)
    catalog_run_ids = parse_catalog_run_ids(args, run_id)

    pipeline = BigQueryPipeline()
    sync_id = new_sync_id()
    started_at = utc_now()
    stats = SyncStats()
    connection = None

    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as stream:
        catalog_path = Path(stream.name)

    try:
        # --- BigQuery 側の内訳 ---------------------------------------------
        bq_stats = next(
            iter(
                pipeline.execute(
                    catalog_stats_query(pipeline, catalog_run_ids),
                    query_parameters(catalog_run_ids),
                )
            )
        )
        LOGGER.info(
            "catalog: %d 行 / %d 投稿（run: %s）",
            bq_stats.catalog_rows,
            bq_stats.distinct_posts,
            "全て" if catalog_run_ids is None else ",".join(catalog_run_ids),
        )
        for label, value in (
            ("canonical_url 欠落", bq_stats.missing_canonical_url),
            ("google_place_id 欠落", bq_stats.missing_place_id),
            ("dish_category_id 欠落", bq_stats.missing_category),
            ("provider が DB の値域外", bq_stats.unsupported_provider),
        ):
            if value:
                LOGGER.warning("BigQuery 側で落とす: %s = %d 行", label, value)

        staged, outside_kpi = export_catalog(pipeline, catalog_run_ids, catalog_path)
        collapsed = bq_stats.catalog_rows - staged
        LOGGER.info("PG へ渡す候補: %d 行（1 投稿 1 行に畳んだ結果）", staged)
        if collapsed > 0:
            LOGGER.warning(
                "同じ投稿の別候補 %d 行を畳みました（built_at が新しい方を採用）。"
                "1 投稿 1 dish_media は build_dish_media_id の設計上の制約です",
                collapsed,
            )
        if outside_kpi:
            LOGGER.warning(
                "アプリの 134 カテゴリ外の QID が %d 行あります（%.1f%%）。"
                "PG には入りますが日本のユーザーの検索には出ません（捨てません）",
                outside_kpi,
                100.0 * outside_kpi / staged if staged else 0.0,
            )
        if staged == 0:
            raise RuntimeError(
                f"{TABLE_DISH_MEDIA_CATALOG} に同期できる行がありません。"
                "9_1_build_sns_dish_media_catalog.py を先に実行してください"
            )

        # --- PostgreSQL 側 -------------------------------------------------
        connection = connect_postgres(args.schema, allow_public=False)
        if not dry_run and not args.skip_backup:
            for table in TARGET_TABLES:
                backup_table_to_gcs(connection, args.schema, table, run_id=run_id)

        load_staging(connection, catalog_path)
        plan = count_plan(connection)
        LOGGER.info(
            "同期計画: 候補 %d 行 → 入る %d 行 / 落ちる %d 行",
            plan["staged_rows"],
            plan["eligible_rows"],
            plan["staged_rows"] - plan["eligible_rows"],
        )
        if plan["dropped_no_restaurant"]:
            LOGGER.warning(
                "落ちる: PG に居ない店 = %d 行 / %d 店（中止しません。9_1_sync_restaurants の対象外）",
                plan["dropped_no_restaurant"],
                plan["dropped_store_count"],
            )
        if plan["dropped_no_dish_category"]:
            LOGGER.warning(
                "落ちる: PG に居ない料理カテゴリ = %d 行 / %d カテゴリ（中止しません）",
                plan["dropped_no_dish_category"],
                plan["dropped_category_count"],
            )

        assert_no_uuid_collision(connection)
        stats, counters = apply_sync(connection)
        LOGGER.info(
            "適用: dishes +%d / dish_media +%d / embeddings +%d "
            "（同じ料理に既に居て据え置き %d / 別の料理へ紐づき済みで据え置き %d）",
            counters["dishes_inserted"],
            counters["dish_media_inserted"],
            counters["embeddings_inserted"],
            counters["already_present"],
            counters["rebound_kept"],
        )
        LOGGER.info(
            "検算: 同期後にアプリから使える行 = %d（usable-dish-media-filter.ts と同条件）",
            counters["usable_after_sync"],
        )
        if counters["embeddings_inserted"] != counters["planned_insert"]:
            LOGGER.warning(
                "計画 %d 行に対し実際の INSERT は %d 行でした（差分は既存行との競合）",
                counters["planned_insert"],
                counters["embeddings_inserted"],
            )

        if dry_run:
            connection.rollback()
            LOGGER.info("dry-run のため rollback しました。PostgreSQL は変更していません")
        else:
            connection.commit()

        write_sync_log(
            pipeline,
            run_id=run_id,
            sync_id=sync_id,
            schema=args.schema,
            target_table=",".join(TARGET_TABLES),
            dry_run=dry_run,
            stats=stats,
            status="succeeded",
            started_at=started_at,
        )
    except Exception as error:
        if connection:
            connection.rollback()
        write_sync_log(
            pipeline,
            run_id=run_id,
            sync_id=sync_id,
            schema=args.schema,
            target_table=",".join(TARGET_TABLES),
            dry_run=dry_run,
            stats=stats,
            status="failed",
            started_at=started_at,
            error_message=str(error),
        )
        raise
    finally:
        catalog_path.unlink(missing_ok=True)
        if connection:
            connection.close()


if __name__ == "__main__":
    main()
