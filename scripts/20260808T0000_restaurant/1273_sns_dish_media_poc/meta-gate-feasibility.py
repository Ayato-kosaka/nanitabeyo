#!/usr/bin/env python3
"""#1273 Meta ゲートの実務要件確定（一次資料調査 + 実機プローブ）

# #1273 【設計】これは技術PoCではなく「投資判断のための要件確定」である。
# 既知の socials 91.3% が本当に dish_media になりうるのかを、
#   (a) 同一600店サンプルでの FB / IG 内訳の実測
#   (b) 無認証での Meta oEmbed 実機プローブ（レスポンスに媒体URLが含まれるか）
# の2点で確定させる。
"""

import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

BASE = Path(__file__).resolve().parent
OUT = BASE / "out" / "meta-gate-feasibility.json"
OVERTURE = "/tmp/overture-jp.parquet"
SAMPLE = BASE / "out" / "supply_ceiling_2026-08-13.json"
GRAPH = "https://graph.facebook.com/v23.0"


def load_sample_ids():
    """# #1273 【仕様】カバレッジは必ず同一600店サンプルで測る（鉄則1）。"""
    d = json.loads(SAMPLE.read_text())
    res = d["results"] if isinstance(d, dict) and "results" in d else d
    rows = [(r["restaurant"]["id"], r["restaurant"].get("name", "")) for r in res]
    # 部分集合が要るときは SHA-256(id) 昇順で先頭N件（鉄則1）
    rows.sort(key=lambda t: hashlib.sha256(t[0].encode()).hexdigest())
    return rows


def measure_socials_split(ids):
    """# #1273 【設計】91.3%の socials が FB と IG のどちらに寄っているかが本質。
    IG は business_discovery で到達しうるが、FB は Page Public Content Access
    （App Review + Business Verification 必須）が無いと投稿を1件も読めない。
    """
    import duckdb

    con = duckdb.connect()
    con.execute("CREATE TEMP TABLE s(id VARCHAR)")
    con.executemany("INSERT INTO s VALUES (?)", [(i,) for i in ids])
    q = f"""
    SELECT count(*) AS matched,
      sum(CASE WHEN socials IS NOT NULL AND len(socials)>0 THEN 1 ELSE 0 END) AS any_social,
      sum(CASE WHEN list_contains(list_transform(coalesce(socials,[]), x-> contains(x,'facebook.com')),true)
               THEN 1 ELSE 0 END) AS facebook,
      sum(CASE WHEN list_contains(list_transform(coalesce(socials,[]), x-> contains(x,'instagram.com')),true)
               THEN 1 ELSE 0 END) AS instagram
    FROM read_parquet('{OVERTURE}') o JOIN s ON o.id = s.id
    """
    matched, any_s, fb, ig = con.execute(q).fetchone()
    # 目視精度検証用に実URLも取り出す
    q2 = f"""
    SELECT o.id, o.names.primary AS name, o.socials
    FROM read_parquet('{OVERTURE}') o JOIN s ON o.id = s.id
    WHERE list_contains(list_transform(coalesce(o.socials,[]), x-> contains(x,'facebook.com')),true)
    """
    fb_rows = con.execute(q2).fetchall()
    fb_rows.sort(key=lambda r: hashlib.sha256(r[0].encode()).hexdigest())
    return {
        "n": len(ids),
        "matched_in_overture": matched,
        "any_social": any_s,
        "facebook": fb,
        "instagram": ig,
        "any_social_pct": round(100.0 * any_s / len(ids), 2),
        "facebook_pct": round(100.0 * fb / len(ids), 2),
        "instagram_pct": round(100.0 * ig / len(ids), 2),
    }, fb_rows


def curl_json(url, timeout=25):
    try:
        p = subprocess.run(["curl", "-sS", "-m", str(timeout), url],
                           capture_output=True, text=True)
        return json.loads(p.stdout)
    except Exception as e:  # noqa: BLE001
        return {"_error": str(e)}


