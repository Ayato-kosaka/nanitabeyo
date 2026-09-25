"""#1947 «次はどこから流せばよいか» を、run の記録だけで復元できるようにする。

2026-09-25、CC WAT の未読分を流そうとして «前回どこまで読んだか» が分からなかった。
`4_9` は `parameters_json` に `shards`/`shard`/`files` しか残しておらず、
**「続きから」を決める `--skip-files` を記録していなかった**。手元の台帳は
コンテナと一緒に消えるので、durable な記録はこの `restaurant_pipeline_runs` だけである。
結果、2026-09-04 の 5 ラウンドが crawl 10 万本のうち **先頭 16,000 本（16.0%）を
重複して読んでいただけ**だったことに、3 週間気づけなかった。

このテストは個別の値ではなく **パターン**を固定する:

  «continuation（続きの位置）を決める引数は、必ず `pipeline.step(parameters=...)` に載せる»

`VOCAB` に当たる引数を機械的に全部拾い、載っていないものがあれば落とす。
**当てはまらないもの**は `NOT_A_POSITION` に理由付きで並べる（理由を書かないと、
次の人が同じ調査をやり直すことになる）。
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

# 「続きの位置」を表す語。ここを増やすと守れる範囲が広がる。
VOCAB = ("skip", "offset", "page_", "cursor", "since", "resume", "start_at", "from_")

# VOCAB には当たるが «続きの位置» ではないもの。**理由を必ず書く。**
NOT_A_POSITION = {
    # 任意の下位ステップを on/off するだけで、どこから流すかには関わらない。
    ("4_21_link_name_place_to_posts.py", "skip_backfill"),
    ("8_1_validate_catalogs.py", "skip_dish_media_checks"),
    # «同期前にバックアップを取るか» の安全弁。位置ではない
    # （データ損失の監査という別の観点では記録する価値があるが、それはこの規則の外）。
    ("9_1_sync_restaurants.py", "skip_backup"),
    ("9_2_sync_sns_dish_media.py", "skip_backup"),
}


def _scripts() -> list[Path]:
    return sorted(p for p in HERE.glob("[0-9]*.py") if not p.name.startswith("test_"))


def _option_dests(tree: ast.AST) -> set[str]:
    out: set[str] = set()
    for n in ast.walk(tree):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "add_argument"):
            for a in n.args:
                if isinstance(a, ast.Constant) and isinstance(a.value, str) and a.value.startswith("--"):
                    out.add(a.value[2:].replace("-", "_"))
    return out


def _recorded_keys(tree: ast.AST) -> set[str] | None:
    """`pipeline.step(parameters={...})` のキー。dict を変数で渡している場合も辿る。

    ⚠️ 1 ファイルに `step` が複数あることがある（`4_7` は JSONL 読み込み用と収集用の 2 つ）。
    **最初の 1 つで打ち切らず、全部の和を返すこと。** 最初の版はそれで
    `4_7_load_jsonl` の `{"path": ...}` だけを見て «記録していない» と誤検知した。
    """
    dicts: dict[str, ast.Dict] = {}
    for n in ast.walk(tree):
        if isinstance(n, ast.Assign) and isinstance(n.value, ast.Dict):
            for t in n.targets:
                if isinstance(t, ast.Name):
                    dicts[t.id] = n.value
    found = False
    keys: set[str] = set()
    for n in ast.walk(tree):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "step"):
            for kw in n.keywords:
                if kw.arg != "parameters":
                    continue
                node = kw.value
                if isinstance(node, ast.Name):
                    node = dicts.get(node.id)
                if isinstance(node, ast.Dict):
                    found = True
                    keys |= {k.value for k in node.keys
                             if isinstance(k, ast.Constant) and isinstance(k.value, str)}
    return keys if found else None


def _continuation_args(path: Path) -> tuple[list[str], set[str] | None]:
    tree = ast.parse(path.read_text())
    cont = sorted(o for o in _option_dests(tree)
                  if any(v in o for v in VOCAB) and (path.name, o) not in NOT_A_POSITION)
    return cont, _recorded_keys(tree)


class ContinuationArgsAreRecorded(unittest.TestCase):
    def test_every_continuation_arg_is_in_parameters_json(self):
        missing: list[str] = []
        for path in _scripts():
            cont, recorded = _continuation_args(path)
            if not cont:
                continue
            for arg in cont:
                if recorded is None or arg not in recorded:
                    missing.append(f"{path.name}: --{arg.replace('_', '-')}")
        self.assertEqual(
            missing, [],
            "続きの位置を決める引数が pipeline.step(parameters=...) に載っていない。"
            "載せるか、位置ではない理由を書いて NOT_A_POSITION へ入れること:\n  "
            + "\n  ".join(missing))

    def test_the_guard_actually_catches_the_2026_09_04_shape(self):
        """#1947 «直す前の 4_9» の形（skip_files を書かない）を、この規則が落とすこと。"""
        src = (
            "import argparse\n"
            "def main():\n"
            "    p = argparse.ArgumentParser()\n"
            "    p.add_argument('--shards', type=int)\n"
            "    p.add_argument('--skip-files', type=int)\n"
            "    with pipeline.step(rid, 'x', parameters={'shards': args.shards}):\n"
            "        pass\n")
        tree = ast.parse(src)
        self.assertIn("skip_files", _option_dests(tree))
        self.assertNotIn("skip_files", _recorded_keys(tree) or set())

    def test_reasons_are_written_down_for_every_exclusion(self):
        """NOT_A_POSITION は «実在するファイル × 実在する引数» だけを持つこと。

        存在しない行が残ると «直したのに除外され続ける» 穴になる。
        """
        stale = []
        for name, arg in sorted(NOT_A_POSITION):
            path = HERE / name
            if not path.exists():
                stale.append(f"{name}（ファイルが無い）")
                continue
            if arg not in _option_dests(ast.parse(path.read_text())):
                stale.append(f"{name}: --{arg.replace('_', '-')}（引数が無い）")
        self.assertEqual(stale, [], "NOT_A_POSITION が陳腐化している: " + ", ".join(stale))


if __name__ == "__main__":
    unittest.main()
