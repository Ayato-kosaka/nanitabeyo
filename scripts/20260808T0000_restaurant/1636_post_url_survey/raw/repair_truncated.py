#!/usr/bin/env python3
"""SSM の出力上限（約 24,000 文字）で末尾が切れた JSON を、落ちた件数を明記して閉じ直す。

EC2 上の実ファイルは完全だが、こちらへ運ぶ経路が SSM の標準出力しか無いため
最後の 1 件が途中で切れた。**黙って件数を減らさない**ために、
何件落ちたかを `urls_truncated` としてファイル自身に残す。
"""

import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
expected = int(sys.argv[2])

lines = path.read_text(encoding="utf-8").splitlines()
while lines and not lines[-1].strip().rstrip(",").endswith('"'):
    lines.pop()
lines[-1] = lines[-1].rstrip().rstrip(",")
doc = json.loads("\n".join(lines) + "\n ]\n}\n")

doc["urls_truncated"] = expected - len(doc["urls"])
path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"{path.name}: urls={len(doc['urls'])} truncated={doc['urls_truncated']}")
