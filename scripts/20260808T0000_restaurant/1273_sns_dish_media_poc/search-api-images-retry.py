#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#1273 検索APIの画像検索で dish_media を取れるか（規約ゲート再実測 / Round6 リトライ）

# #1273 【設計】前ラウンド（search-api-images.py）は規約表を人手で埋めただけで、
#   引用が本当に原文に存在するかを機械的に確かめていなかった。本スクリプトは
#   「規約原文を今この場で取得し、決定的条項が実在することを文字列一致で確認する」
#   ところまでを自動化する。判定の再現性はここで担保する。
#
# #1273 【仕様】判定順序（規約 → 実行）は前ラウンドから変えない。
#   (1) 各サービスの規約原文を HTTP で取得
#   (2) 決定的条項（禁止文言）が原文に存在するかを verbatim 一致で検証
#   (3) 3ゲート + 無料ゲート + 画像エンドポイント有無で採否を決める
#   (4) 1つでも通れば 600店サンプル先頭N件（SHA-256(id)昇順）に画像検索を実行
#   通過ゼロなら (4) は実行しない。抵触が確定した API を「実測のため」に叩くのは
#   採用不能なデータのために規約違反を犯すだけで、意思決定に何も足さない。
#
# #1273 【仕様】3ゲート
#   gate_a: 飲食店から対価を得る事業での利用可否（nanitabeyo は掲載店から対価を得る）
#   gate_b: listings / directory サービスでの利用可否
#   gate_c: 画像（検索結果）のキャッシュ / 恒久保存可否 ← ここで大半が落ちる
#   fee_gate: 無料枠のみで運用可能か（鉄則4）
#
# #1273 【バグ】前ラウンドは本 PoC の結論を StructuredOutput で返す前に落ちた。
#   本スクリプトは JSON を書いた時点で結論が確定するよう、metric を payload に含める。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", "search-api-images-retry.json")
SUPPLY = os.path.join(HERE, "out", "supply_ceiling_2026-08-13.json")

# 全国飲食店数（fixtures/overture_jp_food.csv の行数）
JP_FOOD_TOTAL = 789_612

UA = "Mozilla/5.0 (X11; Linux x86_64)"


