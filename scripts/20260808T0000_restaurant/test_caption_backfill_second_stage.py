"""#1947 後入れしたキャプションを «埋めたものだけ» 解き直せるようにする（2 段目）。

2026-09-25、`4_14` は 7 ラウンドで約 2 万件のキャプションを埋めたが、**カテゴリへ 1 件も
効いていなかった**。対象は既に `sns_post_resolved` に行を持つ投稿なので、走っている resolve は
`--skip-resolved-anywhere` で必ず飛ばすからである。裏取り: 直近 8 時間の resolve は
**200,254 行 = 200,254 投稿**（行数＝投稿数なので解き直しはゼロ）。

⚠️ **全国を `--only-without-category` で解き直すのは筋が悪い。** 対象は 100 万件を超え、
その **83% は実際に料理語を含まない**（同日の実測: 料理語を含むのは 16.9%）ので、
解き直しても 0 のまま返る。**埋めた post_id を記録して、それだけを狙い撃ちする。**

このテストは値ではなくパターンを固定する:
  1. `4_14` は埋めた post_id を表へ残す（残さないと 2 段目が作れない）
  2. `5_1` はその表を狙い撃ちできる（`--post-ids-table`）
  3. 表の名前は 1 箇所（`4_14` の定数）が正で、`5_1` 側へ写経しない
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def _load(name: str, fname: str):
    spec = importlib.util.spec_from_file_location(name, HERE / fname)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


m414 = _load("m414b", "4_14_fetch_missing_captions.py")
m51 = _load("m51b", "5_1_apply_resolve.py")
SRC414 = (HERE / "4_14_fetch_missing_captions.py").read_text(encoding="utf-8")
SRC51 = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")


class _FakePipeline:
    def table(self, name: str) -> str:
        return f"proj.ds.{name}"


class TheFilledPostsAreRecorded(unittest.TestCase):
    def test_the_table_exists_as_one_constant(self) -> None:
        self.assertEqual("sns_caption_backfilled", m414.TABLE_CAPTION_BACKFILLED)

    def test_the_ddl_partitions_and_clusters_for_the_lookup(self) -> None:
        ddl = m414.CREATE_BACKFILLED_SQL
        self.assertIn("post_id   STRING NOT NULL", ddl)
        self.assertIn("PARTITION BY DATE(filled_at)", ddl)
        self.assertIn("CLUSTER BY post_id", ddl)

    def test_it_writes_after_the_update_not_before(self) -> None:
        """«書けていないのに記録する» を作らない。UPDATE の後で記録すること。"""
        body = "\n".join(ln for ln in SRC414.splitlines() if not ln.lstrip().startswith("#"))
        self.assertLess(body.index("execute_dml_retrying"),
                        body.index("TABLE_CAPTION_BACKFILLED, ["))

    def test_dry_run_records_nothing(self) -> None:
        """`--dry-run` で表を作ったり行を入れたりしないこと。"""
        body = SRC414[SRC414.index("def main("):]
        i = body.index("TABLE_CAPTION_BACKFILLED, [")
        self.assertIn("if not args.dry_run:", body[max(0, i - 400):i])


class TheResolveCanTargetThatTable(unittest.TestCase):
    def test_the_filter_is_a_subquery_on_the_table(self) -> None:
        sql = m51._fetch_unresolved.__doc__  # 存在確認だけ（SQL は下で組む）
        self.assertIsNotNone(sql)
        self.assertIn('AND r.post_id IN (SELECT post_id FROM `{post_ids_table}`)', SRC51)

    def test_the_flag_warns_about_skip_resolved_anywhere(self) -> None:
        """付け合わせを間違えると «全部飛ぶ» ので、help で明示していること。"""
        self.assertIn("--post-ids-table", SRC51)
        i = SRC51.index('"--post-ids-table"')
        self.assertIn("--skip-resolved-anywhere を付けない", SRC51[i:i + 500])

    def test_the_table_name_is_not_transcribed_into_5_1(self) -> None:
        """表名の実体は 4_14 の定数だけ。`5_1` は引数で受け取る（写経しない）。"""
        body = "\n".join(ln for ln in SRC51.splitlines() if not ln.lstrip().startswith("#"))
        self.assertNotIn('"sns_caption_backfilled"', body)

    def test_it_is_recorded_in_parameters_json(self) -> None:
        """どのラウンドが狙い撃ちだったのかを run の記録から復元できること。"""
        self.assertIn('"post_ids_table": args.post_ids_table', SRC51)


if __name__ == "__main__":
    unittest.main()
