#!/usr/bin/env python3
"""#1815 «海外の店として PostgreSQL に入ってしまった行» を数え、修復 SQL を出す。

## なぜ要るか

`restaurant_catalog` 620,428 行のうち 100,063 行（16.13%）が日本以外の店なのに
`country_code` は全行 'JP' だった。8_1 の海外チェックが «取り込みの矩形を取り込んだ
結果へ当てる» 作りで構造上いつでも緑だったため、誰も気づかないまま
9_1_sync_restaurants → 9_2_sync_sns_dish_media を通って PostgreSQL へ入った。

**配信段は止めた**（判定は `common_sns.foreign_store_sql`）が、それは «これ以上入らない»
だけである。**既に入った行は残っている。** 何がどれだけ残っているのかを数え、
どう直すかをオーナーが選べるところまで持っていくのがこのスクリプトである。

## 実測（2026-09-05、db-script-run.yml から読み取り専用で実行）

| | dev | public |
| --- | --- | --- |
| restaurants 総数 | 621,974 | 654,702 |
| 日本以外の店 | 100,400（16.14%） | 100,065（15.28%） |
| └ パイプライン製（修復対象） | 100,063 | 100,055 |
| └ ユーザー製（正当・触らない） | 337 | 10 |
| 修復対象の dishes | 309 | 0 |
| 修復対象の dish_media | 946（全て external_embed） | 0 |
| 修復対象の 埋め込み実体 | 946 | 0 |
| 修復対象へのいいね/レビュー/入札/payout | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |

**public には海外の店の dish_media が 1 行も無い**（9_2 は dev 専用なので当然）。
**修復対象にユーザーの痕跡は 1 件も無い**ので、削除案を採っても失うユーザーデータは無い。

## 何をするか / しないか

- 既定は **読み取りだけ**。dev と public の両方を数え、修復 SQL を **表示するだけ**で実行しない
- `--apply` は **dev 専用**（argparse の choices・実行時 assert・`allow_public=False` の三重）。
  public はこのスクリプトからは絶対に書き換えられない
- 削除の候補から **ユーザーの痕跡がある行を外す**（いいね・レビュー・入札・payout）。
  海外の店であっても、ユーザーが触った行をバッチで消してはいけない

## 判定

«日本の店ではない» の判定は `common_sns.foreign_restaurant_sql`（PostgreSQL 方言）が
唯一の正。配信段（9_1/9_2）・品質ゲート（8_1）と同じ式を使う。ここへ写経しない。

⚠️ `created_by_source = 'user'` の海外店は **正当**である（ユーザーが旅行先で登録した店）。
数えはするが、修復の対象には入れない。

## 使い方（db-script-run.yml）

    script_path: scripts/20260808T0000_restaurant/9_9_audit_foreign_rows.py
    args: --schema dev
    args: --schema public --allow-public      # 読むだけ。public は --apply できない
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common_sns import (  # noqa: E402
    FOREIGN_TERRITORY_BOXES,
    foreign_restaurant_sql,
)
from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

# #1815 判定は common_sns が唯一の正。列名の対応もここ 1 行で決める。
FOREIGN_SQL = foreign_restaurant_sql(
    name="r.name",
    address="r.address",
    country_code="r.country_code",
    latitude="r.latitude",
    longitude="r.longitude",
    dialect="postgres",
)

# 修復の対象になる «海外の店» の集合。何度も書かないので CTE 1 本に固定する。
# パイプラインが作った行だけ。ユーザーが登録した海外店は正当なので触らない。
FOREIGN_RESTAURANTS_CTE = f"""
WITH foreign_restaurants AS (
  SELECT r.id, r.google_place_id, r.name, r.address, r.country_code,
         r.latitude, r.longitude, r.created_by_source
  FROM restaurants r
  WHERE {FOREIGN_SQL}
),
repairable AS (
  SELECT * FROM foreign_restaurants WHERE created_by_source = 'pipeline'
)
"""

# 何行あるか。restaurants → dishes → dish_media → dmee の順に辿る。
#
# ⚠️ **«海外の店ぜんぶ» と «修復対象» を必ず分けて出す。** dev の実測では海外 100,400 店の
# うち 337 店がユーザー登録（ジョージアの店など。**正当**で触らない）で、dish_media 2,937 行の
# 大半・レビュー 4,442 件はそちら側に付いていた。1 つの数にまとめると «消すと 4,442 件の
# レビューが消える» と読めてしまい、オーナーの判断を誤らせる。
SQL_COUNTS = FOREIGN_RESTAURANTS_CTE + """
SELECT
  (SELECT COUNT(*) FROM restaurants)                                  AS restaurants_total,
  (SELECT COUNT(*) FROM foreign_restaurants)                          AS foreign_restaurants,
  (SELECT COUNT(*) FROM repairable)                                   AS foreign_pipeline_restaurants,
  (SELECT COUNT(*) FROM foreign_restaurants WHERE created_by_source <> 'pipeline')
                                                                      AS foreign_user_restaurants,
  (SELECT COUNT(*) FROM dishes d JOIN repairable f ON f.id = d.restaurant_id)
                                                                      AS foreign_dishes,
  (SELECT COUNT(*) FROM dish_media m
     JOIN dishes d ON d.id = m.dish_id
     JOIN repairable f ON f.id = d.restaurant_id)                      AS foreign_dish_media,
  (SELECT COUNT(*) FROM dish_media m
     JOIN dishes d ON d.id = m.dish_id
     JOIN repairable f ON f.id = d.restaurant_id
    WHERE m.render_type = 'external_embed')                            AS foreign_dish_media_embed,
  (SELECT COUNT(*) FROM dish_media_external_embeddings e
     JOIN dishes d ON d.id = e.dish_id
     JOIN repairable f ON f.id = d.restaurant_id)                      AS foreign_embeddings,
  (SELECT COUNT(*) FROM dishes d JOIN foreign_restaurants f ON f.id = d.restaurant_id)
                                                                      AS all_foreign_dishes,
  (SELECT COUNT(*) FROM dish_media m
     JOIN dishes d ON d.id = m.dish_id
     JOIN foreign_restaurants f ON f.id = d.restaurant_id)             AS all_foreign_dish_media