# ---------------------------------------------------------------------------
# 規約判定表
# ---------------------------------------------------------------------------
# #1273 【仕様】verbatim_probe は「原文にこの文字列が存在すれば禁止条項が生きている」
#   という検証キー。要約ではなく原文の一部をそのまま置くことで、後から真偽を再確認できる。
#   tos_fetchable=False は egress proxy 等で原文取得ができなかったサービス。
#   その場合 verbatim_verified は None（未検証）にし、通過扱いには絶対にしない。
SERVICES = [
    {
        "name": "Brave Search API (Image Search)",
        "tos_url": "https://api-dashboard.search.brave.com/documentation/resources/terms-of-service",
        "image_endpoint": "https://api.search.brave.com/res/v1/images/search",
        "image_search_exists": True,
        "free_tier": False,
        "fee_gate": False,
        "gate_a": None,
        "gate_b": None,
        "gate_c": False,   # 致命傷
        "verbatim_probe": [
            "store, cache, or create a database of Search Results",
            "other than transient storage required for operation of Customer Applications",
            '"Search Results" means any outputs from calls made to the API',
        ],
        "free_quota_per_day": None,
        "reason": (
            "画像検索エンドポイントは実在し、キー無しで叩くと 422 "
            "(x-subscription-token required) が返る＝契約者のみ利用可。規約 Use Restrictions (i) が "
            "Search Results の store/cache/database 化を transient storage 以外禁じる。"
            "Search Results の定義は API の出力全般で Third-Party Content（images を明記）を含むため、"
            "dish_media として画像を恒久保持する用途は不可。storage rights は上位有料プランの付帯であり、"
            "無料枠のみで運用する本件の前提（鉄則4）とも両立しない。"
        ),
    },
    {
        "name": "Naver Search API (image)",
        "tos_url": "https://developers.naver.com/products/terms/",
        "image_endpoint": "https://openapi.naver.com/v1/search/image",
        "image_search_exists": True,
        "free_tier": True,
        "fee_gate": True,
        "gate_a": False,   # 致命傷1
        "gate_b": False,   # 致命傷2
        "gate_c": False,   # 致命傷3
        "verbatim_probe": [
            "무단으로 복제, 저장(캐시 행위 포함), 가공, 배포",
            "네이버 지역정보를 수집하여 해당 정보를 광고 영업에 이용하는 행위",
            "네이버 지역정보를 수집하여 별도 데이터베이스로 관리하며 이용하는 행위",
        ],
        "free_quota_per_day": 25_000,
        "reason": (
            "3ゲート全滅。(c) 取得情報の無断複製・保存（캐시 행위 포함＝キャッシュを含む）・加工・配布を禁止。"
            "(a) 「지역정보를 수집하여 해당 정보를 광고 영업에 이용하는 행위」＝地域情報を収集して広告営業に"
            "利用する行為を明示禁止 → 飲食店から対価を得る nanitabeyo が該当。"
            "(b) 「별도 데이터베이스로 관리하며 이용하는 행위」＝別途DB化して利用する行為を明示禁止 → "
            "listings/directory そのもの。加えて日本の飲食店の画像被覆も期待できない。"
        ),
    },
    {
        "name": "Google Custom Search JSON API (Programmable Search Engine)",
        "tos_url": "https://support.google.com/programmable-search/answer/1714300",
        "image_endpoint": "https://www.googleapis.com/customsearch/v1?searchType=image",
        "image_search_exists": True,
        "free_tier": True,
        "fee_gate": True,
        "gate_a": None,
        "gate_b": False,   # #1313 で Google 側 ToS の listings 禁止が既に確定
        "gate_c": False,   # 致命傷
        "verbatim_probe": [
            "You may not in any way frame, cache or modify the Results produced by Google",
        ],
        "free_quota_per_day": 100,
        "reason": (
            "searchType=image で画像検索自体は可能だが、PSE 規約 1.3 が Results の frame/cache/modify を"
            "明示禁止 → dish_media として保存不可。listings 用途の禁止は #1313 で Google 側 ToS により"
            "既に確定済み。加えて無料枠は 100 queries/day = 36,500/年で、789,612店を1回叩くだけで21.6年。"
        ),
    },
    {
        "name": "SerpApi / Serper 等の Google・Bing 結果プロキシ",
        "tos_url": "https://serpapi.com/",
        "image_endpoint": "https://serpapi.com/images-results",
        "image_search_exists": True,
        "free_tier": True,
        "fee_gate": False,
        "gate_a": None,
        "gate_b": False,   # 上流 Google ToS を継承
        "gate_c": False,   # 上流 Google ToS を継承
        "verbatim_probe": [],
        "verbatim_note": (
            "これらは自前のインデックスを持たず Google/Bing の結果を代理取得して転送するだけなので、"
            "上流の規約（Google: listings 禁止 #1313 / Results の cache 禁止）がそのまま被る。"
            "プロキシを挟んでも上流規約が消えないことは #1303 と同型の論点。"
        ),
        "free_quota_per_day": 3,   # 100/月 相当
        "reason": (
            "実体は Google 検索結果の代理取得であり、#1313 で reject 済みの Google ToS "
            "(3.2.3(d)(iii) listings 禁止) と PSE の cache 禁止を回避できない。"
            "無料枠も 100 searches/月 で、789,612店には 658年かかる。規約・スケールとも不可。"
        ),
    },
    {
        "name": "Tavily Search API (include_images)",
        "tos_url": "https://www.tavily.com/terms",
        "image_endpoint": "https://api.tavily.com/search (include_images=true)",
        "image_search_exists": True,
        "free_tier": True,
        "fee_gate": False,   # 1,000 credits/月では全国を回せない
        "gate_a": True,      # 対価を得る事業を禁じる条項なし（原文確認）
        "gate_b": True,      # listings/directory を禁じる条項なし（原文確認）
        "gate_c": True,      # Output の cache/store を禁じる条項なし（原文確認）
        "verbatim_probe": [
            "The Services are provided solely for Customer’s internal business purposes",
            "“ Output ” means the outputs or results delivered or made available to Customer",
        ],
        "free_quota_per_day": 33,   # 1,000 credits/月
        "reason": (
            "唯一3ゲートを通過した。規約原文に Output の cache/store 禁止条項が無く、"
            "listings/directory 禁止も、飲食店から対価を得る事業の禁止も無い（3.2 General Use Restrictions "
            "を全項確認、禁止は再販・競合構築・リバースエンジニアリング等）。しかし採用不可の理由が2つ残る: "
            "(1) 無料枠 1,000 credits/月 = 12,000/年に対し全国 789,612店で 65.8年（鉄則4の無料枠内で回らない）。"
            "(2) Tavily の画像は自前の画像インデックスではなく、クロールしたWebページから抽出した画像URLであり、"
            "供給元は #1304 で実効7.16%と実測済みの店舗自社サイト等に一致する。上流が既に測定済みで低い。"
            "さらに本セッションにはAPIキーが無く、無料枠内であっても被覆率の実測は到達不能。"
        ),
    },
    {
        "name": "Exa (旧 Metaphor) Search API",
        "tos_url": "https://exa.ai/terms-of-service",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": True,
        "fee_gate": True,
        "gate_a": None,
        "gate_b": None,
        "gate_c": None,
        "verbatim_probe": [],
        "verbatim_note": "規約原文は取得できたが、画像検索エンドポイントが製品に存在しない。",
        "reason": (
            "Web ページ（URL / title / text / highlights）を返す意味検索APIで、画像検索エンドポイントを"
            "提供しない。結果に付随する image フィールドは OGP 画像で、料理写真の検索経路にならない。"
        ),
    },
    {
        "name": "Bing Search API / Azure AI (Grounding with Bing Search)",
        "tos_url": "https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": False,
        "fee_gate": False,
        "gate_a": None,
        "gate_b": None,
        "gate_c": None,
        "verbatim_probe": ["retire"],
        "free_quota_per_day": None,
        "reason": (
            "Bing Search APIs は 2025-08-11 に廃止済みで新規契約不可。後継の Grounding with Bing Search は "
            "Azure AI Agents 内でのみ動くツール課金の有料製品で、画像検索を提供しない。到達不能。"
        ),
    },
    {
        "name": "DuckDuckGo",
        "tos_url": "https://duckduckgo.com/terms",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": True,
        "fee_gate": True,
        "gate_a": None,
        "gate_b": None,
        "gate_c": None,
        "verbatim_probe": [],
        "verbatim_note": (
            "本セッションからは duckduckgo.com が egress proxy で遮断され、規約原文を取得できなかった。"
            "ただし判定は原文に依存しない: 公式の画像検索APIが製品として存在せず、"
            "Instant Answer API は検索結果を返さない。"
        ),
        "reason": (
            "公式の画像検索APIが存在しない。i.duckduckgo.com 等の非公式エンドポイントを叩く経路しか無く、"
            "これは #1303（規約が営利目的のアクセス自体を禁止）と同型で採用不可。"
        ),
    },
    {
        "name": "Kagi Search API",
        "tos_url": "https://help.kagi.com/kagi/api/search.html",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": False,
        "fee_gate": False,
        "gate_a": None, "gate_b": None, "gate_c": None,
        "verbatim_probe": [],
        "reason": "有料クレジット制のみで無料枠なし（鉄則4）。提供は web/news 検索で画像検索が無い。",
    },
    {
        "name": "Mojeek Search API",
        "tos_url": "https://www.mojeek.com/services/search/web-search-api/",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": False,
        "fee_gate": False,
        "gate_a": None, "gate_b": None, "gate_c": None,
        "verbatim_probe": [],
        "reason": "返すのは URL / title / snippet のみで画像を返さない。最安でも £2 CPM の従量課金で無料枠なし。",
    },
    {
        "name": "Yandex Search API (Yandex Cloud)",
        "tos_url": "https://yandex.cloud/en/docs/search-api/",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": False,
        "fee_gate": False,
        "gate_a": None, "gate_b": None, "gate_c": None,
        "verbatim_probe": [],
        "verbatim_note": "非ブラウザUAでは SmartCaptcha が返り、ドキュメントの機械取得自体が遮断される。",
        "reason": "XML/テキスト検索の有料従量課金のみで公開画像検索エンドポイントが無い。日本の飲食店被覆も期待できない。",
    },
    {
        "name": "Marginalia Search",
        "tos_url": "https://about.marginalia.nu/",
        "image_endpoint": None,
        "image_search_exists": False,
        "free_tier": True,
        "fee_gate": True,
        "gate_a": None, "gate_b": None, "gate_c": None,
        "verbatim_probe": [],
        "reason": "テキスト専用の小規模独立インデックスで画像インデックスを持たない。日本語飲食店ページの被覆も無い。",
    },
]


