#!/usr/bin/env python3
"""州（`subterritory_code`）の上書きを持つ国を、**本番が読むファイル**から引く。

## なぜ別ファイルなのか

`9_9_audit_google_derived_data.py` は `psycopg2` を要求するので、pr-check の
ユニットテストからは import できない。ここへ切り出しておけば依存ゼロで縛れる。

## なぜ国のリストを書かないのか

`api/src/v1/locations/locations.service.ts` の `buildLanguageCandidates` は、
`subterritory_overrides.json` に載っている州でだけ言語を差し替える。載っていない
国では州が NULL でも国の重み順がそのまま採用されるので、**州を失っても結果は
1 文字も変わらない**。

つまり «州を失って困る国» の正はあの JSON であって、ここではない。写経すると
**JSON に国が増えたときに、この監査だけが «影響なし» と言い続ける**。
"""

from __future__ import annotations

import json
from pathlib import Path

# scripts/20260808T0000_restaurant/ → リポジトリルート
OVERRIDES_PATH = (
    Path(__file__).resolve().parents[2]
    / "api/src/v1/locations/subterritory_overrides.json"
)


def subterritory_override_countries(path: Path | None = None) -> list[str]:
    """州の上書きを持つ国コード（ISO 3166-1 alpha-2）を昇順で返す。

    `sub` は `CH-GE` のような «国-州» 形式なので、先頭の国だけを取る。
    """
    entries = json.loads((path or OVERRIDES_PATH).read_text(encoding="utf-8"))
    return sorted({str(entry["sub"]).split("-", 1)[0] for entry in entries})
