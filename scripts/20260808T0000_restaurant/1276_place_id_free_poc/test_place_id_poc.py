#!/usr/bin/env python3
"""ネットワークなしで、課金ガード・住所クエリ組立・判定ルールを固定する。"""

from __future__ import annotations

import io
import json
import time
import unittest
import urllib.error
import urllib.request
from unittest import mock

import http.client

from free_places import (
    DailyQuotaExhausted,
    FreePlacesClient,
    RateLimiter,
    ALLOWED_PLACE_KEYS,
    DETAILS_FIELD_MASK,
    FIELD_MASK,
    RETRYABLE_EXCEPTIONS,
    BillingGuardError,
    SearchResult,
    extract_place_ids,
)
from matching import (
    EXPORT_SAFE_RULES,
    GEO_ABSENT,
    GEO_CONFIRMED,
    GEO_INCONCLUSIVE,
    PROBE_A,
    PROBE_B,
    PROBE_C_HUGE,
    PROBE_C_TIGHT,
    PROBE_C_WIDE,
    PROBE_NEARBY,
    RULES,
    STATUS_AMBIGUOUS,
    STATUS_API_ERROR,
    STATUS_INELIGIBLE,
    STATUS_MATCHED,
    STATUS_UNMATCHED,
)
from ground_truth import chain_key
from jp_name_match import search_variant
from jp_text import name_similarity, normalize_for_comparison
from seeds import (
    Seed,
    body_nearby,
    body_query_a,
    body_query_b,
    body_query_c,
    body_query_ca,
    build_address_query,
    format_postcode,
    normalize_postcode_digits,
    normalize_name_for_query,
    strip_bracket_tail,
)


def make_seed(**overrides) -> Seed:
    base = dict(
        seed_id="seed-1",
        name="町中華 龍月",
        name_query="町中華 龍月",
        address_query="〒103-0021 東京都中央区日本橋本石町4-5-12",
        address_quality="prefecture_and_postcode",
        latitude=35.6,
        longitude=139.7,
        postcode="103-0021",
        freeform="東京都中央区日本橋本石町4-5-12",
        locality="中央区",
        basic_category="restaurant",
        confidence=0.8,
        websites="",
    )
    base.update(overrides)
    return Seed(**base)


class BillingGuardTest(unittest.TestCase):
    def test_field_mask_is_ids_only(self) -> None:
        self.assertEqual(FIELD_MASK, "places.id")
        self.assertEqual(set(ALLOWED_PLACE_KEYS), {"id"})

    def test_details_field_mask_is_ids_only(self) -> None:
        # ID Refresh も Essentials (IDs Only) SKU に留める。単一 place を引くので
        # 接頭辞 places. が付かない点だけが検索と違う。
        self.assertEqual(DETAILS_FIELD_MASK, "id")

    def test_single_place_response_is_accepted(self) -> None:
        # Place Details は places 配列ではなく place 単体を返す。
        self.assertEqual(extract_place_ids({"id": "A"}), ("A",))

    def test_extract_ids_deduplicates_in_order(self) -> None:
        document = {"places": [{"id": "A"}, {"id": "B"}, {"id": "A"}]}
        self.assertEqual(extract_place_ids(document), ("A", "B"))

    def test_empty_response_is_allowed(self) -> None:
        self.assertEqual(extract_place_ids({}), ())

    def test_billable_field_stops_the_run(self) -> None:
        document = {"places": [{"id": "A", "displayName": {"text": "x"}}]}
        with self.assertRaises(BillingGuardError):
            extract_place_ids(document)

    def test_unexpected_top_level_key_stops_the_run(self) -> None:
        with self.assertRaises(BillingGuardError):
            extract_place_ids({"places": [], "contextualContents": []})

    def test_disconnects_are_retryable(self) -> None:
        # urllib はこれを URLError で包まないため、素通りすると worker thread ごと
        # 実行が落ちる。長時間の一括実行で実際に発生した。
        self.assertIsInstance(
            http.client.RemoteDisconnected("closed"), RETRYABLE_EXCEPTIONS
        )
        self.assertIsInstance(ConnectionResetError(), RETRYABLE_EXCEPTIONS)