"""

# 消してよいか。ユーザーの痕跡がある行はバッチで消してはいけないので、別に数える。
# **修復対象（パイプライン製）だけ**を数える。ユーザーが登録した海外店の痕跡は
# そもそも触らないので、ここに混ぜると «消すと失われるもの» を過大に見せてしまう。
SQL_USER_TRACES = FOREIGN_RESTAURANTS_CTE + """
, foreign_media AS (
  SELECT m.id
  FROM dish_media m
  JOIN dishes d ON d.id = m.dish_id
  JOIN repairable f ON f.id = d.restaurant_id
),
foreign_dishes AS (
  SELECT d.id FROM dishes d JOIN repairable f ON f.id = d.restaurant_id
)
SELECT
  (SELECT COUNT(*) FROM dish_media_likes l JOIN foreign_media m ON m.id = l.dish_media_id)
                                                                       AS likes,
  (SELECT COUNT(*) FROM dish_reviews v JOIN foreign_dishes d ON d.id = v.dish_id)
                                                                       AS reviews,
  (SELECT COUNT(*) FROM restaurant_bids b JOIN repairable f ON f.id = b.restaurant_id)
                                                                       AS bids,
  (SELECT COUNT(*) FROM payouts p JOIN foreign_media m ON m.id = p.dish_media_id)
                                                                       AS payouts
"""

# 何が入っているのかを人が見るための一覧。
SQL_SAMPLE = FOREIGN_RESTAURANTS_CTE + """
SELECT f.google_place_id, f.name, f.address, f.country_code,
       ROUND(f.latitude::numeric, 3) AS lat, ROUND(f.longitude::numeric, 3) AS lng,
       f.created_by_source,
       (SELECT COUNT(*) FROM dishes d WHERE d.restaurant_id = f.id) AS dishes,
       (SELECT COUNT(*) FROM dish_media m JOIN dishes d ON d.id = m.dish_id
         WHERE d.restaurant_id = f.id) AS media
FROM repairable f
ORDER BY media DESC, f.google_place_id
LIMIT %s
"""

# --- 修復案 A: 消す ----------------------------------------------------------
# 子から親へ。ユーザーの痕跡がある店は除く（`safe` CTE）。
# ⚠️ PostgreSQL の WITH は **1 文にしか掛からない**ので、4 文それぞれに CTE を付ける。
#    1 文にまとめようとして `WITH ...; DELETE ...;` と書くと 2 文目が構文エラーになる。
# ⚠️ dish_media_likes / dish_reviews / restaurant_bids / payouts は ON DELETE NO ACTION
#    なので、痕跡が残っている店を消そうとすると FK で落ちる。**落ちるから除くのではなく、
#    ユーザーが触ったものをバッチで消さないために除く。**
SAFE_CTE = FOREIGN_RESTAURANTS_CTE.rstrip() + """
, safe AS (
  SELECT p.id FROM repairable p
  WHERE NOT EXISTS (SELECT 1 FROM restaurant_bids b WHERE b.restaurant_id = p.id)
    AND NOT EXISTS (
      SELECT 1 FROM dishes d
      WHERE d.restaurant_id = p.id
        AND (EXISTS (SELECT 1 FROM dish_reviews v WHERE v.dish_id = d.id)
             OR EXISTS (
               SELECT 1 FROM dish_media m
               WHERE m.dish_id = d.id
                 AND (EXISTS (SELECT 1 FROM dish_media_likes l WHERE l.dish_media_id = m.id)
                      OR EXISTS (SELECT 1 FROM payouts y WHERE y.dish_media_id = m.id))))
    )
)
"""

REPAIR_DELETE_STATEMENTS = [
    SAFE_CTE + """
