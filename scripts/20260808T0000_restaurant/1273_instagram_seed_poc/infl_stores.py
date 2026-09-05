"""#1273 柱2の異なり店数＆店舗照合可能性の実測。

インフルエンサーのキャプションは «📍地名「店名」＋料理» の構造。ここから:
- 「」内の店名を抽出（異なり数＝重複を割った店数の指標）
- 📍地名を抽出（照合の地域キー）
- 飲食シグナル（134カテゴリ＋酒場/立ち飲み/バー/ダイニング等）
キャプションは out/infl_captions.jsonl に保存し、抽出はオフライン再現可能にする。"""
import json,os,re,sys,time,urllib.parse,urllib.request
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"out")
GRAPH="https://graph.facebook.com/v23.0"
def bd(ig,tok,h,lim=50):
    q=urllib.parse.urlencode({"fields":f"business_discovery.username({h}){{media_count,media.limit({lim}){{caption,permalink}}}}","access_token":tok})
    r=urllib.request.Request(f"{GRAPH}/{ig}?{q}",headers={"User-Agent":"x"})
    try:
        with urllib.request.urlopen(r,timeout=45) as x: return json.load(x),None
    except urllib.error.HTTPError as e:
        try: return None,json.loads(e.read().decode()).get("error",{})
        except: return None,{"code":-1}
    except Exception as e: return None,{"code":-2}
def main():
    tok=os.environ["IG_TOKEN"]; ig=os.environ["IG_USER_ID"]
    hs=json.load(open(f"{OUT}/influencer_handles.json"))["handles"]
    n=int(sys.argv[1]) if len(sys.argv)>1 else 40
    import random; random.seed(5); random.shuffle(hs); hs=hs[:n]
    f=open(f"{OUT}/infl_captions.jsonl","w")
    done=0
    for i,h in enumerate(hs):
        back=60
        while True:
            d,e=bd(ig,tok,h)
            if e and e.get("code")==4: time.sleep(back); back=min(back*2,600); continue
            break
        if e: continue
        b=d["business_discovery"]
        for m in b.get("media",{}).get("data",[]):
            f.write(json.dumps({"h":h,"cap":m.get("caption","") or "","link":m.get("permalink","")},ensure_ascii=False)+"\n")
        done+=1; f.flush()
        time.sleep(8)
        if (i+1)%10==0: print(f"  {i+1}/{n} saved",flush=True)
    f.close()
    print(f"captions saved for {done} influencers -> out/infl_captions.jsonl",flush=True)
if __name__=="__main__": main()
