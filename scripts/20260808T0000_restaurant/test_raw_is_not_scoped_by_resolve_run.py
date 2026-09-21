"""#1947 «投稿の素性（raw）を resolve の run_id で絞る» を二度と書かないための固定。

## 欠陥をパターンで 1 文にすると

**«投稿の素性（`sns_post_raw`）を引くのに、resolve 側の run_id を使っていた。
両者が同じ run_id になるのは運用上の偶然でしかなく、分けた途端に素性が引けなくなる。»**

2026-09-21、resolve を `--raw-run-id ALL` で回すために run_id を `resolve-2026-09-20-*`
へ改名した。収集の run_id（`sns-2026-09-20-*`）と別名になった瞬間、その日に resolve した
**331,147 行が seed（`discovery_seed_place_id`）を 1 つも引けなくなった**。
症状は «15 時間収集したのに配信店が +36 しか増えない» で、収集側は正常に動いていた。

実測（`9_1` が実際に投げる SQL をそのまま A/B。A は当時の cat12 を行単位で再現）:

| | A（当時） | B（raw の絞りを外す） |
| --- | ---: | ---: |
| 配信行 | 644,591 | **855,028**（+210,437） |
| 配信店 | 69,442 | **74,583**（+5,141） |
| A にあって B に無い投稿 | — | **0**（何も失わない） |
| 店が変わる投稿 | — | 5,717。**全件 «弱い根拠 → 強い根拠»**（rank 4→1 が 5,677） |

## 固定するもの

1. 共通判定（`post_store_cte_sql`）に **raw を run で絞る引数を持たせない**
   （持たせられると、また «resolve の run_id» が渡される）
2. 欠陥の «形» そのものを、この directory の全 script から締め出す
3. 掃いた箇所の判定表を残す（«当てはまらない» の理由を消さない）
"""

from __future__ import annotations

import inspect
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common_sns  # noqa: E402


# --- 掃いた箇所の判定表 ---------------------------------------------------------
#
# ⚠️ **この表を空にしない。** 消すと、次に同じ調査をする人が «7_3 は直さなくてよいのか» を
#    もう一度 BigQuery に聞くことになる。
SWEPT_SITES: tuple[tuple[str, str, bool, str], ...] = (
    ("common_sns.py", "post_store_cte_sql の seed 候補", True,
     "resolve の run_id で seed を絞っていた。引数ごと廃止した"),
    ("9_1_build_sns_dish_media_catalog.py", "配信 SQL の post_store", True,
     "同上（runs_param='srcs'）。srcs は resolve の run_id"),
    ("9_1_build_sns_dish_media_catalog.py", "配信 SQL の canonical_url 結合", True,
     "«raw の結合に run_id 条件を付けない» とコメントに書きながら付けていた"),
    ("9_1_build_sns_dish_media_catalog.py", "dropped_sql の post_store / seeded", True,
     "落とした理由の内訳も同じ絞りで数えており、内訳まで嘘になっていた"),
    ("7_1_build_coverage.py", "計上 SQL の post_store と raw 結合", True,
     "**KPI 計上側も同じ欠陥**。配った店を数え落としていた"),
    ("4_7_collect_search_api_posts.py", "狙うセルを決める usable", True,
     "`r.run_id = v.run_id` という別の形。同じ前提なので当てはまる"),
    ("7_3_report_coverage_ceiling.py", "pair CTE の raw 結合", False,
     "**当てはまらない。** 既に run 条件なしで結合している（直す所が無い）"),
    ("5_1_apply_resolve.py", "未 resolve 投稿の取り出し", False,
     "**当てはまらない。** `@raw_rid` と `@resolve_rid` を別の引数で持っている"),
    ("7_2_report_funnel.py", "run ごとの内訳", False,
     "**当てはまらない。** «1 run の内訳» を出す道具で、run を跨ぐと意味が壊れる"),
)

# 欠陥の «形»。ここに挙げた文字列が production の script に出てきたら赤にする。
FORBIDDEN_SHAPES: tuple[tuple[str, str], ...] = (
    ("r.run_id IN UNNEST(@srcs)", "@srcs は resolve の run_id。raw を絞ってはいけない"),
    ("r.run_id IN UNNEST(@resolved_rids)", "@resolved_rids も同じく resolve の run_id"),
    ("r.run_id = v.run_id", "raw と resolved の run_id が一致する前提を置いてはいけない"),
)


def _production_sources() -> list[tuple[str, str]]:
    out = []
    for path in sorted(HERE.glob("*.py")):
        if path.name.startswith("test_") or path.name == "conftest.py":
            continue
        out.append((path.name, path.read_text(encoding="utf-8")))
    return out


