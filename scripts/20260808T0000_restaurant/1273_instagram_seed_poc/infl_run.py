import json,os,statistics,time,urllib.parse,urllib.request
OUT=os.path.dirname(os.path.abspath(__file__)); OUT=os.path.join(OUT,"out")
tok=os.environ["IG_TOKEN"]; ig=os.environ["IG_USER_ID"]
hs=json.load(open(os.path.join(OUT,"influencer_handles.json")))["handles"]
def bd(h):
    q=urllib.parse.urlencode({"fields":"business_discovery.username(%s){followers_count,media_count}"%h,"access_token":tok})
    try:
        d=json.load(urllib.request.urlopen(urllib.request.Request("https://graph.facebook.com/v23.0/%s?%s"%(ig,q),headers={"User-Agent":"x"}),timeout=30))
        return d.get("business_discovery"),None
    except urllib.error.HTTPError as e:
        try: return None,json.loads(e.read().decode()).get("error",{})
        except Exception: return None,{"code":-1}
    except Exception as e:
        return None,{"code":-2,"m":str(e)[:40]}
rows=[]
for i,h in enumerate(hs):
    back=60
    while True:
        b,e=bd(h)
        if e and e.get("code")==4:
            print("rl@%d wait%d"%(i,back),flush=True); time.sleep(back); back=min(back*2,600); continue
        break
    if e: rows.append({"h":h,"ok":False,"code":e.get("code")})
    else: rows.append({"h":h,"ok":True,"followers":b.get("followers_count"),"media":b.get("media_count")})
    time.sleep(1.5)
    if (i+1)%40==0:
        ok=[r for r in rows if r["ok"]]
        print("%d/%d ok=%d"%(i+1,len(hs),len(ok)),flush=True)
        json.dump({"partial":True,"rows":rows},open(os.path.join(OUT,"infl_fast.json"),"w"),ensure_ascii=False)
ok=[r for r in rows if r["ok"]]; mc=[r["media"] for r in ok if r["media"]]
summ={"handles":len(rows),"resolved":len(ok),"resolve_pct":round(100*len(ok)/max(len(rows),1),1),
      "media_total":sum(mc),"media_median":statistics.median(mc) if mc else 0,
      "media_mean":round(statistics.mean(mc)) if mc else 0,
      "followers_median":statistics.median([r["followers"] for r in ok if r["followers"]] or [0])}
print(json.dumps(summ,ensure_ascii=False))
json.dump({"summary":summ,"rows":rows},open(os.path.join(OUT,"infl_fast.json"),"w"),ensure_ascii=False,indent=2)
