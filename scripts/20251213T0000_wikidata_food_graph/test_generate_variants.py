#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#1748 表記が衝突したときに «検索に出ない QID» を勝たせないことを固定する。

実機で起きたこと: 表記「焼肉」を Q844466（広東料理の焼豚 siu yuk）が取り、
検索が要求する Q2431975（yakiniku）には日本語の「焼肉」が 1 件も無くなっていた。
取り込み時に付くのは Q844466、検索が要求するのは Q2431975 で、
`findDishMediaIds` は category_id の完全一致なので永久にヒットしない。

実行:
    python3 -m pytest scripts/20251213T0000_wikidata_food_graph/test_generate_variants.py
"""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent))

from importlib import import_module

# ファイル名が数字で始まるため通常の import 文が使えない
_mod = import_module("4_1_generate_variants")
resolve_winners = _mod.resolve_winners

# 本番と同じ値（4_1_generate_variants.generate_variants 内の定義と一致させること）
SOURCE_PRIORITY = {
    "wikidata-label": 0,
    "kata2hira": 1,
    "romaji": 2,
    "canonical-label-en": -1,
}


def _candidate(qid, surface, source="wikidata-label", canonical=False):
    return {"qid": qid, "surface": surface, "source": source, "canonical": canonical}


def _winner_qid(candidates, searchable, surface):
    winners, _ = resolve_winners(candidates, SOURCE_PRIORITY, searchable)
    return candidates[winners[surface]]["qid"]


def test_yakiniku_goes_to_the_searchable_qid():
    """
    🛑 これが Q844466 に戻ると、取り込んだ投稿が検索から到達不能になる。

    Q844466 の方が Q 番号が小さいので、修正前の «Q 番号が小さい方を採用» では
    siu yuk が「焼肉」を取っていた。
    """
    candidates = [
        _candidate("Q844466", "焼肉"),    # 広東料理の焼豚。検索には出ない
        _candidate("Q2431975", "焼肉"),   # 日本の焼肉。検索が要求するのはこちら
    ]
    assert _winner_qid(candidates, {"Q2431975"}, "焼肉") == "Q2431975"


def test_kakigori_and_gyoza_are_fixed_by_the_same_rule():
    """かき氷・餃子も同じ形。3 件が 1 つの規則で直ることを固定する"""
    cases = [
        ("かき氷", "Q905204", "Q7491078"),      # kakigōri（検索外） / shaved ice（検索）
        ("餃子", "Q640769", "Q107014807"),      # jiaozi（検索外） / gyoza（検索）
    ]
    for surface, unsearchable, searchable in cases:
        candidates = [_candidate(unsearchable, surface), _candidate(searchable, surface)]
        assert _winner_qid(candidates, {searchable}, surface) == searchable


def test_searchability_outranks_source_priority():
    """
    «検索に出るか» は source priority より上。

    ここが逆だと、検索に出ない側が強い source（wikidata-label）を持っているだけで
    表記を取り返してしまう。
    """
    candidates = [
        _candidate("Q100", "ラーメン", source="wikidata-label"),  # 強い source だが検索外
        _candidate("Q200", "ラーメン", source="romaji"),          # 弱い source だが検索対象
    ]
    assert _winner_qid(candidates, {"Q200"}, "ラーメン") == "Q200"


def test_qid_number_still_breaks_ties_when_both_are_searchable():
    """
    どちらも検索に出るなら従来どおりの決め方（source priority → QID 番号）に戻る。
    ここを変えると、実害の無い 70 件の表記まで無用に入れ替わる。
    """
    candidates = [
        _candidate("Q300", "うどん"),
        _candidate("Q100", "うどん"),
    ]
    assert _winner_qid(candidates, {"Q100", "Q300"}, "うどん") == "Q100"


def test_neither_searchable_falls_back_to_qid_number():
    """どちらも検索に出ないなら、従来どおり QID 番号で決まる（挙動を変えない）"""
    candidates = [
        _candidate("Q300", "謎料理"),
        _candidate("Q100", "謎料理"),
    ]
    assert _winner_qid(candidates, {"Q999"}, "謎料理") == "Q100"


def test_canonical_still_beats_non_canonical():
    """
    ⚠️ canonical の優先は崩さない。

    canonical-label-en はその項目自身の英語名なので、日本語ラベルに奪わせると
    その語での英語検索が別の料理へ着地する。検索に出る側であっても、
    非 canonical が canonical を追い出してはいけない。
    """
    candidates = [
        _candidate("Q100", "ramen", source="canonical-label-en", canonical=True),  # 検索外
        _candidate("Q200", "ramen", source="wikidata-label"),                      # 検索対象
    ]
    assert _winner_qid(candidates, {"Q200"}, "ramen") == "Q100"


def test_searchable_wins_among_canonicals():
    """canonical 同士が衝突したときは、検索に出る側を採る"""
    candidates = [
        _candidate("Q100", "tart", source="canonical-label-en", canonical=True),  # 検索外
        _candidate("Q900", "tart", source="canonical-label-en", canonical=True),  # 検索対象
    ]
    assert _winner_qid(candidates, {"Q900"}, "tart") == "Q900"


def test_collide_skipped_counts_discarded_candidates():
    """捨てた候補の数が実行ログの検証に使えること"""
    candidates = [
        _candidate("Q100", "そば"),
        _candidate("Q200", "そば"),
        _candidate("Q300", "うどん"),
    ]
    winners, collide_skipped = resolve_winners(candidates, SOURCE_PRIORITY, {"Q200"})
    assert len(winners) == 2
    assert collide_skipped == 1
