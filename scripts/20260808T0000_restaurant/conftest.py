"""#1815 BigQuery クライアントの軽量スタブを **1 箇所** で用意する。

パイプラインのスクリプトは import 時に `from google.cloud import bigquery` する。
SQL 文字列だけを見るテストではライブラリ本体も資格情報も要らないので、import を
通すためだけのスタブを差し込む。

⚠️ **このスタブを各テストへ写経しないこと。** 実際に事故が起きた: 6 本のテストが
同じスタブを各自で持ち、`if "google.cloud.bigquery" not in sys.modules` で «先に
入れた者勝ち» になっていた。5 本は 6 属性、`test_4_19_rank_account_candidates` だけ
`SchemaField` / `Table` を足した 8 属性に育っていたため、**単体では両方通るのに
同時に走らせると落ちる**（属性の少ない方が先に入ると
`module 'google.cloud.bigquery' has no attribute 'SchemaField'`）。
テストの実行順に依存する緑は、緑ではない。

conftest.py は収集より前に 1 度だけ読まれるので、ここに置けば «先に入れた者勝ち»
そのものが無くなる。属性を足す必要が出たら **このファイルだけ**を直す。
"""

from __future__ import annotations

import sys
import types

_BQ_ATTRS = (
    "Client", "ScalarQueryParameter", "ArrayQueryParameter", "QueryJobConfig",
    "LoadJobConfig", "ParquetOptions", "SchemaField", "Table",
)


def _install_bigquery_stub() -> None:
    try:  # 本物が入っている環境では触らない
        import google.cloud.bigquery  # noqa: F401
        return
    except Exception:
        pass
    bq = types.ModuleType("google.cloud.bigquery")
    for name in _BQ_ATTRS:
        setattr(bq, name, type(name, (), {}))
    bq.WriteDisposition = types.SimpleNamespace(WRITE_APPEND="WRITE_APPEND")
    bq.SourceFormat = types.SimpleNamespace(
        NEWLINE_DELIMITED_JSON="NDJSON", PARQUET="PARQUET")
    google = sys.modules.setdefault("google", types.ModuleType("google"))
    cloud = sys.modules.setdefault("google.cloud", types.ModuleType("google.cloud"))
    setattr(google, "cloud", cloud)
    setattr(cloud, "bigquery", bq)
    sys.modules["google.cloud.bigquery"] = bq


_install_bigquery_stub()
