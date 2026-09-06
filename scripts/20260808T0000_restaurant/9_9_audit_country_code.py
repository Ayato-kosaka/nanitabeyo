#!/usr/bin/env python3
"""`country_code` 列を足したとき、既存 57 万行を本当に全部埋められるかを数える。

## なぜ必要か

オーナーからの問い（2026-08-28）:
「country_code は必須カラムですよね？ミスらない保証は？既存のレストランも全部埋まる？」

**埋まらない行が 1 行でもあれば NOT NULL にはできない。** 推測ではなく数えて答える。

## 埋める根拠は行の出所で違う

| 行の種類 | 根拠 | 確からしさ |
|---|---|---|
| パイプライン製 | 日本の座標矩形で絞って作っている（`1_3_load_overture.py` の bbox） | 構造的に JP |
| アプリ製 | `address_components` の `country.shortText` | 値があれば確実 |

アプリ製は海外の店もありうる（ユーザーが旅行先で登録する）ので、
**一律 'JP' で埋めてはいけない**。ここを 1 行ずつ数える。

## ⚠️ «埋まるか» と «合っているか» は別（2026-09-05 追記）

このスクリプトは元々「**全行埋められるか**」（NOT NULL にできるか）を数えるものだった。
埋まることは確かめたが、**埋めた値が合っているかは誰も確かめていなかった**。

`country_code` はパイプライン側では **緯度経度の矩形だけ**で決まる
（`3_4_build_restaurant_catalog.py`）。矩形は国境ではないので、朝鮮半島もウラジオストクも
«JP» になる。実際に #1666 の標本へ韓国の店が混ざっていた。末尾に «日本の陸地が無い矩形に
JP の行がいくつあるか» を足した。

## 何をしないか

**1行も書き換えない。** SELECT だけ。
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pg_sync_common import connect_postgres  # noqa: E402
from pipeline_common import configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

# address_components から country の shortText を取り出す。
# jsonb の NOT NULL は配列であることを保証しないので、型を確かめてから展開する。
COUNTRY_EXPR = """
  (SELECT elem->>'shortText'
     FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(address_components) = 'array'
            THEN address_components ELSE '[]'::jsonb END) AS elem
    WHERE elem->'types' ? 'country'
    LIMIT 1)
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="country_code を全行埋められるかを数えます（読み取り専用）"
    )
    parser.add_argument("--schema", choices=["dev", "public"], required=True)
    parser.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()

    connection = connect_postgres(args.schema, allow_public=args.allow_public)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT
                  COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE created_by_source = 'pipeline') AS pipeline_rows,
                  COUNT(*) FILTER (WHERE created_by_source <> 'pipeline') AS app_rows,
                  COUNT(*) FILTER (
                    WHERE created_by_source <> 'pipeline' AND {COUNTRY_EXPR} IS NOT NULL
                  ) AS app_rows_resolvable,
                  COUNT(*) FILTER (
                    WHERE created_by_source <> 'pipeline' AND {COUNTRY_EXPR} IS NULL
                  ) AS app_rows_unresolvable
                FROM restaurants
                """
            )
            total, pipeline_rows, app_rows, ok, ng = cursor.fetchone()
            LOGGER.info("restaurants 総数: %d行", total)
            LOGGER.info("  パイプライン製: %d行 → 日本の座標矩形で作っているので JP", pipeline_rows)
            LOGGER.info("  アプリ製      : %d行", app_rows)
            LOGGER.info("    国が引ける  : %d行", ok)
            LOGGER.info("    国が引けない: %d行  ← ここが 0 でないと NOT NULL にできない", ng)

            # アプリ製の国の内訳。'JP' 以外があるなら «一律 JP» は誤りだと分かる。
            cursor.execute(
                f"""
                SELECT {COUNTRY_EXPR} AS cc, COUNT(*)
                FROM restaurants
                WHERE created_by_source <> 'pipeline'
                GROUP BY 1 ORDER BY 2 DESC LIMIT 20
                """
            )
            LOGGER.info("アプリ製の国の内訳:")
            for cc, count in cursor.fetchall():
                LOGGER.info("  %-6s %d行", cc if cc else "(引けない)", count)

            # 形式が ISO-3166-1 alpha-2 になっているか（CHECK 制約を張れるか）
            cursor.execute(
                f"""
                SELECT COUNT(*) FROM restaurants
                WHERE created_by_source <> 'pipeline'
                  AND {COUNTRY_EXPR} IS NOT NULL
                  AND {COUNTRY_EXPR} !~ '^[A-Z]{{2}}$'
                """
            )
            LOGGER.info(
                "2文字の大文字になっていない値: %d行  ← CHECK 制約を張れるかの判定",
                cursor.fetchone()[0],
            )

            # パイプライン製が矩形に収まっているか。
            #
            # ⚠️ **この検査は «JP と断言してよいか» を判定できない。** 判定に使う矩形が、
            #    3_4_build_restaurant_catalog.py が JP を割り当てるのに使った矩形と同じもので、
            #    **規則を規則自身で確かめている**（必ず 0 になる）。残してあるのは
            #    «矩形の外の行が混ざっていないか» という別の意味の番人としてだけである。
            #    実際に国が合っているかは、次の「矩形の外」検査で見ること。
            cursor.execute(
                """
                SELECT COUNT(*) FROM restaurants
                WHERE created_by_source = 'pipeline'
                  AND NOT (latitude BETWEEN 20 AND 46 AND longitude BETWEEN 122 AND 154)
                """
            )
            LOGGER.info(
                "パイプライン製で矩形の外にある行: %d行  ← 規則の自己確認（必ず 0。国の正しさは測れない）",
                cursor.fetchone()[0],
            )

            # ── ここからが «国が本当に合っているか» ───────────────────────────
            #
            # ⚠️ #1881 で直した。`country_code` は **住所から**決める
            # （`country_resolution.py` の `RULES` が唯一の正本）。
            # それ以前は 3_4_build_restaurant_catalog.py が **緯度経度の矩形**
            # （lat 20.0-46.5 / lon 122.0-154.0）だけで決めており、矩形は国境ではないので
            # **朝鮮半島もウラジオストクも黄海もまるごと «JP» になっていた**。
            #
            # ⚠️ **この監査は判定の規則を import しない。** 下の矩形は «日本の陸地が
            #    1 つも無いと言い切れる範囲» という **別の根拠**であり、規則と同じもので
            #    確かめると #1881 の «作った規則で検証していた» に戻る。
            #
            # #1666 の標本 300 件（dev / seed 1666 / country=JP）に、実際に韓国の店が
            # 混ざっていた（run 33989897700 で座標まで確認）:
            #   파리바게뜨       (37.351, 126.742) 仁川
            #   골뱅이가 따문 조개 (35.221, 128.684) 昌原
            #   식육 삼덕본점     (35.867, 128.602) 大邱
            #
            # ⚠️ **これは «日本でない行» の下限しか出せない。** 正確に測るには国境の
            #    ポリゴンが要る。ここでは «日本の陸地が 1 つも無いと言い切れる矩形» だけを
            #    数える。日本の領土の端は次のとおり（この矩形はそれらを避けてある）:
            #      西端 与那国島 (24.45, 122.93) / 南端 沖ノ鳥島 (20.42, 136.08)
            #      北端 弁天島   (45.52, 141.94) / 東端 南鳥島   (24.28, 153.98)
            #      対馬 (34.1-34.7, 129.17-129.48) / 五島 福江島 (32.7, 128.8)
            #    そのため、たとえば釜山 (35.18, 129.08) は対馬を避けた結果ここに入らない。
            #    **出る数字は «少なくともこれだけは間違っている» である。**
            OUTSIDE_JAPAN_BOXES = [
                ("朝鮮半島", 34.0, 43.0, 124.0, 129.0),
                ("ロシア沿海地方・日本海西側", 42.0, 46.5, 130.0, 139.0),
                ("黄海・中国沿岸", 30.0, 41.0, 122.0, 124.0),
            ]
            LOGGER.info("country_code='JP' なのに日本の陸地が無い矩形にある行（下限）:")
            subtotal = 0
            for label, lat_min, lat_max, lon_min, lon_max in OUTSIDE_JAPAN_BOXES:
                cursor.execute(
                    """
                    SELECT COUNT(*) FROM restaurants
                    WHERE country_code = 'JP'
                      AND latitude BETWEEN %s AND %s
                      AND longitude BETWEEN %s AND %s
                    """,
                    (lat_min, lat_max, lon_min, lon_max),
                )
                count = cursor.fetchone()[0]
                subtotal += count
                LOGGER.info("  %-26s %d行", label, count)
            LOGGER.info("  合計（下限）             %d行", subtotal)

            # 例を出す。数字だけだと «本当に日本でないのか» を人が確かめられない。
            cursor.execute(
                """
                SELECT name, latitude, longitude
                FROM restaurants
                WHERE country_code = 'JP'
                  AND latitude BETWEEN 34.0 AND 43.0
                  AND longitude BETWEEN 124.0 AND 129.0
                ORDER BY id
                LIMIT 10
                """
            )
            for name, lat, lon in cursor.fetchall():
                LOGGER.info("    例: (%.3f, %.3f) %s", lat, lon, name)
    finally:
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    main()
