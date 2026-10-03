#!/usr/bin/env python3
"""BigQuery restaurant_catalogをPostgreSQL restaurantsへ安全に同期する。"""

from __future__ import annotations

import argparse
import csv
import logging
import tempfile
from pathlib import Path
from typing import Any

from google.cloud import bigquery

from pg_sync_common import (
    RESTAURANT_ERROR_CHECKS,
    SyncStats,
    assert_quality_gate_passed,
    backup_table_to_gcs,
    connect_postgres,
    fetch_sync_windows,
    new_sync_id,
    write_sync_log,
)
from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now

LOGGER = logging.getLogger(__name__)


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

        # #1881 【設計】**COPY の後に索引を張る。**
        #
        # apply_sync は staging を google_place_id で 7 回結合し、さらに
        # `execute_in_key_ranges` がそれを範囲へ切って複数回流す。索引が無いと
        # **範囲ごとに 62 万行の seq scan** になり、文を刻んだぶんだけ走査が増える
        # （＝刻む前より遅くなる）。実際、索引無しでバッチ化した dry-run は
        # 2 時間 15 分たっても終わらなかった。
        #
        # ⚠️ **COPY の «前» に張らないこと。** 索引付きの表へ 62 万行を COPY すると
        #    行ごとに索引更新が走り、取り込み自体が遅くなる。まとめて入れてから張る。
        #
        # ⚠️ **ANALYZE も要る。** temp table は autovacuum の対象外なので、統計が
        #    無いままだとプランナが行数を既定値で見積もり、索引を使わない判断をしうる。
        cursor.execute("CREATE INDEX ON restaurant_sync_staging (google_place_id)")
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
        #
        # ⚠️ `source_seed_id IS NOT NULL` だけで判定してはいけない。
        # 9_1 の provenance UPDATE は **アプリ製の行にも source_seed_id を刻む**
        # ので、アプリが作った既存店（dev 実測 2,115 行）が恒久的に引っかかり、
        # backfill 済みでも同期が二度と通らなくなる。実際にこれで落とした。
        #
        # 「パイプラインが INSERT した行」の定義は backfill（9_9）と同じ
        # ——**同期の実行窓に作られた行**——でなければならない。判定を
        # 二重に書かないよう、窓の取得は pg_sync_common に寄せてある。
        #
        # ⚠️ #1881 【バグ】**窓で絞るだけでは足りない。アプリが同期の窓の中で店を
        # 作ると必ず誤検知する。** 実際に dev で 9_1 が止まった（2026-09-09）:
        #
        #   08-29 22:24  ユーザーがアプリで「スターバックス コーヒー 渋谷cocoti店」を作成
        #   09-01 01:45  同期が走る。同じ google_place_id なので INSERT は ON CONFLICT で
        #                弾かれたが、**下の provenance UPDATE が設計どおり**この行へ
        #                seed と synced_at を刻んだ
        #   → この検査が «backfill 漏れ 1 件» として発火し、同期が通らなくなった
        #
        # 案内どおり 9_9_backfill_created_by_source.py を流すこともできない。あれ自身が
        # 「ユーザーの行を pipeline へ誤って書き換える」として実行を拒否する。
        # **データは壊れていない。検査の条件が足りていなかった。**
        #
        # 探したいのは「パイプラインが INSERT したのに backfill されていない行」。
        # それを取り違えずに言い表せる事実が 1 つある:
        #
        #   - INSERT は source_row_hash を必ず入れる（下の INSERT 列）
        #   - provenance UPDATE は source_row_hash を **pipeline の行にしか**刻まない
        #     （下の CASE 式。理由もそこに書いてある）
        #
        # ⇒ **source_row_hash が NULL の行は、パイプラインが中身を 1 度も書いていない
        #    = アプリ製**と言い切れる。`source_seed_id` の有無では言い切れない。
        #
        # ⚠️ この SQL は tests/extract_backfill_detect_sql.py が **1 行へ畳んで**
        # 取り出す。SQL 文字列の中に `--` コメントを書くと、畳んだ瞬間に後続が
        # 全部コメントになる。**説明はこの Python コメント側に書くこと。**
        unbackfilled = 0
        for window in sync_windows:
            cursor.execute(
                """
                SELECT COUNT(*)
                FROM restaurants r
                WHERE r.created_by_source <> 'pipeline'
                  AND r.source_seed_id IS NOT NULL
                  /* #1881 パイプラインが中身を書いた行だけを見る（理由は上のコメント） */
                  AND r.source_row_hash IS NOT NULL
                  AND r.created_at BETWEEN %s AND %s
                """,
                (window.started_at, window.finished_at),
            )
            unbackfilled += cursor.fetchone()[0]

    if unbackfilled:
        raise RuntimeError(
            f"過去の同期が作った行のうち{unbackfilled}件が created_by_source='pipeline' に"
            "なっていません。9_9_backfill_created_by_source.py を先に実行してください"
        )
    if invalid_changes:
        raise RuntimeError(
            f"人手overrideでない既存Google Place ID変更が{invalid_changes}件あります"
        )
    if occupied_place_ids:
        raise RuntimeError(
            f"override先Google Place IDを別restaurantが使用中の行が{occupied_place_ids}件あります"
        )