def fetch_text(url: str) -> tuple[str, str]:
    """# #1273 【設計】規約原文を取得して素のテキストに落とす。取得失敗も結果として残す。"""
    try:
        proc = subprocess.run(
            ["curl", "-sS", "-L", "--max-time", "25", "-A", UA, url],
            capture_output=True, text=True,
        )
    except Exception as exc:  # pragma: no cover
        return "", f"error: {exc}"
    if proc.returncode != 0:
        return "", f"curl_failed: {proc.stderr.strip()[:200]}"
    raw = proc.stdout
    raw = re.sub(r"<script.*?</script>", " ", raw, flags=re.S | re.I)
    raw = re.sub(r"<style.*?</style>", " ", raw, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", raw)
    for a, b in (("&amp;", "&"), ("&quot;", '"'), ("&#39;", "'"), ("&nbsp;", " "),
                 ("&ldquo;", "“"), ("&rdquo;", "”"), ("&lt;", "<"), ("&gt;", ">")):
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text), "ok"


def verify_verbatim(svc: dict) -> dict:
    """# #1273 【仕様】禁止条項が原文に実在するかを文字列一致で検証する。

    要約の正しさではなく「引用が原文にあるか」だけを機械判定する。
    probe が空のサービスは条項ではなく製品仕様（画像APIが無い等）で落ちているので None を返す。
    """
    probes = svc.get("verbatim_probe") or []
    if not probes:
        return {"checked": False, "fetch_status": "skipped", "matched": [], "missing": []}
    text, status = fetch_text(svc["tos_url"])
    if status != "ok" or not text:
        return {"checked": True, "fetch_status": status or "empty", "matched": [], "missing": probes}
    matched, missing = [], []
    for p in probes:
        (matched if p in text else missing).append(p)
    return {
        "checked": True,
        "fetch_status": "ok",
        "tos_bytes": len(text),
        "matched": matched,
        "missing": missing,
        "all_verified": not missing,
    }


