"""#1273 打開策②の «何割埋まるか» と «スノーボール» の実測（サンプル）。

各インフルエンサーを business_discovery でキャプション付き取得し:
1) @メンション抽出 → 新規«店アカウント»候補（柱1へ還流できる = スノーボール）
2) 料理カテゴリ辞書で飲食キャプション率
3) 延べ投稿 vs 異なり（重複の粗い指標）
ゆるいペース（20秒）。IG_TOKEN/IG_USER_ID を環境変数で。"""
import json,os,re,sys,time,urllib.parse,urllib.request
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"out")
GRAPH="https://graph.facebook.com/v23.0"
CATS=json.load(open(f"{OUT}/dish_categories_jp.json"))["categories_ja"]
CATRE=re.compile("|".join(re.escape(c) for c in CATS))
MENTION=re.compile(r"@([A-Za-z0-9_.]{2,30})")
def bd(ig,tok,h,lim=40):
    q=urllib.parse.urlencode({"fields":f"business_discovery.username({h}){{followers_count,media_count,media.limit({lim}){{caption,permalink}}}}","access_token":tok})
    r=urllib.request.Request(f"{GRAPH}/{ig}?{q}",headers={"User-Agent":"nanitabeyo/1.0"})
    try:
        with urllib.request.urlopen(r,timeout=45) as x: return json.load(x),None
    except urllib.error.HTTPError as e:
        try: return None,json.loads(e.read().decode())["error"]
        except: return None,{"code":-1}
def main():
    tok=os.environ["IG_TOKEN"]; ig=os.environ["IG_USER_ID"]
    hs=json.load(open(f"{OUT}/influencer_handles.json"))["handles"]
    n=int(sys.argv[1]) if len(sys.argv)>1 else 30
    import random; random.seed(3); random.shuffle(hs); hs=hs[:n]
    mentions=set(); rows=[]; seed=set(hs)
    for i,h in enumerate(hs):
        back=90
        while True:
            d,e=bd(ig,tok,h)
            if e and e.get("code")==4: print(f"  rl@{i} wait{back}",flush=True); time.sleep(back); back=min(back*2,600); continue
            break
        if e: rows.append({"h":h,"ok":False}); time.sleep(20); continue
        b=d["business_discovery"]; media=b.get("media",{}).get("data",[])
        caps=[m.get("caption","") or "" for m in media]
        food=sum(1 for c in caps if CATRE.search(c))
        ms=set(x.lower() for c in caps for x in MENTION.findall(c))
        new=ms-seed
        mentions|=new
        rows.append({"h":h,"ok":True,"media_count":b.get("media_count"),"followers":b.get("followers_count"),
                     "sampled":len(caps),"food_caps":food,"mentions":len(ms),"new_mentions":len(new)})
        time.sleep(20)
        if (i+1)%10==0: print(f"  {i+1}/{n} newmentions_total={len(mentions)}",flush=True)
    ok=[r for r in rows if r["ok"]]
    summ={"sampled_influencers":len(ok),
          "mean_media_count":round(sum(r["media_count"] or 0 for r in ok)/max(len(ok),1)),
          "mean_food_cap_rate":round(sum(r["food_caps"]/max(r["sampled"],1) for r in ok)/max(len(ok),1),2),
          "total_distinct_new_mentioned_accounts":len(mentions),
          "new_mentions_per_influencer":round(len(mentions)/max(len(ok),1),1),
          "note":"@メンションの多くは店/コラボ相手。business_discovery で店か判定すれば柱1へ還流できる新規アカウント"}
    print(json.dumps(summ,ensure_ascii=False,indent=2))
    json.dump({"summary":summ,"rows":rows,"new_mentions":sorted(mentions)[:200]},
              open(f"{OUT}/infl_deep.json","w"),ensure_ascii=False,indent=2)
if __name__=="__main__": main()
