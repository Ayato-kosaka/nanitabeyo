#!/usr/bin/env python3
"""#843 の未解決事項台帳（Issue 本文）を**壊さずに**書き換える。

## なぜ要るか — 本文の上限を超えると «成功したように見えて» 消える

GitHub の Issue 本文は **65,536 文字**で、超えた PATCH は **HTTP 200 を返しながら
黙って切り捨てる**。#843 の台帳は 2026-10-04 時点で 62,803 文字（残り 2,733）あり、
**次の 1 回で消える距離にある**。台帳はこのプロジェクトの現在地の唯一の正なので、
切り捨ては «気づかないデータ損失» になる。

そこで、毎回手で守っていた 3 つをスクリプトにする。

1. **上限を超える本文は送らない**（送る前に落とす）
2. **バッククォートの数が偶数**であること（奇数だと以降が全部コードブロックになる）
3. **送った後に読み直して、1 文字でも違えば失敗にする**（切り捨ての検出）

## 使い方

置換は «元の文字列 → 新しい文字列» の JSON で渡す。**ちょうど 1 箇所に一致しない
置換は失敗**にしてある（0 箇所なら台帳が変わっていた・2 箇所以上なら狙いが曖昧）。

    python3 scripts/issue-ledger/edit_ledger.py --issue 843 --edits edits.json
    python3 scripts/issue-ledger/edit_ledger.py --issue 843 --show   # 残り文字数だけ見る

`edits.json` は

    [{"old": "…置換前…", "new": "…置換後…"}]

`--dry-run` は差分と残り文字数を出すだけ（PATCH しない）。

環境変数: `GH_TOKEN`（`--show` / `--dry-run` でも読み取りに使う）
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

# GitHub の Issue 本文の上限。⚠️ 超えた PATCH は 200 を返して黙って切り捨てる。
BODY_LIMIT = 65_536

REPO = "Ayato-kosaka/nanitabeyo"


class LedgerError(RuntimeError):
    pass


def check_body(body: str) -> None:
    """送る前の 2 つの番人。問題があれば `LedgerError`。"""
    if len(body) > BODY_LIMIT:
        raise LedgerError(
            f"本文が上限を超えています: {len(body):,} > {BODY_LIMIT:,}。"
            f"{len(body) - BODY_LIMIT:,} 文字削ってください"
            f"（まず無損失で縮める: 同じ repo を指すリンクは #1234 と書けば自動リンクする）"
        )
    if body.count("`") % 2 != 0:
        raise LedgerError(
            f"バッククォートが奇数です（{body.count('`')} 個）。"
            f"以降が全部コードブロックになるので送れません"
        )


def apply_edits(body: str, edits: list[dict[str, str]]) -> str:
    """`[{"old":…,"new":…}]` を順に当てる。1 箇所に一致しない置換は失敗。

    ⚠️ **「0 箇所だったら何もしない」で済ませてはいけない。** 台帳が別セッションに
    書き換わっていたときに «当たったつもりで当たっていない» 状態になる。
    """
    for i, edit in enumerate(edits, start=1):
        old, new = edit["old"], edit["new"]
        hits = body.count(old)
        if hits != 1:
            raise LedgerError(
                f"edits[{i}] が {hits} 箇所に一致しました（1 箇所である必要があります）。"
                f"先頭 60 文字: {old[:60]!r}"
            )
        body = body.replace(old, new)
    return body


def _gh(args: list[str], *, input_bytes: bytes | None = None) -> str:
    """`gh api` を呼ぶ。失敗したら stderr を載せて例外。"""
    proc = subprocess.run(
        ["gh", "api", *args], input=input_bytes, capture_output=True, check=False
    )
    if proc.returncode != 0:
        raise LedgerError(f"gh api が失敗しました: {proc.stderr.decode(errors='replace')[:500]}")
    return proc.stdout.decode()


def fetch_body(issue: int) -> str:
    """Issue 本文を取る。

    ⚠️ **`--jq .body` を使わない。** あれは JSON ではなく生の文字列を返すので
    `json.loads` が落ちる（2026-10-04 に実際に落ちた）。Issue 全体を取って
    Python 側で読む方が、改行・引用符の扱いも 1 箇所に寄る。
    """
    payload = json.loads(_gh([f"repos/{REPO}/issues/{issue}"]))
    return payload.get("body") or ""


def patch_body(issue: int, body: str) -> None:
    """PATCH して**読み直し、1 文字でも違えば失敗**にする（切り捨ての検出）。"""
    payload = json.dumps({"body": body}).encode()
    _gh(
        [
            "-X",
            "PATCH",
            f"repos/{REPO}/issues/{issue}",
            "-H",
            "Content-Type: application/json",
            "--input",
            "-",
        ],
        input_bytes=payload,
    )
    written = fetch_body(issue)
    if written.rstrip("\n") != body.rstrip("\n"):
        raise LedgerError(
            f"読み直したら違っていました（送った {len(body):,} 文字 / 戻った {len(written):,} 文字）。"
            f"上限超えで切り捨てられた可能性があります"
        )


def headroom(body: str) -> int:
    return BODY_LIMIT - len(body)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--issue", type=int, default=843)
    p.add_argument("--edits", help="置換の JSON ファイル")
    p.add_argument("--show", action="store_true", help="いまの文字数と残りだけ出す")
    p.add_argument("--dry-run", action="store_true", help="番人は通すが PATCH しない")
    args = p.parse_args()

    if not os.environ.get("GH_TOKEN") and not os.environ.get("GITHUB_TOKEN"):
        print("⚠️ GH_TOKEN が無いので gh api が失敗するかもしれません", file=sys.stderr)

    try:
        body = fetch_body(args.issue)
        print(f"いまの本文: {len(body):,} 文字 / 残り {headroom(body):,}")
        if args.show:
            return 0
        if not args.edits:
            print("❌ --edits か --show が要ります", file=sys.stderr)
            return 2

        with open(args.edits, encoding="utf-8") as handle:
            edits = json.load(handle)
        new_body = apply_edits(body, edits)
        check_body(new_body)
        delta = len(new_body) - len(body)
        print(f"適用後: {len(new_body):,} 文字（{delta:+,}）/ 残り {headroom(new_body):,}")
        if args.dry_run:
            print("（--dry-run なので PATCH していません）")
            return 0
        patch_body(args.issue, new_body)
        print("✅ 書き込んで読み直し、一致を確認しました")
    except LedgerError as error:
        print(f"❌ {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
