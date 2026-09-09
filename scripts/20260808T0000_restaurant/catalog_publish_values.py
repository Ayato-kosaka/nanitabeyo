#!/usr/bin/env python3
"""#1881 catalog の «配信する値» の作り方を 1 箇所に持つ。

## なぜこのモジュールが要るか

2026-09-09、`3_4` を流し直したあと `8_1` の品質ゲートが落ちた。

    FAIL existing_pg_serving_values_preserved  observed=2469.0 threshold=0.0

列ごとに数えたところ（[run 34347785203](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/34347785203)）、
**app 作成店 2,469 行の «全部» が、たった 2 列で食い違って**いた。

    image_url                :  2,469 件   existing は 全行 NULL
    address_components_json  :  2,469 件   existing は 全行 NULL
    （他の 6 列は 0 件）

原因は «データの壊れ» ではなく **2 つの SQL が別の規則で比べていたこと**である。

| | していたこと |
| --- | --- |
| `3_4` | `COALESCE(existing.image_url, s.image_url, '')` … NULL を `''` へ **正規化して**入れる |
| `8_1` | `catalog.image_url IS DISTINCT FROM existing.image_url` … **正規化前**と完全一致を求める |

`existing` が NULL なら catalog は必ず `''` / `'[]'` になるので、**この 2 列は構造的に
必ず不一致になる**。ゲートは «壊れている» と言い続けるが、catalog の値の方が正しい。

⚠️ **同じ判定を 2 箇所に書いた時点で、ずれるのは時間の問題だった**
（CLAUDE.md「本番のロジックをテストへ写経しない」と同じ形。写経先が «テスト» ではなく
«品質ゲート» だった）。値の作り方をここへ 1 本化し、**作る側と確かめる側の両方が
ここを呼ぶ**。

## 使い方

    from catalog_publish_values import publish_value_sql

    publish_value_sql("image_url", existing="existing", seed="s")
    # -> "COALESCE(existing.image_url, s.image_url, '')"
"""

from __future__ import annotations

# 列名 -> 値の作り方。`{existing}` と `{seed}` は呼び出し側の別名で埋める。
#
# ⚠️ ここに無い列は «そのまま運ぶ» 列である。足すときは 3_4 と 8_1 の両方が
#    自動的に追従することを確かめること（テストが縛っている）。
_PUBLISH_VALUE_TEMPLATES: dict[str, str] = {
    "name": "COALESCE({existing}.name, {seed}.canonical_name)",
    "name_language_code": "COALESCE(NULLIF({existing}.name_language_code, ''), 'ja')",
    "latitude": "COALESCE({existing}.latitude, {seed}.latitude)",
    "longitude": "COALESCE({existing}.longitude, {seed}.longitude)",
    "image_url": "COALESCE({existing}.image_url, {seed}.image_url, '')",
    "image_path": "COALESCE({existing}.image_path, {seed}.image_path)",
    "address_components_json": (
        "COALESCE(NULLIF({existing}.address_components_json, ''), "
        "NULLIF({seed}.address_components_json, ''), '[]')"
    ),
    "plus_code_json": "COALESCE({existing}.plus_code_json, {seed}.plus_code_json)",
}

# `8_1` の existing_pg_serving_values_preserved が見る列。
# **この順序と中身が、上の表の鍵と一致していること**をテストで縛る。
COMPARED_COLUMNS: tuple[str, ...] = tuple(_PUBLISH_VALUE_TEMPLATES)


def publish_value_sql(column: str, *, existing: str, seed: str) -> str:
    """`column` の «配信する値» を作る SQL 式を返す。

    ⚠️ `3_4`（作る側）と `8_1`（確かめる側）が **同じ文字列**を使うためにある。
       どちらかへ書き写すと、片方だけ直したときに «同じ行を見て違う結論» が出る。
    """
    try:
        template = _PUBLISH_VALUE_TEMPLATES[column]
    except KeyError:  # pragma: no cover - 呼び出し側の綴り間違い
        raise KeyError(
            f"{column!r} は配信値の表にありません。"
            f"扱えるのは {sorted(_PUBLISH_VALUE_TEMPLATES)} です"
        ) from None
    return template.format(existing=existing, seed=seed)


def preserved_mismatch_sql(*, catalog: str, existing: str, seed: str) -> str:
    """«app 作成店の表示値が保たれていないか» を判定する条件式を返す。

    `3_4` が入れる値と同じ規則で正規化してから比べる。ここが `8_1` のゲートになる。
    """
    clauses = [
        f"{catalog}.{column} IS DISTINCT FROM "
        f"{publish_value_sql(column, existing=existing, seed=seed)}"
        for column in COMPARED_COLUMNS
    ]
    return "\n            OR ".join(clauses)