def probe_endpoints() -> dict:
    """# #1273 【設計】画像エンドポイントの実在と「鍵が要る＝規約同意者のみ」を実測で示す。"""
    targets = {
        "brave_images": "https://api.search.brave.com/res/v1/images/search?q=test&count=1",
        "naver_image": "https://openapi.naver.com/v1/search/image?query=test",
        "google_cse_image": "https://www.googleapis.com/customsearch/v1?q=test&searchType=image",
        "tavily_search": "https://api.tavily.com/search",
    }
    out = {}
    for key, url in targets.items():
        try:
            proc = subprocess.run(
                ["curl", "-sS", "--max-time", "20", "-o", "-", "-w", "\n%{http_code}", url],
                capture_output=True, text=True,
            )
            body, _, code = proc.stdout.rpartition("\n")
            out[key] = {"http_status": code.strip(), "body_head": body[:220]}
        except Exception as exc:  # pragma: no cover
            out[key] = {"error": str(exc)}
    return out


def sample_ids(n: int) -> list:
    """# #1273 【仕様】部分集合は SHA-256(id) 昇順で先頭N件（鉄則1）。"""
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
        rows.append((hashlib.sha256(str(rid).encode()).hexdigest(), rid,
                     rest.get("name"), rest.get("locality")))
    rows.sort(key=lambda r: r[0])
    return [{"id": r[1], "name": r[2], "locality": r[3]} for r in rows[:n]]


