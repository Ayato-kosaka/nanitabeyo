"""#1273 resolve クライアントが接続を張り直さないことを固定する。

5_1 は 1 投稿 = 1 リクエストで数万回 resolve を叩く。`urllib.request.urlopen` は
リクエストごとに TCP+TLS を作って捨てるので、**サーバがほとんど何もしない投稿**
（キャプションだけ・エリア無しで店舗検索が走らない経路。実測 231ms/件）では
その張り直しが所要時間の大きな割合を占める。

ここで固定するのは «速さ» ではなく **«同じ接続が使い回されること» と
«使い回しが壊れたときに 1 度だけ張り直して再送すること»**。速さは環境で揺れるが、
この 2 つが壊れたら遅くなるのは確実で、しかも静かに壊れる。
"""

from __future__ import annotations

import json
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer

import common_sns


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    # ⚠️ 接続の本数を `id(self.connection)` で数えてはいけない。閉じたソケットの
    #    アドレスが再利用されると «別の接続» が同じ id になり、**単体では通るのに
    #    まとめて走らせると落ちる**（実際に起きた）。受理のたびに増える counter で数える。
    accepted: int = 0
    fail_next: list[str] = []
    status: int = 200
    status_queue: list[int] = []  # 先頭から 1 回ずつ使う（空なら status）

    def setup(self):  # 1 接続の受理につき 1 回だけ呼ばれる
        _Handler.accepted += 1
        super().setup()

    def log_message(self, *args):  # ログを黙らせる
        pass

    def do_POST(self):
        if _Handler.fail_next:
            _Handler.fail_next.pop()
            self.close_connection = True
            self.wfile.close()  # 応答せずに切る（相手に切られた状況を作る）
            return
        length = int(self.headers.get("content-length") or 0)
        self.rfile.read(length)
        body = json.dumps({"data": {"status": "ok"}}).encode()
        status = _Handler.status_queue.pop(0) if _Handler.status_queue else _Handler.status
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class KeepAliveTest(unittest.TestCase):
    def setUp(self) -> None:
        _Handler.accepted = 0
        _Handler.fail_next = []
        _Handler.status = 200
        self.srv = HTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"

    def tearDown(self) -> None:
        self.srv.shutdown()
        self.srv.server_close()

    def _client(self, **kw) -> common_sns.ResolveClient:
        c = common_sns.ResolveClient(base_url=self.base, **kw)
        c._jwt, c._jwt_exp = "stub", 1e18  # 署名鍵を要らなくする
        return c

    def test_one_connection_is_reused_for_many_requests(self) -> None:
        c = self._client()
        for _ in range(5):
            self.assertEqual(c.resolve_raw("https://www.instagram.com/p/x/"), {"data": {"status": "ok"}})
        self.assertEqual(_Handler.accepted, 1,
                         f"接続が使い回されていない: {_Handler.accepted} 本")

    def test_without_keep_alive_each_request_makes_a_new_connection(self) -> None:
        c = self._client(keep_alive=False)
        for _ in range(3):
            c.resolve_raw("https://www.instagram.com/p/x/")
        self.assertEqual(_Handler.accepted, 3)

    def test_a_dropped_connection_is_retried_once(self) -> None:
        c = self._client()
        c.resolve_raw("https://www.instagram.com/p/x/")  # 1 本目を張る
        _Handler.fail_next = ["x"]  # 次の 1 回だけ «応答せず切る»
        self.assertEqual(c.resolve_raw("https://www.instagram.com/p/x/"), {"data": {"status": "ok"}})

    def test_error_status_is_raised_as_urlerror_so_5_1_can_skip_the_post(self) -> None:
        # 5_1 は URLError / TimeoutError / ValueError しか捕まえない。ここで別系統の
        # 例外を出すと «その投稿だけ飛ばす» が効かず、ジョブごと落ちる。
        _Handler.status = 500
        c = self._client(retries=0)  # リトライそのものは RetryTest で見る
        with self.assertRaises(urllib.error.URLError):
            c.resolve_raw("https://www.instagram.com/p/x/")


if __name__ == "__main__":
    unittest.main()


class RetryTest(unittest.TestCase):
    """混雑（429）とサーバ側の一時失敗（5xx）は投稿を捨てずに投げ直す。

    実測（2026-09-05, dev, 同時 24 リクエスト）: 1 分で 500 が 82 件出て、中身は
    `EMAXCONNSESSION: max clients reached in session mode - pool_size: 15`
    ＝ Supabase のプーラの接続上限だった。**こちらが投げすぎたときだけ出る**ので
    少し待てば通る。捨てると同じ混雑に次の周回でまた当たる。
    """

    def setUp(self) -> None:
        _Handler.accepted = 0
        _Handler.fail_next = []
        _Handler.status = 200
        _Handler.status_queue = []
        self.srv = HTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"

    def tearDown(self) -> None:
        self.srv.shutdown()
        self.srv.server_close()

    def _client(self, **kw):
        c = common_sns.ResolveClient(base_url=self.base, **kw)
        c._jwt, c._jwt_exp = "stub", 1e18
        return c

    def test_500_is_retried_and_then_succeeds(self) -> None:
        _Handler.status_queue = [500]  # 1 回目だけ 500、2 回目は 200
        c = self._client(retries=2)
        c._backoff_s = lambda attempt: 0.0  # テストを待たせない
        self.assertEqual(c.resolve_raw("https://www.instagram.com/p/x/"), {"data": {"status": "ok"}})
        self.assertEqual(c.retried, 1)

    def test_400_is_not_retried(self) -> None:
        # 400 はこちらの組み立てが悪いので、投げ直しても同じ結果にしかならない。
        _Handler.status = 400
        c = self._client(retries=2)
        c._backoff_s = lambda attempt: 0.0
        with self.assertRaises(urllib.error.HTTPError):
            c.resolve_raw("https://www.instagram.com/p/x/")
        self.assertEqual(c.retried, 0)

    def test_gives_up_after_the_configured_number_of_retries(self) -> None:
        _Handler.status = 503
        c = self._client(retries=2)
        c._backoff_s = lambda attempt: 0.0
        with self.assertRaises(urllib.error.HTTPError):
            c.resolve_raw("https://www.instagram.com/p/x/")
        self.assertEqual(c.retried, 2)
