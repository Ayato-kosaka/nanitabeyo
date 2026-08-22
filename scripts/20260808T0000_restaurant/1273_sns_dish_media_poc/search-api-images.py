#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#1273 検索APIの画像検索で「店名+料理名」の dish_media を取れるか（規約ゲート実測）

# #1273 【設計】このスクリプトは「規約を先に読む」ためのもので、画像を取りに行かない。
#   過去 #1303 / #1270 / R5-E はいずれも規約で落ちた。規約を読まずに叩くと、
#   採用不能なデータで被覆率を測って時間を捨てることになる。よって順序を固定する:
#     (1) 各サービスの規約原文を取得し、3つのゲートで判定する
#     (2) 通ったサービスだけ、600店サンプルの一部に画像検索を実行する
#   本 PoC では (1) で全滅したため (2) は実行されない（run_coverage() が空を返す）。
#
# #1273 【仕様】3つの規約ゲート（すべて通過して初めて採用可能）
#   gate_a: 飲食店から対価を得る事業での利用可否
#           nanitabeyo は掲載店から対価を得る。広告営業目的の利用を禁じる条項に抵触すると不可。
#   gate_b: listings / directory サービスでの利用可否
#           「収集した情報を別途データベースとして管理して利用する行為」の禁止に抵触すると不可。
#   gate_c: 画像（検索結果）のキャッシュ/保存可否 ← ここで大半が落ちる
#           dish_media は永続的に保持する必要がある。transient storage 限定の許諾では足りない。
#
# #1273 【仕様】無料であることも必須条件（鉄則4: 有料APIは呼ばない）。
#   規約を通っても有料しか無いサービスは fee_gate=False として不採用にする。
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", "search-api-images.json")
SUPPLY = os.path.join(HERE, "out", "supply_ceiling_2026-08-13.json")

# 全国飲食店数（fixtures/overture_jp_food.csv の行数）
JP_FOOD_TOTAL = 789_612


