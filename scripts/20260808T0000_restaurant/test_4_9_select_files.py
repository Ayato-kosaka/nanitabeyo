"""#1947 CC WAT の «続きから» を固定する。

2026-09-04 の 5 ラウンドは `--shards` / `--shard` を変えながら流したが、ストライプは
毎回その先頭から取り直されるため、**全部がファイル 0〜15,999 番に当たっていた**
（`restaurant_pipeline_runs.parameters_json` の実測: shards=8 × files=2000 で 0〜15,999、
shards=6 × files=1600 で 0〜9,599）。crawl は 10 万本あるので **16.0% しか読めていない**。

守りたいのは 2 つ。

1. `--skip-files` を渡さなければ **これまでと同じ選び方**であること（既存の挙動を変えない）
2. `--skip-files` を渡すと **そのシャードの続き**から取れること（重複ゼロ・取りこぼしゼロ）
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


scanner = _load(HERE / "4_9_scan_cc_wat_instagram.py", "scan_cc_wat_instagram")
PATHS = [f"f{i}" for i in range(1000)]


class SelectFiles(unittest.TestCase):
    def test_without_skip_it_behaves_as_before(self) -> None:
        """既定（skip=0）は «ストライプの先頭から max_files 本»。"""
        got = scanner.select_files(PATHS, shards=8, shard=3, max_files=4, skip_files=0)
        self.assertEqual(got, ["f3", "f11", "f19", "f27"])

    def test_skip_continues_the_same_stripe(self) -> None:
        """skip は «そのシャードで既に読んだ本数»。別のシャードへ飛ばない。"""
        first = scanner.select_files(PATHS, shards=8, shard=3, max_files=4, skip_files=0)
        second = scanner.select_files(PATHS, shards=8, shard=3, max_files=4, skip_files=4)
        self.assertEqual(second, ["f35", "f43", "f51", "f59"])
        self.assertEqual(set(first) & set(second), set(), "重複して読んではいけない")

    def test_two_rounds_cover_the_stripe_without_holes(self) -> None:
        """«続きから» を繰り返すと、そのシャードを穴なく舐められる。"""
        rounds = [scanner.select_files(PATHS, shards=10, shard=0, max_files=30, skip_files=30 * k)
                  for k in range(4)]
        flat = [p for r in rounds for p in r]
        self.assertEqual(flat, [p for i, p in enumerate(PATHS) if i % 10 == 0][:120])
        self.assertEqual(len(flat), len(set(flat)))

    def test_skip_past_the_end_yields_nothing(self) -> None:
        """読み切ったシャードは空を返す（«仕事が無い» を黙って隠さない）。"""
        self.assertEqual(scanner.select_files(PATHS, shards=10, shard=0,
                                              max_files=30, skip_files=100), [])


if __name__ == "__main__":
    unittest.main()
