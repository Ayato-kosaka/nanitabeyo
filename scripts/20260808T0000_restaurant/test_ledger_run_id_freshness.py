"""#1947 «台帳の run_id を貼り忘れたら黙って古いスナップショットで走る» を復活させない。

## 何が起きたか

作り直される台帳（`sns_coverage` / `sns_dish_media_catalog` / `sns_post_resolved`）を
読む側が run_id を **手渡しでしか受け取れない**設計になっており、呼び出し側が古い値を
貼り続けても誰も気づけなかった。同じ形が 3 箇所にあった。

1. `4_2 --priority-coverage-run-id`: 省略時は «並べ替えなし» だったため呼び出し側が毎回
   run_id を貼る必要があり、収集ラウンド 6〜10 が `sns-2026-09-04-cov11`（20 run 分・
   6 日前）のまま走った。そのあいだ台帳は cov18（41 run 分）まで進んでおり、
   **既に埋まったセルを «惜しいセル» として優先し続けていた**。
2. `7_3 --coverage-run-id`: 既定値が文字列リテラル `"cov15"`。引数を省くと 4 世代前の
   カバレッジで上限を報告する。
3. `7_1 / 9_1 --resolved-run-ids`: «全 run の union» を呼び出し側の手書きリストに頼って
   いたため、run を足した人が貼り忘れた分が黙って落ちる。

## 何を固定するか

**個別の run_id ではなく «形» を固定する。** 値（cov18 / 49 本）は明日には古くなるので、
テストに書くと意味が無い。

- 作り直される台帳を読む run_id 引数が、**既定値に run_id のリテラルを持たないこと**。
  持ってよいのは `restaurant_catalog` だけ（#1947 の決定的 313 地点の物差しとして
  `restaurant-2026-08-23` に固定してあり、動かすと過去の実測と比較できなくなる）。
- `resolve_run_ids` が `all` を «その台帳に在る run を全部» と解釈すること。
- `latest_run_id` が表ごとに «最新» の定義を持ち、未知の表では黙って間違えず落ちること。

## 実データで «当てはまる / 当てはまらない» を判定した記録（2026-09-17）

| 箇所 | 判定 | 根拠 |
| --- | --- | --- |
| `4_2 --priority-coverage-run-id` | 当てはまる | 台帳は cov18 まで進んでいたのに cov11 で 5 ラウンド走っていた |
| `7_3 --coverage-run-id="cov15"` | 当てはまる | cov15 は 4 世代前。引数を省くとそこを読む |
| `7_1 / 9_1 --resolved-run-ids` | 当てはまる | `sns_post_resolved` に 49 run 在るが cov18 は 41 run 分で止まっていた |
| `4_10 --site-run-id="sns-2026-09-04-sitecrawl"` | 当てはまる | `sns_store_site_ig` の 7 run のうち 5 run（25,696 行）が後から入っており、scan が見ていなかった |
| `4_12 --hosts-from-run-ids=""` | **当てはまらない** | 既定は «host を数えない»。run_id を 1 つも指さないので古くならない |
| `--catalog-run-id="restaurant-2026-08-23"`（4_11 / 4_12 / 4_18 / 4_21 / 4_9 / 6_1 / 7_3 / 9_9） | **当てはまらない** | `restaurant_catalog` は #1947 の決定的 313 地点の物差しとして意図的に固定。動かすと過去の実測と比較できない |
"""

from __future__ import annotations

import ast
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common_sns  # noqa: E402  (conftest が bigquery スタブを入れた後に読む)

# 作り直される台帳。ここを読む引数は «省略時は最新» でなければならない。
REBUILT_LEDGERS = (
    common_sns.TABLE_COVERAGE,
    common_sns.TABLE_DISH_MEDIA_CATALOG,
    common_sns.TABLE_POST_RESOLVED,
)
# 固定してよい台帳と、その理由。増やすときは理由を書くこと。
PINNED_LEDGERS = {
    common_sns.TABLE_RESTAURANT_CATALOG:
        "#1947 の決定的 313 地点の物差し。動かすと過去の実測と比較できない",
}


class StubPipeline:
    """`execute` と `table` だけを持つ最小のパイプライン。"""

    def __init__(self, rows):
        self.rows = rows
        self.queries: list[str] = []

    def table(self, name: str) -> str:
        return f"proj.ds.{name}"

    def execute(self, sql: str, params=None):
        self.queries.append(sql)
        return list(self.rows)


