"""#1273 経路② 無料の柱: グルメインフルエンサーの handle を公開リストから抽出する。

サブエージェント調査で「◯選」「エリア別」記事から @handle が機械抽出できると実測。
ここではその記事群を実際に取得し、instagram.com/{handle} を集めて重複除去する。
これが business_discovery の入力（無料で各人の数百投稿 → 店名つきキャプション）になる。
"""
import json, os, re, sys, time, urllib.request
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"out")
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
SOURCES=[
  "https://cevsty.com/gourmet-marketing-creator-instagram-account/",
  "https://find-model.jp/insta-lab/influencers-gourmet/",
  "https://otomo.join-up.co.jp/instagram-gourmet/",
  "https://influencer-company.info/influencer-column/influencer-gourmet/",
  "https://star-inc.co/topics/409/",
  "https://media-radar.jp/contents/meditsubu/columns6-gourmetinfluencer/",
]
# instagram.com/{handle} を拾う。投稿/リール/固定パスは除外
HANDLE=re.compile(r"instagram\.com/([A-Za-z0-9_.]{2,30})/?", re.I)
BAD={"p","reel","reels","tv","explore","accounts","stories","about","developer",
     "legal","directory","web","instagram","help","privacy","terms"}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":UA}),timeout=40).read().decode("utf-8","replace")
def main():
    handles={}  # handle -> [sources]
    persrc={}
    for u in SOURCES:
        try: h=get(u)
        except Exception as e:
            persrc[u]=f"ERR {str(e)[:50]}"; print("  ERR",u,str(e)[:40],flush=True); continue
        found=set()
        for m in HANDLE.finditer(h):
            hd=m.group(1).lower().strip(".")
            if hd in BAD or hd.isdigit() or "." in hd and hd.split(".")[0] in BAD: continue
            if len(hd)<2: continue
            found.add(hd)
        for hd in found: handles.setdefault(hd,[]).append(u.split("/")[2])
        persrc[u]=len(found)
        print(f"  {u.split('/')[2]}: {len(found)} handles", flush=True)
        time.sleep(1)
    out={"total_distinct_handles":len(handles),"per_source":persrc,
         "handles":sorted(handles.keys()),
         "multi_source_handles":[h for h,s in handles.items() if len(set(s))>=2]}
    print(json.dumps({"total":out["total_distinct_handles"],
                      "per_source":persrc,
                      "multi_source":len(out["multi_source_handles"]),
                      "sample":out["handles"][:30]},ensure_ascii=False,indent=2))
    json.dump(out, open(f"{OUT}/influencer_handles.json","w"), ensure_ascii=False, indent=2)
if __name__=="__main__": main()
