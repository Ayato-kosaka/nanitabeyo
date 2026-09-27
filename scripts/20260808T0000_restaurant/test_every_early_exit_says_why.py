"""#1947 «途中で降りた» が要約から消えない — 降り方が増えても消えない形にする。

## 何が起きたか

2026-09-27、キャプション後埋め（`4_14`）の第 39〜41 ラウンドは **3 本続けて相手側に
閉じられて降りていた**のに、ログの最終行は 「キャプション後入れ完了: …」 だった。
オーナーへは «第 41 ラウンド完了・本文率 42.7%» と報告した。**完走していない。**

真因は «遅い» でも «遮断» でもなく、**降りた理由を記録する場所が分岐ごとに違っていた**こと。

    soft_block（空だけが続く）      → state["stopped_by"] = "soft_block"  … 要約が読む
    非 200 の連続（相手の遮断）      → state["stop"] = True だけ           … 要約に出ない ★
    --max-minutes 切れ               → 何も書かない                        … 要約に出ない ★

要約は `if state["stopped_by"] == "soft_block":` と **1 つの値を名指し**していたので、
★ の 2 本は «完了» と同じ見た目で終わった。

## パターンとして言い直すと

**«相手側の都合で途中で降りた» を、降り方の分岐ごとに別の場所へ記録していた。**
要約が片方しか読まないので、残りの降り方は黙って «完走» に化ける。

だからこのテストは «soft_block を消すな» ではなく、次の形を固定する。

1. 降りる分岐は **どれも** 1 つの変数（`stopped_by`）へ理由を書く
2. 要約は **その変数の中身を名指しせず**、入っていること自体で分岐する
3. 書く理由の語は表（`STOPPED_BY_LABEL`）に載っている（載せ忘れれば «理由不明» と出る）
4. «何本で降りたか» を 0 で表さない（`x or len(...)` は 1 本目で降りた run を «全部» と言う）

## 当てはまらないと判定したもの（実データで確認した）

- `3_2_search_google_place_ids.py`: 日次クォータ枯渇で `step["quota_exhausted"]` を残し、
  さらに `RuntimeError` を投げて run を赤くする。**既にこの形の手本**なので触らない
- `4_6` / `4_12` の `break`: すべて **自分で決めた上限**（`--max-posts` / `max_urls`）に
  当たったもので、その上限値は要約に載っている。«相手側の都合» ではないので対象外
- `4_2_collect_account_posts.py`: 最終行が「時間で打ち切り / 在庫を処理しきった」を
  必ず出し分けている。既に条件を満たしている
- `5_1_apply_resolve.py`: 締め切りで降りたとき「%d 件は次の run へ回します」を出す。
  同上
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def src(name: str) -> str:
    return (HERE / name).read_text(encoding="utf-8")


CAPTIONS = "4_14_fetch_missing_captions.py"
SEARCH = "4_7_collect_search_api_posts.py"
CC_POSTS = "4_5_collect_cc_instagram_posts.py"
CC_WAT = "4_9_scan_cc_wat_instagram.py"


class TheCaptionRoundSaysWhyItStopped(unittest.TestCase):
    """★ 実際に 3 ラウンド誤報した分岐。"""

    def setUp(self) -> None:
        self.s = src(CAPTIONS)

    def test_the_consecutive_error_branch_records_a_reason(self) -> None:
        i = self.s.index("非 200 が %d 回続いたのでこのバッチを打ち切ります")
        self.assertIn('state["stopped_by"]', self.s[i:i + 600])

    def test_the_deadline_records_a_reason(self) -> None:
        self.assertIn('"max_minutes"', self.s)

    def test_the_summary_does_not_name_one_reason(self) -> None:
        """`== "soft_block"` へ戻ったら落ちる。新しい降り方が黙って消える形だから。"""
        self.assertNotIn('state["stopped_by"] == "soft_block"', self.s)
        self.assertIn('if state["stopped_by"]:', self.s)

    def test_every_reason_it_writes_is_in_the_label_table(self) -> None:
        written = set(re.findall(r'state\["stopped_by"\]\s*=\s*"([a-z_]+)"', self.s))
        labelled = set(re.findall(r'^\s+"([a-z_]+)": "', self.s[
            self.s.index("STOPPED_BY_LABEL = {"):
            self.s.index("}", self.s.index("STOPPED_BY_LABEL = {"))], re.M))
        self.assertTrue(written, "降りる理由を 1 つも書いていない")
        self.assertEqual(written - labelled, set())

    def test_the_summary_headline_changes_when_it_stopped(self) -> None:
        """«完了» と同じ見た目で終わらせない。"""
        self.assertIn("は途中で降りました", self.s)

    def test_it_says_how_far_it_got_against_the_target(self) -> None:
        self.assertIn("件しか当たれずに降りました", self.s)

    def test_a_block_says_the_rest_is_carried_over_and_not_worked_around(self) -> None:
        """遮断で降りたときは «残りは次が引き継ぐ» と言い、回避策は勧めない。

        ⚠️ «時間を空けてから流せ» と書いていたが、**18 ラウンドの実測で否定された**。
        間隔 1〜263 分に対し到達点は 3,755〜17,103 件で相関が無い（最長 263 分は 5,373 件、
        唯一の完走は 25 分の間隔のあと）。助言が間違っていたので文言を直した。
        """
        i = self.s.index("件しか当たれずに降りました")
        tail = self.s[i:i + 500]
        self.assertIn('("soft_block", "http_block")', tail)
        self.assertIn("回避策は実装しない", tail)
        self.assertNotIn("時間を空けてから", tail)

    def test_the_falsified_advice_is_not_left_in_the_tool(self) -> None:
        self.assertNotIn("時間を空けてから次のラウンドを流すこと", self.s)

    def test_the_measurement_that_falsified_it_is_recorded(self) -> None:
        """助言を消した理由を道具の中に残す（理由の無い削除は誰かが戻す）。"""
        self.assertIn("18 ラウンドの実測で否定された", self.s)


class TheSearchRoundSaysWhyItStopped(unittest.TestCase):
    def setUp(self) -> None:
        self.s = src(SEARCH)

    def test_the_quota_break_records_a_reason(self) -> None:
        i = self.s.index("except _QuotaExhausted:")
        self.assertIn("stopped_by", self.s[i:i + 600])

    def test_the_step_record_carries_it(self) -> None:
        self.assertIn('result["stopped_by"]', self.s)

    def test_the_summary_warns_when_it_was_cut_off(self) -> None:
        self.assertIn("クエリで降りました", self.s)


class TruncatedStreamsAreCounted(unittest.TestCase):
    """半分しか読めていないファイルを «読んだ 1 本» として黙って数えない。"""

    def test_cc_posts_counts_them(self) -> None:
        s = src(CC_POSTS)
        self.assertIn('"wat_files_truncated"', s)
        self.assertIn("本は途中で切れています", s)

    def test_cc_wat_counts_them(self) -> None:
        s = src(CC_WAT)
        self.assertIn('result["files_truncated"]', s)
        self.assertIn("本は途中で切れています", s)

    def test_cc_wat_scan_file_returns_the_flag(self) -> None:
        s = src(CC_WAT)
        self.assertIn("return posts, profiles, seen_bytes, truncated", s)


class ZeroIsNotHowYouSayHowFarItGot(unittest.TestCase):
    """`stopped_early or len(mine)` は **1 本目で降りた run を «全部読んだ» と報告する**。"""

    def test_no_script_reports_progress_with_a_falsy_or(self) -> None:
        bad = []
        for f in sorted(HERE.glob("[0-9]*_*.py")):
            for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                if re.search(r'(result|step)\[[^]]+\]\s*=\s*\w+\s+or\s+(len\(|\d)', line):
                    bad.append(f"{f.name}:{n}: {line.strip()}")
        self.assertEqual(bad, [], "進捗の件数を falsy な 0 で表している:\n" + "\n".join(bad))


if __name__ == "__main__":
    unittest.main()
