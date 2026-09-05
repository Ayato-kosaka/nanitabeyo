"""#1815 相手の «一時的な失敗» を、こちらの «恒久的な失敗» として扱わない（4_2）。

2026-09-05、341 件の influencer を採る予定だった収集 run が **28 アカウントで落ちた**。
原因は 1 回の `IG API 500 {"error":{..."is_transient":true...}}`。相手が «あとで試して»
と明示しているものを即座に例外にし、6 時間ぶんのバッチごと終わらせていた。

同じ考え違いは resolve 側（`common_sns.ResolveClient` の 429/5xx 再送）で既に直してある。
このテストは値ではなく **パターン**を固定する:
  1. 相手が一時的だと言った失敗は再送する（そして最終的に成功できる）
  2. 一時的でない失敗は再送しない（握り潰して延々待たない）
  3. レート制限と «handle が引けない» は今までどおり別の例外のまま
     （再送に巻き込むと、待つべきものを待たず、飛ばすべきものを飛ばさなくなる）
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def _load():
    spec = importlib.util.spec_from_file_location(
        "collect_account_posts", HERE / "4_2_collect_account_posts.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["collect_account_posts"] = mod
    spec.loader.exec_module(mod)
    return mod


M = _load()


def _http_error(status: int, body: str):
    import io
    import urllib.error
    return urllib.error.HTTPError(
        "https://graph.facebook.com/x", status, "err", {},
        io.BytesIO(body.encode("utf-8")))


TRANSIENT_BODY = ('{"error":{"message":"An unexpected error has occurred. '
                  'Please retry your request later.","type":"OAuthException",'
                  '"is_transient":true,"code":2}}')


class TransientRetryThroughTheRealPath(unittest.TestCase):
    """⚠️ `_get_once` をモックせず、**実際に落ちた経路**（HTTPError の分類）を通す。

    最初に書いたテストは `_TransientIGError` を直接投げていたので、分類の行を
    消しても緑のままだった。事故を再現しないテストは、テストではない。
    """

    def _run(self, status: int, body: str, responses: int = 1):
        calls = []

        def urlopen(req, timeout=None):
            calls.append(1)
            if len(calls) <= responses:
                raise _http_error(status, body)
            import io
            return _FakeResp(io.BytesIO(b'{"ok":true}'))

        with mock.patch.object(M.urllib.request, "urlopen", urlopen), \
                mock.patch.object(M.time, "sleep"):
            try:
                out = M._get("https://example/x")
            except Exception as e:  # noqa: BLE001 - 呼び出し側の判定に渡す
                return calls, e
            return calls, out

    def test_transient_500_is_retried_not_fatal(self) -> None:
        calls, out = self._run(500, TRANSIENT_BODY, responses=1)
        self.assertEqual(out, {"ok": True},
                         "is_transient の 500 でバッチが落ちている（1 回で終わってはいけない）")
        self.assertEqual(len(calls), 2)

    def test_client_error_is_still_fatal(self) -> None:
        calls, out = self._run(400, '{"error":{"message":"bad","code":100}}', responses=99)
        self.assertIsInstance(out, RuntimeError)
        self.assertEqual(len(calls), 1, "4xx まで再送している")

    def test_rate_limit_is_not_swallowed_by_the_retry(self) -> None:
        calls, out = self._run(400, '{"error":{"message":"rate","code":4}}', responses=99)
        self.assertIsInstance(out, M.RateLimited)
        self.assertEqual(len(calls), 1)

    def test_not_discoverable_is_not_swallowed_by_the_retry(self) -> None:
        calls, out = self._run(400, '{"error":{"message":"no user","code":110}}', responses=99)
        self.assertIsInstance(out, M.AccountNotDiscoverable)
        self.assertEqual(len(calls), 1)


class _FakeResp:
    def __init__(self, body):
        self._body = body
        self.headers = {}

    def read(self):
        return self._body.read()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TransientRetry(unittest.TestCase):
    def test_transient_is_retried_until_it_succeeds(self) -> None:
        calls = []

        def fake(url, timeout=30.0):
            calls.append(url)
            if len(calls) < 3:
                raise M._TransientIGError('IG API 500: {"is_transient":true}')
            return {"ok": True}

        with mock.patch.object(M, "_get_once", fake), mock.patch.object(M.time, "sleep"):
            self.assertEqual(M._get("https://example/x"), {"ok": True})
        self.assertEqual(len(calls), 3, "一時エラーで再送していない")

    def test_transient_gives_up_after_the_limit(self) -> None:
        def always(url, timeout=30.0):
            raise M._TransientIGError('IG API 500: {"is_transient":true}')

        with mock.patch.object(M, "_get_once", always), mock.patch.object(M.time, "sleep"):
            with self.assertRaises(RuntimeError):
                M._get("https://example/x")

    def test_non_transient_is_not_retried(self) -> None:
        calls = []

        def fake(url, timeout=30.0):
            calls.append(url)
            raise RuntimeError("IG API 400: bad request")

        with mock.patch.object(M, "_get_once", fake), mock.patch.object(M.time, "sleep"):
            with self.assertRaises(RuntimeError):
                M._get("https://example/x")
        self.assertEqual(len(calls), 1, "一時的でない失敗まで再送している")

    def test_which_failures_count_as_transient(self) -> None:
        self.assertTrue(M._is_transient({"is_transient": True}, 500))
        self.assertTrue(M._is_transient({}, 503), "5xx は相手側の失敗")
        self.assertFalse(M._is_transient({}, 400), "4xx はこちらの誤り")
        self.assertFalse(M._is_transient({"code": 110}, 400))

    def test_rate_limit_and_not_discoverable_stay_separate(self) -> None:
        # 再送に巻き込むと «待つべきもの» を待たず «飛ばすべきもの» を飛ばさなくなる。
        self.assertTrue(issubclass(M.RateLimited, Exception))
        self.assertTrue(issubclass(M.AccountNotDiscoverable, Exception))
        self.assertFalse(issubclass(M.RateLimited, M._TransientIGError))
        self.assertFalse(issubclass(M.AccountNotDiscoverable, M._TransientIGError))


if __name__ == "__main__":
    unittest.main()
