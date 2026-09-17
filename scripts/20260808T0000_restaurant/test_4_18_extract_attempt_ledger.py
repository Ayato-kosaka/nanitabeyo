"""#1947 «キャプションから店名を抽出して、どこで消えたか» を投稿単位で残すことを固定する。

## なぜ要るか

`#1776` の取り分（カテゴリは判るのに配信できていない投稿）は 241,149 件で、そのうち
194,471 件は «店の手がかりが 1 つも無い» 群である。この群を救うのが供給を増やす唯一の
大きな打ち手なのに、**«その 8 割がどこで消えているか» を数える手段が無かった**。

`build_name_keys` は内訳（`no_store_name` / `no_area_hint` / `ok`）を昔から計算していたが、
**`LOGGER.info` にしか出していなかった**。ログは job が終われば runner ごと消えるので、
BigQuery からは «抽出を試みて何も出なかった投稿» が 1 件も見えない。
`sns_name_place_lookup` は (店名, 都道府県, 市区町村) がキーで `sample_post_id` しか持たず、
落ちた投稿はそこにも現れない。

これは CLAUDE.md の「見えないものは «無い» ではない」に当たる。**規則を触る前に
見えるようにする**。見えないまま規則を変えると、効いたかどうかを測れない。

## 固定するもの

- 投稿 1 件につき 1 行が記録される（3 つの outcome すべて）。**落ちた投稿こそ残す**のが
  目的なので、`ok` だけ記録する実装に戻さない。
- 既存の戻り値の形（2-tuple）を壊さない。`4_21` が `keys, reasons = ...` で受けている。
- `attempts` を渡さない呼び出しでは何も変わらない。
- `--dry-run` は «書き込みも無し» と宣言しているので書かない。
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location(
    "resolve_place_id_by_name", HERE / "4_18_resolve_place_id_by_name.py")
m = importlib.util.module_from_spec(_spec)
sys.modules["resolve_place_id_by_name"] = m
_spec.loader.exec_module(m)

SOURCE = (HERE / "4_18_resolve_place_id_by_name.py").read_text(encoding="utf-8")

# 「東京都中央区」が引ける最小の市区町村索引。
CITY = ("東京都", "中央区")
BY_PAIR = {CITY: (35.66, 139.76, 35.69, 139.79)}
UNIQ = {"中央区": [CITY]}
PREF_OF_UNIQUE_CITY = {"中央区": "東京都"}


def _post(post_id: str, caption: str | None, query: str | None = None) -> dict:
    return {"post_id": post_id, "caption": caption, "discovery_query": query}


class ExtractAttemptLedgerTest(unittest.TestCase):
    def _run(self, posts):
        attempts: list[dict] = []
        keys, reasons = m.build_name_keys(posts, BY_PAIR, UNIQ, PREF_OF_UNIQUE_CITY,
                                          attempts=attempts)
        return keys, reasons, attempts

    def test_one_row_per_post_including_the_ones_that_fell_out(self):
        """**落ちた投稿こそ**残る。ok だけ記録する実装へ戻さないための番人。"""
        posts = [
            _post("p_ok", "📍東京都中央区のラーメン花子 美味しかった"),
            _post("p_no_name", "今日はいい天気。ラーメン食べた"),
            _post("p_no_area", "📍「ラーメン花子」に行った"),
        ]
        keys, reasons, attempts = self._run(posts)
        self.assertEqual(len(attempts), len(posts),
                         "投稿 1 件につき 1 行でなければ «どこで消えたか» を数えられない")
        by_post = {a["post_id"]: a for a in attempts}
        self.assertEqual(set(by_post), {"p_ok", "p_no_name", "p_no_area"})
        # 内訳の合計と記録の件数が一致する（片方だけ数え落とす実装を弾く）
        self.assertEqual(sum(reasons.values()), len(attempts))
        for outcome in by_post.values():
            self.assertIn(outcome["outcome"], ("ok", "no_store_name", "no_area_hint"))

    def test_outcome_matches_the_counted_reason(self):
        """記録の outcome の内訳が `reasons` と一致する（2 箇所がずれない）。"""
        posts = [
            _post("a", "📍東京都中央区のラーメン花子"),
            _post("b", "なにも書いていない"),
            _post("c", "ただの散歩"),
        ]
        _keys, reasons, attempts = self._run(posts)
        for outcome, n in reasons.items():
            got = sum(1 for a in attempts if a["outcome"] == outcome)
            self.assertEqual(got, n, f"{outcome}: 台帳 {got} 件 / 内訳 {n} 件")

    def test_name_is_kept_even_when_the_area_was_not_found(self):
        """店名は採れて地点で落ちた投稿は、その店名を残す（次に何を足せばよいか分かる）。"""
        _keys, _reasons, attempts = self._run([_post("x", "📍「ラーメン花子」へ行った")])
        row = attempts[0]
        if row["outcome"] == "no_area_hint":
            self.assertTrue(row["store_name"],
                            "地点で落ちたのに店名を捨てると «あと地点だけ» の件数が数えられない")

    def test_callers_that_pass_no_sink_are_unaffected(self):
        """`attempts` を渡さない呼び出し（4_21）は今までどおり動く。"""
        posts = [_post("p", "📍東京都中央区のラーメン花子")]
        keys, reasons = m.build_name_keys(posts, BY_PAIR, UNIQ, PREF_OF_UNIQUE_CITY)
        self.assertEqual(sum(reasons.values()), 1)
        self.assertEqual(len(keys), reasons["ok"])

    def test_return_shape_stays_a_two_tuple_for_4_21(self):
        """4_21 は `keys, reasons = resolver.build_name_keys(...)` で受けている。"""
        got = m.build_name_keys([], BY_PAIR, UNIQ, PREF_OF_UNIQUE_CITY, attempts=[])
        self.assertEqual(len(got), 2)


class LedgerIsPersistedNotJustLoggedTest(unittest.TestCase):
    """内訳が «ログだけ» へ戻らないことを、書き込み側で固定する。"""

    def test_a_ledger_table_is_declared_and_created_at_runtime(self):
        self.assertIn("CREATE_EXTRACT_ATTEMPT_SQL", SOURCE)
        self.assertIn("CREATE TABLE IF NOT EXISTS", SOURCE)
        # 他の script と同じく «migration 頼みにせず自分で作る»（#1970 の反省）
        self.assertIn("CREATE_EXTRACT_ATTEMPT_SQL.replace", SOURCE)

    def test_the_ledger_is_written_before_the_execute_gate(self):
        """Google を叩かない実行でも内訳が残る。

        内訳は API を 1 回も呼ばずに決まる情報なので、`--execute` の有無に縛られては
        «クォータを使わずに測る» ができない。
        """
        write_at = SOURCE.index("_write_extract_attempts(pipeline, args, run_id, attempts)")
        gate_at = SOURCE.index("if args.dry_run or not args.execute:")
        self.assertLess(write_at, gate_at,
                        "--execute の門より後ろに置くと、クォータを使わずに内訳を採れない")

    def test_dry_run_writes_nothing(self):
        """`--dry-run` は «API も BigQuery 書き込みも無し» と宣言している。"""
        fn_at = SOURCE.index("def _write_extract_attempts")
        body = SOURCE[fn_at:fn_at + 2000]
        self.assertIn("args.dry_run", body)
        self.assertIn("args.no_bq_write", body)


if __name__ == "__main__":
    unittest.main()