class QueryBuildingTest(unittest.TestCase):
    def test_postcode_formats(self) -> None:
        self.assertEqual(format_postcode("1030021"), "103-0021")
        self.assertEqual(format_postcode("103-0021"), "103-0021")
        self.assertEqual(format_postcode(""), "")
        self.assertEqual(format_postcode("abc"), "")

    def test_name_normalization_keeps_branch_but_drops_corporate_form(self) -> None:
        self.assertEqual(normalize_name_for_query("株式会社　ドミノ・ピザ 渋谷店"), "ドミノ・ピザ 渋谷店")
        self.assertEqual(normalize_name_for_query("ラーメン太郎　有限会社"), "ラーメン太郎")
        self.assertEqual(normalize_name_for_query("〒103-0021 蕎麦屋"), "蕎麦屋")

    def test_bracket_tail_variant(self) -> None:
        self.assertEqual(strip_bracket_tail("Mermaid Cafe（マーメイドカフェ）"), "Mermaid Cafe")
        self.assertEqual(strip_bracket_tail("龍月"), "龍月")

    def test_address_query_is_built_from_the_most_reliable_geography(self) -> None:
        # freeform に都道府県が入っていれば、それだけで住所は一意に定まる。
        self.assertEqual(
            build_address_query("東京都中央区日本橋1-1", "1030021", "中央区"),
            ("東京都中央区日本橋1-1", "prefecture_in_freeform"),
        )
        # 都道府県が無い行は郵便番号から作り直す。Overture の locality が誤って
        # いても（この郵便番号の行は locality=Ogasawara-mura だった）正しくなる。
        self.assertEqual(
            build_address_query("志茂2-48-10", "1150042", "Ogasawara-mura"),
            ("東京都北区志茂2-48-10", "postcode_expanded_and_partial"),
        )
        # freeform が空なら町域名まで補う。
        self.assertEqual(
            build_address_query("", "1002101", ""), ("東京都小笠原村父島", "postcode_expanded")
        )
        # 郵便番号の町域と freeform の町名が食い違っても、矛盾した住所を作らない。
        self.assertEqual(
            build_address_query("田村町235-1", "5150073", "松阪市"),
            ("三重県松阪市田村町235-1", "postcode_expanded_and_partial"),
        )
        self.assertEqual(build_address_query(None, None), ("", "none"))

    def test_postcode_digits_survive_real_world_formatting(self) -> None:
        # 全角や、ハイフンの代わりに長音記号が入った行が実データに存在する。
        self.assertEqual(normalize_postcode_digits("１５０ｰ００４４"), "1500044")
        self.assertEqual(normalize_postcode_digits("542ー0083"), "5420083")
        self.assertEqual(normalize_postcode_digits("103-0021"), "1030021")
        self.assertIsNone(normalize_postcode_digits("103-002"))
        self.assertIsNone(normalize_postcode_digits(""))

    def test_locality_is_used_only_when_nothing_better_exists(self) -> None:
        # 住所も郵便番号も無い行では、locality が唯一の地理情報になる。
        self.assertEqual(build_address_query("", None, "東大阪市"), ("東大阪市", "locality_only"))
        self.assertEqual(
            build_address_query("港北区新横浜2丁目6-17", None, "横浜市"),
            ("横浜市 港北区新横浜2丁目6-17", "locality_and_partial"),
        )
        # ローマ字の locality は検索の役に立たず誤りも多いので使わない。
        self.assertEqual(build_address_query("", None, "Chiyoda-ku"), ("", "none"))

    def test_page_size_is_twenty(self) -> None:
        # IDs Only は件数に依らず $0.00 なので、曖昧さを取りこぼさない上限を使う。
        self.assertEqual(body_query_a(make_seed())["pageSize"], 20)
        self.assertEqual(body_query_b(make_seed())["pageSize"], 20)

    def test_query_bodies_stay_within_free_sku_shape(self) -> None:
        seed = make_seed()
        body_a = body_query_a(seed, radius_m=150.0)
        self.assertEqual(body_a["textQuery"], seed.name_query)
        self.assertEqual(body_a["locationBias"]["circle"]["radius"], 150.0)
        body_b = body_query_b(seed)
        self.assertNotIn("locationBias", body_b)
        self.assertIn(seed.address_query, body_b["textQuery"])
        body_c = body_query_c(seed, half_side_m=75.0)
        rectangle = body_c["locationRestriction"]["rectangle"]
        self.assertNotIn("locationBias", body_c)
        self.assertLess(rectangle["low"]["latitude"], seed.latitude)
        self.assertGreater(rectangle["high"]["latitude"], seed.latitude)
        self.assertAlmostEqual(
            (rectangle["high"]["latitude"] - rectangle["low"]["latitude"]) * 111_320.0, 150.0, places=3
        )
        nearby = body_nearby(seed, radius_m=40.0)
        self.assertEqual(nearby["locationRestriction"]["circle"]["radius"], 40.0)
        self.assertEqual(nearby["rankPreference"], "DISTANCE")



