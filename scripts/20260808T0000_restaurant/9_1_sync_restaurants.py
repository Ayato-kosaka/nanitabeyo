#!/usr/bin/env python3
"""BigQuery restaurant_catalogをPostgreSQL restaurantsへ安全に同期する。"""

from __future__ import annotations

import argparse
import csv
import logging
import tempfile
import time
from pathlib import Path
from typing import Any

from google.cloud import bigquery

from pg_sync_common import (
    RESTAURANT_ERROR_CHECKS,
    SyncStats,
    assert_quality_gate_passed,
    backup_table_to_gcs,
    log_db_load,
    connect_postgres,
    fetch_sync_windows,
    new_sync_id,
    write_sync_log,
)
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now

LOGGER = logging.getLogger(__name__)

# これを超えた文は plan をログへ出す（#1706）
SLOW_STATEMENT_SECONDS = 60.0

# #1706 **共有 DB を掴んでよい上限。** 超えたら自分から降りる。
#
# この DB は本番と共有している。2026-08-31 に、このバッチが 1 時間級の
# 全表走査を日中に 5 回繰り返して本番障害を起こした。**遅いまま粘るのは
# 自分の都合であって、他のサービスには関係がない。**
#
# ここを超えるなら、伸ばすのではなく «62 万行を 1 トランザクションで処理する»
# 設計の方を見直すこと（#1706 の残作業）。
SYNC_TIME_BUDGET_SECONDS = 20 * 60


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="restaurant catalogをPostgreSQLへ同期します"
    )
    parser.add_argument("--run-id")
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-public", action="store_true")
    parser.add_argument(
        "--skip-backup",
        action="store_true",
        help="復元可能性を理解した緊急時だけ指定。通常は使用しない",
    )
    return parser.parse_args()


def csv_value(value: Any) -> Any:
    if value is None:
        return r"\N"
    return value


def export_catalog(pipeline: BigQueryPipeline, run_id: str, path: Path) -> int:
    query = f"""
      SELECT
        seed_id, google_place_id, match_method,
        name, name_language_code,
        latitude, longitude, image_url, image_path, address_components_json,
        plus_code_json, address, country_code,
        phone, website, TO_JSON_STRING(social_urls) AS social_urls_json,
        TO_JSON_STRING(source_names) AS source_names_json, row_hash
      FROM `{pipeline.dataset_ref}.restaurant_catalog`
      WHERE run_id = @run_id
      ORDER BY google_place_id
    """
    config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("run_id", "STRING", run_id)]
    )
    rows = pipeline.client.query(
        query, job_config=config, location=pipeline.config.region
    ).result(page_size=10_000)
    count = 0
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        for row in rows:
            writer.writerow(csv_value(value) for value in row.values())
            count += 1
    return count


def load_staging(connection: Any, path: Path) -> None:
    create_sql = """
      CREATE TEMP TABLE restaurant_sync_staging (
        seed_id UUID NOT NULL,
        google_place_id TEXT NOT NULL,
        match_method TEXT NOT NULL,
        name TEXT NOT NULL,
        name_language_code TEXT NOT NULL,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        image_url TEXT NOT NULL,
        image_path TEXT,
        address_components_json TEXT NOT NULL,
        plus_code_json TEXT,
        address TEXT,
        country_code TEXT,
        phone TEXT,
        website TEXT,
        social_urls_json TEXT NOT NULL,
        source_names_json TEXT NOT NULL,
        row_hash TEXT NOT NULL
      ) ON COMMIT DROP
    """
    with connection.cursor() as cursor:
        cursor.execute(create_sql)
        with path.open("r", encoding="utf-8", newline="") as stream:
            cursor.copy_expert(
                "COPY restaurant_sync_staging FROM STDIN WITH (FORMAT CSV, NULL '\\N')",
                stream,
            )
        # #1706 **索引と統計を作ってから DML へ入る。**
        #
        # staging は TEMP テーブルで、これまで索引も ANALYZE も無かった。
        # そのため後続の全ての文が 62 万行の seq scan になり、
        # **0 行しか更新しない文まで 600 秒**かかっていた（2026-08-30 実測）。
        #
        #   seed 付替の provenance 解除  566秒 /     0行
        #   表示値 UPDATE               671秒 /   168行
        #   古い open_data リンク削除     646秒 / 1,654行
        #   リンク投入                   680秒 /     2行
        #
        # ここで索引を作る数十秒で、その後の数千秒が消える。
        # ANALYZE も要る。統計が無いと plan が nested loop / hash join を誤る。
        cursor.execute(
            "CREATE INDEX ON restaurant_sync_staging (google_place_id)"
        )
        cursor.execute("CREATE INDEX ON restaurant_sync_staging (seed_id)")
        cursor.execute("ANALYZE restaurant_sync_staging")


