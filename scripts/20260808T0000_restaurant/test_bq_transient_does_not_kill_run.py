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

from google.api_core.exceptions import (  # noqa: E402
    BadRequest, Forbidden, InternalServerError, TooManyRequests)

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


class EntryPointDoesNotNarrowSignatureTest(unittest.TestCase):
    """#1947 2026-09-22: **入口へ寄せたときに引数を狭めて本番を落とした。**

    直呼び（`pipeline.client.insert_rows_json`）を入口（`pipeline.insert_rows_json`）へ
    寄せた際、入口を `(table_id, rows)` だけにした。`pg_sync_common.write_sync_log` は
    `row_ids=` を渡しているので **TypeError で落ち、dev 同期が «最後のログ書き込みだけ» で
    失敗した**（本体の DML は成功していたのに）。

    ⚠️ **文字列 grep のテストではこれを検出できない。** 直呼びが消えたことは確認できても、
       «同じ引数で呼べるか» は確認していなかった。**実際に呼ぶ**テストをここに置く。
    """

    def setUp(self) -> None:
        patcher = mock.patch.object(pipeline_common.time, "sleep")
        patcher.start(); self.addCleanup(patcher.stop)
        self.calls = []

        class _Client:
            def insert_rows_json(_s, table_id, rows, **kw):
                self.calls.append(("insert", table_id, rows, kw)); return []
            def get_table(_s, table_id, **kw):
                self.calls.append(("get", table_id, kw)); return "table"

        # get_table は self._run_call を通るので、本物を束ねて渡す（挙動を写経しない）
        self.pipeline = SimpleNamespace(client=_Client())
        self.pipeline._run_call = (
            lambda fn, **kw: pipeline_common.BigQueryPipeline._run_call(self.pipeline, fn, **kw))

    def test_insert_rows_json_passes_row_ids_through(self) -> None:
        """`pg_sync_common.write_sync_log` が実際に使っている形。"""
        out = pipeline_common.BigQueryPipeline.insert_rows_json(
            self.pipeline, "proj.ds.restaurant_pg_sync_logs", [{"a": 1}], row_ids=["sync-1"])
        self.assertEqual([], out)
        self.assertEqual(("insert", "proj.ds.restaurant_pg_sync_logs", [{"a": 1}],
                          {"row_ids": ["sync-1"]}), self.calls[0])

    def test_get_table_accepts_kwargs(self) -> None:
        pipeline_common.BigQueryPipeline.get_table(self.pipeline, "proj.ds.t", retry=None)
        self.assertEqual(("get", "proj.ds.t", {"retry": None}), self.calls[0])

    def test_entry_points_accept_arbitrary_kwargs(self) -> None:
        """入口が **kwargs を受けること自体を固定する（将来また狭めさせない）。"""
        import inspect
        for name in ("insert_rows_json", "get_table"):
            sig = inspect.signature(getattr(pipeline_common.BigQueryPipeline, name))
            kinds = [p.kind for p in sig.parameters.values()]
            self.assertIn(inspect.Parameter.VAR_KEYWORD, kinds,
                          f"{name} が **kwargs を受けない（呼び出し側のシグネチャを狭めている）")


def _forbidden(body: str, content_type: str = "application/json"):
    """本物の HTTP 応答から `Forbidden` を作る（**例外の形を写経しない**）。

    ⚠️ `Forbidden("...")` を手で組むと `errors` が空になり、**HTML の拒否と
       `accessDenied` の区別が付かないまま緑になる**。ライブラリに解釈させる。
    """
    import json as _json

    from google.api_core import exceptions as _ex

    class _Resp:
        status_code = 403
        headers = {"content-type": content_type}

        def __init__(self, text: str) -> None:
            self.text = text
            self.request = SimpleNamespace(
                method="POST",
                url="https://bigquery.googleapis.com/bigquery/v2/projects/food-scroll/jobs")

        def json(self):
            return _json.loads(self.text)

    return _ex.from_http_response(_Resp(body))


GFE_403_HTML = (
    "<!DOCTYPE html><html lang=en><title>Error 403 (Forbidden)!!1</title>"
    "<p><b>403.</b> Your client does not have permission to get URL "
    "<code>/bigquery/v2/projects/food-scroll/jobs</code> from this server.</html>")


