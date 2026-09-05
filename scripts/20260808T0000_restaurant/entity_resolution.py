"""restaurant_source_records を実店舗seedへ束ねる保守的な名寄せ器。"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any

from normalization import (
    build_seed_id,
    haversine_m,
    normalize_address,
    normalize_name,
    normalize_name_l1,
    s2_cell_id,
    trigram_similarity,
)

# canonical列の採用順位。許可台帳（IFAS・自治体の食品営業許可台帳）は営業許可の
# 根拠には強いが、店舗表示名の主マスターではないため、名称・座標では
# Overture / 既存DB / OSM より後にする。
#
# 自治体台帳(food_permit)を IFAS と同順にしないのは、座標の出どころが違うためである。
# IFAS は台帳に座標が入っているが、自治体台帳は住所からジオコーディングした行が
# 多い（実測で 13,896 件、命中率100%だが番地レベル）。同じ店が両方にあるなら
# IFAS 側の座標を採る。
SOURCE_PRIORITY = {
    "overture": 10,
    "existing_pg": 20,
    "osm": 30,
    "ifas": 40,
    "food_permit": 50,
}
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class SourceRecord:
    source: str
    source_record_id: str
    name: str
    address: str
    latitude: float
    longitude: float
    normalized_name: str = ""
    normalized_name_l1: str = ""
    normalized_address: str = ""
    # #843 取り込み時点で分かっていた国（ISO 3166-1 alpha-2）。座標から推測しない。
    country_code: str | None = None
    phone: str | None = None
    website: str | None = None
    social_urls: tuple[str, ...] = ()
    existing_restaurant_id: str | None = None
    google_place_id: str | None = None
    image_url: str | None = None
    image_path: str | None = None
    address_components_json: str | None = None
    plus_code_json: str | None = None

    def normalized(self) -> SourceRecord:
        return replace(
            self,
            normalized_name=self.normalized_name or normalize_name(self.name),
            normalized_name_l1=self.normalized_name_l1 or normalize_name_l1(self.name),
            normalized_address=self.normalized_address
            or normalize_address(self.address),
        )


@dataclass(frozen=True, slots=True)
class SourceLink:
    seed_id: str
    source: str
    source_record_id: str
    match_method: str
    match_score: float
    distance_m: float


@dataclass(slots=True)
class Seed:
    seed_id: str
    canonical_source: str
    canonical_name: str
    canonical_address: str
    normalized_name: str
    normalized_name_l1: str
    normalized_address: str
    country_code: str | None
    latitude: float
    longitude: float
    phone: str | None
    website: str | None
    # sourceは最大4種、SNS URLも通常数件なのでlistの線形探索で十分。seedごとに
    # 空setを2個持つより、全国約100万seedで数百MBのheapを節約できる。
    social_urls: list[str] = field(default_factory=list)
    source_names: list[str] = field(default_factory=list)
    source_record_count: int = 0
    entity_resolution_method: str = "new_seed"
    entity_resolution_score: float = 1.0
    existing_restaurant_id: str | None = None
    existing_google_place_id: str | None = None
    image_url: str | None = None
    image_path: str | None = None
    address_components_json: str | None = None
    plus_code_json: str | None = None
    conflict_reason: str | None = None

    def absorb(self, record: SourceRecord, method: str, score: float) -> None:
        """source recordを追加し、列単位の優先順位でcanonical値を更新する。"""

        if record.source not in self.source_names:
            self.source_names.append(record.source)
        self.source_record_count += 1
        for url in record.social_urls:
            if url not in self.social_urls:
                self.social_urls.append(url)
        self.entity_resolution_method = method
        self.entity_resolution_score = min(self.entity_resolution_score, score)

        if SOURCE_PRIORITY.get(record.source, 999) < SOURCE_PRIORITY.get(
            self.canonical_source, 999
        ):
            self.canonical_source = record.source
            self.canonical_name = record.name
            self.canonical_address = record.address
            # #843 国も canonical と同じ優先順位で決める（overture > existing_pg >
            # osm > ifas > food_permit）。値が無いソースが勝ったときは、
            # 下の or で他ソースの値が残る。
            self.country_code = record.country_code or self.country_code
            # 正規化値は候補比較のたびに再計算せず、canonical変更時だけ更新する。
            self.normalized_name = record.normalized_name
            self.normalized_name_l1 = record.normalized_name_l1
            self.normalized_address = record.normalized_address
            self.latitude = record.latitude
            self.longitude = record.longitude

        self.country_code = self.country_code or record.country_code
        self.phone = self.phone or record.phone
        self.website = self.website or record.website
        self.image_url = self.image_url or record.image_url
        self.image_path = self.image_path or record.image_path

        # Google固有の構造化住所等は既存DB由来だけを引き継ぐ。オープンデータから
        # Google Contentを再現したと偽装しない。
        if record.source == "existing_pg":
            self.existing_restaurant_id = record.existing_restaurant_id
            self.address_components_json = record.address_components_json
            self.plus_code_json = record.plus_code_json
            if self.existing_google_place_id and (
                record.google_place_id
                and record.google_place_id != self.existing_google_place_id
            ):
                self.conflict_reason = "multiple_existing_google_place_ids"
            else:
                self.existing_google_place_id = record.google_place_id

    def seed_origin(self) -> str:
        if "overture" in self.source_names:
            return "overture"
        # existing PGにOSM/IFASが補助的に紐付いても、表示値の由来は既存行である。
        if "existing_pg" in self.source_names:
            return "existing_pg_carry_forward"
        # OSM+IFAS seedではcanonical列の優先順位が高いOSMをoriginにする。
        # ODbLの公開判断をifas_only名義で迂回させないためである。
        if self.canonical_source == "osm":
            return "osm_only"
        if self.canonical_source == "ifas":
            return "ifas_only"
        if self.canonical_source == "food_permit":
            return "food_permit_only"
        return self.canonical_source


class MutableSpatialIndex:
    """全国全件のペアを作らず、約220mの格子から近傍だけを調べる。

    Seed/SourceRecordはslots付きにし、約140万原票で__dict__を大量生成しない。
    linkは逐次NDJSONへ退避するため、メモリに残すのは現在seedと空間indexだけである。
    """

    def __init__(self, cell_degrees: float = 0.002) -> None:
        self.cell_degrees = cell_degrees
        self._cells: dict[tuple[int, int], list[Seed]] = defaultdict(list)

    def _cell(self, latitude: float, longitude: float) -> tuple[int, int]:
        return (
            math.floor(latitude / self.cell_degrees),
            math.floor(longitude / self.cell_degrees),
        )

    def add(self, seed: Seed) -> None:
        self._cells[self._cell(seed.latitude, seed.longitude)].append(seed)

    def nearby(self, latitude: float, longitude: float) -> Iterable[Seed]:
        lat_cell, lon_cell = self._cell(latitude, longitude)
        for lat_offset in (-1, 0, 1):
            for lon_offset in (-1, 0, 1):
                yield from self._cells.get(
                    (lat_cell + lat_offset, lon_cell + lon_offset), ()
                )


class EntityResolver:
    """Overtureを主幹とし、既存PG・IFAS・OSMを保守的に統合する。"""

    def __init__(
        self,
        *,
        cross_source_radius_m: float = 150.0,
        same_source_radius_m: float = 50.0,
        fuzzy_threshold: float = 0.6,
    ) -> None:
        self.cross_source_radius_m = cross_source_radius_m
        self.same_source_radius_m = same_source_radius_m
        self.fuzzy_threshold = fuzzy_threshold

    def resolve(
        self, records: Iterable[SourceRecord]
    ) -> tuple[list[Seed], list[SourceLink]]:
        """小規模データ・テスト向け。全linkをメモリに保持して返す。"""

        links: list[SourceLink] = []
        seeds = self.resolve_stream(records, on_link=links.append, presorted=False)
        return seeds, links

    def resolve_stream(
        self,
        records: Iterable[SourceRecord],
        *,
        on_link: Callable[[SourceLink], None],
        presorted: bool,
    ) -> list[Seed]:
        """全国データ向け。linkをcallbackへ逐次渡し、巨大list化を避ける。"""

        normalized_records = (record.normalized() for record in records)
        ordered: Iterable[SourceRecord]
        if presorted:
            ordered = normalized_records
        else:
            ordered = sorted(
                normalized_records,
                key=lambda record: (
                    SOURCE_PRIORITY.get(record.source, 999),
                    record.source_record_id,
                ),
            )
        seeds: list[Seed] = []
        index = MutableSpatialIndex()

        for processed_count, record in enumerate(ordered, start=1):
            if processed_count % 100_000 == 0:
                LOGGER.info(
                    "店舗名寄せ進捗: source_records=%d seeds=%d",
                    processed_count,
                    len(seeds),
                )
            candidates = self._rank_candidates(
                record, index.nearby(record.latitude, record.longitude)
            )
            selected = self._select_unambiguous(candidates)
            if selected is None:
                method = "ambiguous_new_seed" if candidates else "new_seed"
                seed = self._new_seed(record, method)
                if candidates:
                    seed.conflict_reason = (
                        f"ambiguous_candidate_count={len(candidates)}"
                    )
                seeds.append(seed)
                index.add(seed)
                on_link(
                    SourceLink(
                        seed.seed_id,
                        record.source,
                        record.source_record_id,
                        method,
                        1.0,
                        0.0,
                    )
                )
                continue

            tier, name_score, address_score, distance, seed, method = selected
            del tier, address_score
            seed.absorb(record, method, name_score)
            on_link(
                SourceLink(
                    seed.seed_id,
                    record.source,
                    record.source_record_id,
                    method,
                    round(name_score, 4),
                    round(distance, 2),
                )
            )

        return seeds

    def _new_seed(self, record: SourceRecord, method: str) -> Seed:
        seed = Seed(
            seed_id=build_seed_id(record.source, record.source_record_id),
            canonical_source=record.source,
            canonical_name=record.name,
            canonical_address=record.address,
            normalized_name=record.normalized_name,
            normalized_name_l1=record.normalized_name_l1,
            normalized_address=record.normalized_address,
            country_code=record.country_code,
            latitude=record.latitude,
            longitude=record.longitude,
            phone=record.phone,
            website=record.website,
            entity_resolution_method=method,
        )
        seed.absorb(record, method, 1.0)
        return seed

    def _rank_candidates(
        self, record: SourceRecord, nearby: Iterable[Seed]
    ) -> list[tuple[int, float, float, float, Seed, str]]:
        ranked: list[tuple[int, float, float, float, Seed, str]] = []
        for seed in nearby:
            same_source = record.source in seed.source_names
            maximum_distance = (
                self.same_source_radius_m if same_source else self.cross_source_radius_m
            )
            distance = haversine_m(
                record.latitude, record.longitude, seed.latitude, seed.longitude
            )
            if distance > maximum_distance:
                continue

            # 既存DB同士でGoogle Place IDが違う場合は、店名が同じでも統合しない。
            if (
                record.google_place_id
                and seed.existing_google_place_id
                and record.google_place_id != seed.existing_google_place_id
            ):
                continue

            if (
                record.normalized_name
                and record.normalized_name == seed.normalized_name
            ):
                tier, name_score, method = 4, 1.0, "exact_name_nearby"
            elif (
                len(record.normalized_name_l1) >= 2
                and record.normalized_name_l1 == seed.normalized_name_l1
            ):
                tier, name_score, method = 3, 1.0, "l1_name_nearby"
            else:
                name_score = trigram_similarity(
                    record.normalized_name_l1, seed.normalized_name_l1
                )
                threshold = 0.75 if same_source else self.fuzzy_threshold
                if name_score < threshold:
                    continue
                tier, method = 2, "trigram_name_nearby"

            address_score = (
                trigram_similarity(record.normalized_address, seed.normalized_address)
                if record.normalized_address and seed.normalized_address
                else 0.0
            )
            ranked.append((tier, name_score, address_score, distance, seed, method))

        ranked.sort(
            key=lambda item: (-item[0], -item[1], -item[2], item[3], item[4].seed_id)
        )
        return ranked

    @staticmethod
    def _select_unambiguous(
        candidates: list[tuple[int, float, float, float, Seed, str]],
    ) -> tuple[int, float, float, float, Seed, str] | None:
        if not candidates:
            return None
        best = candidates[0]
        near_ties = [
            candidate
            for candidate in candidates[1:]
            if candidate[0] == best[0]
            and abs(candidate[1] - best[1]) < 0.02
            and abs(candidate[2] - best[2]) < 0.05
        ]
        return None if near_ties else best


def seed_to_bq_row(seed: Seed, run_id: str) -> dict[str, Any]:
    built_at = datetime.now(timezone.utc).isoformat()
    return {
        "run_id": run_id,
        "seed_id": seed.seed_id,
        "canonical_name": seed.canonical_name,
        "normalized_name": seed.normalized_name,
        "canonical_address": seed.canonical_address or None,
        "normalized_address": seed.normalized_address or None,
        "country_code": seed.country_code or None,
        "latitude": seed.latitude,
        "longitude": seed.longitude,
        "location": f"POINT({seed.longitude} {seed.latitude})",
        "s2_cell_id": s2_cell_id(seed.latitude, seed.longitude),
        "phone": seed.phone,
        "website": seed.website,
        "social_urls": sorted(seed.social_urls),
        "source_names": sorted(seed.source_names),
        "source_record_count": seed.source_record_count,
        "seed_origin": seed.seed_origin(),
        "entity_resolution_method": seed.entity_resolution_method,
        "entity_resolution_score": seed.entity_resolution_score,
        "existing_restaurant_id": seed.existing_restaurant_id,
        "existing_google_place_id": seed.existing_google_place_id,
        "image_url": seed.image_url,
        "image_path": seed.image_path,
        "address_components_json": seed.address_components_json,
        "plus_code_json": seed.plus_code_json,
        "conflict_reason": seed.conflict_reason,
        "built_at": built_at,
    }


def link_to_bq_row(link: SourceLink, run_id: str) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "seed_id": link.seed_id,
        "source": link.source,
        "source_record_id": link.source_record_id,
        "match_method": link.match_method,
        "match_score": link.match_score,
        "distance_m": link.distance_m,
        "linked_at": datetime.now(timezone.utc).isoformat(),
    }
