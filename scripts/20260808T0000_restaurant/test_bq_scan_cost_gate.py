"""#1947 BigQuery のスキャン課金を «見えない» ままにしない回帰テスト。

2026-10-01、`5_1` の対象抽出クエリ（1 回 4.58 GiB）が 12 秒おきに 1 日 1,900 回走り、
2026-09 以降で約 40 TiB（≒$240）を使った。**run は全部緑で、8 日間気づかなかった。**

気づけなかった構造は 3 つあり、テストはその 3 つをパターンとして固定する。

1. **実行前に見積もらなかった** → dry run を門にする（dry run は課金ゼロ）
2. **読んだ量をどこにも出さなかった** → 1 本ごとにログ、run の合計を durable な記録へ
3. **費用が «仕事の量» ではなく «ループの回転数» に比例していた** → 問いかけを時間で間隔を空け、回数に上限
"""
import ast
import importlib.util
import pathlib
import sys
import types
import unittest

HERE = pathlib.Path(__file__).parent


def _load_pipeline_common():
    """`pipeline_common` を単体で読み込む（google-cloud-bigquery はこの環境に入っている）。

    ⚠️ `sys.modules` へ先に登録する。dataclass のデコレータが解決時に
    `sys.modules[cls.__module__]` を引くので、登録前に exec すると AttributeError になる。
    """
    name = "pipeline_common_for_test"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, HERE / "pipeline_common.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


PC = _load_pipeline_common()
PIPELINE_SRC = (HERE / "pipeline_common.py").read_text(encoding="utf-8")
RESOLVE_SRC = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")


def _select_again():
    """5_1 の純関数だけを取り出す（本番ロジックを写経しない）。"""
    tree = ast.parse(RESOLVE_SRC)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "select_again":
            ns: dict = {}
            exec(compile(ast.Module([node], []), "5_1", "exec"), ns)
            return ns["select_again"]
    raise AssertionError("5_1 に select_again が無い")


SELECT_AGAIN = _select_again()
GIB = PC.GIB


class 実行前に見積もって門で止める(unittest.TestCase):
    def test_門より小さければ通る(self):
        self.assertEqual(
            PC.scan_verdict(int(0.5 * GIB), gate_gib=1.0, allow_gib=None), "ok")

    def test_門を超えて宣言が無ければ止める(self):
        # 今回の原因そのもの（4.58 GiB を宣言なしで投げていた）。
        self.assertEqual(
            PC.scan_verdict(int(4.58 * GIB), gate_gib=1.0, allow_gib=None), "gate")

    def test_宣言すれば通る(self):
        self.assertEqual(
            PC.scan_verdict(int(4.58 * GIB), gate_gib=1.0, allow_gib=5.0), "ok")

    def test_宣言より大きければ宣言しても止める(self):
        self.assertEqual(
            PC.scan_verdict(int(9.0 * GIB), gate_gib=1.0, allow_gib=5.0), "gate")

    def test_予算が広くても門は通さない(self):
        # «予算が余っているから大きいクエリを通す» 抜け道を作らない。
        self.assertEqual(
            PC.scan_verdict(int(4.58 * GIB), gate_gib=1.0, allow_gib=None,
                            billed_bytes=0, budget_gib=1000.0), "gate")

    def test_累計が予算を超えたら止める(self):
        self.assertEqual(
            PC.scan_verdict(int(0.5 * GIB), gate_gib=1.0, allow_gib=1.0,
                            billed_bytes=int(9.8 * GIB), budget_gib=10.0), "over_budget")

    def test_予算の指定が無ければ予算では止めない(self):
        self.assertEqual(
            PC.scan_verdict(int(0.5 * GIB), gate_gib=1.0, allow_gib=None,
                            billed_bytes=int(999 * GIB), budget_gib=None), "ok")


class すべてのクエリが同じ1箇所を通る(unittest.TestCase):
    def test_execute系はclient_queryを直接呼ばない(self):
        # 入口が分かれていると片方だけ守られる（一時障害の扱いで既に踏んでいる）。
        tree = ast.parse(PIPELINE_SRC)
        offenders = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef):
                continue
            if node.name in ("_query", "dry_run_bytes"):
                continue
            src = ast.get_source_segment(PIPELINE_SRC, node) or ""
            if "self.client.query(" in src:
                offenders.append(node.name)
        self.assertEqual(offenders, [],
                         f"{offenders} が門を通らずに query している")

    def test_dmlも門を通る(self):
        tree = ast.parse(PIPELINE_SRC)
        dml = next(n for n in ast.walk(tree)
                   if isinstance(n, ast.FunctionDef) and n.name == "execute_dml")
        self.assertIn("self._query(", ast.get_source_segment(PIPELINE_SRC, dml))

    def test_dry_runは課金されない設定で投げている(self):
        tree = ast.parse(PIPELINE_SRC)
        fn = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == "dry_run_bytes")
        src = ast.get_source_segment(PIPELINE_SRC, fn)
        self.assertIn("dry_run=True", src)
        self.assertIn("use_query_cache=False", src)


