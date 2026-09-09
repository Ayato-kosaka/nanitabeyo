#!/usr/bin/env python3
"""#1881 オープンデータを **どこまで取り込むか** の矩形。**ここが唯一の定義である。**

## ⚠️ これは «国» ではない。«探索範囲» である

この矩形（20.0〜46.5N / 122.0〜154.0E）は同じ数字が **7 箇所へ写経**されており、
そのうち `3_4_build_restaurant_catalog.py` が **国コードの判定に使い回していた**。
矩形は国境ではないので、朝鮮半島もウラジオストクも丸ごと `'JP'` になり、
dev の 98,139 行が «日本にない JP» になった（#1881）。

国コードは `country_resolution.py` が **住所から**決める。**この矩形を国の判定へ
二度と使わないこと。** そのために、名前から「日本」を外してある。

## 何に使ってよいか

- オープンデータの取り込みを絞る（`1_3_load_overture.py`）
- 取り込んだ行が範囲の外に出ていないかを検査する（`8_1_validate_catalogs.py` /
  `9_9_audit_review_findings.py`）— «座標か取り込み範囲が壊れている» の検知

## 何に使ってはいけないか

- **国コードを決めること**（#1881 そのもの）
- 「範囲の外だから海外」「範囲の中だから日本」と読むこと

## なぜ範囲を狭めないのか

オーナー確定（#1881）は **B（韓国の店は持っていてよい。国コードだけ正しく付ける）**
である。範囲を国境で絞ると 98,139 行を捨てることになり、それは A の選択肢だった。
"""

from __future__ import annotations

from typing import Any

# 取り込みの探索範囲。**国境ではない。**
MIN_LAT = 20.0
MAX_LAT = 46.5
MIN_LON = 122.0
MAX_LON = 154.0


def in_search_bounds(latitude: Any, longitude: Any) -> bool:
    """座標が取り込みの探索範囲に入っているか。**«日本にあるか» ではない。**"""
    if latitude is None or longitude is None:
        return False
    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError):
        return False
    return MIN_LAT <= latitude <= MAX_LAT and MIN_LON <= longitude <= MAX_LON


def search_bounds_sql(latitude_expr: str, longitude_expr: str) -> str:
    """「探索範囲の中」を表す SQL 式（BigQuery / DuckDB / PostgreSQL 共通の構文）。"""
    return (
        f"({latitude_expr} BETWEEN {MIN_LAT} AND {MAX_LAT}"
        f" AND {longitude_expr} BETWEEN {MIN_LON} AND {MAX_LON})"
    )


def outside_search_bounds_sql(latitude_expr: str, longitude_expr: str) -> str:
    """「探索範囲の外」を表す SQL 式。NULL 座標は «外» とは呼ばない（NULL のまま）。"""
    return (
        f"({latitude_expr} NOT BETWEEN {MIN_LAT} AND {MAX_LAT}"
        f" OR {longitude_expr} NOT BETWEEN {MIN_LON} AND {MAX_LON})"
    )
