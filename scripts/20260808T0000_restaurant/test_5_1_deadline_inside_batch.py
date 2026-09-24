"""#1947 `--max-minutes` を «1 バッチ回し切ってから» ではなく «バッチの中で» 見る（5_1）。

2026-09-23、dev の Postgres が詰まって resolve が 40,000 投稿/時 → 3,400 投稿/時に落ちた。
1 バッチは `--limit`（運用 20,000 件）なので、1 バッチの所要が約 6 時間になり、
**`--max-minutes 270` を渡した run が 310 分を越えても止まれなかった**。
GitHub Actions の 1 job の上限は 360 分で、過去に **361 分ちょうどで cancelled** され
5.5 時間ぶんの集計を失っている（`next_resolve.sh` のコメントに記録）。

このテストは値ではなく **パターン**を固定する:
  1. 締め切りを越えたら、バッチの途中でも配るのをやめる
  2. 締め切り無し（0）のときは今までどおり全部配る
  3. 確認の間隔は «遅い日でも数分以内に必ず締め切りを見る» 程度に小さい
  4. `run_batch` がこのジェネレータ経由で回っている（直接 `for post in batch` へ戻さない）

## 水平展開 — 同じ «時間予算» を持つ他のスクリプトを 1 件ずつ当たった結果

| スクリプト | 判定 | 理由 |
| --- | --- | --- |
| `5_1_apply_resolve.py` | **当てはまる** | 1 バッチ = `--limit` 件を回し切るまで締め切りを見ていなかった |
| `4_2_collect_account_posts.py` | 当てはまらない | 締め切りを **1 アカウントごと**に見ている（1 アカウント ≒ 4 コール） |
| `4_14_fetch_missing_captions.py` | 当てはまらない | 締め切りを **1 投稿ごと**（`work` の先頭）と 1 完了ごとに見ている |
| `4_22_probe_embed_liveness.py` | 当てはまらない | 締め切りを **1 件ごと**に見ている |
"""

from __future__ import annotations

import ast
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

SOURCE = HERE / "5_1_apply_resolve.py"


def _load():
    spec = importlib.util.spec_from_file_location("apply_resolve", SOURCE)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["apply_resolve"] = mod
    spec.loader.exec_module(mod)
    return mod


M = _load()


class DeadlineIsSeenInsideTheBatch(unittest.TestCase):
    def test_stops_partway_through_a_batch(self) -> None:
        """締め切りを越えた時点で、バッチの残りは配らない（＝次の run へ回す）。"""
        batch = list(range(1000))
        clock = {"t": 0.0}

        def now() -> float:
            clock["t"] += 10.0   # 1 塊ごとに 10 秒進む
            return clock["t"]

        got = [c for _, c in M.deadline_chunks(batch, deadline=25.0, chunk=100, now=now)]
        # 10s, 20s は締め切り前・30s で越える → 2 塊だけ配って止まる
        self.assertEqual([len(c) for c in got], [100, 100])
        self.assertLess(sum(len(c) for c in got), len(batch))

    def test_no_deadline_yields_everything(self) -> None:
        """`--max-minutes` を渡していない run（deadline=0）の挙動は変えない。"""
        batch = list(range(450))
        got = list(M.deadline_chunks(batch, deadline=0.0, chunk=100,
                                     now=lambda: 10 ** 9))
        self.assertEqual(sum(len(c) for _, c in got), 450)
        self.assertEqual([i for i, _ in got], [0, 100, 200, 300, 400])

    def test_offsets_let_the_caller_report_the_remainder(self) -> None:
        """«残り何件を次へ回したか» を呼び出し側が言えるよう、先頭位置も返す。"""
        got = list(M.deadline_chunks(list(range(250)), deadline=0.0, chunk=100,
                                     now=lambda: 0.0))
        self.assertEqual([i for i, _ in got], [0, 100, 200])
        self.assertEqual(len(got[-1][1]), 50)

    def test_check_interval_is_small_enough_to_matter(self) -> None:
        """遅い日（実測 3,400 投稿/時 = 約 1 投稿/秒）でも数分以内に締め切りを見ること。"""
        self.assertLessEqual(M.DEADLINE_CHECK_EVERY, 1000)
        self.assertGreaterEqual(M.DEADLINE_CHECK_EVERY, 1)


class RunBatchGoesThroughIt(unittest.TestCase):
    """`run_batch` を «バッチを丸ごと回す» 形へ戻さない。"""

    def _run_batch(self) -> ast.FunctionDef:
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == "run_batch":
                return node
        self.fail("run_batch が見つからない")

    def test_iterates_via_deadline_chunks(self) -> None:
        fn = self._run_batch()
        calls = [n.func.id for n in ast.walk(fn)
                 if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
        self.assertIn("deadline_chunks", calls,
                      "run_batch が deadline_chunks を経由していない。"
                      "バッチを丸ごと回すと --max-minutes が効かない（#1947）")

    def test_does_not_loop_over_the_whole_batch_directly(self) -> None:
        fn = self._run_batch()
        for node in ast.walk(fn):
            if isinstance(node, ast.For) and isinstance(node.iter, ast.Name):
                self.assertNotEqual(
                    node.iter.id, "batch",
                    "バッチ全体を直接回している。締め切りを見ずに何時間も走る（#1947）")


if __name__ == "__main__":
    unittest.main()