class ResolveRunIdsTest(unittest.TestCase):
    def test_all_reads_every_run_in_the_ledger(self):
        """`all` は台帳に在る run を全部返す（手書きリストを不要にする本体）。"""
        pipe = StubPipeline([{"run_id": "a"}, {"run_id": "b"}, {"run_id": "c"}])
        got = common_sns.resolve_run_ids(pipe, common_sns.TABLE_POST_RESOLVED, "all")
        self.assertEqual(got, ["a", "b", "c"])
        self.assertIn("SELECT DISTINCT run_id", pipe.queries[0])
        self.assertIn(common_sns.TABLE_POST_RESOLVED, pipe.queries[0])

    def test_all_is_case_insensitive_and_tolerates_spaces(self):
        pipe = StubPipeline([{"run_id": "a"}])
        self.assertEqual(
            common_sns.resolve_run_ids(pipe, common_sns.TABLE_POST_RESOLVED, " ALL "), ["a"])

    def test_explicit_list_keeps_order_and_does_not_query(self):
        pipe = StubPipeline([{"run_id": "zzz"}])
        got = common_sns.resolve_run_ids(pipe, common_sns.TABLE_POST_RESOLVED, "b, a ,c")
        self.assertEqual(got, ["b", "a", "c"])
        self.assertEqual(pipe.queries, [])

    def test_empty_falls_back_to_the_single_run(self):
        pipe = StubPipeline([])
        self.assertEqual(
            common_sns.resolve_run_ids(
                pipe, common_sns.TABLE_POST_RESOLVED, None, fallback="only-one"),
            ["only-one"])
        self.assertEqual(pipe.queries, [])


class LatestRunIdTest(unittest.TestCase):
    def test_each_rebuilt_ledger_knows_what_latest_means(self):
        """台帳ごとに «最新» の列は違う。既定を持たない台帳を作らない。"""
        for table in REBUILT_LEDGERS:
            self.assertIn(table, common_sns.LATEST_RUN_ID_ORDER, table)

    def test_restaurant_catalog_is_picked_by_row_count_not_time(self):
        """作りかけの run が «最新» になると店が消えるので、件数で選ぶ。"""
        self.assertEqual(
            common_sns.LATEST_RUN_ID_ORDER[common_sns.TABLE_RESTAURANT_CATALOG], "COUNT(*)")

    def test_unknown_table_fails_loudly(self):
        pipe = StubPipeline([{"run_id": "a"}])
        with self.assertRaises(RuntimeError):
            common_sns.latest_run_id(pipe, "sns_table_that_has_no_rule")

    def test_empty_ledger_fails_loudly(self):
        pipe = StubPipeline([])
        with self.assertRaises(RuntimeError):
            common_sns.latest_run_id(pipe, common_sns.TABLE_COVERAGE)


def _literal_default_run_id_args(path: Path) -> list[tuple[str, str]]:
    """`add_argument("--...run-id(s)", default="<文字列>")` を拾う。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: list[tuple[str, str]] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "add_argument" and node.args):
            continue
        first = node.args[0]
        if not (isinstance(first, ast.Constant) and isinstance(first.value, str)):
            continue
        name = first.value
        if not name.startswith("--") or "run-id" not in name:
            continue
        for kw in node.keywords:
            if kw.arg != "default":
                continue
            if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                found.append((name, kw.value.value))
    return found


class NoStaleLiteralDefaultsTest(unittest.TestCase):
    """作り直される台帳の run_id を、既定値のリテラルで固定していないこと。

    ⚠️ これは «7_3 の cov15 を直した» を固定するテストではない。**その形を他所へ書けない**
    ようにするテストである。1 箇所だけ直して残りを放置したのが #1947 の反省点なので、
    判定はスクリプト全体に対して行う。
    """

    def test_no_script_pins_a_rebuilt_ledger_run_id_as_a_default(self):
        offenders: list[str] = []
        for path in sorted(HERE.glob("[0-9]*.py")):
            for name, default in _literal_default_run_id_args(path):
                # restaurant_catalog を指す引数は固定してよい（PINNED_LEDGERS の理由）。
                if default.startswith("restaurant-"):
                    continue
                # 空文字は «run_id を 1 つも指していない» ので古くならない。
                # 実データで判定した «当てはまらない» 例: `4_12 --hosts-from-run-ids=""`。
                # 既定は «host を数えない» であって «この run を数える» ではないため、
                # 台帳が進んでも挙動が古くなることが無い（2026-09-17 確認）。
                if default.strip() in ("", "all"):
                    continue
                offenders.append(f"{path.name}: {name} = {default!r}")
        self.assertEqual(
            offenders, [],
            "作り直される台帳の run_id を既定値で固定している。省略時は最新を引くこと"
            f"（common_sns.latest_run_id）。固定してよいのは {sorted(PINNED_LEDGERS)} だけ:\n"
            + "\n".join(offenders))


if __name__ == "__main__":
    unittest.main()
