"""#1273 4.20 「ライセンス不明の公開データセット」を、ライセンスが分かる形で棚卸しする。

仕様書は Kaggle / GitHub / 研究用 dump を挙げているが、**判定に必要なのは
「明確な商用ライセンスと provenance があるか」**である。したがってライセンス
メタデータを機械可読で持っている先（Zenodo / Hugging Face）を優先して当たり、
無記名では検索できない先（Kaggle）は到達可否そのものを記録する。
"""
import json
import os
import time
import urllib.parse
import urllib.request

UA = "nanitabeyo-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
QUERIES = [
    "instagram", "instagram post url", "instagram japan", "instagram restaurant",
    "instagram food", "instagram shortcode", "instagram permalink", "instagram scraping",
    "japanese restaurant instagram", "gourmet japan social media",
]


def fetch(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def zenodo():
    rows = []
    for q in QUERIES:
        u = ("https://zenodo.org/api/records?q=" + urllib.parse.quote(q)
             + "&size=25&type=dataset&sort=mostrecent")
        try:
            d = fetch(u)
        except Exception as e:
            rows.append({"query": q, "error": str(e)[:120]})
            continue
        for h in d.get("hits", {}).get("hits", []):
            md = h.get("metadata", {})
            rows.append({
                "source": "zenodo", "query": q, "id": h.get("id"),
                "title": (md.get("title") or "")[:160],
                "license": ((md.get("license") or {}).get("id")
                            or (md.get("license") or {}).get("identifier")),
                "publication_date": md.get("publication_date"),
                "url": h.get("links", {}).get("self_html") or h.get("doi_url"),
            })
        time.sleep(1)
    return rows


def huggingface():
    tok = os.environ.get("HF_TOKEN")
    hdr = {"Authorization": f"Bearer {tok}"} if tok else {}
    rows = []
    for q in QUERIES:
        u = ("https://huggingface.co/api/datasets?search=" + urllib.parse.quote(q)
             + "&limit=50&full=false")
        try:
            d = fetch(u, hdr)
        except Exception as e:
            rows.append({"query": q, "error": str(e)[:120]})
            continue
        for x in d:
            tags = x.get("tags", [])
            rows.append({
                "source": "huggingface", "query": q, "id": x.get("id"),
                "license": next((t.split(":", 1)[1] for t in tags if t.startswith("license:")), None),
                "downloads": x.get("downloads"), "gated": x.get("gated"),
                "lang": [t for t in tags if t.startswith("language:")],
            })
        time.sleep(0.5)
    return rows


def kaggle_reachable():
    out = {}
    for name, u in [
        ("kaggle_api_list", "https://www.kaggle.com/api/v1/datasets/list?search=instagram"),
        ("kaggle_site", "https://www.kaggle.com/datasets?search=instagram"),
    ]:
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                out[name] = {"status": r.status, "bytes": len(r.read(2000))}
        except Exception as e:
            out[name] = {"error": str(e)[:160]}
    return out


def main():
    result = {
        "zenodo": zenodo(),
        "huggingface": huggingface(),
        "kaggle": kaggle_reachable(),
    }
    with open(f"{OUT}/dataset_survey.json", "w") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    z = [r for r in result["zenodo"] if "id" in r]
    h = [r for r in result["huggingface"] if "id" in r]
    zu = {r["id"]: r for r in z}
    hu = {r["id"]: r for r in h}
    print(f"zenodo hits (unique): {len(zu)}  with_license: {sum(1 for r in zu.values() if r['license'])}")
    print(f"huggingface hits (unique): {len(hu)}  with_license: {sum(1 for r in hu.values() if r['license'])}")
    print("kaggle:", json.dumps(result["kaggle"], ensure_ascii=False))
    print("\n-- zenodo, license あり --")
    for r in list(zu.values()):
        if r["license"]:
            print(f"  [{r['license']}] {r['title'][:90]}")
    print("\n-- huggingface, license あり --")
    for r in hu.values():
        if r["license"]:
            print(f"  [{r['license']}] {r['id']}  dl={r['downloads']} gated={r['gated']}")


if __name__ == "__main__":
    main()
