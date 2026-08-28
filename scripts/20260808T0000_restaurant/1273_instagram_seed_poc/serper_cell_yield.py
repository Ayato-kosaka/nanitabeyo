"""#1273 4.11 本測定: `site:instagram.com/p <カテゴリ> <地域>` の 108 セル歩留まり。

セル設計は #1273 §15 に合わせる（18 カテゴリ × 6 地域タイプ）。
成功条件も §32 に合わせ「1 セルにつき異なる店 5 店以上」を見る。

Serper の free tier で分かっていること（実測）:
- `site:` 演算子は使える。`num` を 10 より大きくすると 0 件になる
- `page` は 10 まで有効。8 ページ目あたりで index が尽きる
- 1 リクエスト = 1 credit

SERPER_API_KEY を環境変数で渡す。キーはコミットしない。
"""
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

CATEGORIES = {
    "high": ["ラーメン", "寿司", "焼肉", "カレー", "パスタ", "ハンバーガー"],
    "mid": ["とんかつ", "お好み焼き", "天ぷら", "餃子", "タコス", "ステーキ"],
    "tail": ["うなぎ", "ジンギスカン", "ふぐ", "沖縄そば", "ビリヤニ", "ネパール料理"],
}
AREAS = [
    ("超高密度都市", "渋谷"),
    ("大都市中心部", "大阪 難波"),
    ("大都市郊外", "町田"),
    ("地方政令市", "仙台"),
    ("地方中核市", "高松"),
    ("郊外", "五所川原"),
]
POST_RE = re.compile(r"instagram\.com/(p|reel|tv)/([A-Za-z0-9_-]+)")
# Serper の title は「<アカウント名> on Instagram: "<キャプション>"」の形になることがある。
ACCOUNT_RE = re.compile(r"^(.{1,40}?)\s+on Instagram")


def search(key, q, page):
    body = json.dumps({"q": q, "gl": "jp", "hl": "ja", "page": page}).encode()
    req = urllib.request.Request(
        "https://google.serper.dev/search", data=body,
        headers={"X-API-KEY": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main():
    key = os.environ["SERPER_API_KEY"]
    pages = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    cells, credits = [], 0
    for tier, cats in CATEGORIES.items():
        for cat in cats:
            for area_type, area in AREAS:
                q = f"site:instagram.com/p {cat} {area}"
                posts, accounts, organic = {}, set(), []
                for page in range(1, pages + 1):
                    try:
                        d = search(key, q, page)
                    except Exception as e:
                        print(f"  ERR {q} p{page}: {str(e)[:90]}", flush=True)
                        break
                    credits += 1
                    for x in d.get("organic", []):
                        organic.append({"link": x.get("link"), "title": x.get("title")})
                        m = POST_RE.search(x.get("link", ""))
                        if m:
                            posts[m.group(2)] = x.get("title", "")
                        a = ACCOUNT_RE.match(x.get("title") or "")
                        if a:
                            accounts.add(a.group(1).strip())
                    time.sleep(0.2)
                cells.append({
                    "tier": tier, "category": cat, "area_type": area_type, "area": area,
                    "query": q, "pages": pages,
                    "organic": len(organic), "unique_posts": len(posts),
                    "named_accounts": len(accounts), "accounts": sorted(accounts),
                    "results": organic,
                })
                print(f"  [{tier}] {cat} x {area}: posts={len(posts)} accounts={len(accounts)}"
                      f" credits={credits}", flush=True)

    summ = {"pages_per_cell": pages, "cells": len(cells), "credits_used": credits}
    for tier in CATEGORIES:
        t = [c for c in cells if c["tier"] == tier]
        summ[f"{tier}_mean_unique_posts"] = round(sum(c["unique_posts"] for c in t) / len(t), 2)
        summ[f"{tier}_cells_with_5plus_posts"] = sum(1 for c in t if c["unique_posts"] >= 5)
    for at, _ in AREAS:
        a = [c for c in cells if c["area_type"] == at]
        summ[f"area:{at}_mean_unique_posts"] = round(sum(c["unique_posts"] for c in a) / len(a), 2)
    print(json.dumps(summ, ensure_ascii=False, indent=2))
    json.dump({"summary": summ, "cells": cells},
              open(f"{OUT}/serper_cell_yield.json", "w"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
