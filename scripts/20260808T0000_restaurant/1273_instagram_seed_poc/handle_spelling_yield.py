#!/usr/bin/env python3
"""#1273 «ハンドルの綴りで取れ高を予測できるか» を実測して否定した script（BQ 読み取りのみ）。

## なぜ残すか

2026-09-05、`4_19_rank_account_candidates.py` の較正表（A 段 = 料理語×地域語 が
18.6 店/コール、D 段 = 店アカウント の 86 倍）を根拠に、**«ハンドル名を機械的に組み立てて
IG で存在確認すれば A 段を量産できる»** という案が立った。この script はその案を
**IG のコールを 1 回も使わずに否定した**もの。同じ思いつきが次に出たときの
再実行用に置く（＝ また 200 コール/時の枠を溶かさないため）。

## 何が間違っていたか

較正表の成果が `sns_post_resolved` の matched で数えられていた。成果を
**«配信カタログ（`sns_dish_media_catalog`）に載った異なり店»** に替え、さらに
«人が選んだ一覧（`discovery_method='influencer_list'`）に載っているか» で層別すると、
効いていたのは綴りではなく curation だった（`stratify_sql()` の実測）。

    段              curated あり   curated なし
    A 料理語×地域語     49.911        0.061
    B 料理語のみ        38.960        0.121
    C 地域語のみ        38.280        0.134
    D 店アカウント         --         0.592
    E 語なし            21.377        0.051

未収集プールはほぼ全部 curated ではない。**綴りで組み立てたハンドルの期待値は
0.05〜0.13 店/コールで、店アカウント（0.592）より 1 桁悪い。** しかも非 curated の中では
A 段が最下位で、綴りの «効果» は符号すら逆である。

## なぜ綴りが効いて見えたか（2 つ）

1. **選択バイアス**: A 段の収集済み 257 件のうち 45 件（17.5%）が influencer_list。
   この 45 件が段の合計をほぼ全部作っていた。
2. **部分文字列の誤爆**: `FOOD_TOKENS` の `eat` が theatre / create / meat / great /
   breath / retreat / sweat に、`umai` が sumai（住まい）に、`oishi` が koishikawa に当たる。
   A 段 273 件のうち **71 件（26%）は料理語が部分文字列でしか当たっていない**
   （`nationaltheatre_tokyo` `sumai_yokohama` `mariakoishikawa` `aichi_creative` …）。
   `artifact_sql()` がこの内訳を出す。

## 綴りの型そのものは実在する（が、取れ高を予測しない）

`shapes()` が A 段の実在ハンドルから数える並びは «地域語 + 区切り + 料理語» が主で、
区切りは `_` `.` `__` 無し、接尾辞は数字 / `_` / `map` / `official` が付く
（`okayama_gourmet` `toyama.gourmet` `tochigi__gurume` `osaka_gourmet1`
`chiba.gourmet2021` `eatmapsendai`）。**型が実在することと、その型を組み立てた
ハンドルが取れることは別**である、というのがこの script の結論。

## 使い方

    python3 handle_spelling_yield.py            # 3 つの実測を全部出す
"""

from __future__ import annotations

import importlib.util
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
PARENT = HERE.parent