# ---------------------------------------------------------------------------
# 規約判定表（原文引用つき）
# ---------------------------------------------------------------------------
# #1273 【仕様】verbatim は curl で取得した規約原文からの逐語引用。
#   要約ではなく原文を残すのは、後から「本当に禁止されているのか」を再検証できるようにするため。
SERVICES = [
    {
        "name": "Brave Search API",
        "image_endpoint": "https://api.search.brave.com/res/v1/images/search",
        "image_search_exists": True,
        "free_tier": False,
        "fee_gate": False,
        "gate_a": None,      # 明示条項なし（判定不能）
        "gate_b": None,      # 明示条項なし（判定不能）
        "gate_c": False,     # ← 致命傷
        "tos_url": "https://api-dashboard.search.brave.com/documentation/resources/terms-of-service",
        "tos_last_updated": "2026-02-11",
        "verbatim": [
            "Customer shall not and shall not permit End Users or others to: (i) store, cache, "
            "or create a database of Search Results, in whole or in part, other than transient "
            "storage required for operation of Customer Applications or related software, "
            "service or systems;",
            "(ii) create derivative works of the API, Documentation or Search Results;",
            "(xii) redistribute, resell, or sublicense the Search Results;",
            "\"Search Results\" means any outputs from calls made to the API, which may consist of "
            "(i) internet search results; (ii) Generated Results; or (iii) Third-Party Content. "
            "\"Third-Party Content\" means materials and information, in any form or medium, that "
            "are not proprietary to Provider, including any third party documents, text, images, "
            "video, audio, data, information or other materials not provided by Provider.",
        ],
        "reason": (
            "画像検索エンドポイントは実在するが、Use Restrictions (i) が Search Results の "
            "store/cache/database 化を transient storage 以外禁じる。Search Results の定義に "
            "images が明記されているため、dish_media として画像URLを恒久保持する用途は不可。"
            "storage rights は別プラン（有料）でのみ付与。さらに2026年2月に無料枠が廃止され、"
            "支払い手段の登録が必須になったため鉄則4（無料のみ）にも抵触。"
        ),
    },
    {
        "name": "Bing Search API / Azure AI (Grounding with Bing Search)",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": False,
        "fee_gate": False,
        "gate_a": None,
        "gate_b": None,
        "gate_c": False,
        "tos_url": "https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement",
        "tos_last_updated": "2025-08-11",
        "verbatim": [
            "Bing Search APIs were retired on August 11, 2025. Any existing instances of Bing "
            "Search APIs were decommissioned completely, and the product is no longer available "
            "for use or new customer signup.",
        ],
        "verbatim_note": "上記は Microsoft Lifecycle の retirement announcement の記載。",
        "reason": (
            "2025-08-11 に完全廃止済みで新規契約不可。後継の Grounding with Bing Search は "
            "Azure AI Agents 内でのみ動作するツール呼び出し課金の有料製品で、無料枠なし。"
            "画像検索そのものが提供されない。到達不能につき reject。"
        ),
    },
    {
        "name": "Google Custom Search JSON API (Programmable Search Engine)",
        "image_endpoint": "https://www.googleapis.com/customsearch/v1?searchType=image",
        "image_search_exists": True,
        "free_tier": True,           # 100 queries/day
        "fee_gate": True,
        "gate_a": None,
        "gate_b": None,
        "gate_c": False,             # ← 致命傷
        "tos_url": "https://support.google.com/programmable-search/answer/1714300",
        "tos_last_updated": "n/a",
        "verbatim": [
            "You may not in any way frame, cache or modify the Results produced by Google, except "
            "as otherwise agreed to between You and Google.",
        ],
        "reason": (
            "searchType=image で画像検索は可能だが、Programmable Search Engine 規約が "
            "Results の frame/cache/modify を明示的に禁止。dish_media としての保存は不可。"
            "加えて2026年時点で新規顧客受付を停止しており（既存顧客も2027-01-01までに移行）、"
            "無料枠は 100 queries/day = 36,500/年。789,612店を1回ずつ叩くだけで21.6年かかる。"
        ),
        "free_quota_per_day": 100,
    },
    {
        "name": "DuckDuckGo",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": True,
        "fee_gate": True,
        "gate_a": None,
        "gate_b": None,
        "gate_c": False,
        "tos_url": "https://duckduckgo.com/terms",
        "tos_last_updated": "n/a",
        "verbatim": [
            "DuckDuckGo's terms of service do not allow automated, non-personal use of the site.",
        ],
        "verbatim_note": "公式の検索/画像検索APIは存在せず、Instant Answer API は検索結果を返さない。",
        "reason": (
            "公式の画像検索APIが存在しない。非公式エンドポイント叩きは規約が禁じる "
            "automated / non-personal use に該当し、#1303（規約でアクセス自体禁止）と同型。"
            "有料の正規プランも存在しないためスケールする合法経路が無い。"
        ),
    },
    {
        "name": "Naver Search API (image)",
        "image_endpoint": "https://openapi.naver.com/v1/search/image",
        "image_search_exists": True,
        "free_tier": True,           # 25,000 calls/day
        "fee_gate": True,
        "gate_a": False,             # ← 致命傷1
        "gate_b": False,             # ← 致命傷2
        "gate_c": False,             # ← 致命傷3
        "tos_url": "https://developers.naver.com/products/terms/",
        "tos_last_updated": "2026-07-31",
        "verbatim": [
            "③ API서비스를 이용하여 취득한 정보(네이버 회원의 계정 관련 정보, 네이버 서비스의 "
            "컨텐츠 내용 등 일체의 데이터를 포함한다)를 다음의 예시와 같이 본 약관에서 허용한 "
            "범위를 넘어서서 무단으로 복제, 저장(캐시 행위 포함), 가공, 배포 등 이용하거나 "
            "제3자에게 제공하는 행위",
            "네이버 지역정보를 수집하여 해당 정보를 광고 영업에 이용하는 행위",
            "네이버 지역정보를 수집하여 별도 데이터베이스로 관리하며 이용하는 행위",
            "2.1. 이용자는 네이버 검색 API 서비스의 검색결과를 독립적으로 노출하여야 하며, "
            "검색결과의 앞, 뒤, 중간 등에 다른 내용을 삽입하거나 왜곡할 수 없고",
        ],
        "reason": (
            "3ゲート全滅。(c) 取得情報の複製・保存（캐시 행위 포함=キャッシュ含む）・加工・配布を禁止。"
            "(a) 「네이버 지역정보를 수집하여 해당 정보를 광고 영업에 이용하는 행위」＝地域情報を"
            "収集して広告営業に利用する行為を禁止 → 飲食店から対価を得る nanitabeyo は該当。"
            "(b) 「별도 데이터베이스로 관리하며 이용하는 행위」＝別途DB化して利用する行為を禁止 → "
            "listings/directory そのもの。加えて検索結果は独立表示が義務で、自社UIへの混在も不可。"
        ),
        "free_quota_per_day": 25_000,
    },
    {
        "name": "Kagi Search API",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": False,
        "fee_gate": False,
        "gate_a": None,
        "gate_b": None,
        "gate_c": None,
        "tos_url": "https://help.kagi.com/kagi/api/search.html",
        "tos_last_updated": "n/a",
        "verbatim": [],
        "reason": (
            "Search API は有料クレジット制のみで無料枠なし（鉄則4に抵触）。かつ提供されるのは "
            "web/news 検索で画像検索エンドポイントが存在しない。実行不能。"
        ),
    },
    {
        "name": "Mojeek Search API",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": False,
        "fee_gate": False,
        "gate_a": None,
        "gate_b": None,
        "gate_c": None,
        "tos_url": "https://www.mojeek.com/services/search/web-search-api/",
        "tos_last_updated": "n/a",
        "verbatim": [
            "What search data is available through the API? Web search results which consist of "
            "URL, page title, and query dependent snippets.",
            "Startup £2 * CPM Pay as you Go 5 Queries /sec 100,000 Queries /day Storage Rights "
            "AI Usage Web Search Focus",
        ],
        "reason": (
            "APIが返すのは URL / title / snippet のみで画像を返さない。料金は最安 Startup でも "
            "£2 CPM の従量課金で無料枠なし。Storage Rights は有料プランの付帯機能。"
        ),
    },
    {
        "name": "Yandex Search API (Yandex Cloud)",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": False,
        "fee_gate": False,
        "gate_a": None,
        "gate_b": None,
        "gate_c": None,
        "tos_url": "https://yandex.cloud/en/docs/search-api/",
        "tos_last_updated": "n/a",
        "verbatim": [],
        "verbatim_note": (
            "docs へ非ブラウザUAでアクセスすると SmartCaptcha が返り、規約原文の機械取得自体が"
            "ブロックされる（自動アクセスを想定していない）。"
        ),
        "reason": (
            "Yandex Cloud Search API は XML/テキスト検索の有料従量課金のみで、公開された画像検索"
            "エンドポイントが無い。ドキュメント取得すら SmartCaptcha で遮断される。"
            "日本の飲食店カバレッジも期待できない。"
        ),
    },
    {
        "name": "Marginalia Search",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": True,
        "fee_gate": True,
        "gate_a": None,
        "gate_b": None,
        "gate_c": None,
        "tos_url": "https://about.marginalia.nu/",
        "tos_last_updated": "n/a",
        "verbatim": [],
        "verbatim_note": "about.marginalia.nu は既定の nginx ページを返す状態（ドキュメント未提供）。",
        "reason": (
            "テキスト専用の小規模独立インデックスで画像インデックスを持たない。"
            "日本語の飲食店ページの被覆も想定できず、画像取得経路として成立しない。"
        ),
    },
]