class SharedRuleCannotScopeRawByRunTest(unittest.TestCase):
    """共通判定に «raw を run で絞る» 引数を戻さない。"""

    def test_runs_param_argument_is_gone(self) -> None:
        params = inspect.signature(common_sns.post_store_cte_sql).parameters
        self.assertNotIn("runs_param", params,
                         "raw を run で絞る引数を置くと、また resolve の run_id が渡される")

    def test_passing_runs_param_is_an_error(self) -> None:
        with self.assertRaises(TypeError):
            common_sns.post_store_cte_sql(  # type: ignore[call-arg]
                "proj.ds.sns_post_raw", latest_cte="v", runs_param="srcs")

    def test_generated_sql_has_no_run_filter_on_raw(self) -> None:
        sql = common_sns.post_store_cte_sql("proj.ds.sns_post_raw", latest_cte="v")
        code = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
        self.assertNotIn("run_id", code,
                         "seed 側は run をひとつも見ない（raw は run のスナップショットではない）")

    def test_seed_identity_is_still_counted_across_all_runs(self) -> None:
        """#1846 の «共有度は全 run で測る» を巻き添えで壊していないこと。"""
        sql = common_sns.post_store_cte_sql("proj.ds.sns_post_raw", latest_cte="v")
        head = sql[sql.index("seed_identity AS ("):sql.index("identity_place_count")]
        self.assertNotIn("run_id", head)

    def test_seed_still_beats_resolve(self) -> None:
        """A/B で店が変わった 5,717 件は «弱い根拠 → 強い根拠» だった。その順位を保つ。"""
        sql = common_sns.post_store_cte_sql("proj.ds.sns_post_raw", latest_cte="v")
        self.assertGreater(common_sns.RESOLVED_STORE_RANK, 3)
        self.assertIn("MIN(c.store_rank) OVER (PARTITION BY c.post_id)", sql)


class ForbiddenShapeIsAbsentEverywhereTest(unittest.TestCase):
    """1 箇所ではなく «この形» を directory 全体から締め出す（水平展開）。"""

    def test_no_script_scopes_raw_by_a_resolve_run(self) -> None:
        hits = []
        for name, src in _production_sources():
            code = "\n".join(l for l in src.splitlines()
                             if not l.lstrip().startswith(("#", "--")))
            for shape, why in FORBIDDEN_SHAPES:
                if shape in code:
                    hits.append(f"{name}: {shape!r} — {why}")
        self.assertEqual([], hits, "\n".join(hits))

    def test_delivery_and_counting_read_raw_without_a_run_condition(self) -> None:
        """配る側（9_1）と数える側（7_1）が同じ範囲の raw を読むこと。"""
        for name in ("9_1_build_sns_dish_media_catalog.py", "7_1_build_coverage.py"):
            src = (HERE / name).read_text(encoding="utf-8")
            joins = re.findall(r"JOIN `\{pipeline\.table\(TABLE_POST_RAW\)\}` r\s*\n\s*ON ([^\n]+)",
                               src)
            self.assertTrue(joins, f"{name}: raw の結合が見つからない（形が変わった？）")
            for cond in joins:
                self.assertNotIn("run_id", cond, f"{name}: raw の結合に run 条件が戻っている")

    def test_run_params_are_only_applied_to_the_resolved_table(self) -> None:
        """`@srcs` / `@resolved_rids` は resolved にだけ当てる。"""
        for name, param in (("9_1_build_sns_dish_media_catalog.py", "@srcs"),
                            ("7_1_build_coverage.py", "@resolved_rids")):
            src = (HERE / name).read_text(encoding="utf-8")
            code = "\n".join(l for l in src.splitlines()
                             if not l.lstrip().startswith(("#", "--")))
            for line in code.splitlines():
                if param in line:
                    self.assertNotIn("r.run_id", line,
                                     f"{name}: {param} を raw へ当てている: {line.strip()}")


class SweptSitesAreRecordedTest(unittest.TestCase):
    """«当てはまらない» の理由を消さない（消すと次の人がまた同じ調査をする）。"""

    def test_table_is_not_emptied(self) -> None:
        self.assertGreaterEqual(len(SWEPT_SITES), 9)
        self.assertTrue(any(applies for _, _, applies, _ in SWEPT_SITES))
        self.assertTrue(any(not applies for _, _, applies, _ in SWEPT_SITES))

    def test_every_swept_script_exists(self) -> None:
        for name, _, _, _ in SWEPT_SITES:
            self.assertTrue((HERE / name).exists(), f"{name} が無い（改名したら表も直す）")

    def test_every_entry_has_a_reason(self) -> None:
        for name, where, _, why in SWEPT_SITES:
            self.assertTrue(why.strip(), f"{name} / {where} に理由が無い")


if __name__ == "__main__":
    unittest.main()