class NameComparisonTest(unittest.TestCase):
    """正解検証の店名比較。ここが緩いと 99% は自動的に達成されてしまう。"""

    def test_category_words_are_not_erased(self) -> None:
        # 業態語を文字列中どこでも落とすと「カフェ」「居酒屋」が空になり、
        # その行は店名で一切判定できなくなる。末尾の支店語だけ落とす。
        self.assertEqual(normalize_for_comparison("カフェ"), "カフェ")
        self.assertEqual(normalize_for_comparison("居酒屋"), "居酒屋")
        self.assertEqual(normalize_for_comparison("ラーメン二郎三田本店"), "ラーメン二郎三田")

    def test_bare_chain_name_does_not_auto_pass(self) -> None:
        # 以前は包含関係だけで 0.85 を返しており、Overture に 2,741行ある
        # 「マクドナルド」がどの支店とも無条件で一致してしまっていた。
        self.assertLess(name_similarity("マクドナルド", "マクドナルド渋谷店"), 0.85)
        self.assertLess(name_similarity("マクドナルド渋谷店", "マクドナルド道玄坂店"), 0.7)

    def test_real_variants_still_match(self) -> None:
        self.assertGreater(name_similarity("百万石うどんこのみ小中店", "このみ百万石うどん 小中店"), 0.5)
        self.assertGreater(name_similarity("株式会社ドミノ・ピザ 渋谷店", "ドミノ・ピザ 渋谷店"), 0.9)
        # 実際に別店舗である例は落ちること。
        self.assertLess(name_similarity("栗雲丹", "海鮮料理 雲丹しゃぶしゃぶ 工藤"), 0.2)

    def test_chain_key_separates_branch_qualified_names(self) -> None:
        # 支店名が付いている行は名前が支店を特定しているので、別扱いでよい。
        self.assertNotEqual(chain_key("マクドナルド渋谷店"), chain_key("マクドナルド"))
        # 店名がチェーン名のままの行だけが同名多数として束ねられる。
        self.assertEqual(chain_key("マクドナルド"), chain_key("マクドナルド店"))
        self.assertNotEqual(chain_key("マクドナルド"), chain_key("モスバーガー"))