def calculate_stats(connection: Any) -> SyncStats:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
              COUNT(*) FILTER (WHERE r.id IS NULL) AS inserted,
              COUNT(*) FILTER (
                WHERE r.id IS NOT NULL
                  AND r.source_row_hash IS DISTINCT FROM s.row_hash
              ) AS updated,
              COUNT(*) FILTER (
                WHERE r.id IS NOT NULL
                  AND r.source_row_hash IS NOT DISTINCT FROM s.row_hash
              ) AS skipped
            FROM restaurant_sync_staging s
            -- #843 かつては `OR r.id = s.existing_restaurant_id` を付けていたが、
            -- 両方成立する行を二重に数えるうえ、PG の UUID に依存していた。
            -- google_place_id は UNIQUE なので、これだけで 1 行に定まる。
            LEFT JOIN restaurants r
              ON r.google_place_id = s.google_place_id
            """
        )
        inserted, updated, skipped = cursor.fetchone()
    return SyncStats(inserted or 0, updated or 0, skipped or 0)


def detect_backfill_missing(
    has_pipeline_rows: bool, sync_windows: list[Any]
) -> tuple[bool, int]:
    """backfill（9_9）の実施漏れを判定する。戻り値は (漏れているか, 過去INSERT数)。

    #843 **「行を数える」形の判定を書いてはいけない。**
    9_1 の provenance UPDATE は **アプリ製の行にも source_seed_id を刻む**し、
    同期中に作られたアプリ製の行は実行窓の中に created_at を持つ。つまり
    «source_seed_id を持つ» でも «実行窓に入っている» でもアプリ製の行が
    混ざり、backfill 済みでも同期が二度と通らなくなる。実際にこの 2 つの
    書き方で 2 回続けて落とした（2026-08-30 / 08-31）。

    backfill は全件を一括で更新する one-shot なので、実施漏れは
    「1 行も 'pipeline' が居ない」という **全か無か** でしか現れない。
    過去の同期が 1 行でも INSERT しているのに 'pipeline' が 0 件、という
    組み合わせだけが実施漏れである。誤検知の余地が無い。

    テストが本物を呼べるよう、SQL ではなくここに判定を置く
    （CLAUDE.md「本番のロジックをテストへ写経しない」）。
    """

    past_inserted = sum(int(getattr(w, "inserted_count", 0) or 0) for w in sync_windows)
    return past_inserted > 0 and not has_pipeline_rows, past_inserted


def validate_staging(connection: Any, sync_windows: list[Any]) -> None:
    """既存restaurantの暗黙Place ID変更をpublish前に止める。"""

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM restaurant_sync_staging s
            -- #843 seed で引く。source_seed_id は UNIQUE（20260823T0000）なので
            -- 高々1行に定まり、PG の UUID をカタログ側へ持ち込まずに済む。
            JOIN restaurants r ON r.source_seed_id = s.seed_id
            WHERE r.google_place_id <> s.google_place_id
              AND s.match_method <> 'manual_override'
            """
        )
        invalid_changes = cursor.fetchone()[0]
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM restaurant_sync_staging s
            -- 「この seed は既に PG のどの行か」を seed で引いてから、
            -- その place_id を別の行が使っていないかを見る。
            -- 初回同期では linked が 0 件なので、この検査は自然に無効になる。
            JOIN restaurants linked ON linked.source_seed_id = s.seed_id
            JOIN restaurants occupied ON occupied.google_place_id = s.google_place_id
            WHERE occupied.id <> linked.id
            """
        )
        occupied_place_ids = cursor.fetchone()[0]

        # #843 backfill 忘れの検知。
        #
        # created_by_source の既定は 'user' なので、パイプラインが過去に
        # 投入した行も、backfill しないままだと 'user' に見える。その状態で
        # 同期すると **オープンデータの更新が一件も反映されない**（壊れは
        # しないが黙って止まる）。落ちるより気付きにくいので、ここで数える。
        # 判定の根拠は detect_backfill_missing の docstring にある。
        # #1706 **数えない。«1 行でもあるか» だけを見る。**
        #
        # 判定に要るのは 0 か 0 でないかだけなので、COUNT(*) は無駄である。
        # しかも高くつく。pipeline が 62 万行中 61.9 万行を占めるため planner は
        # 索引を使わず全表走査を選び、**死骸が積んだ表では 30 分でも終わらない**
        # （2026-08-31 に実測。9_1 が 3 回連続で落ちた 3 回目の原因）。
        # EXISTS なら索引で最初の 1 行に当たった時点で止まる。
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM restaurants WHERE created_by_source = 'pipeline')"
        )
        has_pipeline_rows = cursor.fetchone()[0]

    backfill_missing, past_inserted = detect_backfill_missing(
        has_pipeline_rows, sync_windows
    )

    if backfill_missing:
        raise RuntimeError(
            f"過去の同期が{past_inserted}行を INSERT しているのに "
            "created_by_source='pipeline' の行が 1 件もありません。"
            "9_9_backfill_created_by_source.py を先に実行してください"
        )
    if invalid_changes:
        raise RuntimeError(
            f"人手overrideでない既存Google Place ID変更が{invalid_changes}件あります"
        )
    if occupied_place_ids:
        raise RuntimeError(
            f"override先Google Place IDを別restaurantが使用中の行が{occupied_place_ids}件あります"
        )


def apply_sync(connection: Any) -> None:
    """同期の DML を流す。

    #1706 **文ごとに所要時間を出す。** 62 万行規模では複数の文が
    statement_timeout（30 分）の境界付近に並ぶ。2026-08-30 に 2 回続けて
    timeout し、1 回目は provenance UPDATE、それを直すと次は INSERT だった。
    «どれが遅いか» をログから読めないと、推測で 30〜60 分を溶かすことになる。
    """

    budget_started = time.monotonic()

    def run(label: str, sql: str) -> None:
        # #1706 **次の文へ進む前に、予算を使い切っていないか見る。**
        # 共有 DB なので «あと少しだから» で粘らない。
        spent = time.monotonic() - budget_started
        if spent >= SYNC_TIME_BUDGET_SECONDS:
            raise RuntimeError(
                f"同期が {spent / 60:.1f} 分を超えました（上限 "
                f"{SYNC_TIME_BUDGET_SECONDS / 60:.0f} 分）。この DB は本番と共有して"
                "いるので、ここで降ります。上限を伸ばすのではなく、処理の分割を"
                "検討してください（#1706）"
            )

        # #1706 **遅いときに «なぜ» を残す。** 同じ文が実行によって 8 秒にも
        # 408 秒にもなった（どちらも 0 行）。行数では説明が付かず、plan の
        # 違いだった。EXPLAIN は実行しないので安く、これが無いと次も推測になる。
        started = time.monotonic()
        cursor.execute(sql)
        elapsed = time.monotonic() - started
        LOGGER.info("  %-28s %6.1f秒 / %d行", label, elapsed, cursor.rowcount)
        if elapsed >= SLOW_STATEMENT_SECONDS:
            try:
                cursor.execute("EXPLAIN " + sql)
                plan = " / ".join(line[0].strip() for line in cursor.fetchall()[:6])
                LOGGER.warning("    ↑ 遅い。plan: %s", plan)
            except Exception as error:  # EXPLAIN の失敗で同期を止めない
                LOGGER.warning("    ↑ 遅いが EXPLAIN を取れなかった: %s", error)

    with connection.cursor() as cursor:
        # #1706 **この同期は «両方の表をほぼ全部触る» 形なので、hash join を選ばせる。**
        #
        # 実測（dev、同じ文・同じ 0 行）:
        #
        #   新規 INSERT      8.3秒 → 408.4秒
        #   リンク削除       15.9秒 → 499.7秒
        #
        # 行数では説明が付かない。違いは plan である。VACUUM ANALYZE で統計が
        # 更新されたあと、planner が «索引で 1 行ずつ引く» 側（nested loop）を
        # 選ぶようになった。62 万行ぶんの索引探索は、この DB の速度では
        # 1 文あたり数百秒かかる。
        #
        # バッチとして正しいのは «両方を舐めて突き合わせる»（hash join）方である。
        # random_page_cost の既定はマネージド PostgreSQL では SSD 向けに
        # 小さく設定されていることが多く、対話クエリには合っているが、
        # 62 万行を 1 文で処理するバッチには合わない。
        #
        # SET LOCAL なので **このトランザクションの中だけ**に効く。
        cursor.execute("SET LOCAL random_page_cost = 4")
        cursor.execute("SET LOCAL enable_nestloop = off")
        # ⚠️ **work_mem は上げない。**
        #
        # 一度 `SET LOCAL work_mem = '256MB'` を入れたが、撤回した。work_mem は
        # **同時に動くノードごとに**確保されるので、1 文で何倍にもなる。この DB は
        # **本番と共有**しており、2026-08-31 にこのバッチが本番障害を起こした。
        # hash join は plan（上の 2 行）で誘導できる。溢れたらディスクを使えばよく、
        # それは遅いだけで **他のサービスを巻き込まない**。
        #
        # 共有資源では «自分が速いこと» より «他人を止めないこと» を優先する。
        # 既存PGのPlace ID変更は人手overrideを明示した場合だけ許す。restaurant UUIDを
        # 維持するため、削除→再作成ではなく既存行のID列だけを更新する。
        run(
            "manual_override の付替",
            """
            UPDATE restaurants r
            SET google_place_id = s.google_place_id
            FROM restaurant_sync_staging s
            WHERE r.source_seed_id = s.seed_id
              AND r.google_place_id <> s.google_place_id
              AND s.match_method = 'manual_override'
            """,
        )

        # seedが別restaurantへ付け替わった場合、旧行は削除せずprovenanceだけ外す。
        run(
            "seed 付替の provenance 解除",
            """
            UPDATE restaurants r
            SET source_seed_id = NULL,
                source_row_hash = NULL,
                synced_at = CURRENT_TIMESTAMP
            FROM restaurant_sync_staging s
            WHERE r.source_seed_id = s.seed_id
              AND r.google_place_id <> s.google_place_id
            """,
        )

        # まず不足行だけ追加する。
        #
        # #843 かつては `COALESCE(s.existing_restaurant_id, gen_random_uuid())` で
        # 既存UUIDを維持していたが、**この分岐は結果を変えていなかった**。
        # existing_restaurant_id が入っている行は PG に既に在るので
        # ON CONFLICT (google_place_id) DO NOTHING で弾かれ、INSERT されない。
        # 一方この列は «1_2 がどのスキーマを読んだか» に依存しており、
        # dev の catalog を public へ流すと dev の UUID が public の主キーに
        # なりえた。結果を変えない依存は外す。
        run(
            "新規 INSERT",
            """
            INSERT INTO restaurants (
              id, google_place_id, name, name_language_code, latitude, longitude,
              image_url, image_path, address_components, plus_code,
              address, country_code,
              source_seed_id, source_names, source_row_hash, synced_at,
              created_by_source
            )
            SELECT
              gen_random_uuid(),
              s.google_place_id, s.name, s.name_language_code, s.latitude, s.longitude,
              s.image_url, s.image_path, s.address_components_json::jsonb,
              CASE WHEN s.plus_code_json IS NULL THEN NULL ELSE s.plus_code_json::jsonb END,
              s.address, s.country_code,
              s.seed_id,
              ARRAY(SELECT jsonb_array_elements_text(s.source_names_json::jsonb)),
              s.row_hash,
              CURRENT_TIMESTAMP,
              -- #843 ここで所有者を刻む。ON CONFLICT DO NOTHING なので、既に
              -- 存在する行（＝アプリが作った行）の created_by_source は
              -- 書き換わらない。スナップショットに載っていたかどうかに関係なく
              -- アプリ製の行が 'user' のまま残るのが、この設計の要点である。
              'pipeline'
            FROM restaurant_sync_staging s
            -- #1706 **既に在る行は最初から候補にしない。**
            --
            -- ON CONFLICT だけに任せると、62 万行すべてについて
            -- gen_random_uuid() / jsonb キャスト / 配列生成をやってから捨てる。
            -- 実測では insert=0 なのにこの 1 文で 30 分の statement timeout に
            -- 当たった。ON CONFLICT は同時実行に対する保険として残す。
            WHERE NOT EXISTS (
              SELECT 1 FROM restaurants r WHERE r.google_place_id = s.google_place_id
            )
            ON CONFLICT (google_place_id) DO NOTHING
            """,
        )

        # パイプラインが作った行だけ、再実行時にcanonical値を更新する。
        #
        # #843 かつてこの条件は `s.existing_restaurant_id IS NULL` だった。
        # つまり「1_2 が撮ったスナップショットに載っていないなら新規行だろう」
        # という **PostgreSQL の外にある古いデータへの否定条件** で判定していた。
        # スナップショットから同期までは実測で約40時間あり、その間にアプリが
        # 作った行はスナップショットに載らないので「新規」と誤認され、
        # 表示値をオープンデータ値で上書きされた（2026-08-24 の dev で7行）。
        #
        # 判定を、行のとなりに刻まれた時間に依らない事実へ移す。これで
        # スナップショットが何時間古かろうと、アプリが作った行は触れない。
        #
        # `source_seed_id IS NULL` は条件に使えない。この直後の provenance
        # UPDATE が **アプリ製の行にも source_seed_id を付ける**ため、2回目の
        # 実行で条件が反転してしまう。
        run(
            "表示値 UPDATE",
            """
            UPDATE restaurants r
            SET
              name = s.name,
              name_language_code = s.name_language_code,
              latitude = s.latitude,
              longitude = s.longitude,
              image_url = s.image_url,
              image_path = s.image_path,
              address_components = s.address_components_json::jsonb,
              plus_code = CASE
                WHEN s.plus_code_json IS NULL THEN NULL ELSE s.plus_code_json::jsonb
              END,
              address = s.address,
              country_code = s.country_code
            FROM restaurant_sync_staging s
            WHERE r.google_place_id = s.google_place_id
              AND r.created_by_source = 'pipeline'
              AND r.source_row_hash IS DISTINCT FROM s.row_hash
              -- #1706 **値が本当に変わる行だけを書く。**
              --
              -- row_hash が動いただけでは表示値が変わったことにならない。
              -- 実際に 2026-08-31 に row_hash の定義へ source_names を足したところ、
              -- **表示値は 1 文字も変わらないのに 619,497 行を書き直し**、
              -- この 1 文だけで 1,520 秒かかった。この表の name には trigram、
              -- location（lat/lng からの生成列）には GIST が乗っているので、
              -- 同じ値で上書きしても索引は毎回作り直される。
              --
              -- hash はあくまで «調べる価値があるか» の粗いふるいで、
              -- «書くべきか» の判定はここで列ごとに行う。
              AND (
                r.name IS DISTINCT FROM s.name
                OR r.name_language_code IS DISTINCT FROM s.name_language_code
                OR r.latitude IS DISTINCT FROM s.latitude
                OR r.longitude IS DISTINCT FROM s.longitude
                OR r.image_url IS DISTINCT FROM s.image_url
                OR r.image_path IS DISTINCT FROM s.image_path
                OR r.address_components IS DISTINCT FROM s.address_components_json::jsonb
                OR r.plus_code IS DISTINCT FROM (
                  CASE WHEN s.plus_code_json IS NULL THEN NULL ELSE s.plus_code_json::jsonb END
                )
                OR r.address IS DISTINCT FROM s.address
                OR r.country_code IS DISTINCT FROM s.country_code
              )
            """,
        )

        # #1681 電話・公式サイト・SNS を restaurant_links へ入れる。
        #
        # BigQuery はこれらを計算済みなのに PG に受け口が無く、9_1 が捨てていた
        # （保有率 電話 89.2% / SNS 79.2% / サイト 44.9%）。website は営業時間の
        # 取得（#1666）の入口なので、無いとそちらへ着手できない。
        #
        # **消してから入れ直す形にはしない。** ユーザーやオーナーが後から足した
        # リンク（source が user / owner / official_site）まで消えるためである。
        # オープンデータ由来の行だけを対象に upsert する。
        # #1706 **アプリ製の行の «空いている» 住所だけを埋める。**
        #
        # 上の値 UPDATE は created_by_source='pipeline' に限っているので、
        # アプリが作った行には address / country_code が永久に入らない。
        # dev 実測で 2,472 行すべてが address 空だった。
        # 「上書きしない」と「欠けたままにする」は別の話なので、分けて扱う。
        #
        # ⚠️ **NULL の行にしか書かない。** 値が入っている行には触らない。
        # ユーザー／オーナーが入れた住所を、オープンデータで塗り替えないため。
        # country_code は 9_9_backfill_country_code.py が
        # その行自身の address_components から入れる方が精度が高いので、
        # ここでは **catalog にしか無い address だけ**を対象にする。
        run(
            "アプリ製の住所を穴埋め",
            """
            UPDATE restaurants r
            SET address = s.address
            FROM restaurant_sync_staging s
            WHERE r.google_place_id = s.google_place_id
              AND r.created_by_source <> 'pipeline'
              AND r.address IS NULL
              AND NULLIF(btrim(s.address), '') IS NOT NULL
            """,
        )

        # #1700 レビュー: 出所側で値が変わった/消えたときに、**古い値が残り続ける**。
        # ON CONFLICT DO NOTHING は足すだけなので、電話が変わった店は
        # 新旧 2 本を持つことになり、どちらが現在の値か区別できない。
        #
        # **オープンデータ由来の行だけ**を、今回の catalog に無いものに限って消す。
        # ユーザー・オーナー・公式サイト由来（source <> 'open_data'）は触らない。
        # 対象も staging に居る店に限る（catalog に載らなかった店の履歴は消さない）。
        run(
            "古い open_data リンク削除",
            """
            DELETE FROM restaurant_links l
            USING restaurants r, restaurant_sync_staging s
            WHERE l.restaurant_id = r.id
              AND r.google_place_id = s.google_place_id
              AND l.source = 'open_data'
              -- #1706 **リンクは row_hash が動いたときしか変わらない。**
              -- row_hash は phone / website / social_urls を含むので、
              -- 一致している店のリンクを調べ直す必要はない。62 万店ぶんの
              -- 突き合わせを毎回やると statement timeout に当たる。
              -- アプリ製の行は source_row_hash が NULL のままなので常に対象
              -- （2,468 行しかないので支障はない）。
              AND r.source_row_hash IS DISTINCT FROM s.row_hash
              AND NOT EXISTS (
                SELECT 1
                FROM (
                  SELECT 'phone'::text AS kind, s.phone AS value
                  UNION ALL SELECT 'website', s.website
                  UNION ALL SELECT
                    CASE
                      WHEN u.value ILIKE '%%instagram.com%%' THEN 'instagram'
                      WHEN u.value ILIKE '%%tiktok.com%%'    THEN 'tiktok'
                      WHEN u.value ILIKE '%%facebook.com%%'  THEN 'facebook'
                      WHEN u.value ILIKE '%%twitter.com%%'
                        OR u.value ILIKE '%%//x.com/%%'      THEN 'x'
                      ELSE 'other'
                    END,
                    u.value
                  FROM jsonb_array_elements_text(s.social_urls_json::jsonb) AS u(value)
                ) AS cur
                WHERE cur.kind = l.kind AND cur.value = l.value
              )
            """,
        )

        run(
            "リンク投入",
            """
            INSERT INTO restaurant_links (restaurant_id, kind, value, source, fetched_at)
            SELECT r.id, v.kind, v.value, 'open_data', CURRENT_TIMESTAMP
            FROM restaurant_sync_staging s
            JOIN restaurants r
              ON r.google_place_id = s.google_place_id
             -- #1706 DELETE と同じ理由。row_hash が動いた店だけを見る。
             AND r.source_row_hash IS DISTINCT FROM s.row_hash
            CROSS JOIN LATERAL (
              -- 電話・サイトは 1 本ずつ、SNS は配列。1 つの SELECT に畳んで
              -- 空文字と NULL を同じ「無い」として落とす。
              SELECT 'phone'::text AS kind, s.phone AS value
              WHERE NULLIF(btrim(COALESCE(s.phone, '')), '') IS NOT NULL
              UNION ALL
              SELECT 'website', s.website
              WHERE NULLIF(btrim(COALESCE(s.website, '')), '') IS NOT NULL
              UNION ALL
              SELECT
                CASE
                  WHEN u.value ILIKE '%%instagram.com%%' THEN 'instagram'
                  WHEN u.value ILIKE '%%tiktok.com%%'    THEN 'tiktok'
                  WHEN u.value ILIKE '%%facebook.com%%'  THEN 'facebook'
                  WHEN u.value ILIKE '%%twitter.com%%'
                    OR u.value ILIKE '%%//x.com/%%'      THEN 'x'
                  ELSE 'other'
                END,
                u.value
              FROM jsonb_array_elements_text(s.social_urls_json::jsonb) AS u(value)
              WHERE NULLIF(btrim(u.value), '') IS NOT NULL
            ) AS v
            ON CONFLICT (restaurant_id, kind, value) DO NOTHING
            """,
        )

        # provenanceは既存行にも付ける。これによりPG表示値を維持しつつ、どのseedが
        # 根拠になったかと最終同期時刻を追跡できる。
        #
        # #1706 **中身が変わる行だけを書く。**
        #
        # 以前はここを無条件（place_id が一致する全行）で流していた。skip 判定の
        # 行は provenance も変わらないのに毎回書き直しており、62 万行を丸ごと
        # 更新していた。`source_seed_id` は UNIQUE 索引が付いているのでこの更新は
        # **非 HOT** になり、name の GIN trigram を含む全索引を毎回作り直す。
        # 2026-08-30 の dev 同期はこの 1 文で 30 分の statement timeout に当たった
        # （実測: insert 0 / update 2,637 / **skip 619,329**）。
        #
        # synced_at だけは «今回の catalog に居た» の印なので全行に付ける必要がある。
        # そちらは索引の無い列だけを触る別の文へ分け、HOT update にする（下）。
        # #1706 **索引の付いた列と、付いていない列を別の文に分ける。**
        #
        # `source_seed_id` には UNIQUE 索引がある（20260823T0000）。この列を
        # 含めて UPDATE すると PostgreSQL は HOT update にできず、**その行の
        # 全索引**（name の trigram、location の GIST を含む）を作り直す。
        # 一方 seed の付け替えは実際にはほとんど起きない（実測 0 行）。
        #
        # 2026-08-31 に row_hash の定義を変えたところ、この 1 文が 62 万行を
        # 掴んで 30 分の statement timeout に当たった。seed が変わらない行まで
        # 索引を作り直していたためである。
        #
        # 変わる列だけを、変わる行にだけ書く。
        run(
            "seed 付替（索引あり）",
            """
            UPDATE restaurants r
            SET source_seed_id = s.seed_id
            FROM restaurant_sync_staging s
            WHERE r.google_place_id = s.google_place_id
              AND r.source_seed_id IS DISTINCT FROM s.seed_id
            """,
        )

        # provenanceは既存行にも付ける。これによりPG表示値を維持しつつ、どのseedが
        # 根拠になったかを追跡できる。
        #
        # ここで触る `source_names` / `source_row_hash` には索引が無いので、
        # 62 万行を書いても HOT update で済む。
        run(
            "provenance UPDATE",
            """
            UPDATE restaurants r
            SET
              source_names = ARRAY(
                SELECT jsonb_array_elements_text(s.source_names_json::jsonb)
              ),
              -- #843 source_row_hash は **pipeline の行にだけ**刻む。
              --
              -- ここを無条件にすると、アプリが作った行にも catalog の row_hash が
              -- 付く。その行が何かの拍子に created_by_source='pipeline' へ変わると、
              -- 値 UPDATE の条件 `source_row_hash IS DISTINCT FROM s.row_hash` が
              -- 最初から偽になり、**その行だけオープンデータの更新が永久に
              -- 届かなくなる**。落ちず、壊れず、気付けない。
              source_row_hash = CASE
                WHEN r.created_by_source = 'pipeline' THEN s.row_hash
                ELSE r.source_row_hash
              END
            FROM restaurant_sync_staging s
            WHERE r.google_place_id = s.google_place_id
              -- #1706 **配列を組み立てて比べない。**
              -- source_names は row_hash に含めた（3_4）ので、hash の比較だけで
              -- «provenance が変わったか» が分かる。62 万行ぶんの jsonb 展開が
              -- 消える。
              --
              -- アプリ製の行は source_row_hash を NULL のままにしているので
              -- 常に真になるが、2,472 行しかないので支障はない。
              AND r.source_row_hash IS DISTINCT FROM s.row_hash
            """,
        )

        # #1706 «今回の catalog に居た» の印だけを全行へ付ける。
        #
        # **索引の付いた列を 1 つも触らない**ので、PostgreSQL は HOT update に
        # できる（索引を作り直さない）。上の provenance UPDATE から synced_at を
        # 分離したのはこのためで、62 万行でも現実的な時間で終わる。
        #
        # この印は 9_9_audit_sync_drift が «最新 catalog に居なかった行»
        # （＝閉店・脱落・place_id 統合で溜まるゴミ）を数えるのに使う。
        # 変わった行だけに付けると、変わらなかった行が «居なかった» に見えてしまう。
        run(
            "synced_at",
            """
            UPDATE restaurants r
            SET synced_at = CURRENT_TIMESTAMP
            FROM restaurant_sync_staging s
            WHERE r.google_place_id = s.google_place_id
            """,
        )


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    assert_quality_gate_passed(
        pipeline, run_id, required_checks=RESTAURANT_ERROR_CHECKS
    )
    sync_id = new_sync_id()
    started_at = utc_now()
    stats = SyncStats()
    connection = None

    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as stream:
        staging_path = Path(stream.name)
    try:
        row_count = export_catalog(pipeline, run_id, staging_path)
        if row_count == 0:
            raise RuntimeError("restaurant_catalogが0件です")
        # 大きなCSV export中に同じrunのcatalogが再生成された場合を検知する。
        assert_quality_gate_passed(
            pipeline, run_id, required_checks=RESTAURANT_ERROR_CHECKS
        )
        connection = connect_postgres(args.schema, allow_public=args.allow_public)
        if not args.dry_run and not args.skip_backup:
            backup_table_to_gcs(connection, args.schema, "restaurants", run_id=run_id)
        load_staging(connection, staging_path)
        # 初回同期では窓が 0 件になる。それは backfill 漏れではないので通す。
        validate_staging(
            connection, fetch_sync_windows(pipeline, args.schema, allow_empty=True)
        )
        stats = calculate_stats(connection)
        LOGGER.info(
            "restaurant sync plan: insert=%d update=%d skip=%d",
            stats.inserted,
            stats.updated,
            stats.skipped,
        )
        # #1706 **重い処理の前後で、共有 DB の負荷を測って残す。**
        # この DB は本番と共有しており、測ることを怠って障害を起こした。
        log_db_load(connection, "同期前")
        # dry-runも同じDMLをtransaction内で実行し、constraint/JSON cast/競合を
        # 本番前に検出する。違いはcommitせずrollbackすることだけにする。
        apply_sync(connection)
        log_db_load(connection, "同期後")
        if args.dry_run:
            connection.rollback()
        else:
            connection.commit()
        write_sync_log(
            pipeline,
            run_id=run_id,
            sync_id=sync_id,
            schema=args.schema,
            target_table="restaurants",
            dry_run=args.dry_run,
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
            target_table="restaurants",
            dry_run=args.dry_run,
            stats=stats,
            status="failed",
            started_at=started_at,
            error_message=str(error),
        )
        raise
    finally:
        staging_path.unlink(missing_ok=True)
        if connection:
            connection.close()


if __name__ == "__main__":
    main()