# #1881 【設計】**staging を全件なめる文を、1 文で書かない。**
#
# 2026-09-23、dev の dry-run が値 UPDATE（apply_sync の 1 文目の大物）で
# `canceling statement due to statement timeout` に当たって落ちた
# （[run 35888471165]。同期 session の statement_timeout は既に 30 分ある）。
#
# 原因は «たまたま重かった» ではない。国コードの是正で **catalog の row_hash が
# 全行変わった**ため、`source_row_hash IS DISTINCT FROM s.row_hash` に
# **621,966 行すべてが当たった**（ログの `update=621966`）。
# 普段は差分だけなので通るが、列の意味を直すたびに全行更新は必ず起きる。
#
# したがって «速くする» のではなく **«1 文あたりの行数を有限にする»** のが正しい。
# staging を google_place_id 順に切り、(lo, hi] の範囲ごとに同じ文を流す。
#
# ⚠️ **境界は staging 側の値で切る。** restaurants 側で切ると、staging に無い行まで
#    走査範囲へ入る。
# ⚠️ **1 トランザクションのままにする。** 途中で commit すると、失敗したときに
#    «半分だけ新しい» 状態が残る（advisory xact lock も外れる）。timeout は
#    «1 文» に掛かるので、文を刻めばトランザクションは長いままでよい。
BATCH_SIZE = 50_000

# 下限の番兵。google_place_id は非空文字列なので、`> ''` は「全部」を意味する
_FIRST_LOWER_BOUND = ""


def staging_key_ranges(cursor: Any, batch_size: int = BATCH_SIZE) -> list[tuple[str, str]]:
    """staging を `google_place_id` 順に `batch_size` 件ずつ切り、`(lo, hi]` を返す。

    返す範囲は **重なりが無く、staging の全行をちょうど 1 回ずつ覆う**。
    staging が空なら空リストを返す（呼び出し側は 1 文も流さない）。
    """
    cursor.execute(
        """
        SELECT google_place_id
        FROM (
          SELECT
            google_place_id,
            row_number() OVER (ORDER BY google_place_id) AS rn,
            count(*)     OVER ()                        AS total
          FROM restaurant_sync_staging
        ) t
        WHERE rn %% %(size)s = 0 OR rn = total
        ORDER BY google_place_id
        """,
        {"size": batch_size},
    )
    upper_bounds = [row[0] for row in cursor.fetchall()]
    ranges: list[tuple[str, str]] = []
    lower = _FIRST_LOWER_BOUND
    for upper in upper_bounds:
        ranges.append((lower, upper))
        lower = upper

    # ⚠️ **覆えていないことを «静かに» 通さない。** 範囲の上端が staging の最大値と
    #    一致しなければ、最後の一群が 1 文も流れないまま «成功» になる。
    #    落ちない・壊れない・気付けない形なので、ここで必ず止める。
    cursor.execute(
        "SELECT max(google_place_id), count(*) FROM restaurant_sync_staging"
    )
    max_key, row_count = cursor.fetchone()
    if row_count and (not ranges or ranges[-1][1] != max_key):
        raise RuntimeError(
            "staging の範囲分割が全行を覆っていません "
            f"(rows={row_count} last_upper={ranges[-1][1] if ranges else None} max={max_key})"
        )
    return ranges


