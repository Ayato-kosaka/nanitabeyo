#!/usr/bin/env python3
"""完全無料SKUだけで Overture の飲食店に google_place_id を逆引きする PoC。

課金しないことがこの PoC の第一制約なので、Google への問い合わせは
``free_places.FreePlacesClient`` 経由に限定する。fieldMask は ``places.id`` 固定で、
応答に他フィールドが混ざれば ``BillingGuardError`` で停止する。

サブコマンド:
  prepare            Overture parquet から seed CSV を作る
  prepare-negatives  店名と座標・住所を意図的に取り違えた負例（精度の下限測定用）
  probe              Google へ問い合わせて結果をキャッシュする
  evaluate           キャッシュ済み結果に判定ルールを当てて指標を出す
  export             1件に絞れた確定matchだけを CSV に書き出す
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Sequence

from free_places import FreePlacesClient, RateLimiter
from matching import (
    GEO_CONFIRMED,
    PROBE_A,
    PROBE_B,
    PROBE_C,
    PROBE_C_TIGHT,
    PROBE_C_WIDE,
    PROBE_D,
    PROBE_NEARBY,
    EXPORT_SAFE_RULES,
    RULES,
    STATUS_MATCHED,
    Decision,
)
from jp_name_match import similarity as name_similarity
from runner import ProbeCache, ProbeSpec, execute_probes
from seeds import (
    Seed,
    body_nearby,
    body_query_a,
    body_query_b,
    body_query_c,
    body_query_d,
    overture_seed_query,
    read_seeds,
    row_to_seed,
    strip_bracket_tail,
    write_seeds,
)

ROOT = Path(__file__).resolve().parent

# 衝突した seed が「同じ店」かを決める閾値。名寄せの判定には使わず、出力の重複整理だけに使う。
SAME_SHOP_SIMILARITY = 0.85
API_KEY_ENVIRONMENT_VARIABLES = ("PLACE_API_TEST", "GOOGLE_PLACES_API_KEY")
EARTH_RADIUS_M = 6_371_000.0


# -- helpers -------------------------------------------------------------------


def require_api_key() -> str:
    for name in API_KEY_ENVIRONMENT_VARIABLES:
        value = os.environ.get(name)
        if value:
            return value
    raise SystemExit(
        "API key が無い。" + " または ".join(API_KEY_ENVIRONMENT_VARIABLES) + " を設定する"
    )


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def duckdb_connect() -> Any:
    try:
        import duckdb  # type: ignore
    except ImportError as error:  # pragma: no cover - 環境依存
        raise SystemExit("DuckDB が必要。python -m pip install -r requirements.txt") from error
    return duckdb.connect()


def build_specs(
    seeds: Sequence[Seed],
    *,
    radius_m: float,
    box_half_side_m: float,
    nearby_radius_m: float,
    with_box: bool,
    wide_box_half_side_m: float,
    with_wide_box: bool,
    tight_box_half_side_m: float,
    with_tight_box: bool,
    with_nearby: bool,
    with_name_variant: bool,
) -> list[ProbeSpec]:
    specs: list[ProbeSpec] = []
    for seed in seeds:
        if not seed.eligible_by_coordinates:
            continue
        specs.append(ProbeSpec(seed.seed_id, PROBE_A, "text", body_query_a(seed, radius_m=radius_m)))
        # 住所が無い行（OSM に多い）では B は A と同じクエリになってしまうので投げない。
        if seed.eligible:
            specs.append(ProbeSpec(seed.seed_id, PROBE_B, "text", body_query_b(seed)))
        if with_box:
            specs.append(
                ProbeSpec(
                    seed.seed_id,
                    PROBE_C,
                    "text",
                    body_query_c(seed, half_side_m=box_half_side_m),
                )
            )
        if with_tight_box:
            specs.append(
                ProbeSpec(
                    seed.seed_id,
                    PROBE_C_TIGHT,
                    "text",
                    body_query_c(seed, half_side_m=tight_box_half_side_m),
                )
            )
        if with_wide_box:
            specs.append(
                ProbeSpec(
                    seed.seed_id,
                    PROBE_C_WIDE,
                    "text",
                    body_query_c(seed, half_side_m=wide_box_half_side_m),
                )
            )
            specs.append(
                ProbeSpec(
                    seed.seed_id,
                    PROBE_D,
                    "text",
                    body_query_d(seed, half_side_m=wide_box_half_side_m),
                )
            )
        if with_nearby:
            specs.append(
                ProbeSpec(
                    seed.seed_id,
                    PROBE_NEARBY,
                    "nearby",
                    body_nearby(seed, radius_m=nearby_radius_m),
                )
            )
        if with_name_variant:
            variant = strip_bracket_tail(seed.name_query)
            if variant != seed.name_query:
                specs.append(
                    ProbeSpec(
                        seed.seed_id,
                        "a_variant",
                        "text",
                        body_query_a(seed, radius_m=radius_m, name_query=variant),
                    )
                )
                specs.append(
                    ProbeSpec(
                        seed.seed_id, "b_variant", "text", body_query_b(seed, name_query=variant)
                    )
                )
                if with_box:
                    specs.append(
                        ProbeSpec(
                            seed.seed_id,
                            "c_variant",
                            "text",
                            body_query_c(seed, half_side_m=box_half_side_m, name_query=variant),
                        )
                    )
    return specs


def load_seed_files(paths: Iterable[Path]) -> list[Seed]:
    seeds: list[Seed] = []
    for path in paths:
        seeds.extend(read_seeds(path))
    return seeds


def apply_rule(
    name: str,
    seeds: Sequence[Seed],
    probes: dict[str, dict[str, Any]],
    *,
    use_variant_fallback: bool,
) -> dict[str, Decision]:
    """ルールを全 seed に適用する。

    ``use_variant_fallback`` は、括弧書きを外した別表記でのリトライ結果を、
    本表記で決まらなかった seed にだけ適用する recall 改善策である。
    """

    rule = RULES[name]
    decisions: dict[str, Decision] = {}
    for seed in seeds:
        seed_probes = probes.get(seed.seed_id, {})
        decision = rule(seed, seed_probes)
        if use_variant_fallback and decision.status != STATUS_MATCHED:
            variant_probes = {
                PROBE_A: seed_probes.get("a_variant"),
                PROBE_B: seed_probes.get("b_variant"),
                PROBE_C: seed_probes.get("c_variant") or seed_probes.get(PROBE_C),
                PROBE_NEARBY: seed_probes.get(PROBE_NEARBY),
            }
            if variant_probes[PROBE_A] is not None and variant_probes[PROBE_B] is not None:
                fallback = rule(seed, {k: v for k, v in variant_probes.items() if v is not None})
                if fallback.status == STATUS_MATCHED:
                    decision = Decision(
                        fallback.status, fallback.place_id, fallback.geo, f"{fallback.detail}+variant"
                    )
        decisions[seed.seed_id] = decision
    return decisions


def summarize(decisions: dict[str, Decision], total: int) -> dict[str, Any]:
    statuses = Counter(decision.status for decision in decisions.values())
    matched = [decision for decision in decisions.values() if decision.status == STATUS_MATCHED]
    geo = Counter(decision.geo for decision in matched)
    return {
        "seeds": total,
        "status_counts": dict(statuses),
        "match_rate": round(len(matched) / total, 6) if total else 0.0,
        "matched_geo_counts": dict(geo),
        "matched_geo_confirmed_rate": (
            round(geo[GEO_CONFIRMED] / len(matched), 6) if matched else 0.0
        ),
        "detail_counts": dict(Counter(decision.detail for decision in decisions.values())),
    }


def collision_report(seeds: Sequence[Seed], decisions: dict[str, Decision]) -> dict[str, Any]:
    """同じ place_id へ複数の seed が当たった件数を数える。

    Overture 側の重複でも起きるため、距離が離れた衝突だけを誤マッチ疑いとして扱う。
    """

    by_place: dict[str, list[Seed]] = defaultdict(list)
    index = {seed.seed_id: seed for seed in seeds}
    for seed_id, decision in decisions.items():
        if decision.status == STATUS_MATCHED and decision.place_id:
            by_place[decision.place_id].append(index[seed_id])
    colliding = {place: rows for place, rows in by_place.items() if len(rows) > 1}
    far_collisions = 0
    for rows in colliding.values():
        distances = [
            haversine_m(a.latitude, a.longitude, b.latitude, b.longitude)
            for index_a, a in enumerate(rows)
            for b in rows[index_a + 1 :]
        ]
        if distances and max(distances) > 200.0:
            far_collisions += 1
    return {
        "distinct_place_ids": len(by_place),
        "colliding_place_ids": len(colliding),
        "colliding_place_ids_over_200m": far_collisions,
    }


# -- commands ------------------------------------------------------------------


def command_prepare(arguments: argparse.Namespace) -> None:
    connection = duckdb_connect()
    query = overture_seed_query(arguments.overture_parquet)
    if arguments.sample:
        query = (
            f"SELECT * FROM ({query}) USING SAMPLE reservoir({int(arguments.sample)} ROWS)"
            f" REPEATABLE ({int(arguments.random_seed)})"
        )
    cursor = connection.execute(query)
    columns = [description[0] for description in cursor.description]
    seeds = [row_to_seed(dict(zip(columns, row))) for row in cursor.fetchall()]
    seeds.sort(key=lambda seed: seed.seed_id)
    write_seeds(seeds, arguments.output)
    eligible = sum(1 for seed in seeds if seed.eligible)
    print(
        json.dumps(
            {
                "seeds": len(seeds),
                "eligible": eligible,
                "eligible_rate": round(eligible / len(seeds), 6) if seeds else 0.0,
                "address_quality": dict(Counter(seed.address_quality for seed in seeds)),
                "output": str(arguments.output),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def command_prepare_negatives(arguments: argparse.Namespace) -> None:
    """店名だけ別店舗のものへ差し替えた負例を作る。

    正解が存在しない入力に対して確定matchが出れば、それは誤マッチである。
    正解データを持たない本 PoC で precision の上限を測る唯一の手段になる。
    """

    source = [seed for seed in read_seeds(arguments.seeds) if seed.eligible]
    generator = random.Random(arguments.random_seed)
    negatives: list[Seed] = []
    attempts = 0
    while len(negatives) < arguments.count and attempts < arguments.count * 50:
        attempts += 1
        host, donor = generator.sample(source, 2)
        distance = haversine_m(host.latitude, host.longitude, donor.latitude, donor.longitude)
        if distance < arguments.min_distance_m:
            continue
        if host.name_query == donor.name_query:
            continue
        negatives.append(
            Seed(
                seed_id=f"neg:{host.seed_id}:{donor.seed_id}",
                name=donor.name,
                name_query=donor.name_query,
                address_query=host.address_query,
                address_quality=host.address_quality,
                latitude=host.latitude,
                longitude=host.longitude,
                postcode=host.postcode,
                freeform=host.freeform,
                locality=host.locality,
                basic_category=host.basic_category,
                confidence=host.confidence,
                websites="",
            )
        )
    write_seeds(negatives, arguments.output)
    print(json.dumps({"negatives": len(negatives), "output": str(arguments.output)}, indent=2))


def command_probe(arguments: argparse.Namespace) -> None:
    seeds = load_seed_files(arguments.seeds)
    if arguments.limit:
        seeds = seeds[: arguments.limit]
    specs = build_specs(
        seeds,
        radius_m=arguments.radius_m,
        box_half_side_m=arguments.box_half_side_m,
        nearby_radius_m=arguments.nearby_radius_m,
        with_box=not arguments.skip_box,
        wide_box_half_side_m=arguments.wide_box_half_side_m,
        with_wide_box=arguments.wide_box,
        tight_box_half_side_m=arguments.tight_box_half_side_m,
        with_tight_box=arguments.tight_box,
        with_nearby=not arguments.skip_nearby,
        with_name_variant=arguments.name_variant,
    )
    if arguments.only_probes:
        wanted = set(arguments.only_probes)
        specs = [spec for spec in specs if spec.probe in wanted]
    cache = ProbeCache(arguments.cache)
    todo = len(specs) - len(
        cache.existing_keys() & {(spec.seed_id, spec.probe, spec.fingerprint) for spec in specs}
    )
    print(
        f"seeds={len(seeds)} probes={len(specs)} pending={todo} "
        f"qps={arguments.qps} workers={arguments.workers} (すべて無料SKU)",
        file=sys.stderr,
    )
    if not arguments.execute:
        print("--execute が無いので問い合わせは行わない", file=sys.stderr)
        return

    limiter = RateLimiter(qps=arguments.qps)
    client = FreePlacesClient(require_api_key(), rate_limiter=limiter)

    def progress(done: int, total: int) -> None:
        print(
            f"  {done}/{total} requests={client.request_count} errors={client.error_count}"
            f" throttled={limiter.throttle_events} penalty={limiter.penalty_seconds:.3f}s",
            file=sys.stderr,
            flush=True,
        )

    executed = execute_probes(
        specs,
        client,
        cache,
        workers=arguments.workers,
        flush_every=arguments.flush_every,
        progress=progress,
    )
    cache.close()
    print(
        json.dumps(
            {
                "executed_probes": executed,
                "http_requests": client.request_count,
                "http_errors": client.error_count,
                "throttle_events": limiter.throttle_events,
                "billed_requests": 0,
            },
            indent=2,
        )
    )


def command_evaluate(arguments: argparse.Namespace) -> None:
    positives = load_seed_files(arguments.seeds)
    negatives = load_seed_files(arguments.negatives) if arguments.negatives else []
    cache = ProbeCache(arguments.cache)
    probes = cache.load()
    cache.close()

    report: dict[str, Any] = {
        "positive_seeds": len(positives),
        "negative_seeds": len(negatives),
        "rules": {},
    }
    matched_ids: dict[str, dict[str, str]] = {}
    for rule_name in RULES:
        for variant_fallback in (False, True):
            label = rule_name + ("+variant" if variant_fallback else "")
            decisions = apply_rule(
                rule_name, positives, probes, use_variant_fallback=variant_fallback
            )
            entry: dict[str, Any] = {
                "positive": summarize(decisions, len(positives)),
                "collisions": collision_report(positives, decisions),
            }
            if negatives:
                negative_decisions = apply_rule(
                    rule_name, negatives, probes, use_variant_fallback=variant_fallback
                )
                negative_matched = sum(
                    1 for d in negative_decisions.values() if d.status == STATUS_MATCHED
                )
                entry["negative_control"] = {
                    "seeds": len(negatives),
                    "false_matches": negative_matched,
                    "false_match_rate": round(negative_matched / len(negatives), 6),
                    "status_counts": dict(
                        Counter(d.status for d in negative_decisions.values())
                    ),
                }
            report["rules"][label] = entry
            matched_ids[label] = {
                seed_id: decision.place_id
                for seed_id, decision in decisions.items()
                if decision.status == STATUS_MATCHED and decision.place_id
            }

    # 独立に強いルール同士が同じ seed で違う place_id を出すなら、少なくとも
    # 片方は誤りである。正解データを持たない本 PoC で誤りの下限を掴む指標。
    report["cross_rule_disagreement"] = cross_rule_disagreement(matched_ids)

    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))


def cross_rule_disagreement(matched_ids: dict[str, dict[str, str]]) -> dict[str, Any]:
    labels = sorted(matched_ids)
    pairs: dict[str, Any] = {}
    for index, left in enumerate(labels):
        for right in labels[index + 1 :]:
            shared = set(matched_ids[left]) & set(matched_ids[right])
            if not shared:
                continue
            conflicts = sum(
                1 for seed_id in shared if matched_ids[left][seed_id] != matched_ids[right][seed_id]
            )
            if conflicts:
                pairs[f"{left} vs {right}"] = {
                    "both_matched": len(shared),
                    "different_place_id": conflicts,
                    "rate": round(conflicts / len(shared), 6),
                }
    return pairs


def command_export(arguments: argparse.Namespace) -> None:
    import csv

    if arguments.rule not in EXPORT_SAFE_RULES:
        raise SystemExit(
            f"{arguments.rule} は負例での誤マッチ率が高く、CSV出力には使えない。"
            f" 使えるのは: {sorted(EXPORT_SAFE_RULES)}"
        )
    seeds = load_seed_files(arguments.seeds)
    cache = ProbeCache(arguments.cache)
    probes = cache.load()
    cache.close()
    decisions = apply_rule(
        arguments.rule, seeds, probes, use_variant_fallback=arguments.name_variant
    )
    # 突合時に「どの強さの証拠なら正しかったか」を段階で測れるよう、確定行に tier を振る。
    # box_unique は層そのものが証拠の強さなので、層をそのまま tier にする。それ以外の
    # ルールでは、一番厳しいルール（A/B が単一候補で一致し、かつ矩形内）でも取れたかで見る。
    box_unique_tiers = {"tight_unique_in_ab": "A", "wide_unique_in_ab": "B"}
    tier_a: dict = {}
    index = {seed.seed_id: seed for seed in seeds}

    # 同じ place_id へ複数 seed が当たったとき、かつては全部落としていた。
    # ソースが1つだった頃は「どちらかが誤り」で正しかったが、いまは Overture・IFAS・
    # OSM・許可台帳の4ソースがあり、**同じ店が複数ソースに載っているほうが普通**である。
    # 全部落とすと、複数ソースが一致した＝最も確からしい行から先に消えてしまう
    # （実測で 7,804 行が該当した）。
    #
    # そこで、衝突した seed の店名を見て分ける。
    # - 名前が揃っている → 同じ店。1行だけ残す（証拠が増えただけ）
    # - 名前が食い違う   → 取り違えの可能性がある。従来どおり全部落とす
    by_place: dict[str, list[str]] = defaultdict(list)
    for seed_id, decision in decisions.items():
        if decision.status == STATUS_MATCHED and decision.place_id:
            by_place[decision.place_id].append(seed_id)
    keep_seed: dict[str, str] = {}
    conflicting: set[str] = set()
    for place_id, seed_ids in by_place.items():
        names = [index[seed_id].name for seed_id in seed_ids]
        if len(seed_ids) == 1 or all(
            name_similarity(names[0], other) >= SAME_SHOP_SIMILARITY for other in names[1:]
        ):
            # 住所クエリを組めた seed を優先して1件だけ残す。
            keep_seed[place_id] = sorted(
                seed_ids, key=lambda s: (not index[s].address_query, s)
            )[0]
        else:
            conflicting.add(place_id)
    rows = []
    dropped_collision = dropped_duplicate = 0
    for seed_id, decision in sorted(decisions.items()):
        if decision.status != STATUS_MATCHED or not decision.place_id:
            continue
        if decision.place_id in conflicting:
            dropped_collision += 1
            continue
        if keep_seed.get(decision.place_id) != seed_id:
            dropped_duplicate += 1
            continue
        seed = index[seed_id]
        rows.append(
            {
                "overture_id": seed.seed_id,
                "google_place_id": decision.place_id,
                "name": seed.name,
                "name_query": seed.name_query,
                "address_query": seed.address_query,
                "latitude": f"{seed.latitude:.7f}",
                "longitude": f"{seed.longitude:.7f}",
                "postcode": seed.postcode,
                "basic_category": seed.basic_category,
                "overture_confidence": f"{seed.confidence:.3f}",
                "match_rule": arguments.rule,
                "match_detail": decision.detail,
                "confidence_tier": box_unique_tiers.get(decision.detail, "B"),
                "geo_verification": decision.geo,
            }
        )
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    with arguments.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()) if rows else ["overture_id"])
        writer.writeheader()
        writer.writerows(rows)
    print(
        json.dumps(
            {
                "rule": arguments.rule,
                "seeds": len(seeds),
                "exported": len(rows),
                "tier_counts": dict(Counter(row["confidence_tier"] for row in rows)),
                "dropped_place_id_conflict": dropped_collision,
                "dropped_same_shop_duplicate": dropped_duplicate,
                "output": str(arguments.output),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


# -- CLI -----------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)

    prepare = subcommands.add_parser("prepare", help="Overture から seed CSV を作る")
    prepare.add_argument("--overture-parquet", type=Path, required=True)
    prepare.add_argument("--output", type=Path, required=True)
    prepare.add_argument("--sample", type=int, default=0, help="0なら全件")
    prepare.add_argument("--random-seed", type=int, default=42)
    prepare.set_defaults(function=command_prepare)

    negatives = subcommands.add_parser("prepare-negatives", help="精度測定用の負例を作る")
    negatives.add_argument("--seeds", type=Path, required=True)
    negatives.add_argument("--output", type=Path, required=True)
    negatives.add_argument("--count", type=int, default=500)
    negatives.add_argument("--min-distance-m", type=float, default=5000.0)
    negatives.add_argument("--random-seed", type=int, default=7)
    negatives.set_defaults(function=command_prepare_negatives)

    probe = subcommands.add_parser("probe", help="Google へ問い合わせてキャッシュする")
    probe.add_argument("--seeds", type=Path, nargs="+", required=True)
    probe.add_argument("--cache", type=Path, required=True)
    probe.add_argument("--limit", type=int, default=0)
    probe.add_argument("--qps", type=float, default=10.0)
    probe.add_argument("--workers", type=int, default=8)
    probe.add_argument("--radius-m", type=float, default=150.0)
    probe.add_argument("--box-half-side-m", type=float, default=75.0)
    probe.add_argument("--nearby-radius-m", type=float, default=40.0)
    probe.add_argument("--skip-box", action="store_true")
    probe.add_argument("--wide-box-half-side-m", type=float, default=250.0)
    probe.add_argument("--wide-box", action="store_true", help="広い矩形と住所つき矩形も送る")
    probe.add_argument("--tight-box-half-side-m", type=float, default=25.0)
    probe.add_argument("--tight-box", action="store_true", help="狭く絞った矩形も送る")
    probe.add_argument(
        "--only-probes",
        nargs="+",
        help="指定した probe だけを送る。既存キャッシュへ1種類だけ足すときに使う",
    )
    probe.add_argument("--flush-every", type=int, default=200)
    probe.add_argument("--skip-nearby", action="store_true")
    probe.add_argument("--name-variant", action="store_true", help="括弧書きを外した再検索も送る")
    probe.add_argument("--execute", action="store_true", help="指定時だけ実際に問い合わせる")
    probe.set_defaults(function=command_probe)

    evaluate = subcommands.add_parser("evaluate", help="キャッシュ結果に判定ルールを当てる")
    evaluate.add_argument("--seeds", type=Path, nargs="+", required=True)
    evaluate.add_argument("--negatives", type=Path, nargs="*")
    evaluate.add_argument("--cache", type=Path, required=True)
    evaluate.add_argument("--output", type=Path)
    evaluate.set_defaults(function=command_evaluate)

    export = subcommands.add_parser("export", help="確定matchのみCSV出力")
    export.add_argument("--seeds", type=Path, nargs="+", required=True)
    export.add_argument("--cache", type=Path, required=True)
    export.add_argument("--rule", default="box_unique_strict", choices=sorted(RULES))
    export.add_argument("--name-variant", action="store_true")
    export.add_argument("--output", type=Path, required=True)
    export.set_defaults(function=command_export)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    arguments.function(arguments)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
