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
from pathlib import Path
from unittest import mock

# ⚠️ `python3 -m unittest scripts/db-checks/test_...py` のようにリポジトリルートから
#    呼ばれても import できるようにする（CI はこの形で回す。#1782 2026-10-01）。
sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import psycopg2  # noqa: F401
    import psycopg2.extras  # noqa: F401
except ImportError:
    fake_psycopg2 = types.ModuleType("psycopg2")
    fake_errors = types.ModuleType("psycopg2.errors")
    fake_extras = types.ModuleType("psycopg2.extras")

    class Error(Exception):
        """psycopg2.Error（例外の基底）。temp_file_limit を張れなかった側で要る。"""

    class ReadOnlySqlTransaction(Error):
        pass

    class QueryCanceled(Error):
        pass

    fake_errors.ReadOnlySqlTransaction = ReadOnlySqlTransaction
    fake_errors.QueryCanceled = QueryCanceled
    fake_psycopg2.Error = Error
    fake_psycopg2.errors = fake_errors
    fake_psycopg2.connect = mock.MagicMock()
    # execute_values はテスト対象内で locations が空（FakeCursor.fetchall() == []）の
    # ときは呼ばれない実装になっているため、import できることだけを保証すればよい。
    fake_extras.execute_values = mock.MagicMock()
    fake_psycopg2.extras = fake_extras
    sys.modules["psycopg2"] = fake_psycopg2
    sys.modules["psycopg2.errors"] = fake_errors
    sys.modules["psycopg2.extras"] = fake_extras

import measure_dish_media_coverage as sut


class FakeCursor:
    """cur.execute() の呼び出し列を、実行順のまま記録するだけの最小フェイク。"""

    def __init__(self, fail_on: str | None = None) -> None:
        self.executed_sql: list[str] = []
        self._last_sql = ""
        # «この部分文字列を含む SQL だけ失敗させる» 口（temp_file_limit は superuser
        # でないと張れないので、張れなかった側の挙動も縛るために要る）
        self._fail_on = fail_on

    def execute(self, sql, *args, **kwargs) -> None:
        self.executed_sql.append(sql)
        self._last_sql = sql
        if self._fail_on and self._fail_on in sql:
            raise sut.psycopg2.Error(f"permission denied to set parameter: {self._fail_on}")

    def fetchone(self):
        if "current_user" in self._last_sql:
            return ("test_user", "test_db")
        if "covered_at_or_above_min" in self._last_sql:
            # Stage5 のバケット集計クエリ(build_stage5_summary_sql)は3列返す。
            return (0, 0, 0)
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