def execute_in_key_ranges(
    cursor: Any, label: str, sql: str, ranges: list[tuple[str, str]]
) -> int:
    """`sql` を範囲ごとに流す。`sql` は `%(lo)s` / `%(hi)s` を含むこと。

    ⚠️ **進捗を数字で出す。** 1 文が 30 分掛かって落ちたときに «生きているのか
       止まっているのか» が分からなかったのが、今回いちばん困った点である。
    """
    total = 0
    for index, (lower, upper) in enumerate(ranges, start=1):
        cursor.execute(sql, {"lo": lower, "hi": upper})
        total += cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0
        LOGGER.info(
            "%s: batch %s/%s done (rows so far: %s)", label, index, len(ranges), total
        )
    return total


# #1881 【設計】**同期が書き戻す列は、ここ 1 箇所で持つ。**
#
# 値 UPDATE は «SET する列» と «変化したかを見る列» の 2 つを必要とする。2 箇所に
# 書くと、列を足したとき片方を忘れて **「その列だけ永久に更新されない」** 形が作れる
# （落ちず・壊れず・気付けない。CLAUDE.md「同じ判定を 2 箇所に書いた時点でずれる」）。
# 列名と staging 側の式を 1 つの表にして、SET も比較もここから組み立てる。
# #1779 【設計】**落とす 3 列（image_url / address_components / plus_code）は
# 同期でも «更新しない»。**
#
# 列が DB から消えたあと `s.address_components_json::jsonb` を SET しようとすると
# 同期が落ちる。消す前に、書く側を先に止めておく（expand → コード移行 → contract）。
#
# ⚠️ **値は失わない。** パイプライン製の行が持っているのは
# `image_url = ''` / `address_components = '[]'` / `plus_code = NULL` で、
# catalog 側も同じものを入れていた（Google の写真・住所はオープンデータには無い）。
# 更新をやめても行の中身は 1 つも変わらない。
#
# ⚠️ **`_changed_predicate()` の対象も同時に狭まる**（この一覧から組み立てているため）。
# 狭まる方向なので «書かなくてよい行を書く» ことは増えない。
SYNCED_COLUMNS: list[tuple[str, str]] = [
    ("name", "s.name"),
    ("name_language_code", "s.name_language_code"),
    ("latitude", "s.latitude"),
    ("longitude", "s.longitude"),
    ("image_path", "s.image_path"),
    ("address", "s.address"),
    ("country_code", "s.country_code"),
]


def _set_clause() -> str:
    return ",\n              ".join(f"{column} = {expr}" for column, expr in SYNCED_COLUMNS)


def _changed_predicate() -> str:
    """値が実際に違う行だけに絞る述語。

    ⚠️ **`IS DISTINCT FROM` を行コンストラクタで使う。** `<>` だと NULL が絡んだ
       ときに UNKNOWN になり、「片方が NULL の変化」を取りこぼす。
    """
    left = ", ".join(f"r.{column}" for column, _ in SYNCED_COLUMNS)
    right = ", ".join(expr for _, expr in SYNCED_COLUMNS)
    return f"({left})\n                  IS DISTINCT FROM ({right})"