class BoxUniqueRuleTest(unittest.TestCase):
    """``rule_box_unique`` は「矩形内で一意」だけを根拠にする。

    合意ではなく一意性を見るルールなので、A と B が揃って間違えている場合でも
    矩形内に複数居れば確定しない、という性質を確かめる。
    """

    def probes(self, a, b, tight=(), wide=()) -> dict:
        return {
            PROBE_A: SearchResult(tuple(a), 200),
            PROBE_B: SearchResult(tuple(b), 200),
            PROBE_C_TIGHT: SearchResult(tuple(tight), 200),
            PROBE_C_WIDE: SearchResult(tuple(wide), 200),
        }

    def decide(self, **kwargs):
        return RULES["box_unique"](make_seed(), self.probes(**kwargs))

    def test_tight_box_unique_and_supported_matches(self) -> None:
        decision = self.decide(a=("A", "B"), b=("A", "C"), tight=("A",))
        self.assertEqual(decision.status, STATUS_MATCHED)
        self.assertEqual(decision.place_id, "A")
        self.assertEqual(decision.detail, "tight_unique_in_ab")

    def test_tight_box_unique_without_text_support_is_rejected(self) -> None:
        """矩形内で一意でも、店名クエリがその place を挙げていなければ別の店である。

        この裏取りを外すと新たに通る49件のうち、ラベルと一致したのは1件だけだった。
        """

        decision = self.decide(a=("B",), b=("C",), tight=("A",))
        self.assertEqual(decision.status, STATUS_AMBIGUOUS)
        self.assertIsNone(decision.place_id)

    def test_multiple_in_tight_box_falls_through_to_wide(self) -> None:
        decision = self.decide(a=("A", "B"), b=("A", "B"), tight=("A", "B"), wide=("A",))
        self.assertEqual(decision.status, STATUS_MATCHED)
        self.assertEqual(decision.detail, "wide_unique_in_ab")

    def test_agreement_alone_does_not_match(self) -> None:
        """A と B が完全一致していても、矩形内が一意でなければ確定させない。"""

        decision = self.decide(a=("A",), b=("A",), tight=("A", "B"), wide=("A", "B"))
        self.assertEqual(decision.status, STATUS_AMBIGUOUS)
        self.assertEqual(decision.detail, "box_not_unique")

    def test_empty_boxes_report_absent(self) -> None:
        decision = self.decide(a=("A",), b=("A",), tight=(), wide=())
        self.assertEqual(decision.status, STATUS_AMBIGUOUS)
        self.assertEqual(decision.geo, GEO_ABSENT)


    def test_missing_address_probe_b_is_not_required(self) -> None:
        """住所が無い行（OSM に多い）でも、A と矩形だけで判定できる。"""

        seed = make_seed(address_query="", address_quality="none")
        probes = {
            PROBE_A: SearchResult(("A",), 200),
            PROBE_C_TIGHT: SearchResult(("A",), 200),
            PROBE_C_WIDE: SearchResult(("A",), 200),
        }
        decision = RULES["box_unique"](seed, probes)
        self.assertEqual(decision.status, STATUS_MATCHED)
        self.assertEqual(decision.place_id, "A")

    def test_missing_name_is_ineligible(self) -> None:
        decision = RULES["box_unique"](make_seed(name_query=""), self.probes(a=("A",), b=("A",), tight=("A",)))
        self.assertEqual(decision.status, STATUS_INELIGIBLE)

    def test_only_the_strict_rule_is_export_safe(self) -> None:
        """提出用CSVに使えるのは、全ラベルで誤り0だった `box_unique_strict` だけである。"""

        self.assertEqual(EXPORT_SAFE_RULES, frozenset({"box_unique_strict"}))

    def test_strict_rule_rejects_wide_box_and_ambiguous_address(self) -> None:
        seed = make_seed()
        probes = {
            PROBE_A: SearchResult(("X",), 200),
            PROBE_B: SearchResult(("X",), 200),
            PROBE_C_TIGHT: SearchResult(("X",), 200),
            PROBE_C_WIDE: SearchResult(("X",), 200),
        }
        self.assertEqual(RULES["box_unique_strict"](seed, probes).status, STATUS_MATCHED)
        # ±25m の矩形に居ない候補は採らない
        loose = dict(probes, **{PROBE_C_TIGHT: SearchResult((), 200)})
        self.assertEqual(
            RULES["box_unique_strict"](seed, loose).detail, "rejected_not_in_tight_box"
        )
        # 住所クエリが複数返す店名は採らない
        noisy = dict(probes, **{PROBE_B: SearchResult(("X", "Y"), 200)})
        self.assertEqual(
            RULES["box_unique_strict"](seed, noisy).detail, "rejected_address_query_ambiguous"
        )


