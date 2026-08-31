#!/usr/bin/env python3
"""#843 9_1 の「backfill 実施漏れ検知」の契約を固定する。

この判定は 2 回続けて誤検知で同期を落としている。

  2026-08-30 `source_seed_id IS NOT NULL` で数えた
              → provenance UPDATE がアプリ製の行にも seed を刻むので 2,115 件が誤検知
  2026-08-31 «実行窓に created_at がある» で数えた
              → 同期中にアプリが作った行が窓に入るので 1 件が誤検知

どちらも «行を数える» 形だったのが原因なので、ここでは
**アプリ製の行がどれだけ混ざっても発火しないこと**を明示的に固定する。

本番の判定関数をそのまま import する（写経しない）。

    python3 scripts/20260808T0000_restaurant/tests/test_9_1_backfill_guard.py
"""

from __future__ import annotations

import ast
import sys
from dataclasses import dataclass
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "9_1_sync_restaurants.py"


def _load_detect():
    """本番の判定関数を **ソースから抜き出して** そのまま使う。

    9_1 は import すると BigQuery クライアントまで芋づるで読み込むため、
    モジュールごとの import は環境に依存して落ちる。関数定義だけを
    AST で取り出して exec する。写経ではないので本体を直せば追従する。
    """

    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "detect_backfill_missing":
            namespace: dict = {"Any": object}
            exec(compile(ast.Module([node], []), str(SOURCE), "exec"), namespace)
            return namespace["detect_backfill_missing"]
    raise SystemExit("detect_backfill_missing を 9_1 から取り出せませんでした")


@dataclass
class Window:
    inserted_count: int


def main() -> None:
    detect = _load_detect()
    failures: list[str] = []

    def check(label: str, got, want) -> None:
        if got == want:
            print(f"✅ {label}")
        else:
            failures.append(f"{label}: got={got} want={want}")
            print(f"❌ {label}: got={got} want={want}")

    # 1. 初回同期。過去の同期が無いので pipeline が 0 でも正常
    check("1. 初回同期（実行窓なし）は発火しない", detect(0, [])[0], False)

    # 2. 過去に同期が走ったが 1 行も INSERT していない（更新のみ）→ 発火しない
    check(
        "2. 過去の同期が 0 行しか INSERT していないなら発火しない",
        detect(0, [Window(0), Window(0)])[0],
        False,
    )

    # 3. 実施漏れの唯一の形。過去に INSERT があるのに pipeline が 0 件
    missing, past = detect(0, [Window(619_497), Window(12)])
    check("3. 過去 INSERT あり × pipeline 0 件 → 発火する", missing, True)
    check("3'. 過去 INSERT 数を合算して報告する", past, 619_509)

    # 4. 誤検知の回帰（2026-08-30 / 08-31 の 2 件）。
    #    アプリ製の行が何行あろうと、pipeline が 1 行でもあれば発火しない。
    #    ここが「行を数える」実装との決定的な違いである。
    check(
        "4. pipeline が 1 件でもあれば発火しない（アプリ製の行が混ざっても）",
        detect(1, [Window(619_497)])[0],
        False,
    )
    check(
        "4'. backfill 済み（pipeline 61 万件）でも当然発火しない",
        detect(619_497, [Window(619_497)])[0],
        False,
    )

    # 5. inserted_count が NULL の実行ログ（dry-run 直後など）で落ちない
    check("5. inserted_count が None でも例外にならない", detect(0, [Window(None)])[0], False)

    print()
    if failures:
        print(f"失敗 {len(failures)} 件")
        sys.exit(1)
    print("すべて通過（7/7）")


if __name__ == "__main__":
    main()
