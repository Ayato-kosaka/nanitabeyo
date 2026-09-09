#!/usr/bin/env python3
"""#1579 «その行を、その画面の容器で探しているか» をソースだけで検査する。

## なぜ要るのか

`profile/index.tsx`（マイページ）は «設定項目が並ぶ 1 枚» から
**«サブ画面へ送るメニュー»** へ変わった。行の実体は端末設定 / テーマ / 通知 /
アカウント / なに食べよについて へ散っている。

e2e はこの移設に **3 度追随できず**、そのたびに «画面は出ているのに行が
見つからない» で 25 秒待って落ちた。

    2026-09-04/05  settings-logout をマイページ本体で探していた（#1579）
    2026-09-06     PR #1900 で account / about を直した（が 3 画面が漏れた）
    2026-09-07..09 settings-language / settings-theme-* / 通知カードで 21 件が 3 夜連続

**Detox を回さないと分からない、という状態が原因である。** 行の testID も容器の
testID も文字列リテラルなので、ソースを読むだけで突き合わせられる。

## 何を検査するか

`SettingsScreen.expectRowVisibleIn(SettingsScreen.CONTAINERS.<key>, this.<row>)`
の呼び出しを集め、その `<row>` が指す testID が **`<key>` の容器を持つ画面**で
実際に描かれているかを見る。描かれていなければ red。

⚠️ **描画はコンポーネントに切り出されていることがある**（テーマ 3 択は
`ThemeSelector.tsx`、通知カードは `NotificationSettingsCard.tsx`）。画面ファイルが
import しているローカルコンポーネントを再帰的に辿る。辿らないと «画面には無い» と
誤判定して、直っているものを赤くする。
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SETTINGS_SCREEN = REPO / "e2e-mobile/screens/SettingsScreen.ts"
APP_DIR = REPO / "app-expo/app"
SRC_ROOTS = [REPO / "app-expo"]

# `readonly foo = by.id("bar");`
ROW_DEF_RE = re.compile(r'readonly\s+(\w+)\s*=\s*by\.id\(\s*"([^"]+)"\s*\)')
# `CONTAINERS = { key: "value", ... }`
CONTAINERS_RE = re.compile(r"static\s+readonly\s+CONTAINERS\s*=\s*\{(.*?)\}\s*as\s+const", re.S)
CONTAINER_ENTRY_RE = re.compile(r'(\w+)\s*:\s*"([^"]+)"')
# `expectRowVisibleIn(SettingsScreen.CONTAINERS.key, this.row` （prettier の折り返しに耐える）
CALL_RE = re.compile(
    r"expectRowVisibleIn\(\s*SettingsScreen\.CONTAINERS\.(\w+)\s*,\s*this\.(\w+)",
    re.S,
)
TESTID_RE = re.compile(r'testID=\{?["`]([^"`{}]+)["`]\}?')
# `import { X } from "@/features/..."` / "@/components/..."
LOCAL_IMPORT_RE = re.compile(r'from\s+"(@/[^"]+)"')


def _resolve(spec: str) -> Path | None:
    """`@/features/x/Y` を実ファイルへ解決する。"""
    rel = spec.replace("@/", "")
    for root in SRC_ROOTS:
        for ext in (".tsx", ".ts"):
            p = root / (rel + ext)
            if p.exists():
                return p
        p = root / rel / "index.tsx"
        if p.exists():
            return p
    return None


def collect_testids(path: Path, depth: int = 3, seen: set[Path] | None = None) -> set[str]:
    """画面ファイルと、そこから辿れるローカルコンポーネントの testID を全部集める。"""
    seen = seen if seen is not None else set()
    if path in seen or depth < 0:
        return set()
    seen.add(path)
    src = path.read_text(encoding="utf-8")
    ids = set(TESTID_RE.findall(src))
    for spec in LOCAL_IMPORT_RE.findall(src):
        child = _resolve(spec)
        if child is not None:
            ids |= collect_testids(child, depth - 1, seen)
    return ids


def screens_by_container() -> dict[str, tuple[Path, set[str]]]:
    """容器の testID → (その容器を持つ画面, その画面で描かれる testID 全部)。"""
    out: dict[str, tuple[Path, set[str]]] = {}
    for f in APP_DIR.rglob("*.tsx"):
        src = f.read_text(encoding="utf-8")
        for cid in re.findall(r'testID="([a-z0-9-]*scroll)"', src):
            out[cid] = (f, collect_testids(f))
    return out


class SettingsRowContainerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.src = SETTINGS_SCREEN.read_text(encoding="utf-8")
        self.rows = dict(ROW_DEF_RE.findall(self.src))
        m = CONTAINERS_RE.search(self.src)
        self.assertIsNotNone(m, "SettingsScreen.CONTAINERS が見つからない")
        self.containers = dict(CONTAINER_ENTRY_RE.findall(m.group(1)))
        self.calls = CALL_RE.findall(self.src)
        self.by_container = screens_by_container()

    def test_the_guard_actually_looks_at_something(self) -> None:
        """⚠️ 0 件でも緑になる検査は «緑» の意味を持たない（#1936 で踏んだ）。"""
        self.assertGreater(len(self.rows), 5, "行の定義を 1 つも拾えていない")
        self.assertGreater(len(self.containers), 3, "CONTAINERS を拾えていない")
        self.assertGreater(len(self.calls), 3, "expectRowVisibleIn の呼び出しを拾えていない")
        self.assertGreater(len(self.by_container), 3, "画面の容器を 1 つも拾えていない")

    def test_containers_exist_in_app(self) -> None:
        """CONTAINERS に書いた容器が、アプリに実在すること。"""
        for key, cid in self.containers.items():
            self.assertIn(
                cid,
                self.by_container,
                f"CONTAINERS.{key} = '{cid}' を描いている画面がアプリに無い",
            )

    def test_every_row_is_looked_for_where_it_lives(self) -> None:
        """行を «その行が居る画面» の容器で探していること（これが本体）。"""
        problems: list[str] = []
        for container_key, row_name in self.calls:
            cid = self.containers.get(container_key)
            if cid is None:
                problems.append(f"CONTAINERS.{container_key} が未定義")
                continue
            testid = self.rows.get(row_name)
            if testid is None:
                # themeOption() のような «動的に組む matcher» は行の定義を持たない。
                # ここで拾えないものは検査対象外（誤検知で赤くしない）
                continue
            screen, ids = self.by_container[cid]
            if testid not in ids:
                where = [
                    f"{c}({p.relative_to(REPO)})"
                    for c, (p, s) in self.by_container.items()
                    if testid in s
                ]
                problems.append(
                    f"'{testid}' を容器 '{cid}'（{screen.relative_to(REPO)}）で探しているが、"
                    f"その画面には無い。実際に在るのは: {', '.join(where) or '（どこにも無い）'}"
                )
        self.assertEqual(problems, [], "\n".join(problems))


if __name__ == "__main__":
    unittest.main()
