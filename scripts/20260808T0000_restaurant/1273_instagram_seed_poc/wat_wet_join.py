"""#1273 打開策①強化（オーナー案）: WAT(リンク) と WET(本文) を同一セグメントで JOIN。

同じ crawl の wat/00048 と wet/00048 は «同じページ集合» を含む。
- WAT から: instagram アカウントリンク + そのページ URL
- WET から: そのページの本文テキスト
URL で JOIN すると «このページは @handle にリンクし、本文に 焼鳥/恵比寿/店名 がある» が得られ、
アカウント → 店 の対応（route①の拡張）や、周辺テキストでの店特定ができる。

測るもの: instagram アカウントを貼る日本語ページのうち、本文に飲食×店名シグナルが
どれだけあるか（＝WETで店を当てられる率）。
"""
import gzip, io, json, os, re, sys, tempfile, urllib.request, zlib
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"out")
UA="nanitabeyo/1.0"; CRAWL="CC-MAIN-2026-34"
PROFILE=re.compile(r"instagram\.com/([A-Za-z0-9_.]{2,30})")
BAD={"p","reel","reels","tv","explore","accounts","stories","about","developer","legal","embed","embed.js"}
DISH=re.compile(r"(ラーメン|寿司|鮨|焼肉|焼き鳥|焼鳥|カレー|そば|うどん|天ぷら|うなぎ|餃子|とんかつ|定食|居酒屋|食堂|喫茶|カフェ|レストラン|ランチ|ディナー|ビストロ|バル|グルメ|料理|絶品|名物|コース)")
STORENAME=re.compile(r"([ぁ-んァ-ヶ一-龠A-Za-z0-9]{2,18}(?:店|食堂|亭|軒|寿司|鮨|ラーメン|らーめん|カフェ|珈琲|キッチン|ダイニング))")
def get(url,rng=None,timeout=600):
    req=urllib.request.Request(url,headers={"User-Agent":UA})
    if rng: req.add_header("Range",f"bytes={rng[0]}-{rng[1]}")
    with urllib.request.urlopen(req,timeout=timeout) as r: return r.read()
def dl(path):
    tmp=os.path.join(tempfile.gettempdir(),path.split("/")[-1])
    open(tmp,"wb").write(get(f"https://data.commoncrawl.org/{path}"))
    return tmp
def main():
    wat_paths=gzip.decompress(get(f"https://data.commoncrawl.org/crawl-data/{CRAWL}/wat.paths.gz")).decode().splitlines()
    import random; random.seed(11)
    watp=random.choice(wat_paths)
    wetp=watp.replace("/wat/","/wet/").replace(".warc.wat.gz",".warc.wet.gz")
    print("WAT:",watp.split("/")[-1]); print("WET:",wetp.split("/")[-1],flush=True)
    # 1) WAT: 日本語ページ → instagram アカウント
    wat=dl(watp); page2acct={}
    with gzip.open(wat,"rb") as gz:
        cur=None
        for line in gz:
            if line.startswith(b"WARC-Target-URI:"):
                u=line.decode("utf-8","replace").split(":",1)[1].strip()
                cur=u if ".jp" in u else None
            elif cur and b"instagram.com/" in line:
                for m in PROFILE.finditer(line.decode("utf-8","replace")):
                    h=m.group(1).lower().strip(".")
                    if h not in BAD and not h.isdigit() and len(h)>=2:
                        page2acct.setdefault(cur,set()).add(h)
    os.remove(wat)
    print(f"instagram を貼る日本語ページ: {len(page2acct)}",flush=True)
    target=set(page2acct.keys())
    # 2) WET: それらページの本文
    wet=dl(wetp); joined=[]
    with gzip.open(wet,"rb") as gz:
        rec=[]; uri=None
        def flush(uri,rec):
            if uri in target:
                text=" ".join(x.decode("utf-8","replace") for x in rec)
                food=bool(DISH.search(text)); names=STORENAME.findall(text)
                joined.append({"url":uri,"accounts":sorted(page2acct[uri])[:3],
                               "food":food,"store_names":list(dict.fromkeys(names))[:5],
                               "text_len":len(text)})
        for line in gz:
            if line.startswith(b"WARC-Target-URI:"):
                if uri is not None: flush(uri,rec)
                uri=line.decode("utf-8","replace").split(":",1)[1].strip(); rec=[]
            else: rec.append(line)
        if uri is not None: flush(uri,rec)
    os.remove(wet)
    food=[j for j in joined if j["food"]]
    withname=[j for j in joined if j["store_names"]]
    summ={"wat_ig_pages":len(page2acct),"joined_with_wet":len(joined),
          "pages_food_text":len(food),"pages_with_store_name":len(withname),
          "food_pct_of_joined":round(100*len(food)/max(len(joined),1),1),
          "store_name_pct_of_food":round(100*len([j for j in food if j["store_names"]])/max(len(food),1),1)}
    print(json.dumps(summ,ensure_ascii=False,indent=2))
    json.dump({"summary":summ,"examples":[j for j in food if j["store_names"]][:20]},
              open(f"{OUT}/wat_wet_join.json","w"),ensure_ascii=False,indent=2)
if __name__=="__main__": main()
