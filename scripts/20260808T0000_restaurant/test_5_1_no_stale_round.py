"""#1947 **入力が 1 件も変わっていないラウンドを走らせない**ことを固定する。

## 何が起きたか（実測）

2026-09-27〜28、店名リンクの resolve を 3 ラウンド流した（run
[1444](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/1444) /
1456 / 1464、各 `--max-minutes 150` = 計 7.5 時間）。3 回とも結果が同じだった。

| ラウンド | 処理した投稿 | matched |
| --- | ---: | ---: |
| 第8 (1444) | 73,890 | 400 |
| 第9 (1456) | 73,890 | 402 |
| 第10 (1464) | 73,890 | 402 |

2026-09-30 に BigQuery で測ると、`sns_name_place_post_link` の 73,890 投稿は
**全部が «リンクが付いた後» に解かれ済み**だった（`never_resolved = 0`,
`input_newer = 0`、最後のリンクは 2026-09-27 13:47、3 ラウンドはすべてそれ以降）。
つまり 7.5 時間は **答えが変わり得ないことが事前に分かる仕事**だった。

## パターンとして 1 文で

**やることリストを «まだこの run で処理していない» だけで作ると、«前回から入力が
何も変わっていない» ラウンドを丸ごと走らせてしまう。**

ログ末尾の «仕事の 100% が解き直し» という警告は出ていた。しかしそれは
**150 分使い切ったあと**に出るので、次のラウンドを止める役に立たない。
気づける場所は «やることリストを取り出した直後» しかない。

## 水平展開（同じ形を全部当たった）

| script | やることリストの作り方 | 判定 |
| --- | --- | --- |
| `5_1_apply_resolve.py` | run_id × resolve_version の anti-join | **当てはまる → 直した** |
| `4_2_collect_account_posts.py` | `--skip-collected-scope any` で run をまたいで除外できる | 当てはまらない（既に横断の除外を持つ） |
| `4_18_resolve_place_id_by_name.py` | 問い合わせ済みキーを除外し «未問い合わせ N 件» を必ず出す | 当てはまらない |
| `4_21_link_name_place_to_posts.py` | 台帳へ貼ったのに seed が増えないときに例外で落ちる | 当てはまらない |
| `4_14_fetch_missing_captions.py` | 対象は «本文が無い投稿»。埋めるたびに必ず減る | 当てはまらない（入力が古いまま同じ対象を引くことがない） |
| `9_1_build_sns_dish_media_catalog.py` | 毎回作り直す。cat21〜38 は柱の数字が同じだが、**店数は +1,408 で入力は変わっている** | 当てはまらない（同じ入力での作り直しではない） |

## 逆側（正常なのに赤くしない）

解き直しに意味が無いという意味ではない。resolve や店名辞書を直した直後の解き直しは
効く（2026-09-21 は店獲得の 76% が解き直しから出た）。その操作は `--resolve-version` を
上げて行うので、**新しい version では 1 件も «同じ version の resolve 済み» を持たず、
門は 0 を返さない**。ここもテストで固定する。
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

_spec = importlib.util.spec_from_file_location("apply_resolve", HERE / "5_1_apply_resolve.py")
apply_resolve = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(apply_resolve)

SOURCE = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")


class _FakePipeline:
    def __init__(self) -> None:
        self.sql = ""

    @property
    def dataset_ref(self) -> str:
        return "proj.ds"

    def table(self, name: str) -> str:
        return f"proj.ds.{name}"

    def execute(self, sql, params=None):
        self.sql = sql
        return []


def _sql(**kwargs) -> str:
    pipeline = _FakePipeline()
    apply_resolve._fetch_unresolved(pipeline, "raw-run", "res-run", "v1", 100, **kwargs)
    return " ".join(pipeline.sql.split())


def _post(*, last: dt.datetime | None, got: dt.datetime | None):
    return {"post_id": "p", "input_at": got, "same_version_resolved_at": last}


T0 = dt.datetime(2026, 9, 27, 13, 47, tzinfo=dt.timezone.utc)
T1 = dt.datetime(2026, 9, 28, 2, 2, tzinfo=dt.timezone.utc)


class TheWorkListCarriesFreshness(unittest.TestCase):
    """やることリストは «入力の時刻» と «同じ version で最後に解いた時刻» を持ち帰る。"""

    def test_fetch_selects_both_timestamps(self) -> None:
        sql = _sql()
        self.assertIn("AS input_at", sql)
        self.assertIn("AS same_version_resolved_at", sql)

    def test_same_version_is_keyed_on_the_version_not_the_run(self) -> None:
        # run_id で絞ると «別 run が解いた» のを «未処理» と読んでしまい、門が空振りする。
        sql = _sql()
        m = re.search(r"SELECT MAX\(v2\.resolved_at\).*?\) AS same_version_resolved_at", sql)
        self.assertIsNotNone(m, sql)
        self.assertIn("v2.resolve_version = @resolve_version", m.group(0))
        self.assertNotIn("v2.run_id", m.group(0))

    def test_post_ids_table_timestamp_overrides_raw_fetched_at(self) -> None:
        """古い投稿へ新しいリンクが付いた場合、入力の新しさは台帳の時刻である。"""
        sql = _sql(post_ids_table="proj.ds.sns_name_place_post_link",
                   post_ids_table_ts="linked_at")
        self.assertIn("GREATEST(r.fetched_at", sql)
        self.assertIn("MAX(t.linked_at)", sql)

    def test_without_a_timestamp_column_the_gate_is_loosened_not_reddened(self) -> None:
        """時刻列が分からないときは raw の fetched_at だけで見る（正常なのに赤くしない）。"""
        sql = _sql(post_ids_table="proj.ds.sns_caption_backfilled")
        self.assertIn("r.fetched_at AS input_at", sql)
        self.assertNotIn("GREATEST", sql)


class TheColumnNameIsAsked(unittest.TestCase):
    """表名 → 時刻列名の対応表を script へ書かない（増えた表で必ず陳腐化する）。"""

    def test_no_table_to_column_mapping_is_written_in_the_script(self) -> None:
        body = re.sub(r'""".*?"""', "", SOURCE, flags=re.S)
        for hardcoded in ("filled_at", "linked_at"):
            self.assertNotIn(hardcoded, body,
                             f"{hardcoded} を script へ写経している。INFORMATION_SCHEMA へ聞くこと")

    def test_the_question_is_asked_of_information_schema(self) -> None:
        sql = " ".join(apply_resolve.single_timestamp_column_sql("proj.ds", "t").split())
        self.assertIn("INFORMATION_SCHEMA.COLUMNS", sql)
        self.assertIn("data_type = 'TIMESTAMP'", sql)
        self.assertIn("table_name = @tbl", sql)


class CountingWhatCanStillChange(unittest.TestCase):
    def test_all_inputs_older_than_the_last_resolve_counts_zero(self) -> None:
        """店名リンク 3 ラウンドの実態。ここが 0 なら走らせてはいけない。"""
        posts = [_post(last=T1, got=T0) for _ in range(5)]
        self.assertEqual(apply_resolve.count_inputs_newer_than_last_resolve(posts), 0)

    def test_a_never_resolved_post_counts_as_fresh(self) -> None:
        """version を上げた解き直しは «この version では 1 件も解いていない» ので通る。"""
        posts = [_post(last=None, got=T0)]
        self.assertEqual(apply_resolve.count_inputs_newer_than_last_resolve(posts), 1)

    def test_a_newer_input_counts_as_fresh(self) -> None:
        posts = [_post(last=T0, got=T1), _post(last=T1, got=T0)]
        self.assertEqual(apply_resolve.count_inputs_newer_than_last_resolve(posts), 1)

    def test_a_missing_input_timestamp_counts_as_fresh(self) -> None:
        """時刻が取れなかったものは «変わったかもしれない» 側へ倒す（赤くしない）。"""
        posts = [_post(last=T1, got=None)]
        self.assertEqual(apply_resolve.count_inputs_newer_than_last_resolve(posts), 1)

    def test_it_does_not_crash_on_an_empty_work_list(self) -> None:
        self.assertEqual(apply_resolve.count_inputs_newer_than_last_resolve([]), 0)


class TheGateIsBeforeTheWork(unittest.TestCase):
    """門は «取り出した直後»。150 分使ってからの警告では次のラウンドを止められない。"""

    def test_the_gate_runs_before_the_pipeline_step_opens(self) -> None:
        gate = SOURCE.index("count_inputs_newer_than_last_resolve(posts)")
        step = SOURCE.index('with pipeline.step(run_id, "5_1_apply_resolve"')
        self.assertLess(gate, step, "門が仕事の開始より後ろにある")

    def test_a_stale_round_exits_nonzero(self) -> None:
        tail = SOURCE[SOURCE.index("count_inputs_newer_than_last_resolve(posts)"):]
        head = tail[:tail.index('with pipeline.step(run_id, "5_1_apply_resolve"')]
        self.assertIn("if fresh == 0:", head)
        self.assertIn("sys.exit(1)", head)

    def test_the_message_names_both_ways_out(self) -> None:
        self.assertIn("--skip-resolved-anywhere", SOURCE)
        tail = SOURCE[SOURCE.index("if fresh == 0:"):]
        head = tail[:tail.index("sys.exit(1)")]
        self.assertIn("--skip-resolved-anywhere", head)
        self.assertIn("--resolve-version", head)


class TheMeasurementThatMotivatedItIsRecorded(unittest.TestCase):
    """«なぜこの門が要るのか» を消さない（理由の無い門は次の人に外される）。"""

    def test_the_wasted_rounds_are_written_down(self) -> None:
        doc = apply_resolve.count_inputs_newer_than_last_resolve.__doc__ or ""
        self.assertIn("73,890", doc)
        self.assertIn("7.5 時間", doc)

    def test_the_counter_example_is_written_down(self) -> None:
        """«解き直しが効いた日» を書いておかないと、門を «解き直し禁止» と誤読される。"""
        doc = apply_resolve.count_inputs_newer_than_last_resolve.__doc__ or ""
        self.assertIn("76%", doc)


if __name__ == "__main__":
    unittest.main()
