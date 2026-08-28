"""#1273 検証: WAT の instagram 投稿を «元ページのドメイン» で層別し、飲食率が上がるかを見る。

オーナー案『WET で周辺テキストを解析』の軽量版。まず «どのサイトが instagram 投稿を
貼っているか» を集め、ドメインごとに embed で飲食率を測る。特定ドメイン（食メディア・
食ブログ）に飲食が集中するなら、そのドメイン allowlist が『無料の飲食発見源』になる。
"""
import gzip, html, io, json, os, re, sys, time, urllib.request, tempfile
from collections import defaultdict, Counter
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"out")
UA="nanitabeyo/1.0"; CRAWL="CC-MAIN-2026-34"
POST=re.compile(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]{5,})")
DISH=re.compile(r"(ラーメン|寿司|鮨|焼肉|焼き鳥|焼鳥|カレー|そば|うどん|天ぷら|うなぎ|鰻|餃子|とんかつ|ハンバーグ|ステーキ|定食|海鮮|丼|パスタ|ピザ|居酒屋|バル|ビストロ|食堂|喫茶店|レストラン|コース料理|ランチ|ディナー|飲み放題|食べ放題|名物料理|お通し|日本酒|クラフトビール|ワインバー|焼き菓子|スイーツ|パン屋|ベーカリー|甘味)")
def get(url, timeout=120):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent":UA}), timeout=timeout).read()
def collect(n_files):
    paths=gzip.decompress(get(f"https://data.commoncrawl.org/crawl-data/{CRAWL}/wat.paths.gz")).decode().splitlines()
    import random; random.seed(7); random.shuffle(paths)
    posts={}  # code -> source host
    for p in paths[:n_files]:
        tmp=os.path.join(tempfile.gettempdir(),"wd_"+p.split("/")[-1])
        try: open(tmp,"wb").write(get(f"https://data.commoncrawl.org/{p}", timeout=600))
        except Exception as e: print("dl fail",str(e)[:40],flush=True); continue
        cur=None
        try:
            with gzip.open(tmp,"rb") as gz:
                for line in gz:
                    if line.startswith(b"WARC-Target-URI:"):
                        u=line.decode("utf-8","replace").split(":",1)[1].strip()
                        cur=u if (".jp" in u) else None
                    elif cur and b"instagram.com/" in line:
                        m=POST.search(line.decode("utf-8","replace"))
                        if m:
                            host=re.sub(r"^https?://","",cur).split("/")[0].replace("www.","")
                            posts.setdefault(m.group(1), host)
        except Exception: pass
        finally:
            try: os.remove(tmp)
            except: pass
        print(f"  collected {len(posts)} (files done, host種 {len(set(posts.values()))})", flush=True)
    return posts
def embed_food(code):
    try:
        h=get(f"https://www.instagram.com/p/{code}/embed/captioned/", timeout=25).decode("utf-8","replace")
    except Exception: return None
    m=re.search(r'class="Caption"(.*?)</div>', h, re.S)
    cap=html.unescape(re.sub(r'<[^>]+>',' ',m.group(1))) if m else ""
    return bool(DISH.search(cap)), cap[:100]
def main():
    n_files=int(sys.argv[1]) if len(sys.argv)>1 else 3
    sample_per=int(sys.argv[2]) if len(sys.argv)>2 else 120
    posts=collect(n_files)
    host_count=Counter(posts.values())
    items=list(posts.items())
    import random; random.seed(7); random.shuffle(items)
    items=items[:sample_per]
    byhost=defaultdict(lambda:[0,0])  # host -> [food, total]
    food=0; ok=0; examples=[]
    for i,(code,host) in enumerate(items):
        r=embed_food(code)
        if r is None: continue
        isfood,cap=r; ok+=1
        byhost[host][1]+=1
        if isfood:
            food+=1; byhost[host][0]+=1
            examples.append({"host":host,"cap":cap})
        time.sleep(0.25)
        if (i+1)%30==0: print(f"  enrich {i+1}/{len(items)} food={food}/{ok}", flush=True)
    top_food_hosts=sorted(((h,v[0],v[1]) for h,v in byhost.items() if v[0]>0), key=lambda x:-x[1])
    summ={"n_files":n_files,"distinct_posts":len(posts),"distinct_hosts":len(host_count),
          "sampled":ok,"food":food,"food_pct":round(100*food/max(ok,1),1),
          "top_hosts_by_link_count":host_count.most_common(15),
          "hosts_with_food_posts":top_food_hosts,
          "food_examples":examples[:15]}
    print(json.dumps(summ,ensure_ascii=False,indent=2))
    json.dump(summ, open(f"{OUT}/wat_domain_food.json","w"), ensure_ascii=False, indent=2)
if __name__=="__main__": main()
