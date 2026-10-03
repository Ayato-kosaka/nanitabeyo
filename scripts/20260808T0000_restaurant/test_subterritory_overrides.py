#!/usr/bin/env python3
"""#1779 «州で言語が変わる国» のリストを写経していないことを縛る。

## 何を守っているか

`address_components` を落とすと `extractLocationCodes` が州を引けなくなる。しかし
州が結果を変えるのは `subterritory_overrides.json` に載っている国だけなので、
監査（`9_9_audit_google_derived_data.py`）はその国だけを数えれば «失うもの» が出る。

⚠️ ここに国コードを直接書くと、**JSON に国が増えたときに監査だけが «影響なし» と
言い続ける**。CLAUDE.md「本番のロジックをテストへ写経しない」と同じ形の事故なので、
«JSON から引いていること» を機械で確かめる。
"""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import subterritory_overrides as mod  # noqa: E402

HERE = Path(__file__).resolve().parent
AUDIT = HERE / "9_9_audit_google_derived_data.py"


class SubterritoryOverridesTest(unittest.TestCase):
    def test_reads_the_file_the_api_imports(self) -> None:
        """参照先が、本番（locations.service.ts）が import しているファイルであること。"""
        self.assertTrue(mod.OVERRIDES_PATH.is_file(), mod.OVERRIDES_PATH)

        service = (
            HERE.parents[1] / "api/src/v1/locations/locations.service.ts"
        ).read_text(encoding="utf-8")
        # `import * as subterritoryOverrides from './subterritory_overrides.json'`
        self.assertIn("subterritory_overrides.json", service)
        self.assertEqual(mod.OVERRIDES_PATH.name, "subterritory_overrides.json")
        self.assertEqual(
            mod.OVERRIDES_PATH.parent,
            HERE.parents[1] / "api/src/v1/locations",
        )

    def test_countries_are_derived_from_the_json(self) -> None:
        """返る国が、JSON の `sub` の «国» 部分そのものであること。"""
        entries = json.loads(mod.OVERRIDES_PATH.read_text(encoding="utf-8"))
        self.assertGreater(len(entries), 0)
        expected = sorted({e["sub"].split("-", 1)[0] for e in entries})

        self.assertEqual(mod.subterritory_override_countries(), expected)
        # 昇順・重複なし（SQL の ANY() へ渡すので安定していること）
        self.assertEqual(expected, sorted(set(expected)))

    def test_derivation_follows_the_json_not_a_literal(self) -> None:
        """JSON を差し替えたら結果も変わること（= 定数を返していないこと）。"""
        with self.subTest("架空の国を足すと増える"):
            fake = HERE / "__subterritory_overrides_fixture.json"
            fake.write_text(
                json.dumps([{"sub": "ZZ-QQ", "primary_lang": "xx"}]),
                encoding="utf-8",
            )
            try:
                self.assertEqual(
                    mod.subterritory_override_countries(fake), ["ZZ"]
                )
            finally:
                fake.unlink()

    def test_audit_script_has_no_hardcoded_country_list(self) -> None:
        """監査スクリプト側に国コードの羅列が復活していないこと。"""
        source = AUDIT.read_text(encoding="utf-8")
        self.assertIn("subterritory_override_countries", source)

        # `'BE', 'CA', 'CH'` のような 2 文字大文字の羅列（3 個以上）を検出する。
        # ⚠️ 2 個までは許す（`('dev', 'public')` のような無関係な組を拾うため）。
        listed = re.findall(
            r"""(?:['"][A-Z]{2}['"]\s*,\s*){2,}['"][A-Z]{2}['"]""", source
        )
        self.assertEqual(listed, [], f"国コードを写経している疑い: {listed}")


if __name__ == "__main__":
    unittest.main()