class 読んだ量が必ず見える(unittest.TestCase):
    def test_1本ごとにログへ出す(self):
        tree = ast.parse(PIPELINE_SRC)
        fn = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == "_query")
        src = ast.get_source_segment(PIPELINE_SRC, fn)
        self.assertIn("LOGGER.info", src)
        self.assertIn("課金", src)

    def test_runの合計をdurableな記録へ残す(self):
        # これが無かったので 8 日間追えなかった。
        self.assertIn('"bq_scan_billed_gib"', PIPELINE_SRC)
        self.assertIn('"bq_queries"', PIPELINE_SRC)

    def test_台帳は秒ではなくバイトを数える(self):
        led = PC.ScanLedger(gate_gib=1.0, allow_gib=None, budget_gib=None)
        led.add(int(2 * GIB))
        led.add(int(3 * GIB))
        self.assertEqual(led.queries, 2)
        self.assertEqual(led.billed_bytes, int(5 * GIB))
        self.assertIn("5.00 GiB", led.summary())

    def test_概算ドルは表示できる(self):
        self.assertAlmostEqual(PC.usd_for_bytes(PC.TIB), PC.USD_PER_TIB, places=6)


class 費用がループの回転数に比例しない(unittest.TestCase):
    def test_間隔が空く前は待たせる(self):
        got, wait = SELECT_AGAIN(selects_done=1, max_selects=12, last_select_at=0.0,
                                 min_interval_s=1800.0, now=12.0)
        self.assertEqual(got, "wait")
        self.assertAlmostEqual(wait, 1788.0)

    def test_間隔が空いたら聞きに行ける(self):
        got, wait = SELECT_AGAIN(selects_done=1, max_selects=12, last_select_at=0.0,
                                 min_interval_s=1800.0, now=1800.0)
        self.assertEqual((got, wait), ("ok", 0.0))

    def test_回数の上限で止まる(self):
        got, _ = SELECT_AGAIN(selects_done=12, max_selects=12, last_select_at=0.0,
                              min_interval_s=1800.0, now=99999.0)
        self.assertEqual(got, "capped")

    def test_12秒ごとに1900回は原理的に起きない(self):
        """今回の事故そのものを固定する。既定でも 1 日あたり数十回に収まること。"""
        selects, last, now = 1, 0.0, 0.0
        for _ in range(5000):
            got, wait = SELECT_AGAIN(selects_done=selects, max_selects=12,
                                     last_select_at=last, min_interval_s=1800.0, now=now)
            if got == "capped":
                break
            if got == "wait":
                now += wait
                continue
            selects += 1
            last = now
            now += 12.0  # バッチが 12 秒で終わる（実測）
        self.assertLessEqual(selects, 12, "回数の上限が効いていない")

    def test_上限に当たっても赤くしない(self):
        # 「正常なのに赤くする」ガードは «黙って成功する» のと同じくらい悪い。
        i = RESOLVE_SRC.index('if gate == "capped":')
        body = RESOLVE_SRC[i:i + 700]
        self.assertIn("break", body)
        self.assertNotIn("SystemExit", body)
        self.assertNotIn("exit(1)", body)

    def test_既定値が事故前の値に戻っていない(self):
        self.assertIn('"--select-interval-min", type=float, default=30.0', RESOLVE_SRC)
        self.assertIn('"--max-selects", type=int, default=12', RESOLVE_SRC)