def _load_ranker():
    """`4_19_rank_account_candidates` を読む（数字始まりなので import 文では書けない）。

    ⚠️ 語彙（FOOD_TOKENS / REGION_TOKENS）と段の判定（tier_of）は **写経しない**。
    写経すると 4_19 側だけ直ったときに、この script が緑のまま古い段を守り続ける。
    """
    sys.path.insert(0, str(PARENT))
    path = PARENT / "4_19_rank_account_candidates.py"
    spec = importlib.util.spec_from_file_location("rank_account_candidates", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RANK = _load_ranker()
FOOD_RE = RANK._token_regex(RANK.FOOD_TOKENS)
REGION_RE = RANK._token_regex(RANK.REGION_TOKENS)

# 料理語が «別の語の一部» としてしか当たっていないもの。ここに挙げた語を潰してから
# もう一度料理語を探して、当たらなくなったものが誤爆である。
FOOD_SUBSTRING_ARTIFACTS = (
    "theat", "creat", "meat", "great", "breath", "retreat", "sweat", "wheat",
    "beat", "seat", "defeat", "sumai", "koishikawa", "gurukun",
)
ARTIFACT_RE = "(" + "|".join(FOOD_SUBSTRING_ARTIFACTS) + ")"

DATASET = "`food-scroll.restaurant_recommendation"


def stratify_sql() -> str:
    """段 × curation ごとの «配信カタログに載った異なり店 / コール» を返す。

    成果は `sns_post_resolved` の matched ではなく **`sns_dish_media_catalog`**
    （＝ 実際に配信され得る行）で数える。matched で数えると、カタログに載らない
    resolve まで成果に入り、段の差が実態より大きく出る。
    """
    return f"""
    WITH acct AS (
      SELECT LOWER(handle) AS h,
             LOGICAL_OR(discovery_method = 'influencer_list') AS curated,
             LOGICAL_OR(discovery_seed_place_id IS NOT NULL) AS store_attr
      FROM {DATASET}.sns_source_account`
      WHERE provider = 'instagram' AND handle IS NOT NULL AND handle != '' GROUP BY 1
    ),
    pr AS (
      SELECT DISTINCT post_id, LOWER(account_id) AS h FROM {DATASET}.sns_post_raw`
      WHERE provider = 'instagram' AND account_id IS NOT NULL AND account_id != ''
    ),
    collected AS (SELECT DISTINCT h FROM pr),
    cat AS (
      SELECT DISTINCT external_content_id AS eid, google_place_id
      FROM {DATASET}.sns_dish_media_catalog`
      WHERE provider = 'instagram' AND google_place_id IS NOT NULL
    ),
    deliv AS (
      SELECT pr.h, COUNT(DISTINCT cat.google_place_id) AS stores
      FROM cat JOIN pr ON pr.post_id = cat.eid GROUP BY 1
    )
    SELECT CASE
             WHEN REGEXP_CONTAINS(c.h, r'{FOOD_RE}') AND REGEXP_CONTAINS(c.h, r'{REGION_RE}')
               THEN 'A_food_region'
             WHEN REGEXP_CONTAINS(c.h, r'{FOOD_RE}') THEN 'B_food'
             WHEN REGEXP_CONTAINS(c.h, r'{REGION_RE}') THEN 'C_region'
             WHEN a.store_attr THEN 'D_store_attributed' ELSE 'E_rest' END AS tier,
           IFNULL(a.curated, FALSE) AS curated,
           COUNT(*) AS collected_accounts,
           SUM(IFNULL(d.stores, 0)) AS delivery_stores,
           ROUND(SUM(IFNULL(d.stores, 0)) / COUNT(*), 3) AS delivery_stores_per_call
    FROM collected c LEFT JOIN acct a USING (h) LEFT JOIN deliv d ON d.h = c.h
    GROUP BY 1, 2 ORDER BY 1, 2
    """


def artifact_sql() -> str:
    """A 段のうち «料理語が部分文字列でしか当たっていない» 件数を返す。"""
    return f"""
    SELECT COUNT(*) AS a_tier_handles,
           COUNTIF(NOT REGEXP_CONTAINS(REGEXP_REPLACE(h, r'{ARTIFACT_RE}', '#'), r'{FOOD_RE}'))
             AS food_match_is_substring_artifact,
           COUNTIF(REGEXP_CONTAINS(REGEXP_REPLACE(h, r'{ARTIFACT_RE}', '#'), r'{FOOD_RE}'))
             AS genuinely_food_worded
    FROM (SELECT DISTINCT LOWER(handle) AS h FROM {DATASET}.sns_source_account`
          WHERE provider = 'instagram' AND handle IS NOT NULL AND handle != '')
    WHERE REGEXP_CONTAINS(h, r'{FOOD_RE}') AND REGEXP_CONTAINS(h, r'{REGION_RE}')
    """


def a_tier_handles_sql() -> str:
    return f"""
    SELECT DISTINCT LOWER(handle) AS h FROM {DATASET}.sns_source_account`
    WHERE provider = 'instagram' AND handle IS NOT NULL AND handle != ''
      AND REGEXP_CONTAINS(LOWER(handle), r'{FOOD_RE}')
      AND REGEXP_CONTAINS(LOWER(handle), r'{REGION_RE}')
    """


_FOOD = re.compile(FOOD_RE)
_REGION = re.compile(REGION_RE)


def shape_of(handle: str) -> tuple[str, str]:
    """実在ハンドルの «並び» と «区切り» を返す（誤爆は除いてから呼ぶこと）。

    返り値は ("region_food" | "food_region" | "mixed", 区切り文字)。
    組み立て案の «型» はここで数えた分布から取っていた。
    """
    f = _FOOD.search(handle)
    r = _REGION.search(handle)
    if not f or not r:
        return ("none", "")
    if f.start() > r.end() - 1:
        order, gap = "region_food", handle[r.end():f.start()]
    elif r.start() > f.end() - 1:
        order, gap = "food_region", handle[f.end():r.start()]
    else:
        return ("overlap", "")
    return (order, gap if re.fullmatch(r"[._]*", gap) else "<word>")


def shapes(handles: list[str]) -> tuple[Counter, Counter]:
    """A 段の実在ハンドルから «並び × 区切り» と «接尾辞» の分布を数える。"""
    order_gap: Counter = Counter()
    suffix: Counter = Counter()
    for h in handles:
        if not _FOOD.search(re.sub(ARTIFACT_RE, "#", h)):
            continue  # 部分文字列の誤爆は型の学習に混ぜない
        order, gap = shape_of(h)
        order_gap[(order, gap)] += 1
        f, r = _FOOD.search(h), _REGION.search(h)
        end = max(f.end(), r.end()) if f and r else 0
        tail = h[end:]
        suffix[re.sub(r"\d+", "<n>", tail) or "<none>"] += 1
    return order_gap, suffix


def main() -> None:
    from pipeline_common import BigQueryPipeline  # noqa: PLC0415 - PARENT を通してから

    pipeline = BigQueryPipeline()

    print("## 段 × curation ごとの «配信カタログの異なり店 / コール»")
    print(f"{'段':<20}{'curated':<9}{'アカウント':>10}{'配信店':>9}{'店/コール':>11}")
    for row in pipeline.execute(stratify_sql(), []):
        print(f"{row['tier']:<20}{str(row['curated']):<9}{row['collected_accounts']:>10}"
              f"{row['delivery_stores']:>9}{row['delivery_stores_per_call']:>11.3f}")

    print("\n## A 段の «料理語» のうち部分文字列の誤爆")
    for row in pipeline.execute(artifact_sql(), []):
        print(f"A 段 {row['a_tier_handles']} 件 / 誤爆 {row['food_match_is_substring_artifact']} 件 "
              f"/ 本物 {row['genuinely_food_worded']} 件")

    handles = [r["h"] for r in pipeline.execute(a_tier_handles_sql(), [])]
    order_gap, suffix = shapes(handles)
    print("\n## A 段の実在ハンドルの並び × 区切り（誤爆を除く）")
    for (order, gap), n in order_gap.most_common(12):
        print(f"  {order:<14} 区切り={gap!r:<10} {n:>4}")
    print("\n## 料理語・地域語の «後ろ» に付く接尾辞")
    for tail, n in suffix.most_common(15):
        print(f"  {tail!r:<16} {n:>4}")


if __name__ == "__main__":
    main()