-- 1. 埋め込みの実体
DELETE FROM dish_media_external_embeddings e
 USING dishes d, safe s
 WHERE e.dish_id = d.id AND d.restaurant_id = s.id
""",
    SAFE_CTE + """
-- 2. 器
DELETE FROM dish_media m
 USING dishes d, safe s
 WHERE m.dish_id = d.id AND d.restaurant_id = s.id
""",
    SAFE_CTE + """
-- 3. 料理
DELETE FROM dishes d USING safe s WHERE d.restaurant_id = s.id
""",
    SAFE_CTE + """
-- 4. 店
DELETE FROM restaurants r USING safe s WHERE r.id = s.id
""",
]

# 消せない（ユーザーの痕跡がある）店が何行あるか。案 A を選ぶと «残る» のはこの数。
SQL_UNSAFE_COUNT = SAFE_CTE + """
SELECT (SELECT COUNT(*) FROM repairable) AS repairable,
       (SELECT COUNT(*) FROM safe) AS safe_to_delete
"""

# --- 修復案 B: country_code を直す ---------------------------------------------
# 行は残し、«日本の店ではない» と分かる状態にする。座標から国コードを当てる。
# ⚠️ 当てられるのは矩形に入る行だけ。矩形の外は推測せず触らない
#    （文字だけで «海外» と分かった行は、どの国かまでは分からない）。
# ⚠️ 矩形の値を写経しない。common_sns.FOREIGN_TERRITORY_BOXES から組み立てる。

# 矩形のラベル → ISO-3166-1 alpha-2。ラベルは common_sns 側が正本。
_BOX_COUNTRY = {
    "韓国本土": "KR",
    "済州・楸子島": "KR",
    "鬱陵島": "KR",
    "ロシア沿海地方": "RU",
}


def _box_predicate(box) -> str:
    lat_lo, lat_hi, lng_lo, lng_hi, _ = box
    return (
        f"(r.latitude BETWEEN {lat_lo} AND {lat_hi}"
        f" AND r.longitude BETWEEN {lng_lo} AND {lng_hi})"
    )


def _country_case_sql() -> str:
    return "\n".join(
        f"         WHEN {_box_predicate(box)} THEN '{_BOX_COUNTRY[box[4]]}'  -- {box[4]}"
        for box in FOREIGN_TERRITORY_BOXES
    ) + "\n         ELSE r.country_code"


def _in_named_box_sql() -> str:
    return "\n     OR ".join(_box_predicate(box) for box in FOREIGN_TERRITORY_BOXES)

REPAIR_FIX_COUNTRY_STATEMENTS = [
    FOREIGN_RESTAURANTS_CTE.rstrip() + f"""
UPDATE restaurants r
   SET country_code = CASE
{_country_case_sql()}
       END
  FROM repairable p
 WHERE r.id = p.id
   AND ({_in_named_box_sql()})