class 門が閉じたら本番クエリは1本も走らない(unittest.TestCase):
    """**ここが «課金しない» の本体である。** 見積もりで止めた後に実行されたら意味が無い。

    ネットワークへは出ない（client を差し替える）。
    """

    def _pipeline(self, *, estimated_gib: float, allow_gib=None, budget_gib=None):
        pl = object.__new__(PC.BigQueryPipeline)
        pl.config = types.SimpleNamespace(region="asia-northeast1", project_id="p",
                                          dataset_ref="p.d")
        pl.scans = PC.ScanLedger(gate_gib=1.0, allow_gib=allow_gib, budget_gib=budget_gib)
        pl.ran = []
        pl.dry_runs = []

        def fake_dry_run(sql, parameters=None):
            pl.dry_runs.append(sql)
            return int(estimated_gib * GIB)

        def fake_run_job(submit, *, what, **kw):
            pl.ran.append(what)
            job = types.SimpleNamespace(total_bytes_billed=int(estimated_gib * GIB),
                                        num_dml_affected_rows=0)
            return job, []

        pl.dry_run_bytes = fake_dry_run
        pl._run_job = fake_run_job
        return pl

    def test_門を超えたら本番クエリを投げずに例外(self):
        pl = self._pipeline(estimated_gib=4.58)
        with self.assertRaises(PC.ScanTooLarge):
            pl.execute("SELECT * FROM t")
        self.assertEqual(pl.ran, [], "止めたはずなのに本番クエリが走っている（＝課金する）")
        self.assertEqual(len(pl.dry_runs), 1, "見積もりは実行前に 1 回だけ")

    def test_例外の文面が次の行動を名指しする(self):
        pl = self._pipeline(estimated_gib=4.58)
        with self.assertRaises(PC.ScanTooLarge) as cm:
            pl.execute("SELECT * FROM t")
        msg = str(cm.exception)
        self.assertIn("4.58 GiB", msg)
        self.assertIn("BQ_ALLOW_SCAN_GIB", msg)
        self.assertIn("safety-policy.md", msg)

    def test_宣言があれば走って台帳へ積まれる(self):
        pl = self._pipeline(estimated_gib=4.58, allow_gib=5.0)
        pl.execute("SELECT * FROM t")
        self.assertEqual(len(pl.ran), 1)
        self.assertEqual(pl.scans.queries, 1)
        self.assertEqual(pl.scans.billed_bytes, int(4.58 * GIB))

    def test_予算を超えたら本番クエリを投げない(self):
        pl = self._pipeline(estimated_gib=0.5, allow_gib=1.0, budget_gib=1.0)
        pl.execute("SELECT 1")   # 0.5 GiB
        pl.execute("SELECT 1")   # 累計 1.0 GiB
        self.assertEqual(len(pl.ran), 2)
        with self.assertRaises(PC.ScanBudgetExceeded):
            pl.execute("SELECT 1")
        self.assertEqual(len(pl.ran), 2, "予算超過なのに 3 本目が走っている")

    def test_DMLも門で止まる(self):
        pl = self._pipeline(estimated_gib=3.66)   # 4_14 の UPDATE の実測
        with self.assertRaises(PC.ScanTooLarge):
            pl.execute_dml("UPDATE t SET a = 1 WHERE TRUE")
        self.assertEqual(pl.ran, [])


# --- 門を通る経路の判定表 ---------------------------------------------------------
#
# ⚠️ **空にしないこと。** «当てはまらない» の理由を消すと、次の人がまた同じ調査をする。
#   実測は `INFORMATION_SCHEMA.JOBS_BY_PROJECT`（2026-05〜10-01）。
SWEPT_SITES: tuple[tuple[str, str, bool, str], ...] = (
    ("pipeline_common.execute", "restaurant_recommendation 系ぜんぶ", True,
     "門を通す。2026-09 の 32.71 TiB ＋ 10-01 の 9.15 TiB ＝ 今回の急増のほぼ全部がここ"),
    ("pipeline_common.execute_dml", "4_11 / 4_13 / 4_14 の UPDATE", True,
     "UPDATE も読んだぶん課金される。4_14 の caption 後入れは 1 回 3.66 GiB だった"),
    ("pipeline_common.delete_run_rows", "途中再開の冪等化 DELETE", True,
     "DELETE も課金される。テストが «門を通らずに query している» と指摘して気づいた"),
    ("pipeline_common.dry_run_bytes", "見積もり自体", True,
     "課金ゼロだが _run_job を通す。見積もりの 1 回の 5xx で 5.5h の run を殺さない"),
    ("pipeline_common.load_json_rows / load_ndjson_file / load_parquet", "Load Job", False,
     "**当てはまらない。** Load Job はスキャン課金が無い（取り込みは無料）。門に掛けない"),
    ("wikidata_food_graph/*/lib/bq.py（7 つの loader）", "別系統・独自に bigquery.Client を作る", False,
     "**門の外にある。** ただし実測で 2026-08 に 0.029 TiB、2026-09 以降は 0 で、"
     "今回の急増（41.9 TiB）とは桁が 3 つ違う。急ぎではないので別チケットに回す。"
     "⚠️ **«0 だから安全» ではなく «いま小さい» だけである。** 門へ寄せるまで残る穴"),
)


class 判定表を空にしない(unittest.TestCase):
    def test_掃いた箇所と理由が残っている(self):
        self.assertGreaterEqual(len(SWEPT_SITES), 6)
        for name, what, applies, why in SWEPT_SITES:
            self.assertTrue(why.strip(), f"{name} に理由が無い")
            if not applies:
                self.assertIn("当てはまらない" if "lib/bq.py" not in name else "門の外", why,
                              f"{name}: 当てはまらない理由を書くこと")


if __name__ == "__main__":
    unittest.main()
