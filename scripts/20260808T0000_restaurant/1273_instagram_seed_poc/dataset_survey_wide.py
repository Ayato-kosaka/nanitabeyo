"""#1273 4.20 打開策: 「日本の飲食店の Instagram 投稿 URL 一覧」を、探せる先を全部当たって探す。

一度目の調査（dataset_survey.py）は Kaggle / Zenodo / Hugging Face / GitHub の 4 箇所で
0 件だった。ここでは **研究データの meta-index（DataCite）** と、
一度目に見ていなかった配布先を足す。DataCite は Zenodo / figshare / Dryad / 大学リポジトリを
横断で引けるので、個別に当たるより漏れが少ない。

日本語圏の受け皿（NII IDR / 情報学研究データリポジトリ）は API が無いので、
到達可否と一覧ページの中身を記録する。
"""
import json
import os
import time
import urllib.parse
import urllib.request

UA = "nanitabeyo-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
QUERIES = ["instagram", "instagram posts", "instagram urls", "instagram japan",
           "instagram restaurant", "instagram food", "social media japan restaurant",
           "japanese restaurant reviews", "gourmet japan dataset"]


def get(url, headers=None, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get_json(url, headers=None):
    return json.loads(get(url, headers))


def datacite():
    """研究データの meta-index。Zenodo / figshare / Dryad / 大学リポジトリを横断で引ける。"""
    rows, seen = [], set()
    for q in QUERIES:
        u = ("https://api.datacite.org/dois?query=" + urllib.parse.quote(q)
             + "&resource-type-id=dataset&page[size]=100")
        try:
            d = get_json(u)
        except Exception as e:
            rows.append({"query": q, "error": str(e)[:120]}); continue
        for x in d.get("data", []):
            a = x.get("attributes", {})
            doi = a.get("doi")
            if doi in seen:
                continue
            seen.add(doi)
            titles = " / ".join(t.get("title", "") for t in a.get("titles", []))
            rows.append({
                "source": "datacite", "query": q, "doi": doi,
                "title": titles[:180],
                "rights": [r.get("rightsIdentifier") or r.get("rights") for r in a.get("rightsList", [])],
                "publisher": (a.get("publisher") or {}).get("name") if isinstance(a.get("publisher"), dict) else a.get("publisher"),
                "year": a.get("publicationYear"),
                "url": a.get("url"),
            })
        time.sleep(1)
    return rows


def openml():
    try:
        d = get_json("https://www.openml.org/api/v1/json/data/list/limit/1000")
        ds = d.get("data", {}).get("dataset", [])
        hits = [x for x in ds if "instagram" in (x.get("name", "") or "").lower()]
        return {"listed": len(ds), "instagram_hits": [x.get("name") for x in hits]}
    except Exception as e:
        return {"error": str(e)[:160]}


def reachability():
    """API が無い配布先は、到達可否と検索結果ページの手応えだけ記録する。"""
    targets = {
        "figshare_api": "https://api.figshare.com/v2/articles/search",
        "osf_api": "https://api.osf.io/v2/nodes/?filter[title]=instagram&page[size]=20",
        "dataworld": "https://data.world/search?q=instagram",
        "academictorrents": "https://academictorrents.com/browse.php?search=instagram",
        "aws_open_data": "https://api.github.com/repos/awslabs/open-data-registry/contents/datasets",
        "nii_idr": "https://www.nii.ac.jp/dsc/idr/datalist.html",
        "archive_org_scrape": "https://archive.org/services/search/beta/page_production/scrape.json?q=instagram+dataset&count=50",
        "google_dataset_search": "https://datasetsearch.research.google.com/search?query=instagram",
    }
    out = {}
    for name, u in targets.items():
        try:
            b = get(u, timeout=60)
            out[name] = {"status": 200, "bytes": len(b),
                         "instagram_mentions": b.lower().count(b"instagram")}
        except Exception as e:
            out[name] = {"error": str(e)[:140]}
    return out


def main():
    res = {"datacite": datacite(), "openml": openml(), "reachability": reachability()}
    json.dump(res, open(f"{OUT}/dataset_survey_wide.json", "w"), ensure_ascii=False, indent=2)

    dc = [r for r in res["datacite"] if "doi" in r]
    ig = [r for r in dc if "instagram" in (r["title"] or "").lower()]
    jp = [r for r in ig if any(k in (r["title"] or "").lower()
                               for k in ("japan", "japanese", "tokyo", "日本"))]
    food = [r for r in ig if any(k in (r["title"] or "").lower()
                                 for k in ("food", "restaurant", "gourmet", "dining", "cuisine", "cafe"))]
    print(f"DataCite: 一意 {len(dc)} 件 / 題名に instagram {len(ig)} 件 / 日本 {len(jp)} 件 / 飲食 {len(food)} 件")
    for r in ig[:40]:
        print(f"  [{r['rights']}] {r['title'][:110]}")
    print("\nOpenML:", json.dumps(res["openml"], ensure_ascii=False)[:300])
    print("\n到達可否:")
    for k, v in res["reachability"].items():
        print(f"  {k}: {json.dumps(v, ensure_ascii=False)[:130]}")


if __name__ == "__main__":
    main()
