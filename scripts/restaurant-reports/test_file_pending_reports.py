"""#1933 受け入れ条件 7 の «1 報告 = 1 Issue» で守りたい不変条件を固定する。

ネットワークにも DB にも出ない。ここで縛るのは次の 4 点。

1. **public な Issue へ `proposed_value` / `reporter_user_id` を出さない**
   （そもそも SELECT していないことを SQL の形で確かめる）
2. **二重起票しない**（マーカーによる索引。DB の NULL だけを根拠にしない）
3. **`--limit` を省略できない**（溜まった報告を一度に全部起票しない）
4. **`--schema public` を選べない**（本番へはオーナーの明示があるときだけ）
"""

from __future__ import annotations

import ast
import importlib.util
import pathlib
import unittest

MODULE_PATH = pathlib.Path(__file__).resolve().parent / "file_pending_reports.py"
spec = importlib.util.spec_from_file_location("file_pending_reports", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)

REPORT = {
    "id": "11111111-1111-4111-8111-111111111111",
    "restaurant_id": "22222222-2222-4222-8222-222222222222",
    "field": "opening_hours",
    "created_at": "2026-09-24T12:00:00+00:00",
}


class IssueBodyTest(unittest.TestCase):
    def test_body_has_the_machine_readable_marker(self) -> None:
        body = mod.issue_body(REPORT, web_base_url="https://example.com")
        found = mod.MARKER_RE.search(body)
        self.assertIsNotNone(found)
        self.assertEqual(found.group(1), REPORT["id"])

    def test_body_links_to_the_restaurant_screen(self) -> None:
        body = mod.issue_body(REPORT, web_base_url="https://example.com")
        self.assertIn("https://example.com/ja-JP/restaurant/" + REPORT["restaurant_id"], body)

    def test_body_mentions_the_owner(self) -> None:
        """受け入れ条件 7: 起票は bot が行い、本文で @Ayato-kosaka にメンションする。"""
        self.assertIn("@Ayato-kosaka", mod.issue_body(REPORT, web_base_url="https://example.com"))

    def test_body_cannot_contain_the_user_free_text(self) -> None:
        """⚠️ `proposed_value` を渡しても本文に出ない（そもそも読んでいない）。"""
        body = mod.issue_body(
            {**REPORT, "proposed_value": "田中太郎 090-0000-0000", "reporter_user_id": "u-1"},
            web_base_url="https://example.com",
        )
        self.assertNotIn("田中太郎", body)
        self.assertNotIn("090-0000-0000", body)
        self.assertNotIn("u-1", body)


class PendingSqlTest(unittest.TestCase):
    """⚠️ **«書かない» を気をつけで守らない。** 取ってこなければ差し込めない。"""

    def test_does_not_select_the_sensitive_columns(self) -> None:
        select_clause = mod.PENDING_SQL.split("FROM")[0]
        self.assertNotIn("proposed_value", select_clause)
        self.assertNotIn("reporter_user_id", select_clause)

    def test_only_takes_unfiled_pending_rows(self) -> None:
        sql = " ".join(mod.PENDING_SQL.split())
        self.assertIn("status = 'pending'", sql)
        self.assertIn("github_issue_number IS NULL", sql)

    def test_oldest_first(self) -> None:
        sql = " ".join(mod.PENDING_SQL.split())
        self.assertIn("ORDER BY created_at, id", sql)

    def test_limit_is_bound_not_interpolated(self) -> None:
        self.assertIn("LIMIT %(limit)s", mod.PENDING_SQL)


class ArgsTest(unittest.TestCase):
    def test_limit_is_required(self) -> None:
        with self.assertRaises(SystemExit):
            mod.parse_args(["--schema", "dev"])

    def test_public_schema_is_not_selectable(self) -> None:
        with self.assertRaises(SystemExit):
            mod.parse_args(["--schema", "public", "--limit", "1"])

    def test_dry_run_defaults_to_off(self) -> None:
        self.assertFalse(mod.parse_args(["--limit", "1"]).dry_run)


class WriteGuardTest(unittest.TestCase):
    """⚠️ dry-run で GitHub / DB へ書きうる呼び出しが走らないことを、ソースの形で見る。"""

    def _main_source(self) -> ast.FunctionDef:
        tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == "main":
                return node
        raise AssertionError("main() が見つからない")

    def test_dry_run_returns_before_any_github_call(self) -> None:
        source = MODULE_PATH.read_text(encoding="utf-8")
        head, _, tail = source.partition("dry-run のため GitHub へも DB へも書いていません")
        self.assertTrue(tail, "dry-run の出口が見つからない")
        # 出口より前に GitHubClient を組み立てていないこと
        self.assertNotIn("GitHubClient(", head.split("def main")[-1])

    def test_dry_run_pins_the_transaction_read_only(self) -> None:
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn("SET default_transaction_read_only = on", source)

    def test_commits_one_report_at_a_time(self) -> None:
        """まとめて commit すると «Issue は立っているのに DB は NULL» が大量に残る。"""
        source = MODULE_PATH.read_text(encoding="utf-8")
        body = source.split("for report in reports:")[-1]
        self.assertGreaterEqual(body.count("conn.commit()"), 2)


class DuplicateGuardTest(unittest.TestCase):
    def test_index_covers_closed_issues(self) -> None:
        """⚠️ 反映 / 却下が済んで close された Issue も «起票済み» である。"""
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn('"state": "all"', source)

    def test_marker_round_trips(self) -> None:
        found = mod.MARKER_RE.search(mod.marker(REPORT["id"]))
        self.assertIsNotNone(found)
        self.assertEqual(found.group(1), REPORT["id"])

    def test_already_filed_backfills_instead_of_creating(self) -> None:
        """索引に居る報告は **起票せずに番号を書き戻すだけ**。"""
        source = MODULE_PATH.read_text(encoding="utf-8")
        branch = source.split("existing = already.get(")[-1].split("number = client.create_issue")[0]
        self.assertIn("UPDATE_ISSUE_NUMBER_SQL", branch)
        self.assertIn("continue", branch)


if __name__ == "__main__":
    unittest.main()
