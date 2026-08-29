#!/usr/bin/env python3
"""生死判定の対照実験（3_5）の入力 CSV を作る（読み取り専用）。

閉店群と対照群を **同数** 取り出す。対照群を置くのが要点で、
閉店群だけ見て «404 が 3 割» と言っても、営業中でも 3 割なら何も分かっていない。

## 閉店群の作り方

IFAS（食品衛生の台帳）は `closed_on` / `is_active=FALSE` を持つ唯一の源である。
ただし `2_1` が `WHERE ... AND is_active` で取り込み時に捨てているため、
catalog には 1 件も届いていない。ここでは生データから直接引く。

突き合わせは **名前一致（NFKC 正規化・空白除去）＋ 座標 50m 以内**。
座標だけだと 1 レコードが約 5.5 店へ広がって使い物にならない（実測）。
名前を足すと 265 レコード → 265 ペアの 1:1 になる。

## 対照群の作り方

同じ catalog から無作為抽出する。ただし **閉店群と同じ地域分布**にはしない。
そこまで揃えると «閉店群と対照群の違い» が地域差で薄まるより先に、
標本が偏って 260 件を確保できない。単純無作為で始め、差が微妙なら層化を検討する。
"""

from __future__ import annotations

import argparse
import csv
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline_common import BigQueryPipeline, configure_logging  # noqa: E402

LOGGER = logging.getLogger(__name__)

CLOSED_SQL = """
WITH latest AS (
  SELECT run_id FROM `{ds}.restaurant_catalog`
  GROUP BY run_id ORDER BY MAX(built_at) DESC LIMIT 1
),
cat AS (
  SELECT c.google_place_id,
         REGEXP_REPLACE(NORMALIZE(c.name, NFKC), r'[\\s　]', '') AS nname,
         c.location
  FROM `{ds}.restaurant_catalog` c JOIN latest USING (run_id)
  WHERE c.location IS NOT NULL
),
closed AS (
  SELECT REGEXP_REPLACE(NORMALIZE(name, NFKC), r'[\\s　]', '') AS nname,
         ST_GEOGPOINT(longitude, latitude) AS loc
  FROM `{ds}.restaurant_ifas_raw`
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 120 DAY)
    AND (is_active = FALSE OR closed_on IS NOT NULL)
    AND latitude IS NOT NULL AND longitude IS NOT NULL
)
SELECT DISTINCT cat.google_place_id
FROM closed JOIN cat
  ON closed.nname = cat.nname AND ST_DWithin(closed.loc, cat.location, 50)
"""

CONTROL_SQL = """
WITH latest AS (
  SELECT run_id FROM `{ds}.restaurant_catalog`
  GROUP BY run_id ORDER BY MAX(built_at) DESC LIMIT 1
)
SELECT c.google_place_id
FROM `{ds}.restaurant_catalog` c JOIN latest USING (run_id)
WHERE c.google_place_id NOT IN UNNEST(@exclude)
ORDER BY FARM_FINGERPRINT(CONCAT(c.google_place_id, 'liveness-control'))
LIMIT @n
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生死判定の対照実験の入力を作ります")
    parser.add_argument("--output", default="/tmp/liveness_probe_input.csv")
    return parser.parse_args()


def build_rows() -> list[tuple[str, str]]:
    """(place_id, label) の一覧を BigQuery から組み立てる。

    3_5_probe_place_id_liveness.py からも呼ぶ。db-script-run.yml は
    1 job = 1 script なので、別 job で書いた /tmp のファイルは引き継げない。
    """

    from google.cloud import bigquery

    pipeline = BigQueryPipeline()
    ds = pipeline.dataset_ref

    closed = [r.google_place_id for r in pipeline.execute(CLOSED_SQL.format(ds=ds))]
    LOGGER.info("閉店群: %d件（IFAS 由来、名前一致＋50m）", len(closed))
    if not closed:
        raise SystemExit("閉店群が 0 件です。突き合わせ条件を見直してください")

    control = [
        r.google_place_id
        for r in pipeline.execute(
            CONTROL_SQL.format(ds=ds),
            [
                bigquery.ArrayQueryParameter("exclude", "STRING", closed),
                bigquery.ScalarQueryParameter("n", "INT64", len(closed)),
            ],
        )
    ]
    LOGGER.info("対照群: %d件（無作為抽出、閉店群を除外）", len(control))
    return [(pid, "closed") for pid in closed] + [(pid, "control") for pid in control]


def main() -> None:
    configure_logging()
    args = parse_args()
    rows = build_rows()
    closed = [pid for pid, label in rows if label == "closed"]
    control = [pid for pid, label in rows if label == "control"]

    with open(args.output, "w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=["place_id", "label"])
        writer.writeheader()
        for pid in closed:
            writer.writerow({"place_id": pid, "label": "closed"})
        for pid in control:
            writer.writerow({"place_id": pid, "label": "control"})
    LOGGER.info("書き出しました: %s（計 %d件）", args.output, len(closed) + len(control))


if __name__ == "__main__":
    main()
