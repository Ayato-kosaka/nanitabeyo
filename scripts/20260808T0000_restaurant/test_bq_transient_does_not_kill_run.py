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


class AuthRefreshIsTransientTest(unittest.TestCase):
    """#1947 2026-09-22: **資格情報の更新の一時失敗**が 5.5 時間の run を 22 秒で殺した。

    ## 欠陥をパターンで 1 文にすると

    **«外部の一時失敗を再送する» 集合が、外部呼び出しの一部（認証の往復）を数えていなかった。**

    2026-09-21 に «横展開の対象は壊れた API 名ではなく外部呼び出し全部» と決めたのに、
    そのときは «BigQuery の呼び出し» までで数え、その下で毎回走る WIF のトークン取得を
    見ていなかった。実際の落ち方:

        google.auth.exceptions.RefreshError: ('Unable to retrieve Identity Pool subject
        token', 'upstream connect error or disconnect/reset before headers.
        reset reason: overflow')

    ⚠️ **トークンは run の途中でも期限切れで更新される。** «起動時だけ» の対策では足りない。
    """

    def setUp(self) -> None:
        patcher = mock.patch.object(pipeline_common.time, "sleep")
        self.sleep = patcher.start()
        self.addCleanup(patcher.stop)
        self.pipeline = SimpleNamespace()

    def test_refresh_error_is_in_the_retried_set(self) -> None:
        from google.auth.exceptions import RefreshError, TransportError

        auth = pipeline_common._auth_transient_exc()
        self.assertIn(RefreshError, auth)
        self.assertIn(TransportError, auth)

    def test_run_job_retries_a_token_refresh_failure(self) -> None:
        """«開始 22 秒で死ぬ» を復活させない。"""
        from google.auth.exceptions import RefreshError

        job = _Job(fail_times=2, exc=RefreshError("Unable to retrieve Identity Pool subject token"))
        submit, box = _submitter(lambda: job)
        got_job, result = RUN_JOB(self.pipeline, submit, what="query x")
        self.assertEqual("rows", result)
        self.assertIs(job, got_job)
        self.assertEqual(1, box.count, "認証の失敗でジョブを投げ直している")

    def test_run_call_retries_idempotent_reads(self) -> None:
        """`get_table` のような «ジョブにならない» 読み取りも掛け直す。"""
        from google.auth.exceptions import RefreshError

        calls = SimpleNamespace(n=0)

        def fn():
            calls.n += 1
            if calls.n <= 2:
                raise RefreshError("token")
            return "schema"

        got = pipeline_common.BigQueryPipeline._run_call(self.pipeline, fn, what="get_table x")
        self.assertEqual("schema", got)
        self.assertEqual(3, calls.n)

    def test_non_idempotent_write_retries_only_before_it_was_sent(self) -> None:
        """⚠️ **ここが安全側の固定。**

        `insert_rows_json` は再送すると行が二重に入る。トークン取得の失敗は «相手へ
        届く前» と言い切れるので掛け直してよいが、**届いたあとの 5xx は掛け直さない**。
        """
        from google.auth.exceptions import RefreshError

        calls = SimpleNamespace(n=0)

        def fn_auth():
            calls.n += 1
            if calls.n == 1:
                raise RefreshError("token")
            return []

        self.assertEqual([], pipeline_common._retry_auth_only(fn_auth, what="insert"))
        self.assertEqual(2, calls.n, "認証の失敗は掛け直してよい")

        sent = SimpleNamespace(n=0)

        def fn_sent():
            sent.n += 1
            raise InternalServerError("500 POST insertAll")

        with self.assertRaises(InternalServerError):
            pipeline_common._retry_auth_only(fn_sent, what="insert")
        self.assertEqual(1, sent.n,
                         "届いたあとの 5xx で冪等でない挿入を再送している（行が二重に入る）")

    # #1947 2026-09-22 の水平展開。`pipeline.client.*` を直に叩いていた箇所を
    # 全部当たり直した一覧。**空にしないこと**（空にすると «調べた» 記録が消える）。
    #   (ファイル, 何を呼んでいたか, 冪等か, どう直したか)
    SWEPT_CLIENT_CALLS = (
        ("pipeline_common.py", "get_table（load のスキーマ取得）", True,
         "読み取りなので _run_call。pipeline.get_table() に寄せた"),
        ("pipeline_common.py", "insert_rows_json（source manifest）", False,
         "認証の失敗だけ掛け直す _retry_auth_only。pipeline.insert_rows_json() に寄せた"),
        ("pipeline_common.py", "insert_rows_json（pipeline run ログ）", False,
         "同上"),
        ("3_2_search_google_place_ids.py", "insert_rows_json", False,
         "pipeline.insert_rows_json() へ。Places 検索は長時間走るので認証更新を挟む"),
        ("8_1_validate_catalogs.py", "insert_rows_json", False, "pipeline.insert_rows_json() へ"),
        ("pg_sync_common.py", "insert_rows_json", False, "pipeline.insert_rows_json() へ"),
        ("4_20_search_influencer_accounts.py", "get_table", True, "pipeline.get_table() へ"),
    )

    def test_every_swept_client_call_has_a_reason(self) -> None:
        for name, where, _, why in self.SWEPT_CLIENT_CALLS:
            self.assertTrue(why.strip(), f"{name} / {where} に理由が無い")
        self.assertTrue(self.SWEPT_CLIENT_CALLS, "水平展開の一覧を空にしてはいけない")

    def test_no_script_calls_the_raw_client_for_these(self) -> None:
        """`pipeline.client.insert_rows_json` / `.get_table` の直呼びを増やさせない。

        素で呼ぶと資格情報の更新の一時失敗で長時間ジョブが死ぬ。雑に再送すると
        `insert_rows_json` は行が二重に入る。入口は `pipeline_common` の 2 つだけ。
        """
        offenders = []
        for path in sorted(HERE.glob("*.py")):
            if path.name.startswith("test_"):
                continue
            for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                stripped = line.strip()
                if "lambda: self.client." in stripped:
                    continue  # 入口（_run_call / _retry_auth_only）の実装そのもの
                for bad in ("client.insert_rows_json(", "client.get_table("):
                    if bad in stripped:
                        offenders.append(f"{path.name}:{i} {stripped[:70]}")
        self.assertEqual([], offenders,
                         "pipeline.insert_rows_json() / pipeline.get_table() を使う（直呼びしない）")


if __name__ == "__main__":
    unittest.main()
