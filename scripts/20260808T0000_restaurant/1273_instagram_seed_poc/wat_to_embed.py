"""#1273 決定的実験: WAT の «裸の投稿 URL» を embed で無料エンリッチし、飲食率を測る。

WAT から日本ドメイン由来の instagram 投稿 URL を集め（無料・発見）、
各 URL を instagram.com/p/{code}/embed/captioned/ で取る（無料・トークン不要・エンリッチ）。
キャプションに料理カテゴリ辞書が当たれば «飲食» と判定する。

これが成り立つなら、WAT + embed は «完全無料で投稿 URL → 料理カテゴリ» のパイプラインになる。
検索（Serper）が要らなくなる可能性がある。
"""
import gzip, html, io, json, os, re, sys, time, urllib.request
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"out")
UA="nanitabeyo/1.0"
CRAWL="CC-MAIN-2026-34"
POST=re.compile(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]{5,})")
FOOD=re.compile(r"(ラーメン|らーめん|寿司|鮨|すし|焼肉|焼き肉|焼鳥|焼き鳥|やきとり|カレー|そば|蕎麦|うどん|居酒屋|カフェ|喫茶|定食|中華|イタリアン|フレンチ|パン|ベーカリー|ケーキ|スイーツ|天ぷら|天丼|うなぎ|鰻|餃子|とんかつ|ハンバーグ|ステーキ|焼肉|丼|グルメ|レストラン|食堂|ランチ|ディナー|バル|ビストロ|酒場|居酒屋|料理|絶品|ご飯|ごはん|美味|旨い|うまい|お food|restaurant|cafe|coffee|ramen|sushi|yakiniku|gourmet|lunch|dinner|menu|foodie|グルメ|食べ歩き|食べログ)", re.I)

def get(url, rng=None, timeout=120, ua=UA):
    req=urllib.request.Request(url, headers={"User-Agent":ua})
    if rng: req.add_header("Range", f"bytes={rng[0]}-{rng[1]}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def collect_jp_posts(n_target):
    paths=gzip.decompress(get(f"https://data.commoncrawl.org/crawl-data/{CRAWL}/wat.paths.gz")).decode().splitlines()
    import random; random.seed(20260828); random.shuffle(paths)
    posts={}
    import tempfile
    for p in paths:
        if len(posts)>=n_target: break
        tmp=os.path.join(tempfile.gettempdir(), "wat_"+p.split("/")[-1])
        try:
            data=get(f"https://data.commoncrawl.org/{p}", timeout=600)
            open(tmp,"wb").write(data)
        except Exception as e:
            print("  DL失敗", str(e)[:60], flush=True); continue
        cur=None
        try:
            with gzip.open(tmp,"rb") as gz:
                for line in gz:
                    if line.startswith(b"WARC-Target-URI:"):
                        u=line.decode("utf-8","replace").split(":",1)[1].strip()
                        cur=u if (".jp" in u) else None
                    elif cur and b"instagram.com/" in line:
                        m=POST.search(line.decode("utf-8","replace"))
                        if m: posts.setdefault(m.group(1), cur)
                    if len(posts)>=n_target: break
        except Exception as e:
            print("  展開途中終了（続行）", str(e)[:50], flush=True)
        finally:
            try: os.remove(tmp)
            except: pass
        print(f"  収集 {len(posts)} / target {n_target}", flush=True)
    return posts

def embed_caption(code):
    try:
        h=get(f"https://www.instagram.com/p/{code}/embed/captioned/", timeout=30).decode("utf-8","replace")
    except Exception as e:
        return None, str(e)[:60]
    m=re.search(r'class="Caption"(.*?)</div>', h, re.S)
    if not m:
        # フォールバック: og:description
        m2=re.search(r'property="og:description" content="([^"]*)"', h)
        return (html.unescape(m2.group(1)) if m2 else ""), None
    return html.unescape(re.sub(r'<[^>]+>',' ',m.group(1))).strip(), None

def main():
    n=int(sys.argv[1]) if len(sys.argv)>1 else 60
    posts=collect_jp_posts(n)
    codes=list(posts.items())[:n]
    rows=[]; food=0; ok=0
    for i,(code,src) in enumerate(codes):
        cap,err=embed_caption(code)
        if cap is None:
            rows.append({"code":code,"src":src,"error":err}); continue
        ok+=1
        isfood=bool(FOOD.search(cap))
        if isfood: food+=1
        rows.append({"code":code,"src":src[:60],"caption":cap[:120],"food":isfood,"cap_len":len(cap)})
        time.sleep(0.3)
        if (i+1)%20==0: print(f"  enrich {i+1}/{len(codes)} ok={ok} food={food}", flush=True)
    summ={"jp_posts_from_wat":len(posts),"enriched":ok,
          "food_captions":food,"food_pct_of_enriched":round(100*food/max(ok,1),1)}
    print(json.dumps(summ,ensure_ascii=False,indent=2))
    json.dump({"summary":summ,"rows":rows}, open(f"{OUT}/wat_to_embed.json","w"), ensure_ascii=False, indent=2)

if __name__=="__main__": main()