def _bq_403(reason: str, message: str):
    import json as _json
    return _forbidden(_json.dumps({"error": {
        "code": 403, "message": message,
        "errors": [{"message": message, "domain": "global", "reason": reason}]}}))


class Forbidden403IsNotAlwaysPermanentTest(unittest.TestCase):
    """#1947 **再送の可否を «HTTP の番号» で決めない。**

    2026-09-26、11 レーンのうち 1 本が **起動 12 秒で死んだ**。返ってきたのは BigQuery の
    JSON ではなく Google のフロントエンドの HTML（`Error 403 (Forbidden)!!1`）で、
    **同じ 8 秒に同じ資格情報で投げた 2 本は通っている**。それでも再送集合が 5xx と 429
    しか見ていなかったので即死した。

    ⚠️ 逆に **本物の `accessDenied` を再送してはいけない**。155 秒かけて同じ理由で
       落ちるだけになり、原因が «一時エラーの再送ログ» に埋まる。
    """

    def setUp(self) -> None:
        patcher = mock.patch.object(pipeline_common.time, "sleep")
        self.sleep = patcher.start()
        self.addCleanup(patcher.stop)
        self.pipeline = SimpleNamespace()

    def test_front_end_rejection_has_no_reason_and_is_retried(self) -> None:
        exc = _forbidden(GFE_403_HTML, content_type="text/html")
        self.assertEqual([], exc.errors, "HTML の拒否は BigQuery の理由を持たない")
        self.assertTrue(pipeline_common._is_transient_forbidden(exc))
        self.assertTrue(pipeline_common._is_sent_transient(exc))

    def test_access_denied_is_permanent(self) -> None:
        exc = _bq_403("accessDenied", "Access Denied: Table food-scroll:ds.t")
        self.assertFalse(pipeline_common._is_transient_forbidden(exc))
        self.assertFalse(pipeline_common._is_sent_transient(exc))

    def test_rate_limit_403_is_retried(self) -> None:
        """429 を再送しているのに、同じことを 403 で言われたら殺す、は筋が通らない。"""
        for reason in ("rateLimitExceeded", "quotaExceeded"):
            with self.subTest(reason=reason):
                self.assertTrue(pipeline_common._is_transient_forbidden(
                    _bq_403(reason, "Exceeded rate limits")))

    def test_run_job_survives_a_front_end_rejection_at_submit(self) -> None:
        """run 1290 の «起動 12 秒で死ぬ» を復活させない（投入そのものが弾かれた形）。"""
        state = SimpleNamespace(n=0)

        def submit():
            state.n += 1
            if state.n <= 2:
                raise _forbidden(GFE_403_HTML, content_type="text/html")
            return _Job()

        _, result = RUN_JOB(self.pipeline, submit, what="query x")
        self.assertEqual("rows", result)
        self.assertEqual(3, state.n, "フロントエンドの拒否でジョブを投げ直している")

    def test_run_job_does_not_retry_access_denied(self) -> None:
        state = SimpleNamespace(n=0)

        def submit():
            state.n += 1
            raise _bq_403("accessDenied", "Access Denied")

        with self.assertRaises(Forbidden):
            RUN_JOB(self.pipeline, submit, what="query x")
        self.assertEqual(1, state.n, "恒久エラーを 6 回投げ直している（原因が埋まる）")

    def test_non_idempotent_write_does_not_retry_a_403(self) -> None:
        """⚠️ 安全側。HTML の拒否は実際には «届く前» だが、**そう証明できない**。

        `insert_rows_json` は再送すると行が二重に入るので、`_retry_auth_only` は
        «届く前だと言い切れる» 資格情報の失敗だけを拾い続ける。
        """
        state = SimpleNamespace(n=0)

        def fn():
            state.n += 1
            raise _forbidden(GFE_403_HTML, content_type="text/html")

        with self.assertRaises(Forbidden):
            pipeline_common._retry_auth_only(fn, what="insert")
        self.assertEqual(1, state.n)

    # #1947 2026-09-26 の水平展開。**「再送するかどうかを HTTP の番号で決めている」**
    # 箇所を全部当たり直した一覧。**空にしないこと**（空にすると «調べた» 記録が消える）。
    #   (ファイル, 何を相手にしているか, 当てはまるか, 判定の根拠)
    SWEPT_RETRY_CLASSIFIERS = (
        ("pipeline_common.py", "BigQuery（全 script が通る）", True,
         "5xx と 429 しか見ておらず、フロントエンドの HTML 403 で run が即死した。"
         "述語 _is_transient_forbidden を足した（accessDenied は即死のまま）"),
        ("pipeline_common.py", "insert_rows_json（冪等でない挿入）", False,
         "意図して狭い。HTML の 403 は実際には «届く前» だが、そう証明できない。"
         "行が二重に入る害の方が大きいので、資格情報の失敗だけ拾い続ける"),
        ("google_place_matching.py", "Places Text Search（googleapis.com）", False,
         "実測: restaurant_google_place_match_attempts の 5,944,111 件（2026 年）に "
         "403 は 0 件（200=3,353,054 / 429=15,605 / 400=4）。403 は http_status へ残るので、"
         "出れば観測できる。3_2 / 4_18 もこの入口を通る"),
        ("1276_place_id_free_poc/free_places.py", "Places（#1276 の PoC）", False,
         "調達の本番経路ではない実験コード。上と同じ相手なので、上の実測がそのまま当たる"),
        ("4_7_collect_search_api_posts.py", "検索 API（serper / tavily / linkup）", False,
         "上限は 429 と 432 と本文（_LOOKS_LIKE_QUOTA）で判定済み。"
         "これらの 403 は鍵・プランの恒久エラーで、待っても直らない"),
        ("4_20_search_influencer_accounts.py", "SERPER", False,
         "そもそも番号で分けていない。本文を出して 5 回連続の失敗で止める形"),
        ("4_2_collect_account_posts.py", "Instagram Graph API", False,
         "IG の上限は code 4/17/613 と 429 で来て RateLimited として別扱い。"
         "403 はトークン失効で恒久。Google のフロントエンドとは別の経路"),
        ("4_14_fetch_missing_captions.py", "Instagram の埋め込みページ", False,
         "番号で再送しない設計。取れなければ «取れなかった» として次へ進む"),
        ("common_sns.py", "自分たちの backend API（resolve）", False,
         "429/5xx を投げ直す。403 は JWT の失効で恒久であり、待っても直らない"),
    )

    def test_every_swept_classifier_has_a_reason(self) -> None:
        """⚠️ **当てはまらないものは «なぜか» を書いて残す。** 書かないと次に同じ調査をする。"""
        self.assertGreaterEqual(len(self.SWEPT_RETRY_CLASSIFIERS), 9)
        for path, target, matched, why in self.SWEPT_RETRY_CLASSIFIERS:
            with self.subTest(path=path, target=target):
                self.assertTrue(why.strip(), f"{path} の判定の根拠が空")
                self.assertIsInstance(matched, bool)

    def test_swept_files_still_exist(self) -> None:
        """挙げたファイルが消えたら、一覧の方を直す（嘘の «調べた» を残さない）。"""
        here = Path(__file__).resolve().parent
        for path, _, _, _ in self.SWEPT_RETRY_CLASSIFIERS:
            with self.subTest(path=path):
                self.assertTrue((here / path).exists(), f"{path} が無い")

    def test_retry_decision_is_a_predicate_not_a_tuple_of_numbers(self) -> None:
        """**パターンの固定**: 再送の可否は述語で決める（番号の集合では表せない）。

        403 のように «同じ番号に恒久と一時が混ざっている» ものがあるので、
        `except <例外のタプル>` へ戻すと同じ欠陥が復活する。
        """
        import inspect
        for name in ("_run_job", "_run_call"):
            src = inspect.getsource(getattr(pipeline_common.BigQueryPipeline, name))
            self.assertIn("_is_sent_transient(", src, f"{name} が述語を通っていない")
            self.assertNotIn("except transient", src,
                             f"{name} が例外のタプルで選り分けている（403 を表せない）")
        src = inspect.getsource(pipeline_common._retry_auth_only)
        self.assertIn("_is_auth_transient(", src)
        self.assertNotIn("except transient", src)


if __name__ == "__main__":
    unittest.main()