def probe_endpoints() -> dict:
    """# #1273 【設計】規約判定の裏取り。キー無しで叩き、エンドポイントの実在と認証必須を確認する。

    画像を取得するのではなく「鍵が要る＝規約に同意した契約者しか使えない」ことを実測で示す。
    規約を回避してよい根拠が無いことの確認であって、被覆率の測定ではない。
    """
    targets = {
        "brave_images": "https://api.search.brave.com/res/v1/images/search?q=%E5%AF%BF%E5%8F%B8",
        "naver_image": "https://openapi.naver.com/v1/search/image?query=test",
        "google_cse_image": "https://www.googleapis.com/customsearch/v1?q=test&searchType=image",
    }
    result = {}
    for key, url in targets.items():
        try:
            proc = subprocess.run(
                ["curl", "-sS", "--max-time", "20", "-w", "\n%{http_code}", url],
                capture_output=True, text=True,
            )
            body, _, code = proc.stdout.rpartition("\n")
            result[key] = {"http_status": code.strip(), "body_head": body[:300]}
        except Exception as exc:  # pragma: no cover
            result[key] = {"error": str(exc)}
    return result


def sample_ids(n: int) -> list:
    """# #1273 【仕様】部分集合は SHA-256(id) 昇順で先頭N件（鉄則1）。

    規約を通ったサービスが出た場合にだけ使う。今回は通過ゼロなので呼ばれるが空扱い。
    """
    if not os.path.exists(SUPPLY):
        return []
    with open(SUPPLY, encoding="utf-8") as fh:
        data = json.load(fh)
    rows = []
    for item in data.get("results", []):
        rest = item.get("restaurant") or {}
        rid = rest.get("id")
        if not rid:
            continue
        rows.append((hashlib.sha256(str(rid).encode()).hexdigest(), rid, rest.get("name"),
                     rest.get("locality")))
    rows.sort(key=lambda r: r[0])
    return [{"id": r[1], "name": r[2], "locality": r[3]} for r in rows[:n]]


