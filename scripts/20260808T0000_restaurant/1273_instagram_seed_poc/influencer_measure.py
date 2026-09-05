"""#1273 打開策② の確定測定: グルメインフルエンサー handle を business_discovery で実測する。

各 handle について:
- 有効な Business/Creator か（解決率）
- media_count（＝カバー投稿数の天井）・followers
- 直近 media のキャプションを取り、飲食率・店名シグナル率を測る
これで «1 アカウントが何店をカバーするか» の実測レンジを出す。
"""
import json, os, re, sys, time, urllib.parse, urllib.request
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"out")
GRAPH="https://graph.facebook.com/v23.0"
DISH=re.compile(r"(ラーメン|らーめん|寿司|鮨|焼肉|焼き鳥|焼鳥|カレー|そば|うどん|天ぷら|うなぎ|鰻|餃子|とんかつ|ハンバーグ|ステーキ|定食|海鮮|丼|パスタ|ピザ|居酒屋|バル|ビストロ|食堂|喫茶|カフェ|レストラン|ランチ|ディナー|スイーツ|パン|ベーカリー|焼き菓子|グルメ|美味|絶品|ご飯|肉|魚|中華|イタリアン|フレンチ|韓国料理|タイ料理)")
STORE=re.compile(r"(@[A-Za-z0-9_.]{2,30}|[ぁ-んァ-ヶ一-龠A-Za-z0-9]{2,20}(?:店|食堂|亭|屋|軒|房|庵|家|寿司|鮨|ラーメン|カフェ|cafe|kitchen|bar|dining))|[都道府県市区町村]")
def bd(ig_id, token, handle, limit=40):
    fields=(f"business_discovery.username({handle})"
            f"{{username,followers_count,media_count,media.limit({limit}){{caption,permalink,timestamp}}}}")
    q=urllib.parse.urlencode({"fields":fields,"access_token":token})
    req=urllib.request.Request(f"{GRAPH}/{ig_id}?{q}",headers={"User-Agent":"nanitabeyo/1.0"})
    try:
        with urllib.request.urlopen(req,timeout=45) as r: return json.load(r),None
    except urllib.error.HTTPError as e:
        try: return None,json.loads(e.read().decode())["error"]
        except: return None,{"code":-1}
def main():
    token=os.environ["IG_TOKEN"]; ig_id=os.environ["IG_USER_ID"]
    handles=json.load(open(f"{OUT}/influencer_handles.json"))["handles"]
    n=int(sys.argv[1]) if len(sys.argv)>1 else len(handles)
    handles=handles[:n]
    rows=[]; t0=time.time()
    for i,h in enumerate(handles):
        while True:
            d,err=bd(ig_id,token,h)
            if err and err.get("code")==4:
                print(f"  rate limit @ {i}, wait 60s",flush=True); time.sleep(60); continue
            break
        if err:
            rows.append({"handle":h,"ok":False,"code":err.get("code"),"sub":err.get("error_subcode")}); continue
        b=d["business_discovery"]; media=b.get("media",{}).get("data",[])
        caps=[m.get("caption","") or "" for m in media]
        food=sum(1 for c in caps if DISH.search(c))
        store=sum(1 for c in caps if STORE.search(c))
        rows.append({"handle":h,"ok":True,"followers":b.get("followers_count"),
                     "media_count":b.get("media_count"),"sampled":len(caps),
                     "food_caps":food,"store_caps":store,
                     "food_rate":round(food/max(len(caps),1),2),
                     "ex":[c[:60] for c in caps[:2]]})
        if (i+1)%25==0:
            ok=[r for r in rows if r.get("ok")]
            print(f"  {i+1}/{len(handles)} ok={len(ok)} elapsed={time.time()-t0:.0f}s",flush=True)
    ok=[r for r in rows if r.get("ok")]
    import statistics
    def med(xs): xs=[x for x in xs if x is not None]; return statistics.median(xs) if xs else 0
    summ={"handles":len(rows),"resolved":len(ok),
          "resolve_pct":round(100*len(ok)/max(len(rows),1),1),
          "median_media_count":med([r["media_count"] for r in ok]),
          "median_followers":med([r["followers"] for r in ok]),
          "mean_food_rate":round(sum(r["food_rate"] for r in ok)/max(len(ok),1),2),
          "sum_media_count":sum((r["media_count"] or 0) for r in ok),
          "note":"sum_media_count は延べ投稿。飲食率を掛け、重複を割ると異なり店の概算"}
    print(json.dumps(summ,ensure_ascii=False,indent=2))
    json.dump({"summary":summ,"rows":rows},open(f"{OUT}/influencer_measure.json","w"),ensure_ascii=False,indent=2)
if __name__=="__main__": main()
