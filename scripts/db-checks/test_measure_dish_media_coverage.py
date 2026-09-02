"""#1782 measure_dish_media_coverage.py の read-only 切り替え順序をガードするテスト。

2026-09-02 に実測した事故（`db-script-run.yml` から dev へ実行）:
接続を最初から readonly セッションで張ったまま `CREATE TEMP TABLE ... AS` を実行し、
psycopg2.errors.ReadOnlySqlTransaction で落ちた
（run: https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/33674497269）。
PostgreSQL の read-only トランザクションは CREATE/ALTER/DROP を種類を問わず禁じるため、
一時テーブルであっても DDL は通らない。

修正後は「一時テーブルを作り終えるまでは read-only にしない → 作り終えた直後に
`SET default_transaction_read_only = on` へ切り替える」順序を守る必要がある。
DB 接続を実際には張らず、psycopg2.connect をフェイクへ差し替えて呼び出し順序だけを検査する。
"""

from __future__ import annotations

import sys
import types
import unittest
from unittest import mock

try:
    import psycopg2  # noqa: F401
except ImportError:
    fake_psycopg2 = types.ModuleType("psycopg2")
    fake_errors = types.ModuleType("psycopg2.errors")

    class ReadOnlySqlTransaction(Exception):
        pass

    class QueryCanceled(Exception):
        pass

    fake_errors.ReadOnlySqlTransaction = ReadOnlySqlTransaction
    fake_errors.QueryCanceled = QueryCanceled
    fake_psycopg2.errors = fake_errors
    fake_psycopg2.connect = mock.MagicMock()
    sys.modules["psycopg2"] = fake_psycopg2
    sys.modules["psycopg2.errors"] = fake_errors

import measure_dish_media_coverage as sut


class FakeCursor:
    """cur.execute() の呼び出し列を、実行順のまま記録するだけの最小フェイク。"""

    def __init__(self) -> None:
        self.executed_sql: list[str] = []
        self._last_sql = ""

    def execute(self, sql, *args, **kwargs) -> None:
        self.executed_sql.append(sql)
        self._last_sql = sql

    def fetchone(self):
        if "current_user" in self._last_sql:
            return ("test_user", "test_db")
        return (0,)

    def fetchall(self):
        return []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc_info: object) -> bool:
        return False


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor
        self.set_session_calls: list[dict] = []

    def set_session(self, **kwargs) -> None:
        self.set_session_calls.append(kwargs)

    def cursor(self) -> FakeCursor:
        return self._cursor

    def __enter__(self) -> "FakeConnection":
        return self

    def __exit__(self, *exc_info: object) -> bool:
        return False


class ReadOnlySwitchOrderTest(unittest.TestCase):
    def setUp(self) -> None:
        self.cursor = FakeCursor()
        self.connection = FakeConnection(self.cursor)
        self._patchers = [
            mock.patch.object(sut.psycopg2, "connect", return_value=self.connection),
            mock.patch.dict(sut.os.environ, {"DATABASE_URL": "postgres://fake"}),
            mock.patch.object(sys, "argv", ["measure_dish_media_coverage.py"]),
        ]
        for p in self._patchers:
            p.start()
            self.addCleanup(p.stop)

    def test_connection_is_not_opened_as_readonly(self) -> None:
        # readonly=True を接続時に付けると、直後の CREATE TEMP TABLE が
        # ReadOnlySqlTransaction で落ちる。autocommit=True だけを付けること。
        sut.main()
        self.assertEqual(1, len(self.connection.set_session_calls))
        kwargs = self.connection.set_session_calls[0]
        self.assertNotIn("readonly", kwargs)
        self.assertTrue(kwargs.get("autocommit"))

    def test_read_only_switch_happens_after_temp_table_and_before_stage4(self) -> None:
        sut.main()
        executed = self.cursor.executed_sql

        create_temp_table_idx = next(
            i for i, sql in enumerate(executed) if sql.startswith("CREATE TEMP TABLE")
        )
        analyze_idx = next(
            i for i, sql in enumerate(executed) if sql.startswith("ANALYZE ")
        )
        read_only_idx = executed.index("SET default_transaction_read_only = on")
        stage4_idx = next(
            i for i, sql in enumerate(executed) if "GROUP BY category_id" in sql
        )

        # 一時テーブル作成 → 索引作成完了(ANALYZE) → read-only 切り替え → Stage4 の順を固定する。
        # ここが崩れると、DDL 区間の途中で read-only になって落ちるか、
        # 逆に読み取り専用のはずの Stage4/5 が read-only になっていないまま走る。
        self.assertLess(create_temp_table_idx, analyze_idx)
        self.assertLess(analyze_idx, read_only_idx)
        self.assertLess(read_only_idx, stage4_idx)


if __name__ == "__main__":
    unittest.main()