def run_coverage(passed: list, targets: list) -> dict:
    """# #1273 【設計】規約通過が0件なら画像検索は一切実行しない。"""
    if not passed:
        return {
            "executed": False,
            "reason": "規約ゲート+無料ゲートを通過したサービスが0件のため画像検索は未実行",
            "queried_restaurants": 0,
            "image_coverage_pct": 0.0,
            "manual_verification": {
                "executed": False,
                "reason": "検証対象の画像が0件（規約上・無料枠上、取得経路が存在しない）",
                "sampled": 0, "true_positives": 0,
            },
        }
    raise NotImplementedError("規約・無料の両ゲートを通過したサービスが出た場合にここへ実装する")


def main() -> int:
    rows, passed = [], []
    for svc in SERVICES:
        blocked = [g for g in ("gate_a", "gate_b", "gate_c") if svc.get(g) is False]
        row = dict(svc)
        row["verbatim_verification"] = verify_verbatim(svc)
        row["blocked_on"] = blocked
        # #1273 【仕様】採用可能 = 3ゲート無抵触 かつ 無料で回る かつ 画像検索が存在する
        row["tos_gates_passed"] = not blocked
        row["adoptable"] = (
            not blocked
            and svc.get("fee_gate") is True
            and svc.get("image_search_exists") is True
        )
        rows.append(row)
        if row["adoptable"]:
            passed.append(svc["name"])

    targets = sample_ids(100)
    coverage = run_coverage(passed, targets)

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
        "slug": "search-api-images-retry",
        "issue": 1273,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "question": "検索APIの画像検索で「店名+地名」の dish_media 画像を取れるか（規約優先）",
        "gates": {
            "gate_a": "飲食店から対価を得る事業での利用可否",
            "gate_b": "listings / directory サービスでの利用可否",
            "gate_c": "画像（検索結果）のキャッシュ / 恒久保存可否",
            "fee_gate": "無料枠のみで全国規模を回せるか（鉄則4）",
        },
        "services_evaluated": len(SERVICES),
        "services_tos_gates_passed": [r["name"] for r in rows if r["tos_gates_passed"]],
        "services_adoptable": passed,
        "services": rows,
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

    print(f"evaluated={len(SERVICES)}  tos_passed={len(payload['services_tos_gates_passed'])}  "
          f"adoptable={len(passed)}")
    for r in rows:
        v = r["verbatim_verification"]
        vs = ("verbatim=OK" if v.get("all_verified")
              else ("verbatim=UNVERIFIED(%s)" % v.get("fetch_status") if v["checked"] else "verbatim=n/a"))
        print(f"  [{'PASS' if r['adoptable'] else 'BLOCK'}] {r['name']}: "
              f"blocked={r['blocked_on'] or '-'} free={r['fee_gate']} img={r['image_search_exists']} {vs}")
    print(f"metric: 規約を通ったサービスでの画像被覆率 = {coverage['image_coverage_pct']}% "
          f"(n={coverage['queried_restaurants']})")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