def apply_sync(connection: Any) -> None:
    with connection.cursor() as cursor:
        # #1881 staging を全件なめる 4 文は、この範囲ごとに流す（→ staging_key_ranges）
        key_ranges = staging_key_ranges(cursor)
        LOGGER.info(
            "staging を %s 件ずつ %s 個の範囲へ切りました", BATCH_SIZE, len(key_ranges)
        )

        # 既存PGのPlace ID変更は人手overrideを明示した場合だけ許す。restaurant UUIDを
        # 維持するため、削除→再作成ではなく既存行のID列だけを更新する。
        execute_in_key_ranges(
            cursor,
            "place id 付け替え",
            """
            UPDATE restaurants r
            SET google_place_id = s.google_place_id
            FROM restaurant_sync_staging s
            WHERE r.source_seed_id = s.seed_id
              AND r.google_place_id <> s.google_place_id
              AND s.match_method = 'manual_override'
              AND s.google_place_id > %(lo)s
              AND s.google_place_id <= %(hi)s
            """,
            key_ranges,
        )

        # seedが別restaurantへ付け替わった場合、旧行は削除せずprovenanceだけ外す。
        execute_in_key_ranges(
            cursor,
            "provenance 外し",
            """
            UPDATE restaurants r
            SET source_seed_id = NULL,
                source_row_hash = NULL,
                synced_at = CURRENT_TIMESTAMP
            FROM restaurant_sync_staging s
            WHERE r.source_seed_id = s.seed_id
              AND r.google_place_id <> s.google_place_id
              AND s.google_place_id > %(lo)s
              AND s.google_place_id <= %(hi)s
            """,
            key_ranges,
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
        execute_in_key_ranges(
            cursor,
            "不足行 INSERT",
            """
            -- #1779 落とす列のうち image_url（DEFAULT ''）と plus_code（NULL 可）は
            -- **もう列挙しない**。DB 側の既定値で通るので、消したあともこの文は動く。
            --
            -- ⚠️ `address_components` だけはまだ列挙している。
            --    `JSONB NOT NULL` で **既定値が無い**ため、外すと INSERT が落ちる。
            --    `image_url` に DEFAULT '' を足した migration（20260909 の A）と同じ形の
            --    expand が 1 本必要で、それはオーナー承認が要る。承認が下りたら
            --    この 2 行を消す。
            INSERT INTO restaurants (
              id, google_place_id, name, name_language_code, latitude, longitude,
              image_path, address_components,
              address, country_code,
              source_seed_id, source_names, source_row_hash, synced_at,
              created_by_source
            )
            SELECT
              gen_random_uuid(),
              s.google_place_id, s.name, s.name_language_code, s.latitude, s.longitude,
              s.image_path, s.address_components_json::jsonb,
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
            WHERE s.google_place_id > %(lo)s
              AND s.google_place_id <= %(hi)s
            ON CONFLICT (google_place_id) DO NOTHING
            """,
            key_ranges,
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
        execute_in_key_ranges(
            cursor,
            "値 UPDATE",
            f"""
            UPDATE restaurants r
            SET
              {_set_clause()}
            FROM restaurant_sync_staging s
            WHERE r.google_place_id = s.google_place_id
              AND r.created_by_source = 'pipeline'
              AND r.source_row_hash IS DISTINCT FROM s.row_hash
              -- #1881 **中身が同じ行を書き直さない。**
              --
              -- ハッシュの差だけを条件にしていたため、値が 1 つも変わっていない行まで
              -- 全部書き直していた（dev で 621,966 行全部が該当し、5 万行あたり
              -- 約 25 分。全体で 6 時間を超えてジョブの上限に当たる）。
              -- ハッシュは «見に行くべきか» の粗い篩で、«書くべきか» ではない。
              AND {_changed_predicate()}
              AND s.google_place_id > %(lo)s
              AND s.google_place_id <= %(hi)s
            """,
            key_ranges,
        )

        # #1779 【設計】**アプリ製の行の «空欄だけ» をオープンデータで埋める。**
        #
        # ## 何が抜けていたか
        #
        # 上の値 UPDATE は `created_by_source = 'pipeline'` に限っている（アプリが
        # 作った行の表示値を上書きしないため。2026-08-24 の事故）。その結果、
        # **アプリ製の行の `address` / `country_code` は誰も埋めない**状態だった。
        # dev の実測（2026-09-24）で `address` が空のまま `address_components` に
        # 頼っている行が 1,675 行あり、**全部がアプリ製**だった。
        #
        # しかもこれは «過去の負債» ではなく **今も増える**。Google 一括取り込み
        # （`dishes.service.ts`）は `address: null` を入れ、その理由をこう書いている:
        #
        #   > 住所と国コードはオープンデータ由来で埋める列なので、この経路では作らない
        #
        # «オープンデータ由来で埋める» 担当がここ（9_1）で、それが抜けていた。
        #
        # ## なぜ address_components から組み立てないのか
        #
        # 組み立てられはする（`restaurant-display-address.ts`）。しかしそれは
        # **Google 由来の住所を、別の列へ移し替えるだけ**で、#843 の目的
        # （Google 由来データを保持しない）に反する。`address` へ入れてよいのは
        # «オープンデータの住所» か «ユーザーが確認した住所»（#1671）だけである。
        #
        # ## 上書きとの違い
        #
        # **空欄にしか書かない。** `COALESCE(NULLIF(既存, ''), ...)` なので、
        # 値が入っている行は 1 文字も変わらない。#1671 の `fillMissingAddress`
        # （確認ページが既存店の空欄を埋める）と同じ約束を、同期側にも置く。
        #
        # ⚠️ **`source_row_hash` を触らないこと。** アプリ製の行でこれが NULL で
        #    あることが «パイプラインが中身を書いた行» の判別条件になっている
        #    （backfill 忘れの検知 / provenance UPDATE）。ここで刻むと、アプリ製の
        #    行が «パイプライン製» と数えられて検知が誤発火する。
        #
        # ⚠️ **`subterritory_code` は埋められない。** staging に列が無い（catalog が
        #    州を持っていない）。`address_components` を落として州を失う行が何行
        #    あるかは `9_9_audit_google_derived_data.py` が数える。
        execute_in_key_ranges(
            cursor,
            "アプリ製の行の空欄 UPDATE",
            """
            UPDATE restaurants r
            SET
              address = COALESCE(NULLIF(r.address, ''), NULLIF(s.address, ''), r.address),
              country_code = COALESCE(
                NULLIF(r.country_code, ''), NULLIF(s.country_code, ''), r.country_code
              )
            FROM restaurant_sync_staging s
            WHERE r.google_place_id = s.google_place_id
              AND r.created_by_source <> 'pipeline'
              -- 実際に埋まる行だけに絞る。«片方でも空いていて、catalog が値を持つ» 行。
              -- ⚠️ これが無いと全アプリ行を毎回書き直す（#1881 で 62 万行を書き直して
              --    6 時間コースに当てたのと同じ形）。
              AND (
                (NULLIF(r.address, '') IS NULL AND NULLIF(s.address, '') IS NOT NULL)
                OR (
                  NULLIF(r.country_code, '') IS NULL
                  AND NULLIF(s.country_code, '') IS NOT NULL
                )
              )
              AND s.google_place_id > %(lo)s
              AND s.google_place_id <= %(hi)s
            """,
            key_ranges,
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
        # #1700 レビュー: 出所側で値が変わった/消えたときに、**古い値が残り続ける**。
        # ON CONFLICT DO NOTHING は足すだけなので、電話が変わった店は
        # 新旧 2 本を持つことになり、どちらが現在の値か区別できない。
        #
        # **オープンデータ由来の行だけ**を、今回の catalog に無いものに限って消す。
        # ユーザー・オーナー・公式サイト由来（source <> 'open_data'）は触らない。
        # 対象も staging に居る店に限る（catalog に載らなかった店の履歴は消さない）。
        execute_in_key_ranges(
            cursor,
            "links DELETE",
            """
            DELETE FROM restaurant_links l
            USING restaurants r, restaurant_sync_staging s
            WHERE l.restaurant_id = r.id
              AND r.google_place_id = s.google_place_id
              AND s.google_place_id > %(lo)s
              AND s.google_place_id <= %(hi)s
              -- #1881 **リンクが変わりえない行は触らない。**
              --
              -- `row_hash` は phone / website / social_urls を**含めて**計算している
              -- （`3_4_build_restaurant_catalog.py`）。したがって **ハッシュが一致する行は
              -- リンクも前回のままでよい**。
              --
              -- ⚠️ 成り立つ理由は順序にある。リンクの DELETE / INSERT は
              -- `source_row_hash` を書く provenance UPDATE より **前**に流れ、全体が
              -- 1 トランザクションである。つまり «そのハッシュが刻まれている» ことは
              -- «そのハッシュのリンクを書き切った» ことを意味する。
              --
              -- ⚠️ アプリ製の行は `source_row_hash` が NULL なので
              -- `IS DISTINCT FROM` は真になり、**ちゃんと対象に残る**。
              AND r.source_row_hash IS DISTINCT FROM s.row_hash
              AND l.source = 'open_data'
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
            key_ranges,
        )

        execute_in_key_ranges(
            cursor,
            "links INSERT",
            """
            INSERT INTO restaurant_links (restaurant_id, kind, value, source, fetched_at)
            SELECT r.id, v.kind, v.value, 'open_data', CURRENT_TIMESTAMP
            FROM restaurant_sync_staging s
            JOIN restaurants r ON r.google_place_id = s.google_place_id
              AND s.google_place_id > %(lo)s
              AND s.google_place_id <= %(hi)s
              -- #1881 **リンクが変わりえない行は触らない。**
              --
              -- `row_hash` は phone / website / social_urls を**含めて**計算している
              -- （`3_4_build_restaurant_catalog.py`）。したがって **ハッシュが一致する行は
              -- リンクも前回のままでよい**。
              --
              -- ⚠️ 成り立つ理由は順序にある。リンクの DELETE / INSERT は
              -- `source_row_hash` を書く provenance UPDATE より **前**に流れ、全体が
              -- 1 トランザクションである。つまり «そのハッシュが刻まれている» ことは
              -- «そのハッシュのリンクを書き切った» ことを意味する。
              --
              -- ⚠️ アプリ製の行は `source_row_hash` が NULL なので
              -- `IS DISTINCT FROM` は真になり、**ちゃんと対象に残る**。
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
            key_ranges,
        )

        # provenanceは既存行にも付ける。これによりPG表示値を維持しつつ、どのseedが
        # 根拠になったかと最終同期時刻を追跡できる。
        execute_in_key_ranges(
            cursor,
            "provenance UPDATE（中身）",
            """
            UPDATE restaurants r
            SET
              source_seed_id = s.seed_id,
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
              -- #1881 **中身が変わる行だけ書く。** 下の `synced_at` と違い、
              -- この 3 列は毎回変わるものではない。`source_names` は行ごとに
              -- jsonb を配列へ展開するので、変わらない行まで舐めると高くつく
              -- （dev の実測で 50,000 行あたり 28 分。13 バッチで約 6 時間）。
              AND (
                r.source_seed_id IS DISTINCT FROM s.seed_id
                OR r.source_names IS DISTINCT FROM ARRAY(
                     SELECT jsonb_array_elements_text(s.source_names_json::jsonb)
                   )
                OR (
                  r.created_by_source = 'pipeline'
                  AND r.source_row_hash IS DISTINCT FROM s.row_hash
                )
              )
              AND s.google_place_id > %(lo)s
              AND s.google_place_id <= %(hi)s
            """,
            key_ranges,
        )

        # #1881 【設計】**`synced_at` だけは «変わらない行» にも必ず押す。**
        #
        # ⚠️ **上の «中身が変わる行だけ» と同じ扱いにしてはいけない。**
        #    `9_9_audit_sync_drift.py` は «最新同期より古い `synced_at`» を
        #    「今回の catalog に居なかった行」の印として使っている。変わらない行の
        #    `synced_at` を据え置くと、**その全部が «消えた店» として報告される**
        #    （落ちず・壊れず・誤報だけが増える）。意味を変えずに、書く内容だけ軽くする。
        #
        # 列 1 本の UPDATE なので、上の jsonb 展開つき UPDATE より 1 行あたりが軽い。
        execute_in_key_ranges(
            cursor,
            "provenance UPDATE（synced_at）",
            """
            UPDATE restaurants r
            SET synced_at = CURRENT_TIMESTAMP
            FROM restaurant_sync_staging s
            WHERE r.google_place_id = s.google_place_id
              AND s.google_place_id > %(lo)s
              AND s.google_place_id <= %(hi)s
            """,
            key_ranges,
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
        # dry-runも同じDMLをtransaction内で実行し、constraint/JSON cast/競合を
        # 本番前に検出する。違いはcommitせずrollbackすることだけにする。
        apply_sync(connection)
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
