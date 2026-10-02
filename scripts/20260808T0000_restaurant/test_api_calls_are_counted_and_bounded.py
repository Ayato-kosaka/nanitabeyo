"""#1947 «外部 API を何回叩いたか» を数えず、上限も持たない状態を復活させない。

2026-10-01、`5_1` が dev の resolve API を **1 時間に約 8.5 万回**叩き、1 回ごとに
3〜5 行のログが出て、dev のログは 9 月上旬の 1 日数万行から **400〜600 万行/日** へ増えた
（合計 84 GiB。ログ保管 ≒¥6,098・Cloud Run ≒¥5,000）。

⚠️ **BigQuery のスキャン課金と同じ形である。** どちらも «呼んだ回数・読んだ量» を
どこにも数えておらず、費用が «仕事の量» ではなく **«ループの回転数»** に比例していた。
テストはその «形» を固定する。

  1. 回数を数えている
  2. 上限で**止まる**（警告して続けない）
  3. **1 回ごとにログを出さない**（それをやると «ログ行数で課金» をこちらで再現する）
  4. 回数が run の durable な記録に残る
"""
import ast
import importlib.util
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).parent


def _load(name: str, filename: str):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


CS = _load("common_sns_for_cost_test", "common_sns.py")
RESOLVE_SRC = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")
CS_SRC = (HERE / "common_sns.py").read_text(encoding="utf-8")


class 回数を数える(unittest.TestCase):
    def test_数えた回数が出る(self):
        led = CS.ApiCallLedger()
        for _ in range(7):
            led.count()
        self.assertEqual(led.calls, 7)
        self.assertIn("7", led.summary())

    def test_予算が無いときは止まらない(self):
        led = CS.ApiCallLedger(max_calls=None)
        for _ in range(100_000):
            led.calls += 1
        self.assertFalse(led.would_exceed())
        self.assertIn("無制限", led.summary())

    def test_投げ直しも別に数える(self):
        led = CS.ApiCallLedger()
        led.retried += 3
        self.assertIn("投げ直し 3", led.summary())


class 上限で止まる(unittest.TestCase):
    def test_上限に達したら次を止める(self):
        led = CS.ApiCallLedger(max_calls=2)
        self.assertFalse(led.would_exceed())
        led.count()
        self.assertFalse(led.would_exceed())
        led.count()
        self.assertTrue(led.would_exceed(), "上限に達しても止まらない")

    def test_上限超過は例外で止める(self):
        # 「警告だけ出して続ける」では費用が止まらない。
        self.assertTrue(issubclass(CS.ApiCallBudgetExceeded, Exception))
        i = CS_SRC.index("if self.ledger.would_exceed():")
        self.assertIn("raise ApiCallBudgetExceeded", CS_SRC[i:i + 400])

    def test_予算超過はワーカーの例外処理に飲まれない(self):
        """⚠️ ここが要点。resolve の失敗として握られると、残り全件ぶん «失敗» が出て走り続ける。"""
        caught = next(n for n in ast.walk(ast.parse(RESOLVE_SRC))
                      if isinstance(n, ast.FunctionDef) and n.name == "_resolve_one")
        src = ast.get_source_segment(RESOLVE_SRC, caught) or ""
        self.assertNotIn("Exception", src,
                         "_resolve_one が広く握ると予算超過で止まれない")
        self.assertNotIn("RuntimeError", src)
        # ApiCallBudgetExceeded は RuntimeError なので、下の 3 つには当たらない。
        self.assertIn("except (urllib.error.URLError, TimeoutError, ValueError)", src)

    def test_既定の上限が入っている(self):
        self.assertIn('"--max-api-calls", type=int, default=200_000', RESOLVE_SRC)


class 一回ごとにログを出さない(unittest.TestCase):
    def test_報告は一定回数ごと(self):
        led = CS.ApiCallLedger()
        reported = sum(1 for _ in range(10_000) if led.count())
        self.assertEqual(reported, 10_000 // CS.ApiCallLedger.REPORT_EVERY,
                         "1 回ごとに報告していると、今回の «ログ行数で課金» を再現する")

    def test_報告間隔が1ではない(self):
        self.assertGreaterEqual(CS.ApiCallLedger.REPORT_EVERY, 1000)


class 回数がdurableな記録に残る(unittest.TestCase):
    def test_runの記録へ書いている(self):
        self.assertIn('"api_calls": 0,', RESOLVE_SRC)
        self.assertIn('step_params["api_calls"] = client.ledger.calls', RESOLVE_SRC)

    def test_途中で殺されても残るようflushで更新している(self):
        flush = next(n for n in ast.walk(ast.parse(RESOLVE_SRC))
                     if isinstance(n, ast.FunctionDef) and n.name == "_flush")
        self.assertIn('step_params["api_calls"]',
                      ast.get_source_segment(RESOLVE_SRC, flush) or "",
                      "最後にだけ書くと、途中で殺された run が 0 回と記録される")

    def test_最終報告に回数を載せている(self):
        self.assertIn("client.ledger.summary()", RESOLVE_SRC)


if __name__ == "__main__":
    unittest.main()
