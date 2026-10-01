"""#1947 «もう読んだ WAT を読み直して緑で終わる» を復活させないための回帰テスト。

2026-10-01、CC-MAIN-2026-34 は 9 月に 100,000 本すべて読み終えていたのに
`--skip-files 0 / 500 / 1000` を投げ直し、約 25 レーン時間で新規投稿は
82,938 件中 2,440 件（2.9%）だった。**run はすべて緑で «成功» と出た。**

テストは «個別の数字» ではなく **パターン**に対して書く:
  1. «どこを読んだか» は shards をまたいで比べられる（絶対ファイル番号の上で判定する）
  2. 途中で降りた run は «読み切った» ことにしない（files_read を使う）
  3. 既読の窓を投げたら **止まる**（黙って成功しない）
  4. 読み終わった crawl は «終わり» であって異常ではない（赤くしない）
"""
import ast
import pathlib
import unittest

SRC = pathlib.Path(__file__).with_name("4_9_scan_cc_wat_instagram.py")
_source = SRC.read_text(encoding="utf-8")


def _load():
    """BigQuery を要求せずに純関数だけ取り出す（本番のロジックを写経しない）。"""
    tree = ast.parse(_source)
    want = ("_index_range", "select_files", "stripe_indices",
            "already_read_indices", "unread_skip")
    ns: dict = {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in want:
            exec(compile(ast.Module([node], []), str(SRC), "exec"), ns)
    missing = [n for n in want if n not in ns]
    if missing:
        raise AssertionError(f"4_9 から取り出せませんでした: {missing}")
    return ns


M = _load()


class 絶対ファイル番号で比べる(unittest.TestCase):
    def test_ストライプの集合は_index_rangeと一致する(self):
        idx = M["stripe_indices"](8, 6, 500, 500)
        self.assertEqual(f"{min(idx)}-{max(idx)}",
                         M["_index_range"](8, 6, 500, 500))

    def test_shardsが違うラウンドも同じ座標で重なりが出る(self):
        # shards=8 の shard 0 と shards=4 の shard 0 は «0, 8, 16…» と «0, 4, 8…» で、
        # ストライプ上の skip では比べられないが絶対番号では重なる。
        a = M["stripe_indices"](8, 0, 0, 10)
        b = M["stripe_indices"](4, 0, 0, 20)
        self.assertTrue(a & b, "絶対番号で比べていないと重なりが見えない")

    def test_選んだファイル数と集合の大きさが一致する(self):
        paths = [f"f{i}" for i in range(1000)]
        mine = M["select_files"](paths, shards=8, shard=3, max_files=50, skip_files=10)
        self.assertEqual(len(mine), len(M["stripe_indices"](8, 3, 10, len(mine))))

    def test_選んだファイルの絶対番号が集合と一致する(self):
        paths = [f"f{i}" for i in range(1000)]
        mine = M["select_files"](paths, shards=8, shard=3, max_files=50, skip_files=10)
        self.assertEqual({int(p[1:]) for p in mine},
                         M["stripe_indices"](8, 3, 10, len(mine)))


class 途中で降りたrunを読み切ったことにしない(unittest.TestCase):
    def test_files_readがあればそちらを使う(self):
        read = M["already_read_indices"]([
            {"shards": 8, "shard": 0, "skip_files": 0, "files": 2000, "files_read": 10},
        ])
        self.assertEqual(len(read), 10, "files（選んだ数）で数えると未読を読み飛ばす")

    def test_files_readが無い古い記録はfilesで数える(self):
        read = M["already_read_indices"]([
            {"shards": 8, "shard": 0, "skip_files": 0, "files": 2000, "files_read": None},
        ])
        self.assertEqual(len(read), 2000)

    def test_files_readが0なら1本も読んでいない(self):
        read = M["already_read_indices"]([
            {"shards": 8, "shard": 0, "skip_files": 0, "files": 2000, "files_read": 0},
        ])
        self.assertEqual(read, set(), "0 を «未設定» と同じに扱うと読んでいない所を既読にする")


class 既読の窓は止める(unittest.TestCase):
    def _九月のCC34の記録(self):
        """9 月に CC-MAIN-2026-34 を 8 シャード × 12,500 本読み切った記録。"""
        recs = []
        for shard in range(8):
            for skip in range(0, 12500, 2000):
                recs.append({"shards": 8, "shard": shard, "skip_files": skip,
                             "files": min(2000, 12500 - skip),
                             "files_read": min(2000, 12500 - skip)})
        return recs

    def test_10月01日に投げ直した窓は100パーセント既読と出る(self):
        already = M["already_read_indices"](self._九月のCC34の記録())
        for skip in (0, 500, 1000):
            got = M["stripe_indices"](8, 6, skip, 500)
            self.assertEqual(len(got & already), 500,
                             f"skip {skip} は全部既読のはずで、これが見えないと緑で空振りする")

    def test_読み終わったcrawlにはautoが窓を返さない(self):
        already = M["already_read_indices"](self._九月のCC34の記録())
        self.assertIsNone(M["unread_skip"](8, 6, 500, already, 12500))

    def test_未採掘のcrawlならautoは先頭を返す(self):
        self.assertEqual(M["unread_skip"](8, 0, 2000, set(), 12500), 0)

    def test_autoは半端に重なる窓を返さない(self):
        already = M["already_read_indices"]([
            {"shards": 8, "shard": 0, "skip_files": 0, "files": 2500, "files_read": 2500}])
        skip = M["unread_skip"](8, 0, 2000, already, 12500)
        self.assertIsNotNone(skip)
        self.assertEqual(M["stripe_indices"](8, 0, skip, 2000) & already, set(),
                         "半端に重なる窓を返すと «どこまで読んだか» がまた曖昧になる")


class 止める側と止めない側が本体に書かれている(unittest.TestCase):
    def test_既読を投げたらSystemExitで止める(self):
        self.assertIn("if overlap and not args.allow_reread:", _source)
        self.assertIn("raise SystemExit", _source)

    def test_読み終わったcrawlは赤くせずreturnする(self):
        # 「正常なのに赤くする」ガードも «黙って成功する» のと同じくらい悪い。
        head = _source[_source.index("if auto is None:"):]
        body = head[:head.index("LOGGER.info(\"--skip-files auto")]
        self.assertIn("return", body)
        self.assertNotIn("SystemExit", body)
        self.assertNotIn("sys.exit", body)

    def test_走行中にfiles_readをdurableな記録へ書いている(self):
        self.assertIn('step_params["files_read"] = files_done', _source)
        self.assertIn('"files_read": 0,', _source)

    def test_既読の判定はrestaurant_pipeline_runsを読んでいる(self):
        self.assertIn("restaurant_pipeline_runs", _source)
        self.assertIn("status = 'succeeded'", _source)


if __name__ == "__main__":
    unittest.main()
