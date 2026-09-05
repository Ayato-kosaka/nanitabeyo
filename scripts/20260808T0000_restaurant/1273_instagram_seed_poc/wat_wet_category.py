"""#1273 オーナー核心案: WAT/WET を «料理カテゴリ辞書» で絞る。

前回の WAT+WET join は loose な店名正規表現で偽陽性だらけだった。今回は 134 の料理カテゴリ語
（dish_category_features whitelist JP）で本文を判定する。狙いは 2 つ:
  A) route②: 本文が料理カテゴリを語り、instagram の /p/ 投稿にリンクするページ
     （＝「焼き鳥」を集めたまとめブログ）から投稿URLを採る
  B) route①: 本文が料理カテゴリ＋instagram アカウントを持つページ（＝飲食店の紹介）
カテゴリ語が «何個» 本文に出るか（=どれだけ料理を語っているか）でページを層別する。
"""
import gzip, json, os, re, sys, tempfile, urllib.request
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"out")
UA="nanitabeyo/1.0"; CRAWL="CC-MAIN-2026-34"
POST=re.compile(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]{5,})")
ACCT=re.compile(r"instagram\.com/([A-Za-z0-9_.]{2,30})")
BAD={"p","reel","reels","tv","explore","accounts","stories","about","developer","legal","embed","embed.js"}
CATS=json.load(open(f"{OUT}/dish_categories_jp.json"))["categories_ja"]
# 単独で誤爆しやすい短語を除外（カフェ/和食/定食/寿司 等は残すが、単字は無い）
CATRE=re.compile("|".join(re.escape(c) for c in CATS))
def get(url,timeout=600):
    return urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":UA}),timeout=timeout).read()
def dl(path):
    tmp=os.path.join(tempfile.gettempdir(),path.split("/")[-1]); open(tmp,"wb").write(get(f"https://data.commoncrawl.org/{path}")); return tmp
def main():
    n_files=int(sys.argv[1]) if len(sys.argv)>1 else 1
    wat_paths=gzip.decompress(get(f"https://data.commoncrawl.org/crawl-data/{CRAWL}/wat.paths.gz")).decode().splitlines()
    import random; random.seed(23); random.shuffle(wat_paths)
    tot_pages=0; tot_ig_pages=0
    page_posts={}   # url -> set(post codes)
    page_accts={}   # url -> set(accounts)
    for watp in wat_paths[:n_files]:
        wetp=watp.replace("/wat/","/wet/").replace(".warc.wat.gz",".warc.wet.gz")
        wat=dl(watp)
        with gzip.open(wat,"rb") as gz:
            cur=None
            for line in gz:
                if line.startswith(b"WARC-Target-URI:"):
                    u=line.decode("utf-8","replace").split(":",1)[1].strip(); cur=u if ".jp" in u else None
                elif cur and b"instagram.com/" in line:
                    s=line.decode("utf-8","replace")
                    for m in POST.finditer(s): page_posts.setdefault(cur,set()).add(m.group(1))
                    for m in ACCT.finditer(s):
                        h=m.group(1).lower().strip(".")
                        if h not in BAD and not h.isdigit() and not POST.search("instagram.com/"+h): page_accts.setdefault(cur,set()).add(h)
        os.remove(wat)
        target=set(page_posts)|set(page_accts)
        wet=dl(wetp); rows=[]
        with gzip.open(wet,"rb") as gz:
            uri=None; rec=[]
            def flush(uri,rec):
                if uri in target:
                    text=" ".join(x.decode("utf-8","replace") for x in rec)
                    hits=CATRE.findall(text)
                    rows.append((uri,len(set(hits)),len(hits),
                                 sorted(set(hits))[:6],
                                 sorted(page_posts.get(uri,[]))[:8],
                                 sorted(page_accts.get(uri,[]))[:5]))
            for line in gz:
                if line.startswith(b"WARC-Target-URI:"):
                    if uri is not None: flush(uri,rec)
                    uri=line.decode("utf-8","replace").split(":",1)[1].strip(); rec=[]
                else: rec.append(line)
            if uri is not None: flush(uri,rec)
        os.remove(wet)
        for r in rows:
            uri,dcat,ncat,cats,posts,accts=r
        # 集計
        globals().setdefault("ALL",[]).extend(rows)
    ALL=globals().get("ALL",[])
    # カテゴリ語を «たくさん» 含むページ = カテゴリまとめの候補
    matome=[r for r in ALL if r[1]>=3 and r[4]]  # 3種以上のカテゴリ語＋投稿リンクあり
    foodpage_post=[r for r in ALL if r[1]>=1 and r[4]]   # 1種以上＋投稿リンク
    foodpage_acct=[r for r in ALL if r[1]>=1 and r[5]]   # 1種以上＋アカウントリンク
    all_posts=set(); 
    for r in foodpage_post:
        all_posts.update(r[4])
    summ={"files":n_files,"ig_pages_joined":len(ALL),
          "pages_with_category_text":sum(1 for r in ALL if r[1]>=1),
          "pages_cat>=3_with_post":len(matome),
          "food_pages_with_post_link":len(foodpage_post),
          "distinct_posts_from_food_pages":len(all_posts),
          "food_pages_with_account_link":len(foodpage_acct)}
    print(json.dumps(summ,ensure_ascii=False,indent=2))
    ex=sorted(ALL,key=lambda r:-r[1])[:15]
    print("=== カテゴリ語を多く含むページ（まとめ候補）===")
    for uri,dcat,ncat,cats,posts,accts in ex:
        dom=uri.split('/')[2] if '://' in uri else uri[:40]
        print(f"  [{dcat}種] {dom} cats={cats} posts={len(posts)} accts={accts[:2]}")
    json.dump({"summary":summ,"top":[{"url":r[0],"distinct_cats":r[1],"cats":r[3],"posts":r[4],"accts":r[5]} for r in ex]},
              open(f"{OUT}/wat_wet_category.json","w"),ensure_ascii=False,indent=2)
if __name__=="__main__": main()