""",
]

REPAIRS = {
    "delete": REPAIR_DELETE_STATEMENTS,
    "fix-country": REPAIR_FIX_COUNTRY_STATEMENTS,
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="海外の店として PG に入った行を数え、修復 SQL を表示します（既定は読み取りのみ）"
    )
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument(
        "--allow-public",
        action="store_true",
        help="public を **読む** ときに必要。--apply とは併用できない",
    )
    parser.add_argument("--limit", type=int, default=30, help="一覧に出す店の数")
    parser.add_argument(
        "--repair",
        choices=sorted(REPAIRS),
        default=None,
        help="表示する修復 SQL。省略すると両方を表示する",
    )
    parser.add_argument(
        "--counts-only",
        action="store_true",
        help="数だけを出し、修復 SQL を表示しない。SQL が長いので «何行あるか» "
        "だけを見たいとき（run ログを読むとき）に使う",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="修復 SQL を実際に流す。**dev 専用**で、--repair の指定が要る。"
        "指定しなければ 1 行も書き換えない（既定）",
    )
    return parser.parse_args(argv)


def assert_apply_is_allowed(args: argparse.Namespace) -> None:
    """`--apply` は dev 以外を受け付けない。

    argparse の choices と二重になっているのは意図的である。choices はコードを 1 行
    書き換えるだけで外れるが、この関数と `connect_postgres(allow_public=False)` は
    «public を書き換える» という結果そのものを止める（9_2_sync_sns_dish_media と同じ作法）。
    """
    if not args.apply:
        return
    if args.schema != "dev":
        raise ValueError(
            f"--apply は dev 専用です（指定: {args.schema!r}）。"
            "public はリリース手順でオーナーが別途扱います"
        )
    if args.allow_public:
        raise ValueError("--apply と --allow-public は併用できません")
    if args.repair is None:
        raise ValueError("--apply には --repair {delete,fix-country} の指定が要ります")


def fetch_one(connection, sql: str, params=None) -> dict:
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        keys = [column.name for column in cursor.description]
        return dict(zip(keys, cursor.fetchone()))


def main() -> None:
    configure_logging()
    args = parse_args()
    assert_apply_is_allowed(args)

    # --apply のときは allow_public=False で繋ぐ。public へは接続すらできない。
    connection = connect_postgres(
        args.schema, allow_public=(args.allow_public and not args.apply)
    )
    try:
        counts = fetch_one(connection, SQL_COUNTS)
        traces = fetch_one(connection, SQL_USER_TRACES)
        safety = fetch_one(connection, SQL_UNSAFE_COUNT)

        LOGGER.info("=== %s スキーマ ===", args.schema)
        LOGGER.info("restaurants 総数            : %d 行", counts["restaurants_total"])
        LOGGER.info(
            "  日本以外の店              : %d 行（%.2f%%）",
            counts["foreign_restaurants"],
            100.0 * counts["foreign_restaurants"] / counts["restaurants_total"]
            if counts["restaurants_total"]
            else 0.0,
        )
        LOGGER.info(
            "    パイプライン製（修復対象）: %d 行", counts["foreign_pipeline_restaurants"]
        )
        LOGGER.info(
            "    ユーザー製（正当・触らない）: %d 行", counts["foreign_user_restaurants"]
        )
        LOGGER.info("  --- 修復対象（パイプライン製）にぶら下がる行 ---")
        LOGGER.info("  dishes                    : %d 行", counts["foreign_dishes"])
        LOGGER.info(
            "  dish_media                : %d 行（うち external_embed %d 行）",
            counts["foreign_dish_media"],
            counts["foreign_dish_media_embed"],
        )
        LOGGER.info("  埋め込み実体              : %d 行", counts["foreign_embeddings"])
        LOGGER.info(
            "  （参考）ユーザー登録の海外店を含めると dishes %d 行 / dish_media %d 行。"
            "こちらは触らない",
            counts["all_foreign_dishes"],
            counts["all_foreign_dish_media"],
        )

        LOGGER.info("")
        LOGGER.info(
            "修復対象に付いたユーザーの痕跡（消す前に必ず見る）: "
            "いいね %d / レビュー %d / 入札 %d / payout %d",
            traces["likes"],
            traces["reviews"],
            traces["bids"],
            traces["payouts"],
        )
        LOGGER.info(
            "案 A（削除）で消せる店: %d / %d。差分の %d 店はユーザーの痕跡があるので残す",
            safety["safe_to_delete"],
            safety["repairable"],
            safety["repairable"] - safety["safe_to_delete"],
        )

        LOGGER.info("")
        LOGGER.info("--- 修復対象の店（media の多い順に %d 件）---", args.limit)
        with connection.cursor() as cursor:
            cursor.execute(SQL_SAMPLE, (args.limit,))
            for row in cursor.fetchall():
                LOGGER.info(
                    "  %-30s %-40.40s cc=%-4s (%s, %s) %-8s dishes=%d media=%d",
                    row[0], row[1], row[3] or "-", row[4], row[5], row[6], row[7], row[8],
                )

        if args.apply:
            LOGGER.warning("--apply: %s の修復を dev へ適用します", args.repair)
            with connection.cursor() as cursor:
                for statement in REPAIRS[args.repair]:
                    cursor.execute(statement)
                    LOGGER.warning("  %d 行に適用しました", cursor.rowcount)
            connection.commit()
            LOGGER.warning("適用してコミットしました（schema=%s）", args.schema)
            return

        if args.counts_only:
            LOGGER.info("")
            LOGGER.info("--counts-only のため修復 SQL は表示しません（1 行も書き換えていません）")
            return

        for name in ([args.repair] if args.repair else sorted(REPAIRS)):
            LOGGER.info("")
            LOGGER.info("=== 修復案 %s の SQL（表示するだけ。実行しません）===", name)
            for statement in REPAIRS[name]:
                for line in statement.splitlines():
                    LOGGER.info("  %s", line)
                LOGGER.info("  ;")
        LOGGER.info("")
        LOGGER.info(
            "1 行も書き換えていません。適用するなら "
            "--schema dev --repair <案> --apply（オーナーの承認後）"
        )
    finally:
        if not args.apply:
            connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