class RateLimiterLookaheadTest(unittest.TestCase):
    """予約が未来へ伸び続けないことを固定する。

    上限が無いと、要求が interval より速く来る限り _next_at が伸び続け、
    全スレッドが数分の sleep に入って実行が止まる。実際に12スレッドの実行が
    3分以上完了0になった。
    """

    def test_reservation_does_not_run_away(self) -> None:
        limiter = RateLimiter(qps=1.0, max_lookahead_seconds=2.0)
        # sleep せずに予約だけを進める（acquire は待つので、内部状態を直接見る）。
        start = time.monotonic()
        for _ in range(100):
            with limiter._lock:
                interval = 1.0 / limiter.qps + limiter._penalty
                now = time.monotonic()
                begin = min(max(now, limiter._next_at), now + limiter.max_lookahead_seconds)
                limiter._next_at = begin + interval
        # 100回まわしても、予約は現在時刻 + 先読み上限 + interval を超えない。
        self.assertLessEqual(limiter._next_at - time.monotonic(), 2.0 + 1.0 + 0.5)
        self.assertLess(time.monotonic() - start, 1.0)

    def test_spacing_is_still_applied(self) -> None:
        limiter = RateLimiter(qps=50.0)
        began = time.monotonic()
        for _ in range(5):
            limiter.acquire()
        self.assertGreater(time.monotonic() - began, 0.05)


class DailyQuotaTest(unittest.TestCase):
    """1日上限の 429 は再試行せずに止める。

    待っても日付が変わるまで回復しないので、再試行を重ねると 429 を積むだけで
    全スレッドが完了0のまま止まる。実測でその状態に陥ったので固定する。
    """

    def _client_raising(self, body: str):
        client = FreePlacesClient("k", rate_limiter=RateLimiter(qps=1000.0))

        def fake_open(request, timeout=None):
            raise urllib.error.HTTPError(
                "https://places.googleapis.com", 429, "Too Many Requests", {},
                io.BytesIO(body.encode("utf-8")),
            )

        return client, fake_open

    def test_per_day_quota_stops_the_run(self) -> None:
        body = json.dumps({"error": {"message": "Quota exceeded ... SearchTextRequestPerDayPerProject"}})
        client, fake_open = self._client_raising(body)
        with mock.patch("urllib.request.urlopen", fake_open):
            with self.assertRaises(DailyQuotaExhausted):
                client.search_text({"textQuery": "x"})

    def test_per_minute_quota_is_retried(self) -> None:
        body = json.dumps({"error": {"message": "Quota exceeded ... SearchTextRequestPerMinute"}})
        client, fake_open = self._client_raising(body)
        client._max_retries = 0
        with mock.patch("urllib.request.urlopen", fake_open):
            result = client.search_text({"textQuery": "x"})
        self.assertEqual(result.http_status, 429)


class AdaptiveProbeTest(unittest.TestCase):
    """必要な probe だけを送っても、box_unique と同じ判定になることを固定する。"""

    class FakeCache:
        def __init__(self): self.stored = {}
        def get(self, seed_id, probe): return None
        def put(self, seed_id, probe, result, body): self.stored[(seed_id, probe)] = result

    def prober(self, responses):
        """probe の種類は本文の形で見分ける。

        A は locationBias、B は位置指定なし、C 系は locationRestriction を持つ。
        C 系は矩形の半辺で tight と wide を分ける。
        """

        from adaptive_probe import AdaptiveProber

        def classify(body):
            restriction = body.get("locationRestriction")
            if restriction:
                rect = restriction["rectangle"]
                half = (rect["high"]["latitude"] - rect["low"]["latitude"]) * 111_320.0 / 2
                return "c_wide" if half > 100 else "c_tight"
            return "a" if body.get("locationBias") else "b"

        class FakeClient:
            def __init__(self): self.sent = []
            def search_text(self, body):
                kind = classify(body)
                self.sent.append(kind)
                return SearchResult(tuple(responses.get(kind, ())), 200)

        client = FakeClient()
        return AdaptiveProber(client, self.FakeCache()), client

    def test_tight_unique_stops_after_two_requests(self) -> None:
        prober, client = self.prober({"c_tight": ("A",), "a": ("A",)})
        outcome = prober.run(make_seed(address_query="東京都港区1-1"))
        self.assertEqual(outcome.place_id, "A")
        self.assertEqual(outcome.detail, "tight_unique_in_ab")
        # c_tight と a の2本だけ。c_wide も b も送らない。
        self.assertEqual(outcome.requests, 2)

    def test_no_candidate_skips_name_queries(self) -> None:
        """矩形がどちらも空なら、A も B も送らない（確定しえないため）。"""

        prober, client = self.prober({})
        outcome = prober.run(make_seed(address_query="東京都港区1-1"))
        self.assertIsNone(outcome.place_id)
        self.assertEqual(outcome.detail, "no_candidate_in_box")
        self.assertEqual(outcome.requests, 2)

    def test_missing_address_never_sends_b(self) -> None:
        prober, client = self.prober({"c_tight": ("A",), "a": ("Z",), "c_wide": ("A",)})
        outcome = prober.run(make_seed(address_query="", address_quality="none"))
        self.assertIsNone(outcome.place_id)
        # 住所が無いので B は一度も送られない。
        self.assertNotIn("b", client.sent)
        self.assertEqual(outcome.requests, 3)


