"""#1947 BigQuery の一時障害で «長時間ジョブ» を殺さない／二重に書かない固定。

## 欠陥をパターンで 1 文にすると

**«相手側の一時的な失敗が、こちらの長時間ジョブを丸ごと終わらせる»。**

2026-09-21、5.5 時間の収集ラウンドが **開始 137 分**で落ちた。収集そのものは正常で、
途中の flush が `load_json_rows` → `job.result()` で踏んだ
`InternalServerError: 500 GET .../jobs/<id>`（**ジョブの «結果を聞きに行く» GET**）だった。
285/6000 アカウントまでしか進まず 2.7 時間を捨てた。

これは前日 IG API で直したもの（`4_2` の `TransientExhausted`）と**同じ形**である。
あのときは IG の呼び出しだけを見て、**同じループの中にある BigQuery の呼び出しを見ていなかった**。

## ここで固定する «安全側» の性質

一時エラーで **ジョブを投げ直さないこと**。polling の 500 は «ジョブが失敗した» ではなく
«結果を聞けなかった» なので、投げ直すと:

- load → **同じ行を二重に入れる**
- DML  → **同じ更新を二度当てる**

投げ直してよいのは «まだジョブが出来ていない»（submit 自体が失敗した）ときだけ。
**«落ちなくなった» だけのテストでは、この二重書き込みを見逃す。**
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from google.api_core.exceptions import BadRequest, InternalServerError, TooManyRequests  # noqa: E402

import pipeline_common  # noqa: E402

RUN_JOB = pipeline_common.BigQueryPipeline._run_job


class _Job:
    """`result()` が指定回数だけ一時エラーを投げるジョブ。"""

    def __init__(self, fail_times: int = 0, exc: BaseException | None = None) -> None:
        self.calls = 0
        self._fail_times = fail_times
        self._exc = exc or InternalServerError("500 GET .../jobs/x")

    def result(self):
        self.calls += 1
        if self.calls <= self._fail_times:
            raise self._exc
        return "rows"


def _submitter(job_factory):
    """submit が何回呼ばれたかを数える。"""
    box = SimpleNamespace(count=0, job=None)

    def submit():
        box.count += 1
        box.job = job_factory()
        return box.job
    return submit, box


class TransientRetryTest(unittest.TestCase):
    def setUp(self) -> None:
        # 待ち時間は挙動と関係ないので潰す（テストを 30 秒待たせない）
        patcher = mock.patch.object(pipeline_common.time, "sleep")
        self.sleep = patcher.start()
        self.addCleanup(patcher.stop)
        self.pipeline = SimpleNamespace()

    def test_polling_500_does_not_resubmit_the_job(self) -> None:
        """**この 1 本がこのファイルの本体。** 一時エラーで投げ直したら二重書き込みになる。"""
        job = _Job(fail_times=2)
        submit, box = _submitter(lambda: job)
        got_job, result = RUN_JOB(self.pipeline, submit, what="load x")
        self.assertEqual(1, box.count, "一時エラーでジョブを投げ直している（行が二重に入る）")
        self.assertEqual(3, job.calls, "同じジョブへ result() を掛け直していない")
        self.assertIs(job, got_job)
        self.assertEqual("rows", result)

    def test_submit_failure_is_retried_by_resubmitting(self) -> None:
        """submit 自体が失敗したときは «ジョブが無い» ので投げ直してよい。"""
        calls = SimpleNamespace(n=0)

        def submit():
            calls.n += 1
            if calls.n == 1:
                raise InternalServerError("500 POST .../jobs")
            return _Job()
        job, result = RUN_JOB(self.pipeline, submit, what="load x")
        self.assertEqual(2, calls.n)
        self.assertEqual("rows", result)

    def test_rate_limit_is_transient_too(self) -> None:
        job = _Job(fail_times=1, exc=TooManyRequests("429"))
        submit, box = _submitter(lambda: job)
        RUN_JOB(self.pipeline, submit, what="query")
        self.assertEqual(1, box.count)
        self.assertEqual(2, job.calls)

    def test_non_transient_error_is_not_retried(self) -> None:
        """クエリの誤りなど «こちらの間違い» は待っても直らない。すぐ上げる。"""
        job = _Job(fail_times=1, exc=BadRequest("400 syntax error"))
        submit, box = _submitter(lambda: job)
        with self.assertRaises(BadRequest):
            RUN_JOB(self.pipeline, submit, what="query")
        self.assertEqual(1, job.calls, "非一時エラーを掛け直している")

    def test_gives_up_after_bounded_attempts_and_raises_the_real_error(self) -> None:
        """無限に粘らない。最後は本物の例外を上げる（黙って成功扱いにしない）。"""
        job = _Job(fail_times=99)
        submit, _ = _submitter(lambda: job)
        with self.assertRaises(InternalServerError):
            RUN_JOB(self.pipeline, submit, what="load x", attempts=3)
        self.assertEqual(3, job.calls)

    def test_backoff_waits_between_attempts(self) -> None:
        job = _Job(fail_times=2)
        submit, _ = _submitter(lambda: job)
        RUN_JOB(self.pipeline, submit, what="load x", base_sleep_s=5.0)
        self.assertEqual([5.0, 10.0], [c.args[0] for c in self.sleep.call_args_list])


class EveryJobGoesThroughTheRetryTest(unittest.TestCase):
    """新しい経路が «素の job.result()» で追加されたら赤くする（水平展開の固定）。"""

    def test_no_bare_job_result_in_pipeline_common(self) -> None:
        src = (HERE / "pipeline_common.py").read_text(encoding="utf-8")
        # «それ自体が 1 文になっている `job.result()`» だけを見る（説明文やコメントは対象外）。
        bare = [l.strip() for l in src.splitlines() if l.strip() == "job.result()"]
        self.assertEqual([], bare,
                         "BigQuery ジョブは `_run_job` を通すこと（素の job.result() は一時障害で落ちる）")

    def test_load_paths_share_one_submitter(self) -> None:
        """load が 3 経路あるので «1 箇所だけ直した» を防ぐ。"""
        src = (HERE / "pipeline_common.py").read_text(encoding="utf-8")
        self.assertEqual(1, src.count("def _submit_load("))
        self.assertEqual(3, src.count("self._submit_load("),
                         "load_json_rows / load_ndjson_file / load_parquet の 3 経路すべて")

    def test_query_paths_go_through_run_job(self) -> None:
        src = (HERE / "pipeline_common.py").read_text(encoding="utf-8")
        self.assertIn("self._run_job(", src)
        self.assertGreaterEqual(src.count("self._run_job("), 5,
                                "execute / delete_run_rows / load 3 経路")


# --- 掃いた箇所の判定表 -----------------------------------------------------------
#
# ⚠️ **空にしないこと。** «当てはまらない» の理由を消すと、次の人がまた同じ調査をする。
SWEPT_SITES: tuple[tuple[str, str, bool, str], ...] = (
    ("pipeline_common.py", "load_json_rows の flush", True,
     "**実際に落ちた箇所**。5.5h の収集が 137 分で死んだ"),
    ("pipeline_common.py", "execute / delete_run_rows / load_ndjson_file / load_parquet", True,
     "同じ形。`_run_job` へ寄せた"),
    ("4_17_resolve_bare_handles.py", "backfill DML / 前回分の DELETE", True,
     "query → job.result() → num_dml_affected_rows の写経。`execute_dml` へ寄せた"),
    ("4_4_crawl_official_site_igs.py", "crawl 済みの印を付ける DML", True,
     "**巡回ループの中から呼ばれる**ので、落ちると巡回ごと死ぬ"),
    ("4_1c_foursquare_store_accounts.py", "前回分の DELETE", True, "同じ写経"),
    ("4_1_discover_sns_accounts.py", "前回分の DELETE", True, "同じ写経"),
    ("6_1_load_osm_opening_hours.py", "照合結果の読み出し", True,
     "読み取りだが同じく一時障害で落ちる。`execute` へ寄せた"),
    ("4_0b_add_caption_column.py", "ALTER TABLE", True,
     "一度きりの DDL だが、寄せるコストが無いので寄せた"),
    ("*.py", "ThreadPoolExecutor の `fut.result()`", False,
     "**当てはまらない。** BigQuery のジョブではなくスレッドの戻り値"),
    ("5_1_apply_resolve.py", "execute_dml_retrying の «serialize access» 再試行", False,
     "**当てはまらない。** こちらは DML が確定的に失敗しており、投げ直すのが正しい"),
)


class SweptSitesAreRecordedTest(unittest.TestCase):
    def test_table_is_not_emptied(self) -> None:
        self.assertGreaterEqual(len(SWEPT_SITES), 10)
        self.assertTrue(any(not applies for _, _, applies, _ in SWEPT_SITES))

    def test_every_entry_has_a_reason(self) -> None:
        for name, where, _, why in SWEPT_SITES:
            self.assertTrue(why.strip(), f"{name} / {where} に理由が無い")

    def test_no_script_copies_the_dml_block_again(self) -> None:
        """«query して job.result() して num_dml_affected_rows を読む» を書き直させない。"""
        offenders = []
        for path in sorted(HERE.glob("*.py")):
            if path.name.startswith("test_") or path.name == "pipeline_common.py":
                continue
            src = path.read_text(encoding="utf-8")
            if "num_dml_affected_rows" in src:
                offenders.append(path.name)
        self.assertEqual([], offenders,
                         "影響行数が要るなら `pipeline.execute_dml()` を使う（写経しない）")


if __name__ == "__main__":
    unittest.main()
