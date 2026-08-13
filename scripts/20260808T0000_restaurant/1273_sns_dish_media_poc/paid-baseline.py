#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#1273 【設計】有料ソースで dish_media カバレッジ70%に到達するコストの算出

無料の天井が 48.0%（YouTube ∪ 店舗自社サイト）と判明したため、目標70%との差
22pt を有料ソースで埋める場合の金額を、公式ドキュメントの料金表の読解のみで算出する。

【仕様】実際に有料APIを呼んではいけない（鉄則4）。本スクリプトはネットワークを
一切使わず、下記 SOURCES に固定した「公式ページから curl で取得した実測の料金表
テキスト」を定数として持ち、そこから決定的に金額を計算する。

【設計】判定は金額だけで行わない。nanitabeyo は飲食店から対価を得る事業であり
（鉄則5）、事業モデルに抵触する規約を持つソースは金額に関わらず採用不可。
したがって本スクリプトは「金額」と「規約適合」を別々に出し、両方が通ったものだけを
adopt 候補とする。
"""

from __future__ import annotations

import json
import os
from datetime import date

# ---------------------------------------------------------------------------
# 母集団
# ---------------------------------------------------------------------------
# fixtures/overture_jp_food.csv の件数（既存実測値）
UNIVERSE = 789_612
# 無料の実測天井（YouTube ∪ 店舗自社サイト、無作為600店で実測）
FREE_CEILING_PCT = 48.0
TARGET_PCT = 70.0

TARGET_STORES = round(UNIVERSE * TARGET_PCT / 100)          # 70% 到達に必要な店舗数
GAP_PCT = TARGET_PCT - FREE_CEILING_PCT                     # 22.0 pt
GAP_STORES = round(UNIVERSE * GAP_PCT / 100)                # 差分だけを埋める店舗数

# ---------------------------------------------------------------------------
# 料金表（公式ページから curl で取得したテキストを転記。取得日 2026-08-13）
# ---------------------------------------------------------------------------
SOURCES = {
    "google_pricing": "https://developers.google.com/maps/billing-and-pricing/pricing",
    "google_datafields": "https://developers.google.com/maps/documentation/places/web-service/data-fields",
    "google_photos": "https://developers.google.com/maps/documentation/places/web-service/place-photos",
    "google_policies": "https://developers.google.com/maps/documentation/places/web-service/policies",
    "google_tos": "https://cloud.google.com/maps-platform/terms",
    "serpapi_pricing": "https://serpapi.com/pricing",
}

# Google Places API (New) の従量課金は「帯ごとの限界課金（marginal tier）」。
# 各タプルは (この帯の上限件数, 1,000件あたりのUSD)。free_cap までは 0 円。
# 出典: SOURCES["google_pricing"] の "Places API (New)" 表。
GOOGLE_SKUS = {
    # SKU DCD1-FE97-8C71。写真の実体（画像バイト列）を取得する Place Photos リクエスト。
    "Place Details Photos": {
        "sku_id": "DCD1-FE97-8C71",
        "free_cap": 1_000,
        "tiers": [(100_000, 7.00), (500_000, 5.60), (1_000_000, 4.20),
                  (5_000_000, 2.10), (float("inf"), 0.53)],
    },
    # SKU 635D-A9DD-C520。fieldMask を places.id のみに絞った Text Search。
    # 料金表の全帯が "-"、Free Usage Cap が "Unlimited" → 無償。
    "Text Search Essentials (IDs Only)": {
        "sku_id": "635D-A9DD-C520",
        "free_cap": float("inf"),
        "tiers": [(float("inf"), 0.0)],
    },
    # SKU 5C36-E272-E88F。fieldMask を id / photos に絞った Place Details。
    # data-fields 表で photos フィールドは "Place Details Essentials (IDs Only)" 帯に属する。
    "Place Details Essentials (IDs Only)": {
        "sku_id": "5C36-E272-E88F",
        "free_cap": float("inf"),
        "tiers": [(float("inf"), 0.0)],
    },
    # 参考: photos を Text Search で直接取ると Pro 課金になり桁が変わる（SKU 4FDA-34B1-A910）。
    "Text Search Pro": {
        "sku_id": "4FDA-34B1-A910",
        "free_cap": 5_000,
        "tiers": [(100_000, 32.00), (500_000, 25.60), (1_000_000, 19.20),
                  (5_000_000, 9.60), (float("inf"), 2.40)],
    },
}

# Foursquare Places（#1270 で算出済み。参考値として引用）
# 無料 500 コール / 501件目以降 $15 CPM。1店あたり search + photos の 2 コール。
FSQ_FREE_CALLS = 500
FSQ_CPM = 15.0
FSQ_CALLS_PER_STORE = 2

# SerpApi（月額前払いのプラン制。搭載検索回数で階段状に課金される）
# 出典: SOURCES["serpapi_pricing"] の埋め込み JSON。
SERPAPI_PLANS = [
    ("Starter", 1_000, 25.0),
    ("Developer", 5_000, 75.0),
    ("Production", 15_000, 150.0),
    ("Big Data", 30_000, 275.0),
    ("Searcher", 100_000, 725.0),
    ("Volume", 250_000, 1_475.0),
    ("Infrastructure", 500_000, 2_750.0),
    ("Cloud 1M", 1_000_000, 3_750.0),
    ("Cloud 2M", 2_000_000, 5_675.0),
]


def google_cost(sku_name: str, units: int) -> float:
    """Google の限界課金モデルで units 件ぶんの USD を返す。

    【仕様】無料枠 free_cap を差し引いた残りを、帯の上限に沿って順に切り出して課金する。
    帯の上限は「累計件数」であって「帯の幅」ではないので、直前の帯上限との差を取る。
    """
    sku = GOOGLE_SKUS[sku_name]
    free_cap = sku["free_cap"]
    if units <= free_cap:
        return 0.0
    total = 0.0
    lower = free_cap  # 課金開始位置は無料枠の直上
    for upper, rate_per_1k in sku["tiers"]:
        if units <= lower:
            break
        billable = min(units, upper) - lower
        if billable > 0:
            total += billable * rate_per_1k / 1_000.0
        lower = upper
    return round(total, 2)


def fsq_cost(stores: int) -> float:
    """Foursquare のコスト。1店あたり 2 コール、500 コールまで無料、以降 $15 CPM。"""
    calls = stores * FSQ_CALLS_PER_STORE
    billable = max(0, calls - FSQ_FREE_CALLS)
    return round(billable * FSQ_CPM / 1_000.0, 2)


def serpapi_cost(searches: int) -> tuple[str, float]:
    """SerpApi は前払いプラン制なので、必要検索数を賄える最小プランの月額を返す。"""
    for name, quota, price in SERPAPI_PLANS:
        if searches <= quota:
            return name, price
    # 最大プランを超える場合は Cloud 2M の単価で線形に外挿
    unit = SERPAPI_PLANS[-1][2] / SERPAPI_PLANS[-1][1]
    return "Cloud 2M+ (extrapolated)", round(searches * unit, 2)


def build_candidates() -> list[dict]:
    """候補ごとに「70%到達コスト」「22pt差分コスト」「規約適合」をまとめる。"""
    candidates = []

    # --- 候補1: Google Places API (New) -------------------------------------
    # 最安経路は 3 ステップ。課金されるのは写真実体の取得のみ。
    #   A. Text Search (fieldMask=places.id)        → Essentials (IDs Only) 無償
    #   B. Place Details (fieldMask=id,photos)      → Essentials (IDs Only) 無償
    #   C. Place Photos /media                      → Place Details Photos 課金
    for label, stores in (("target_70pct", TARGET_STORES), ("gap_22pt", GAP_STORES),
                          ("full_universe", UNIVERSE)):
        pass  # 実際の計算は下でまとめて行う（ループ変数の誤用を避けるため）

    def google_breakdown(stores: int) -> dict:
        return {
            "stores": stores,
            "step_a_text_search_ids_only_usd": google_cost("Text Search Essentials (IDs Only)", stores),
            "step_b_place_details_ids_only_usd": google_cost("Place Details Essentials (IDs Only)", stores),
            "step_c_place_photos_usd": google_cost("Place Details Photos", stores),
            "total_usd": round(
                google_cost("Text Search Essentials (IDs Only)", stores)
                + google_cost("Place Details Essentials (IDs Only)", stores)
                + google_cost("Place Details Photos", stores), 2),
            # 参考: photos を Text Search Pro で直接取った場合（最安経路を取らない実装）
            "naive_text_search_pro_usd": google_cost("Text Search Pro", stores),
        }

    candidates.append({
        "name": "Google Places API (New)",
        "billed_step": "Place Photos /media (SKU DCD1-FE97-8C71)",
        "free_steps": [
            "Text Search fieldMask=places.id (SKU 635D-A9DD-C520, Unlimited free)",
            "Place Details fieldMask=id,photos (SKU 5C36-E272-E88F, Unlimited free)",
        ],
        "cost_target_70pct_usd": google_breakdown(TARGET_STORES)["total_usd"],
        "cost_gap_22pt_usd": google_breakdown(GAP_STORES)["total_usd"],
        "cost_full_universe_usd": google_breakdown(UNIVERSE)["total_usd"],
        "breakdown": {
            "target_70pct": google_breakdown(TARGET_STORES),
            "gap_22pt": google_breakdown(GAP_STORES),
            "full_universe": google_breakdown(UNIVERSE),
        },
        "dish_category_available": False,
        "dish_category_note": (
            "Place Photos のレスポンスに含まれるのは name / widthPx / heightPx / "
            "authorAttributions[] / flagContentUri / googleMapsUri のみ。写真が料理か"
            "内観か外観かを示すラベルは一切無い。#1270 が Foursquare について指摘した"
            "「generic な写真では dish を保証できない」問題が Google にもそのまま該当する。"
        ),
        "tos_compatible": False,
        "tos_blockers": [
            "Google Maps Platform ToS 3.2.3(d)(iii): 「use the Google Maps Core Services "
            "in a listings or directory service or to create or augment an advertising "
            "product」— nanitabeyo は飲食店を掲載し飲食店から対価を得る listings/directory "
            "かつ広告的プロダクトであり、この禁止条項に直接抵触する（鉄則5により採用不可）",
            "ToS 3.2.3(a) No Scraping: 「pre-fetch, index, store, reshare, or rehost Google "
            "Maps Content outside the services」— dish_media は画像を自社DBに保存し再配信する"
            "設計なので不可能",
            "ToS 3.2.3(b) No Caching + Places API policies: 「You must not pre-fetch, cache, "
            "or store Places API content beyond the allowed exceptions」。例外は place_id のみ。"
            "つまり写真は一件も保存できず、コストは店舗数ではなく閲覧回数に比例して恒久的に発生する",
            "ToS 3.2.3(c)(vii): Google Maps Content を機械学習モデルの学習・検証に使うことを禁止。"
            "写真から dish_category を推定する分類器の構築に使えない",
        ],
    })

    # --- 候補2: Foursquare Places（#1270 で算出済み。参考値） ---------------
    candidates.append({
        "name": "Foursquare Places API",
        "billed_step": "search + photos の 2 コール / 店",
        "free_steps": ["先頭 500 コールのみ無料"],
        "cost_target_70pct_usd": fsq_cost(TARGET_STORES),
        "cost_gap_22pt_usd": fsq_cost(GAP_STORES),
        "cost_full_universe_usd": fsq_cost(UNIVERSE),
        "breakdown": {
            "cpm_usd": FSQ_CPM,
            "calls_per_store": FSQ_CALLS_PER_STORE,
            "reference_1270_full_japan_usd": 23_700,
        },
        "dish_category_available": False,
        "dish_category_note": "#1270 実測: 写真は generic な food_or_drink で dish を保証できない",
        "tos_compatible": False,
        "tos_blockers": [
            "#1270 実測済み: derivative works 禁止条項により、写真を自社の dish_media として"
            "再構成・再配信できない（再調査禁止リスト入り）",
        ],
    })

    # --- 候補3: SerpApi（Google Maps 検索結果のプロキシ） -------------------
    sp_t = serpapi_cost(TARGET_STORES)
    sp_g = serpapi_cost(GAP_STORES)
    sp_f = serpapi_cost(UNIVERSE)
    candidates.append({
        "name": "SerpApi (Google Maps engine)",
        "billed_step": "1 検索 / 店（前払いプラン制）",
        "free_steps": [],
        "cost_target_70pct_usd": sp_t[1],
        "cost_gap_22pt_usd": sp_g[1],
        "cost_full_universe_usd": sp_f[1],
        "breakdown": {
            "plan_target_70pct": sp_t[0],
            "plan_gap_22pt": sp_g[0],
            "plan_full_universe": sp_f[0],
            "note": "月額。1回の全件走査で終わらず、鮮度維持には毎月同額が必要",
        },
        "dish_category_available": False,
        "dish_category_note": "Google Maps の写真をそのまま返すだけなので Google と同じく dish ラベル無し",
        "tos_compatible": False,
        "tos_blockers": [
            "返ってくるのは Google Maps Content そのものであり、取得経路を変えても "
            "Google Maps Platform ToS 3.2.3 の No Scraping / No Caching / listings 禁止を"
            "回避したことにはならない。むしろ規約違反の状態で Google のコンテンツを"
            "再配信することになり、法的リスクは Google 直契約より大きい",
        ],
    })

    # --- 候補4: Yelp Fusion（日本カバレッジの観点で除外） -------------------
    candidates.append({
        "name": "Yelp Fusion / Yelp Places API",
        "billed_step": "N/A",
        "free_steps": [],
        "cost_target_70pct_usd": None,
        "cost_gap_22pt_usd": None,
        "cost_full_universe_usd": None,
        "dish_category_available": False,
        "dish_category_note": "算出不能",
        "tos_compatible": False,
        "tos_blockers": [
            "Yelp は日本市場から撤退済みで、日本の飲食店の網羅性が 789,612 店規模に"
            "遠く及ばない。料金以前に母集団を満たせないため候補から除外",
            "Yelp Places API は公開料金表を持たず、営業経由の個別見積のみ。"
            "公式ドキュメントの読解では金額を確定できない（推測を実測として報告しない = 鉄則2）",
        ],
    })

    return candidates


# ---------------------------------------------------------------------------
# 目視検証用の逐語引用（鉄則3）
# ---------------------------------------------------------------------------
# 【設計】本課題はサンプリング調査ではなく文書読解なので、精度検証は「算出の根拠に
# した一文を原文のまま並べ、人が読んで誤読が無いか数える」形で行う。
VERBATIM = [
    {"source": "google_pricing", "quote":
     "Places API Place Details Photos / DCD1-FE97-8C71 / 1,000 / $7.00 / $5.60 / $4.20 / $2.10 / $0.53",
     "used_for": "写真実体取得の単価と無料枠1,000件"},
    {"source": "google_pricing", "quote":
     "SKU Name / Free Usage Cap / Cap - 100,000 / 100,001 - 500,000 / 500,001 - 1,000,000 / 1,000,001 - 5,000,000 / 5,000,000+",
     "used_for": "帯の区切り（限界課金であることの根拠）"},
    {"source": "google_pricing", "quote":
     "Places API Text Search Essentials (IDs Only) / 635D-A9DD-C520 / Unlimited / - / - / - / - / -",
     "used_for": "place_id 解決が無償である根拠"},
    {"source": "google_pricing", "quote":
     "Places API Place Details Essentials (IDs Only) / 5C36-E272-E88F / Unlimited / - / - / - / - / -",
     "used_for": "photos フィールド取得が無償である根拠"},
    {"source": "google_datafields", "quote":
     "Photos / photos / Place Details Essentials (IDs Only) / Text Search Pro / Nearby Search Pro",
     "used_for": "photos が Place Details では IDs Only 帯（無償）に属することの根拠"},
    {"source": "google_pricing", "quote":
     "Places API Text Search Pro / 4FDA-34B1-A910 / 5,000 / $32.00 / $25.60 / $19.20 / $9.60 / $2.40",
     "used_for": "最安経路を取らず Text Search で photos を直接取った場合の比較値"},
    {"source": "google_photos", "quote":
     "Each elements of photo[] contains the following fields: name ... heightPx ... widthPx ... "
     "authorAttributions[]",
     "used_for": "写真に dish ラベルが無いことの根拠（返却フィールドの全列挙）"},
    {"source": "google_policies", "quote":
     "You must not pre-fetch, cache, or store Places API content beyond the allowed exceptions, "
     "although the place_id is exempt from caching restrictions.",
     "used_for": "写真を保存できない＝一巡課金で終わらないことの根拠"},
    {"source": "google_policies", "quote":
     "Note that the place ID, used to uniquely identify a place, is exempt from the caching "
     "restrictions. You can therefore store place ID values indefinitely.",
     "used_for": "保存が許されるのは place_id のみであることの根拠"},
    {"source": "google_tos", "quote":
     "3.2.3 Restrictions Against Misusing the Services. (a) No Scraping. Customer will not export, "
     "extract, or otherwise scrape Google Maps Content for use outside the Services. For example, "
     "Customer will not: (i) pre-fetch, index, store, reshare, or rehost Google Maps Content "
     "outside the services;",
     "used_for": "dish_media の自社保存・再配信が不可であることの根拠"},
    {"source": "google_tos", "quote":
     "(b) No Caching. Customer will not cache Google Maps Content except as expressly permitted "
     "under the Maps Service Specific Terms.",
     "used_for": "キャッシュ禁止"},
    {"source": "google_tos", "quote":
     "(d) No Re-Creating Google Products or Features. ... For example, Customer will not: ... "
     "(iii) use the Google Maps Core Services in a listings or directory service or to create or "
     "augment an advertising product;",
     "used_for": "【決定打】nanitabeyo の事業モデル（飲食店掲載・飲食店から対価）に直接抵触"},
    {"source": "google_tos", "quote":
     "(c) No Creating Content From Google Maps Content. ... (vii) use Google Maps Content to "
     "improve machine learning and artificial intelligence models, including to train, test, "
     "validate or fine-tune the models.",
     "used_for": "写真から dish_category を推定する分類器を作れないことの根拠"},
    {"source": "serpapi_pricing", "quote":
     '{"id":"cloud_1m_v4","name":"Cloud 1M","price":"$3,750","searches":"1,000,000"}',
     "used_for": "SerpApi で 552,728 検索を賄う最小プランの月額"},
    {"source": "serpapi_pricing", "quote":
     '{"id":"volume_v4","name":"Volume","price":"$1,475","searches":"250,000"}',
     "used_for": "SerpApi で 173,715 検索を賄う最小プランの月額"},
]


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    outdir = os.path.join(here, "out")
    os.makedirs(outdir, exist_ok=True)

    candidates = build_candidates()

    # 規約に抵触しない候補だけが実際に採用できる
    adoptable = [c for c in candidates if c["tos_compatible"]]

    # 主要指標: 70%到達コスト。金額として最安の候補を採る（規約判定は別建て）
    priced = [c for c in candidates if c["cost_target_70pct_usd"] is not None]
    cheapest = min(priced, key=lambda c: c["cost_target_70pct_usd"])

    result = {
        "slug": "paid-baseline",
        "measured_at": date.today().isoformat(),
        "network_calls_to_paid_apis": 0,
        "method": "公式ドキュメントの料金表を curl で取得し読解。有料APIは一切呼んでいない",
        "sources": SOURCES,
        "universe": {
            "total_stores": UNIVERSE,
            "free_ceiling_pct": FREE_CEILING_PCT,
            "target_pct": TARGET_PCT,
            "target_stores": TARGET_STORES,
            "gap_pct": GAP_PCT,
            "gap_stores": GAP_STORES,
        },
        "candidates": candidates,
        "verbatim_evidence": VERBATIM,
        "cross_validation": {
            "note": "Foursquare の全件コストを本スクリプトの式で再計算すると #1270 の既報値と一致する",
            "recomputed_full_universe_usd": fsq_cost(UNIVERSE),
            "reference_1270_usd": 23_700,
        },
        "cheapest_priced_candidate": cheapest["name"],
        "metric_70pct_cost_usd": cheapest["cost_target_70pct_usd"],
        "metric_gap_22pt_cost_usd": cheapest["cost_gap_22pt_usd"],
        "adoptable_candidates": [c["name"] for c in adoptable],
        "verdict": "adopt" if adoptable else "reject",
        "verdict_reason": (
            "金額だけを見れば Google Places は一巡 $%.2f と安い。しかし規約に適合する"
            "候補が 0 件であり、どの有料ソースでも 70%% に到達できない。"
            % cheapest["cost_target_70pct_usd"]
        ) if not adoptable else "規約適合かつ現実的な金額の候補が存在する",
    }

    path = os.path.join(outdir, "paid-baseline.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # 人が読める形で出力（目視検証用）
    print("=" * 78)
    print("#1273 有料ソースでの 70%% 到達コスト")
    print("=" * 78)
    print("母集団 %s 店 / 無料天井 %.1f%% / 目標 %.1f%%" % (f"{UNIVERSE:,}", FREE_CEILING_PCT, TARGET_PCT))
    print("70%% 到達に必要 = %s 店 / 22pt 差分 = %s 店" % (f"{TARGET_STORES:,}", f"{GAP_STORES:,}"))
    print()
    for c in candidates:
        print("-" * 78)
        print("候補: %s" % c["name"])
        t = c["cost_target_70pct_usd"]
        g = c["cost_gap_22pt_usd"]
        u = c["cost_full_universe_usd"]
        fmt = lambda v: "算出不能" if v is None else "$%s" % f"{v:,.2f}"
        print("  70%%到達(%s店): %s" % (f"{TARGET_STORES:,}", fmt(t)))
        print("  22pt差分(%s店): %s" % (f"{GAP_STORES:,}", fmt(g)))
        print("  全件(%s店):     %s" % (f"{UNIVERSE:,}", fmt(u)))
        print("  dish_category が付くか: %s" % ("YES" if c["dish_category_available"] else "NO"))
        print("  規約適合: %s" % ("OK" if c["tos_compatible"] else "NG"))
        for b in c["tos_blockers"]:
            print("    - %s" % b)
    print("-" * 78)
    print("採用可能な候補: %s" % (adoptable or "なし"))
    print("verdict: %s" % result["verdict"])
    print("saved -> %s" % path)


if __name__ == "__main__":
    main()
