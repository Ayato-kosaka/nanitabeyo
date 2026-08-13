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


def rule_strict_unique(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision:
    """Issue 記載の素のルール: A も B も候補1件で、その1件が一致。"""

    failure = _preflight(seed, probes)
    if failure:
        return failure
    a, b = probes[PROBE_A].place_ids, probes[PROBE_B].place_ids
    if not a or not b:
        return Decision(STATUS_UNMATCHED, None, GEO_INCONCLUSIVE, "empty_result")
    if len(a) != 1 or len(b) != 1:
        return Decision(STATUS_AMBIGUOUS, None, GEO_INCONCLUSIVE, "multiple_candidates")
    if a[0] != b[0]:
        return Decision(STATUS_AMBIGUOUS, None, GEO_INCONCLUSIVE, "query_disagreement")
    return _matched(a[0], probes, "strict_unique")


def rule_top1_agree(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision:
    """A と B の最上位が一致すれば採用する。件数条件を外した緩和版。"""

    failure = _preflight(seed, probes)
    if failure:
        return failure
    a, b = probes[PROBE_A].place_ids, probes[PROBE_B].place_ids
    if not a or not b:
        return Decision(STATUS_UNMATCHED, None, GEO_INCONCLUSIVE, "empty_result")
    if a[0] != b[0]:
        return Decision(STATUS_AMBIGUOUS, None, GEO_INCONCLUSIVE, "top1_disagreement")
    return _matched(a[0], probes, "top1_agree")


def rule_intersection_unique(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision:
    """A と B の共通集合がちょうど1件のときだけ採用する。"""

    failure = _preflight(seed, probes)
    if failure:
        return failure
    a, b = probes[PROBE_A].place_ids, probes[PROBE_B].place_ids
    if not a or not b:
        return Decision(STATUS_UNMATCHED, None, GEO_INCONCLUSIVE, "empty_result")
    common = [place_id for place_id in a if place_id in set(b)]
    if not common:
        return Decision(STATUS_AMBIGUOUS, None, GEO_INCONCLUSIVE, "no_intersection")
    if len(common) > 1:
        return Decision(STATUS_AMBIGUOUS, None, GEO_INCONCLUSIVE, "multi_intersection")
    return _matched(common[0], probes, "intersection_unique")


def _ids(probes: Mapping[str, SearchResult], name: str) -> tuple[str, ...]:
    result = probes.get(name)
    return result.place_ids if result is not None and result.ok else ()


def rule_layered(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision:
    """A/B/C を層で使い、確定と再現率を両立させる本命ルール。

    どの層も「座標矩形に実在する（C で確認できる）」ことを必須にしている。
    A と B が一致しても、その place が座標の近くに無いなら別店舗である。
    """

    failure = _preflight(seed, probes)
    if failure:
        return failure
    a, b = probes[PROBE_A].place_ids, probes[PROBE_B].place_ids
    result_c = probes.get(PROBE_C)
    c = result_c.place_ids if result_c is not None and result_c.ok else ()
    if not a and not b:
        return Decision(STATUS_UNMATCHED, None, GEO_INCONCLUSIVE, "empty_result")

    common = [place_id for place_id in a if place_id in set(b)]
    # 層1: A と B の共通集合が1件で、それが座標矩形内にある。
    if len(common) == 1 and common[0] in c:
        return _matched(common[0], probes, "layer1_intersection_in_box")
    # 層2: A と B の最上位が一致し、それが座標矩形内にある。
    if a and b and a[0] == b[0] and a[0] in c:
        return _matched(a[0], probes, "layer2_top1_in_box")
    # 層3: 座標矩形内に同名の place が1件しか無く、それを A か B も挙げている。
    if len(c) == 1 and (c[0] in a or c[0] in b):
        return _matched(c[0], probes, "layer3_unique_in_box")

    if not c:
        return Decision(STATUS_AMBIGUOUS, None, GEO_ABSENT, "no_candidate_in_box")
    return Decision(STATUS_AMBIGUOUS, None, GEO_INCONCLUSIVE, "no_layer_satisfied")


def with_geo_gate(
    rule: Callable[[Seed, Mapping[str, SearchResult]], Decision],
    *,
    require_confirmed: bool,
) -> Callable[[Seed, Mapping[str, SearchResult]], Decision]:
    """判定に座標裏取りを課す。

    ``require_confirmed`` が True なら矩形内に実在を確認できたものだけを採用する。
    False なら「矩形内に無いと分かった」ものだけを落とす。
    """

    def wrapped(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision:
        decision = rule(seed, probes)
        if decision.status != STATUS_MATCHED:
            return decision
        if decision.geo == GEO_ABSENT:
            return Decision(STATUS_AMBIGUOUS, None, decision.geo, f"{decision.detail}+geo_absent")
        if require_confirmed and decision.geo != GEO_CONFIRMED:
            return Decision(
                STATUS_AMBIGUOUS, None, decision.geo, f"{decision.detail}+geo_unconfirmed"
            )
        return Decision(STATUS_MATCHED, decision.place_id, decision.geo, f"{decision.detail}+geo")

    return wrapped


def rule_layered_v2(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision:
    """候補集合に正解が入っているのに条件が硬くて落としている行を拾う。

    ラベル付きデータで「未確定だが正解が候補に含まれる」34件の内訳を見ると、
    取りこぼしは3種類に分かれた。層はその内訳に対応して足してある。
    各層の精度はラベルで個別に測り、100%に届かない層は採用しない前提で並べている。
    """

    failure = _preflight(seed, probes)
    if failure:
        return failure
    a, b = _ids(probes, PROBE_A), _ids(probes, PROBE_B)
    c = _ids(probes, PROBE_C)
    wide = set(c) | set(_ids(probes, PROBE_C_WIDE))
    if not a and not b:
        return Decision(STATUS_UNMATCHED, None, GEO_INCONCLUSIVE, "empty_result")

    common = [place_id for place_id in a if place_id in set(b)]

    # 既存の層。狭い矩形の中で A と B が合意している。
    if len(common) == 1 and common[0] in c:
        return _matched(common[0], probes, "layer1_intersection_in_box")
    if a and b and a[0] == b[0] and a[0] in c:
        return _matched(a[0], probes, "layer2_top1_in_box")

    # 新1: A と B の共通集合が複数でも、狭い矩形に居るものが1件なら決まる。
    # 「共通集合がちょうど1件」という条件は、候補が増えるほど成立しにくくなる。
    # 矩形が地理を保証しているので、共通集合の中から矩形内を選べば十分である。
    common_in_box = [place_id for place_id in common if place_id in c]
    if len(common_in_box) == 1:
        return _matched(common_in_box[0], probes, "v2_common_in_box")

    # 新1b: 矩形を縮めて絞る。locationRestriction は矩形外を実際に切り落とすので、
    # ±25m まで縮めて同名が1件しか残らなければ、その1件は座標のほぼ真上にある。
    # A か B のどちらかがそれを挙げていれば、テキストと幾何の両方が支持している。
    tight = _ids(probes, PROBE_C_TIGHT)
    if len(tight) == 1 and (tight[0] in a or tight[0] in b):
        return _matched(tight[0], probes, "v2_tight_box_unique")

    # 新2: A に正解が出てこない行がある（住所クエリBのほうが当たる場合）。
    # B と狭い矩形の共通集合が1件なら、座標とテキストの両方が支持している。
    b_in_box = [place_id for place_id in b if place_id in c]
    if len(b_in_box) == 1:
        return _matched(b_in_box[0], probes, "v2_b_in_box")

    # 新3: 狭い矩形が空でも、広い矩形の中で A と B の最上位が一致していれば拾う。
    # Overture の座標が数十〜250m ずれている行を救う。
    if a and b and a[0] == b[0] and a[0] in wide:
        return _matched(a[0], probes, "v2_top1_in_wide_box")

    # 新4: 広い矩形の中で A と B の共通集合が1件。
    common_in_wide = [place_id for place_id in common if place_id in wide]
    if len(common_in_wide) == 1:
        return _matched(common_in_wide[0], probes, "v2_common_in_wide_box")

    if not c:
        return Decision(STATUS_AMBIGUOUS, None, GEO_ABSENT, "no_candidate_in_box")
    return Decision(STATUS_AMBIGUOUS, None, GEO_INCONCLUSIVE, "no_layer_satisfied")


def rule_box_unique(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision:
    """矩形内で同名店が「1件しかない」ことだけを根拠にする、2層だけのルール。

    層を手で足しては測る進め方をやめ、2,541件の正解ラベルに対して候補の選び方と
    証拠の連言を総当たりで採点し直した結果、残ったのがこの2層である
    （``gate_analysis.py`` と ``results/gate_report.json``）。

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
    result_a = probes.get(PROBE_A)
    if result_a is None:
        return Decision(STATUS_API_ERROR, None, GEO_INCONCLUSIVE, "probe_missing")
    if not result_a.ok:
        return Decision(STATUS_API_ERROR, None, GEO_INCONCLUSIVE, "http_error")

    a, b = _ids(probes, PROBE_A), _ids(probes, PROBE_B)
    if not a and not b:
        return Decision(STATUS_UNMATCHED, None, GEO_INCONCLUSIVE, "empty_result")
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


def rule_layered_strict(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision:
    """``rule_layered`` から層3を外した、最も誤りに強い運用ルール。

    層3（矩形内の唯一の同名店を、A か B の片方だけが支持）は再現率を +2.4pt
    上げるが、負例での誤マッチの大半をこの層が出した。突合結果を「100%正しい」
    前提で使う CSV には層1・層2だけを載せる。
    """

    decision = rule_layered(seed, probes)
    if decision.detail == "layer3_unique_in_box":
        return Decision(STATUS_AMBIGUOUS, None, decision.geo, "layer3_rejected_by_strict_policy")
    return decision


def rule_layered_strict_wide(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision:
    """``layered_strict`` に、負例で誤りを1件も出さなかった救済層だけを足す。

    救済条件は「A と B がどちらも単一候補で、同じ place_id を指し、それが
    半辺250mの矩形の中にある」。Overture の座標が数十m ずれている行を拾うための層で、
    較正では正例 +13件（+1.3pt）に対し負例の誤マッチ 0件だった。

    同じ広い矩形でも、住所つきクエリを使う救済層（``layered_wide`` の wide2・wide3）は
    負例で 41件の誤マッチを出した。矩形内のText Searchは名称が合わなくても近い候補を
    返すため、テキスト側の合意を strict に保つことが効いている。
    """

    decision = rule_layered_strict(seed, probes)
    if decision.status in {STATUS_MATCHED, STATUS_INELIGIBLE, STATUS_API_ERROR}:
        return decision
    a, b = _ids(probes, PROBE_A), _ids(probes, PROBE_B)
    wide = set(_ids(probes, PROBE_C)) | set(_ids(probes, PROBE_C_WIDE))
    if len(a) == 1 and len(b) == 1 and a[0] == b[0] and a[0] in wide:
        return Decision(STATUS_MATCHED, a[0], GEO_CONFIRMED, "wide1_strict_in_wide_box")
    return decision


def rule_layered_wide(seed: Seed, probes: Mapping[str, SearchResult]) -> Decision:
    """狭い矩形で決まらなかった行を、広い矩形と住所つき矩形で救済する。

    Overture の座標は数十m ずれる行があり、狭い矩形（半辺75m）だけでは
    「座標の近くに同名店が無い」と誤って切り捨ててしまう。広い矩形は誤マッチを
    増やしうるので、救済層では A と B の完全一致（strict）など、より強い
    テキスト側の合意を要求して釣り合いを取る。
    """

    decision = rule_layered(seed, probes)
    if decision.status in {STATUS_MATCHED, STATUS_INELIGIBLE, STATUS_API_ERROR}:
        return decision

    a, b = _ids(probes, PROBE_A), _ids(probes, PROBE_B)
    wide = set(_ids(probes, PROBE_C)) | set(_ids(probes, PROBE_C_WIDE))
    address_box = _ids(probes, PROBE_D)

    # 救済層1: A と B が単一候補で一致し、それが広い矩形の中にある。
    if len(a) == 1 and len(b) == 1 and a[0] == b[0] and a[0] in wide:
        return Decision(STATUS_MATCHED, a[0], GEO_CONFIRMED, "wide1_strict_in_wide_box")
    # 救済層2: 住所つき矩形検索が単一候補を返し、A か B もそれを挙げている。
    if len(address_box) == 1 and (address_box[0] in a or address_box[0] in b):
        return Decision(STATUS_MATCHED, address_box[0], GEO_CONFIRMED, "wide2_address_box_unique")
    # 救済層3: 住所つき矩形と広い矩形の共通集合が1件で、A か B もそれを挙げている。
    common = [place_id for place_id in address_box if place_id in wide]
    if len(common) == 1 and (common[0] in a or common[0] in b):
        return Decision(STATUS_MATCHED, common[0], GEO_CONFIRMED, "wide3_address_box_in_box")
    return decision


RULES: dict[str, Callable[[Seed, Mapping[str, SearchResult]], Decision]] = {
    "strict_unique": rule_strict_unique,
    "top1_agree": rule_top1_agree,
    "intersection_unique": rule_intersection_unique,
    "strict_unique_geo_hard": with_geo_gate(rule_strict_unique, require_confirmed=True),
    "top1_agree_geo_soft": with_geo_gate(rule_top1_agree, require_confirmed=False),
    "top1_agree_geo_hard": with_geo_gate(rule_top1_agree, require_confirmed=True),
    "intersection_unique_geo_soft": with_geo_gate(rule_intersection_unique, require_confirmed=False),
    "intersection_unique_geo_hard": with_geo_gate(rule_intersection_unique, require_confirmed=True),
    "layered": rule_layered,
    "layered_strict": rule_layered_strict,
    "layered_v2": rule_layered_v2,
    "box_unique": rule_box_unique,
    "layered_strict_wide": rule_layered_strict_wide,
    # 計測の再現用に残すが、負例での誤マッチ率が高く CSV 出力には使わない。
    "layered_wide": rule_layered_wide,
}

# 負例での誤マッチ率が実測1%以下だったルールだけを CSV 出力に許可する。
# `layered_wide` は 14.67% を出したため、意図せず選べないよう除外している。
EXPORT_SAFE_RULES = frozenset(
    {
        "strict_unique_geo_hard",
        "top1_agree_geo_soft",
        "top1_agree_geo_hard",
        "intersection_unique_geo_soft",
        "intersection_unique_geo_hard",
        "layered",
        "layered_strict",
        "layered_strict_wide",
        "layered_v2",
        "box_unique",
    }
)