def probe_oembed(fb_rows, k=12):
    """# #1273 【バグ】REPORT.md の「oEmbedは審査必須(OAuthException #10)」は現行では再現しない。
    2026-06 の Meta のトークンレス化により無認証で200が返る。ただし返るのは
    埋め込みHTMLのみで、画像URL/サムネイル/キャプションのフィールドは含まれない。
    → dish_media（自社DBに保存してランキングする媒体アセット）には成立しない。
    """
    results = []
    for rid, name, socials in fb_rows[:k]:
        page = next((s for s in socials if "facebook.com" in s), None)
        if not page:
            continue
        url = f"{GRAPH}/oembed_page?url={urllib.parse.quote(page, safe='')}"
        j = curl_json(url)
        ok = "html" in j
        results.append({
            "restaurant_id": rid,
            "name": name,
            "page_url": page,
            "http_ok": ok,
            "error_code": (j.get("error") or {}).get("code") if not ok else None,
            # dish_media に必要なフィールドが1つでもあるか
            "has_thumbnail_url": "thumbnail_url" in j,
            "has_media_url": any(kk in j for kk in ("thumbnail_url", "url", "image")),
            "returned_fields": sorted(j.keys()),
        })
        time.sleep(0.3)
    return results


def probe_gated_endpoints():
    """# #1273 【仕様】審査ゲートが現存する経路を実機で確認する。"""
    probes = {}
    # business_discovery: IG ユーザートークン必須（無認証では 2500）
    probes["business_discovery_tokenless"] = curl_json(
        f"{GRAPH}/me?fields=business_discovery.username(kurasushi.jp)%7Bfollowers_count%7D")
    # instagram_oembed: 実在する公開投稿（無認証）
    probes["instagram_oembed_tokenless"] = {
        k: v for k, v in curl_json(
            f"{GRAPH}/instagram_oembed?url="
            + urllib.parse.quote("https://www.instagram.com/p/BsOGulcndj-/", safe="")
            + "&omitscript=true").items() if k != "html"
    }
    # Page Feed（PPCA が要る経路）を無認証で叩く
    probes["page_feed_tokenless"] = curl_json(f"{GRAPH}/facebook/posts?limit=1")
    return probes


def main():
    rows = load_sample_ids()
    ids = [r[0] for r in rows]
    split, fb_rows = measure_socials_split(ids)
    oembed = probe_oembed(fb_rows)
    gated = probe_gated_endpoints()

    usable = sum(1 for r in oembed if r["has_media_url"])
    out = {
        "slug": "meta-gate-feasibility",
        "sample": {"n": len(ids), "source": str(SAMPLE.name)},
        "socials_split_600": split,
        "oembed_page_probe": {
            "n": len(oembed),
            "http_200": sum(1 for r in oembed if r["http_ok"]),
            "with_usable_media_url": usable,
            "precision_true_positive_for_dish_media": usable,
            "detail": oembed,
        },
        "gated_endpoint_probe": gated,
        "primary_sources": {
            "page_public_content_access": (
                "The Page Public Content Access feature allows an app access to the Pages "
                "Search API and to read public data for Pages ... This permission or feature "
                "is only available with business verification."),
            "meta_oembed_read": (
                "Requires App Review. ... Allowed Usage: To provide front-end views of public "
                "Facebook and Instagram pages, posts, and videos. ... only available with "
                "business verification."),
            "instagram_public_content_access": (
                "allows your app to access Instagram Graph API's Hashtag Search endpoints ... "
                "only available with business verification."),
            "business_verification_legal_entity": (
                "Ensure your business is a legal entity. Your business needs to be registered "
                "with local authorities and you'll need an official phone number or mailing "
                "address for your business."),
            "moj_godo_kaisha": (
                "合同会社の設立登記の登録免許税額は、資本金の額に１０００分の７を乗じた金額です。"
                "ただし、これによって計算した税額が６万円に満たないときは、申請件数１件につき６万円です。"
                " / なお、合同会社の定款については、公証人の認証を受ける必要はありません。"),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(json.dumps({k: v for k, v in out.items() if k != "primary_sources"},
                     ensure_ascii=False, indent=2)[:3000])


if __name__ == "__main__":
    sys.exit(main())