def run_coverage(passed_services: list, targets: list) -> dict:
    """# #1273 【設計】規約を通ったサービスが1つも無ければ、画像検索は一切実行しない。

    規約に抵触すると分かっているAPIを「実測のため」に叩くのは、
    採用不能なデータのために規約違反を犯すだけで、意思決定には何も足さない。
    """
    if not passed_services:
        return {
            "executed": False,
            "reason": "規約ゲートを通過したサービスが0件のため画像検索は未実行",
            "queried_restaurants": 0,
            "image_coverage_pct": 0.0,
            "manual_verification": {
                "executed": False,
                "reason": "検証対象の画像が0件（取得経路が規約上存在しない）",
                "true_positives": 0,
                "sampled": 0,
            },
        }
    raise NotImplementedError("規約通過サービスが出た場合にここへ実装する")


def main() -> int:
    gate_rows = []
    passed = []
    for svc in SERVICES:
        # #1273 【仕様】gate_* は True=通過 / False=抵触 / None=明示条項なし。
        #   None は「安全」ではない。fee_gate と image_search_exists も含めた総合で採否を決める。
        blocked_on = [g for g in ("gate_a", "gate_b", "gate_c") if svc.get(g) is False]
        adoptable = (
            not blocked_on
            and svc.get("fee_gate") is True
            and svc.get("image_search_exists") is True
        )
        row = dict(svc)
        row["blocked_on"] = blocked_on
        row["adoptable"] = adoptable
        gate_rows.append(row)
        if adoptable:
            passed.append(svc["name"])

    targets = sample_ids(100)
    coverage = run_coverage(passed, targets)

    # #1273 【仕様】無料枠で全国789,612店を回せるかの試算。規約を通らなくても数字は残す。
    throughput = []
    for svc in SERVICES:
        q = svc.get("free_quota_per_day")
        if not q:
            continue
        throughput.append({
            "service": svc["name"],
            "free_queries_per_day": q,
            "free_queries_per_month": q * 30,
            "days_to_cover_jp_food_once": round(JP_FOOD_TOTAL / q, 1),
            "years_to_cover_jp_food_once": round(JP_FOOD_TOTAL / q / 365.0, 2),
        })

    payload = {
        "slug": "search-api-images",
        "issue": 1273,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "question": "検索APIの画像検索で「店名+料理名」の dish_media 画像を取れるか",
        "gates": {
            "gate_a": "飲食店から対価を得る事業での利用可否",
            "gate_b": "listings / directory サービスでの利用可否",
            "gate_c": "画像（検索結果）のキャッシュ / 保存可否",
            "fee_gate": "無料枠のみで運用可能か（鉄則4）",
        },
        "services_evaluated": len(SERVICES),
        "services_passed": len(passed),
        "passed_service_names": passed,
        "services": gate_rows,
        "endpoint_probes": probe_endpoints(),
        "sample_target_count": len(targets),
        "coverage": coverage,
        "free_quota_throughput": throughput,
        "jp_food_total": JP_FOOD_TOTAL,
        "metric": {
            "name": "規約を通ったサービスでの画像被覆率(%)",
            "value": coverage["image_coverage_pct"],
            "sample_n": coverage["queried_restaurants"],
        },
        "verdict": "reject",
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    print(f"services evaluated: {len(SERVICES)}  passed: {len(passed)}")
    for row in gate_rows:
        flag = "PASS" if row["adoptable"] else "BLOCK"
        print(f"  [{flag}] {row['name']}: blocked_on={row['blocked_on'] or '-'} "
              f"free={row['fee_gate']} image_api={row['image_search_exists']}")
    print(f"metric: 規約を通ったサービスでの画像被覆率 = {coverage['image_coverage_pct']}% "
          f"(n={coverage['queried_restaurants']})")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