class BillableEndpointTest(unittest.TestCase):
    """Nearby Search を呼べないことを固定する。

    fieldMask を絞れば無料、という前提は Text Search と Place Details にしか
    当てはまらない。Nearby Search (New) は IDs Only でも課金される。
    実際にこれを無料と誤認して約3,700リクエストを発生させたので、
    構造的に呼べないようにしてある。
    """

    def test_search_nearby_is_refused(self) -> None:
        from free_places import BillableEndpointError

        client = FreePlacesClient("k", rate_limiter=RateLimiter(qps=1000.0))
        with self.assertRaises(BillableEndpointError):
            client.search_nearby({"maxResultCount": 1})

    def test_refused_before_any_network_call(self) -> None:
        """送信前に落ちること。落ちる前に1リクエストでも出たら意味がない。"""

        from free_places import BillableEndpointError

        client = FreePlacesClient("k", rate_limiter=RateLimiter(qps=1000.0))
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("送信された")):
            with self.assertRaises(BillableEndpointError):
                client.search_nearby({"maxResultCount": 1})
        self.assertEqual(client.request_count, 0)


class AddressBoxQueryTest(unittest.TestCase):
    """``body_query_ca`` は「店名+住所」を矩形の中で引く。"""

    def test_query_and_rectangle_are_both_present(self) -> None:
        seed = make_seed(name_query="山田屋", address_query="東京都千代田区1-1")
        body = body_query_ca(seed, half_side_m=1000.0)
        self.assertEqual(body["textQuery"], "山田屋 東京都千代田区1-1")
        self.assertIn("rectangle", body["locationRestriction"])
        self.assertNotIn("locationBias", body)

    def test_field_mask_stays_ids_only(self) -> None:
        # 課金の前提が壊れていないこと。fieldMask はクライアント側の定数である。
        from free_places import FIELD_MASK

        self.assertEqual(FIELD_MASK, "places.id")


class SearchVariantTest(unittest.TestCase):
    """検索し直すための短縮形。比較用の ``core`` と違い、表記は保つ。"""

    def test_branch_suffix_and_its_place_name_are_dropped(self) -> None:
        self.assertEqual(search_variant("神戸屋レストラン 浜田山店"), "神戸屋レストラン")

    def test_bracketed_reading_is_dropped(self) -> None:
        self.assertEqual(search_variant("FURUBO（フルボ）"), "FURUBO")

    def test_name_without_branch_is_unchanged(self) -> None:
        self.assertEqual(search_variant("らーめん工房いちにぃさん"), "らーめん工房いちにぃさん")

    def test_result_is_not_kana_folded(self) -> None:
        # ``core`` はカナに畳むのでクエリに使えない。こちらは畳まない。
        self.assertIn("神戸屋", search_variant("神戸屋レストラン 浜田山店"))



if __name__ == "__main__":
    unittest.main(verbosity=2)
