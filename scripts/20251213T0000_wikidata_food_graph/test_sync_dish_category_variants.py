#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#1748 「同じ QID を指しているなら衝突ではない」ことを固定する。

本番で起きたこと（2026-08-31）: `4_1` 側で label_ja が「豚カツ」→「とんかつ」へ変わり、
BQ に `'とんかつ' -> Q1142841` が現れた。本番にはアプリ由来の
`'とんかつ' -> Q1142841`（source = wikidata_qid_match）が既にあり、
**同じ QID なのに**同期全体が例外で止まった。dev には該当行が無いので通り、本番だけ落ちた。

実行:
    python3 -m pytest scripts/20251213T0000_wikidata_food_graph/test_sync_dish_category_variants.py
"""

import sys
from pathlib import Path
from importlib import import_module

sys.path.append(str(Path(__file__).parent))

# ファイル名が数字で始まるため通常の import 文が使えない
_mod = import_module("9_4_sync_dish_category_variants")
classify_app_row_conflicts = _mod.classify_app_row_conflicts


def test_same_qid_is_not_a_conflict():
    """
    🛑 ここが «衝突» に戻ると、本番の同期が丸ごと止まる。

    アプリ由来行と BQ が同じ表記・同じ QID を指しているなら写像は一致しており、
    止める理由が無い。
    """
    app_rows = [("とんかつ", "Q1142841", "wikidata_qid_match")]
    bq = {"とんかつ": "Q1142841"}

    real_conflicts, same_mapping = classify_app_row_conflicts(app_rows, bq)

    assert real_conflicts == []
    assert same_mapping == {"とんかつ"}


def test_different_qid_is_still_a_conflict():
    """
    ⚠️ 本来の目的は崩さない。

    アプリが管理している写像を BQ が **別の QID で** 上書きしようとしたら、
    従来どおり衝突として扱う。
    """
    app_rows = [("とんかつ", "Q1142841", "wikidata_qid_match")]
    bq = {"とんかつ": "Q999999"}

    real_conflicts, same_mapping = classify_app_row_conflicts(app_rows, bq)

    assert real_conflicts == [("とんかつ", "Q1142841", "wikidata_qid_match")]
    assert same_mapping == set()


def test_mixed_rows_are_split_correctly():
    """同じ写像と本当の衝突が混ざっていても、衝突だけが残る"""
    app_rows = [
        ("とんかつ", "Q1142841", "wikidata_qid_match"),   # 同じ
        ("焼肉", "Q844466", "manual"),                     # 別（BQ は Q2431975）
        ("そば", "Q753910", "wikidata_qid_match"),         # 同じ
    ]
    bq = {"とんかつ": "Q1142841", "焼肉": "Q2431975", "そば": "Q753910"}

    real_conflicts, same_mapping = classify_app_row_conflicts(app_rows, bq)

    assert real_conflicts == [("焼肉", "Q844466", "manual")]
    assert same_mapping == {"とんかつ", "そば"}


def test_surface_not_in_bq_is_a_conflict_row():
    """
    BQ 側に無い表記は «同じ写像» ではないので、衝突側へ寄せる。

    実際にはこの関数へ渡る app_rows は BQ 側の表記で絞り込まれているので
    起こらないが、絞り込みが変わったときに黙って «同じ扱い» へ倒れないよう固定する。
    """
    app_rows = [("ここにしかない", "Q1", "manual")]
    bq = {}

    real_conflicts, same_mapping = classify_app_row_conflicts(app_rows, bq)

    assert real_conflicts == [("ここにしかない", "Q1", "manual")]
    assert same_mapping == set()


def test_no_app_rows():
    """アプリ由来行が無ければ、どちらも空"""
    real_conflicts, same_mapping = classify_app_row_conflicts([], {"焼肉": "Q2431975"})

    assert real_conflicts == []
    assert same_mapping == set()
