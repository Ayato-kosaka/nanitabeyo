"""グルメインフルエンサー handle の business_discovery 高速パス（account フィールドのみ）。
アプリ枠(code4)は飽和すると回復が遅い。冒頭で冷却し、以降は 20 秒間隔でゆるく回す。"""
import json,os,statistics,sys,time,urllib.parse,urllib.request
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"out")
GRAPH="https://graph.facebook.com/v23.0"
def bd(ig,tok,h):
    q=urllib.parse.urlencode({"fields":f"business_discovery.username({h}){{username,followers_count,media_count}}","access_token":tok})
    r=urllib.request.Request(f"{GRAPH}/{ig}?{q}",headers={"User-Agent":"nanitabeyo/1.0"})
    try:
        with urllib.request.urlopen(r,timeout=40) as x: return json.load(x),None
    except urllib.error.HTTPError as e:
        try: return None,json.loads(e.read().decode())["error"]
        except: return None,{"code":-1}
def main():
    tok=os.environ["IG_TOKEN"]; ig=os.environ["IG_USER_ID"]
    hs=json.load(open(f"{OUT}/influencer_handles.json"))["handles"]
    print(f"冷却 60s 開始 ({len(hs)} handles)",flush=True); time.sleep(60)
    rows=[]
    for i,h in enumerate(hs):
        back=90
        while True:
            d,e=bd(ig,tok,h)
            if e and e.get("code")==4:
                print(f"  rl@{i} wait{back}",flush=True); time.sleep(back); back=min(back*2,600); continue
            break
        if e: rows.append({"h":h,"ok":False,"code":e.get("code")})
        else:
            b=d["business_discovery"]; rows.append({"h":h,"ok":True,"followers":b.get("followers_count"),"media":b.get("media_count")})
        time.sleep(20)
        if (i+1)%20==0:
            ok=[r for r in rows if r["ok"]]
            print(f"  {i+1}/{len(hs)} ok={len(ok)}",flush=True)
            json.dump({"partial":True,"rows":rows},open(f"{OUT}/infl_fast.json","w"),ensure_ascii=False)
    ok=[r for r in rows if r["ok"]]; mc=[r["media"] for r in ok if r["media"]]
    summ={"handles":len(rows),"resolved":len(ok),"resolve_pct":round(100*len(ok)/max(len(rows),1),1),
          "media_total":sum(mc),"media_median":statistics.median(mc) if mc else 0,
          "media_mean":round(statistics.mean(mc)) if mc else 0,
          "followers_median":statistics.median([r["followers"] for r in ok if r["followers"]] or [0])}
    print(json.dumps(summ,ensure_ascii=False,indent=2))
    json.dump({"summary":summ,"rows":rows},open(f"{OUT}/infl_fast.json","w"),ensure_ascii=False,indent=2)
main()