class TempFileLimitTest(unittest.TestCase):
    """#1782 2026-10-01 の DiskFull。**共有ディスクを埋める代わりに自分だけ落ちる**へ倒す。

    dev と public は同じ Postgres インスタンスなので（#2006）、Stage5 の一時ファイルが
    溢れると本番側の書き込みまで巻き込みうる。`temp_file_limit` は superuser でないと
    張れないことがあるので、**張れたかどうかをログに出して続行する**（黙って続行しない）。
    """

    def _run(self, argv: list[str], fail_on: str | None = None) -> FakeCursor:
        cursor = FakeCursor(fail_on=fail_on)
        connection = FakeConnection(cursor)
        patchers = [
            mock.patch.object(sut.psycopg2, "connect", return_value=connection),
            mock.patch.dict(sut.os.environ, {"DATABASE_URL": "postgres://fake"}),
            mock.patch.object(sys, "argv", ["measure_dish_media_coverage.py", *argv]),
        ]
        for p in patchers:
            p.start()
            self.addCleanup(p.stop)
        sut.main()
        return cursor

    def test_limit_is_set_before_the_stage5_aggregation(self) -> None:
        cursor = self._run([])
        executed = cursor.executed_sql
        limit_idx = next(i for i, sql in enumerate(executed) if "temp_file_limit" in sql)
        aggregation_idx = next(
            i for i, sql in enumerate(executed) if "covered_at_or_above_min" in sql
        )
        self.assertLess(limit_idx, aggregation_idx)

    def test_limit_is_set_before_statement_timeout(self) -> None:
        """⚠️ 時間で殺される前にディスクで殺せる順でなければ意味が無い。"""
        cursor = self._run([])
        executed = cursor.executed_sql
        limit_idx = next(i for i, sql in enumerate(executed) if "temp_file_limit" in sql)
        timeout_idx = next(i for i, sql in enumerate(executed) if "SET statement_timeout" in sql)
        self.assertLess(limit_idx, timeout_idx)

    def test_zero_means_do_not_set_it(self) -> None:
        cursor = self._run(["--temp-file-limit-mb", "0"])
        self.assertFalse([sql for sql in cursor.executed_sql if "temp_file_limit" in sql])

    def test_measurement_continues_when_the_limit_cannot_be_set(self) -> None:
        """superuser でない接続でも測定そのものは止めない（止めるのは過剰）。"""
        cursor = self._run([], fail_on="temp_file_limit")
        # SET は試みている
        self.assertTrue([sql for sql in cursor.executed_sql if "temp_file_limit" in sql])
        # そのあと Stage5 の集計まで到達している
        self.assertTrue([sql for sql in cursor.executed_sql if "covered_at_or_above_min" in sql])


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

    def test_area_cells_temp_table_is_also_built_before_read_only_switch(self) -> None:
        # #1782 でグリッド近似からS2セルへ直したとき、area_cells_tmp という
        # 2本目の一時テーブルが増えた。usable_dish_media_tmp と同様、こちらも
        # read-only へ切り替える前に作成・ANALYZE まで終えている必要がある。
        sut.main()
        executed = self.cursor.executed_sql

        create_temp_table_indices = [
            i for i, sql in enumerate(executed) if sql.startswith("CREATE TEMP TABLE")
        ]
        self.assertEqual(
            3,
            len(create_temp_table_indices),
            "usable_dish_media_tmp / area_cells_tmp / stage5_driver_tmp の3本が作られているはず",
        )
        area_cells_create_idx = next(
            i for i, sql in enumerate(executed) if "area_cells_tmp" in sql and sql.startswith("CREATE TEMP TABLE")
        )
        read_only_idx = executed.index("SET default_transaction_read_only = on")
        self.assertLess(area_cells_create_idx, read_only_idx)

    def test_stage5_driver_temp_table_is_built_before_read_only_switch(self) -> None:
        """#1782 2026-10-01 の DiskFull の修正で 3 本目の一時テーブルが増えた。

        ⚠️ **これは DDL なので read-only へ切り替える前でなければ落ちる**
        （run 33674497269 で踏んだのと同じ形。read-only トランザクションは
        一時テーブルであっても CREATE を通さない）。順序をここで固定する。
        """
        sut.main()
        executed = self.cursor.executed_sql

        driver_create_idx = next(
            i
            for i, sql in enumerate(executed)
            if sut.coverage_sql.DEFAULT_STAGE5_DRIVER_TABLE_NAME in sql
            and sql.startswith("CREATE TEMP TABLE")
        )
        read_only_idx = executed.index("SET default_transaction_read_only = on")
        self.assertLess(driver_create_idx, read_only_idx)

    def test_stage5_driver_is_built_after_the_tables_it_reads(self) -> None:
        """driver は usable 一時テーブルを読むので、その後でなければ作れない。"""
        sut.main()
        executed = self.cursor.executed_sql
        usable_create_idx = next(
            i
            for i, sql in enumerate(executed)
            if sut.coverage_sql.DEFAULT_TEMP_TABLE_NAME in sql
            and sql.startswith("CREATE TEMP TABLE")
        )
        driver_create_idx = next(
            i
            for i, sql in enumerate(executed)
            if sut.coverage_sql.DEFAULT_STAGE5_DRIVER_TABLE_NAME in sql
            and sql.startswith("CREATE TEMP TABLE")
        )
        self.assertLess(usable_create_idx, driver_create_idx)

    def test_restaurant_locations_are_read_before_area_cells_temp_table(self) -> None:
        sut.main()
        executed = self.cursor.executed_sql
        locations_idx = executed.index(sut.coverage_sql.build_restaurant_locations_sql())
        area_cells_create_idx = next(
            i
            for i, sql in enumerate(executed)
            if "area_cells_tmp" in sql and sql.startswith("CREATE TEMP TABLE")
        )
        self.assertLess(locations_idx, area_cells_create_idx)


class ComputeAreaCellsTest(unittest.TestCase):
    """S2セル化そのもの（座標→セルID）は normalization.s2_cell_id() の責任なので、
    ここでは compute_area_cells() のグルーピング・重心計算だけを、s2sphere に依存しない
    フェイクの s2_cell_id で検査する。
    """

    def test_groups_by_cell_and_averages_centroid(self) -> None:
        with mock.patch.object(
            sut,
            "s2_cell_id",
            side_effect=lambda lat, lng, level: 1 if lat < 1 else 2,
        ):
            result = sut.compute_area_cells(
                [(0.0, 0.0), (0.0, 2.0), (5.0, 5.0)], s2_level=14
            )

        by_cell = {cell_id: (lat, lng, count) for cell_id, lat, lng, count in result}
        self.assertEqual({1, 2}, set(by_cell))
        self.assertEqual((0.0, 1.0, 2), by_cell[1])
        self.assertEqual((5.0, 5.0, 1), by_cell[2])

    def test_empty_locations_produce_no_cells(self) -> None:
        with mock.patch.object(sut, "s2_cell_id"):
            self.assertEqual([], sut.compute_area_cells([], s2_level=14))


if __name__ == "__main__":
    unittest.main()
