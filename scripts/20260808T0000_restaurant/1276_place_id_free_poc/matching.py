#!/usr/bin/env python3
"""ダブルクエリ相互検証の判定ルール（純粋関数）。

APIアクセスを含めないのは、ルールを変えるたびに Google を叩き直さずに、
キャッシュ済みの place_id 列だけで再評価できるようにするためである。

証拠は3種類ある。
- A: 店名 + 150m locationBias（座標を弱いヒントに使う）
- B: 店名 + 住所文字列、bias なし（座標と独立なテキスト証拠）
- C: 店名 + 座標矩形の locationRestriction（矩形外を実際に切り落とす裏取り）

A と B は Issue 記載のダブルクエリそのもの。C は「Google 側でもその place が
この座標の近くにある」ことを無料で確かめるために足した第3の証拠である。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping

from free_places import SearchResult
from seeds import Seed

PROBE_A = "a"
PROBE_B = "b"
PROBE_C = "c"
PROBE_C_TIGHT = "c_tight"
PROBE_C_WIDE = "c_wide"
PROBE_C_HUGE = "c_huge"
PROBE_CA_HUGE = "ca_huge"
PROBE_D = "d"
PROBE_NEARBY = "nearby"

STATUS_MATCHED = "matched"
STATUS_AMBIGUOUS = "ambiguous"
STATUS_UNMATCHED = "unmatched"
STATUS_INELIGIBLE = "ineligible"
STATUS_API_ERROR = "api_error"

GEO_CONFIRMED = "confirmed"
GEO_ABSENT = "absent"
GEO_INCONCLUSIVE = "inconclusive"

NEARBY_MAX_RESULTS = 20


@dataclass(frozen=True)
class Decision:
    status: str
    place_id: str | None
    geo: str
    detail: str


def geo_status(place_id: str | None, probes: Mapping[str, SearchResult]) -> str:
    """候補が座標の近傍に実在するかを、無料の証拠だけで判定する。

    優先するのは probe C（店名 + 矩形 restriction）である。店名で絞られるので
    件数上限による打ち切りが起きず、矩形外は Google 側で落とされるため、
    「含まれない」がそのまま「その座標の近くではない」を意味する。

    C が無い場合だけ Nearby Search にフォールバックする。こちらは件数上限で
    打ち切られうるので、上限ちょうどなら ``inconclusive`` に落とす。
    """

    if place_id is None:
        return GEO_INCONCLUSIVE
    # ±75m を第一に見るが、送っていない実行もある。矩形はどれも同じ性質（外を
    # 実際に切り落とす）なので、狭い方から順に、送られているものを使う。
    for probe in (PROBE_C, PROBE_C_TIGHT, PROBE_C_WIDE):
        result = probes.get(probe)
        if result is not None and result.ok:
            if place_id in result.place_ids:
                return GEO_CONFIRMED
            # 狭い矩形に居なくても、広い矩形には居るかもしれない。まだ断定しない。
            if probe is not PROBE_C_WIDE and probes.get(PROBE_C_WIDE) is not None:
                continue
            return GEO_ABSENT
    nearby = probes.get(PROBE_NEARBY)
    if nearby is None or not nearby.ok:
        return GEO_INCONCLUSIVE
    if place_id in nearby.place_ids:
        return GEO_CONFIRMED
    if len(nearby.place_ids) >= NEARBY_MAX_RESULTS or not nearby.place_ids:
        return GEO_INCONCLUSIVE
    return GEO_ABSENT


def _preflight(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision | None:
    if not seed.name_query or not seed.address_query:
        return Decision(STATUS_INELIGIBLE, None, GEO_INCONCLUSIVE, "missing_name_or_address")
    result_a = probes.get(PROBE_A)
    result_b = probes.get(PROBE_B)
    if result_a is None or result_b is None:
        return Decision(STATUS_API_ERROR, None, GEO_INCONCLUSIVE, "probe_missing")
    if not result_a.ok or not result_b.ok:
        return Decision(STATUS_API_ERROR, None, GEO_INCONCLUSIVE, "http_error")
    return None


def _matched(place_id: str, probes: Mapping[str, SearchResult], detail: str) -> Decision:
    return Decision(STATUS_MATCHED, place_id, geo_status(place_id, probes), detail)





def _ids(probes: Mapping[str, SearchResult], name: str) -> tuple[str, ...]:
    result = probes.get(name)
    return result.place_ids if result is not None and result.ok else ()





def rule_box_unique(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision:
    """矩形内で同名店が「1件しかない」ことだけを根拠にする、2層だけのルール。

    層を手で足しては測る進め方をやめ、2,541件の正解ラベルに対して候補の選び方と
    証拠の連言を総当たりで採点し直した結果、残ったのがこの2層である
    （総当たりでの採点による。数字は ``REPORT.md`` に残してある）。

    要点は「一意性」であって「合意」ではなかった。A と B の合意を根拠にする層は
    どれも 99.7〜99.8% で頭打ちになる。合意していても、その店が Google に無ければ
    両クエリが揃って隣の店を返すからである。対して矩形内に同名が1件しか無いことは、
    取り違える相手が存在しないことを意味する。

    - 層1: ±25m の矩形に同名が1件だけ。座標のほぼ真上にある。
    - 層2: ±250m の矩形に広げても同名が1件だけ。座標が数百mずれていても、
      その範囲に同名店が1つしか無いなら取り違えようがない。

    どちらも「A か B がその place_id を挙げている」ことを要求する。この裏取りを
    外すと、層1に新たに通る49件のうち正解は1件しかない（2.0%）。矩形内で唯一でも、
    店名クエリがその店を指していなければ別の店だからである。

    ラベル2,541件での実測は 確定 2,484件 (97.76%)、DB不一致 2件。その2件は
    どちらも「自分の place_id は ±25m 矩形に居るが、DB の place_id は ±100m
    矩形にも居ない」もので、DB 側が古い可能性が高い（``dupcheck`` の記録を参照）。
    seed_id のハッシュで2分割した交差検証でも、両半分とも 99.92% で一致した。
    """

    # このルールは住所テキストのクエリ B を必須にしない。B は「A か B が挙げている」
    # の片方でしかなく、住所が無くても A と矩形だけで判定は成立する。OSM は住所タグが
    # 付いている行が実測で 15.6% しかないので、B の有無で足切りすると使えなくなる。
    if not seed.name_query:
        return Decision(STATUS_INELIGIBLE, None, GEO_INCONCLUSIVE, "missing_name")
    # 必要な probe だけを送る運用（adaptive_probe）では、矩形が一意にならなかった
    # seed に A も B も存在しない。確定しえないと分かって送らなかっただけなので、
    # 取得漏れとは区別する。判断の起点は矩形のほうである。
    if PROBE_C_TIGHT not in probes and PROBE_A not in probes:
        return Decision(STATUS_API_ERROR, None, GEO_INCONCLUSIVE, "probe_missing")
    result_a = probes.get(PROBE_A)
    if result_a is not None and not result_a.ok:
        return Decision(STATUS_API_ERROR, None, GEO_INCONCLUSIVE, "http_error")

    a, b = _ids(probes, PROBE_A), _ids(probes, PROBE_B)
    supported = set(a) | set(b)

    tight = set(_ids(probes, PROBE_C_TIGHT))
    if len(tight) == 1 and (tight & supported):
        return _matched(next(iter(tight)), probes, "tight_unique_in_ab")

    wide = set(_ids(probes, PROBE_C_WIDE))
    if len(wide) == 1 and (wide & supported):
        return _matched(next(iter(wide)), probes, "wide_unique_in_ab")

    if not tight and not wide:
        return Decision(STATUS_AMBIGUOUS, None, GEO_ABSENT, "no_candidate_in_box")
    return Decision(STATUS_AMBIGUOUS, None, GEO_INCONCLUSIVE, "box_not_unique")


def rule_box_unique_strict(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision:
    """②（正解率）を、全ラベル 6,000 件で誤り0にするための出荷用ルール。

    ``rule_box_unique`` はラベルの質で分けると、金ラベル（距離 ≤20m かつ名前類似度
    ≥0.90 で作った対応表）3,715 件では誤り0だが、質を問わない全ラベル 6,000 件では
    8 件残る。その 8 件はどれも「±100m に同名が2つあり、自分は ±5〜25m、DB のものは
    25〜100m」という形で、裁定は ``inconclusive``（``mine_wrong`` は0件）である。
    ラベル側が距離 28〜101m・類似度 0.50〜0.82 で作られており、正解として弱い。

    それでも「確定したものは 100% 正しい」を運用の前提にするなら、弱いラベルとも
    食い違わないところまで絞る必要がある。使える条件を総当たりで採点した結果、
    次の2つを足すと**全ラベル 6,000 件で誤りが0**になった。

    - 選んだ place_id が **±25m の矩形の中にある**こと
      （±250m まで広げて拾ったものは採らない）
    - **B（店名+住所）の候補が1件以下**であること
      （住所で引いて複数出る店名は、そもそも取り違えの余地がある）

    代償は小さくない。① は 66.65% → 55.61%、③ は 68.00% → 63.37% に下がる。
    「確定した分は絶対に間違えない」を優先する判断で、`EXPORT_SAFE_RULES` は
    これだけにしてある。

    条件はラベル 6,000 件の上で選んだので、選定に使った集合で 0 件なのは当然である
    （確定 5,083 件で誤り0、95%下限 99.93%）。別のラベル集合でも 0 になる保証は無い。
    """

    decision = rule_box_unique(seed, probes)
    if decision.status != STATUS_MATCHED or not decision.place_id:
        return decision
    if decision.place_id not in set(_ids(probes, PROBE_C_TIGHT)):
        return Decision(STATUS_AMBIGUOUS, None, decision.geo, "rejected_not_in_tight_box")
    if len(set(_ids(probes, PROBE_B))) > 1:
        return Decision(STATUS_AMBIGUOUS, None, decision.geo, "rejected_address_query_ambiguous")
    return decision





RULES: dict[str, Callable[[Seed, Mapping[str, SearchResult]], Decision]] = {
    "box_unique": rule_box_unique,
    "box_unique_strict": rule_box_unique_strict,
}

# 負例での誤マッチ率が実測1%以下だったルールだけを CSV 出力に許可する。
EXPORT_SAFE_RULES = frozenset({"box_unique_strict"})
