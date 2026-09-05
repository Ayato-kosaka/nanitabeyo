"""#1273 唯一の未検証点: embed/captioned の持続レート制限を測る（#1284 の宿題）。

WAT で集めた実在の投稿コードを、間隔を変えて連続取得し、
「200 が返り続けるか」「何本目で captcha/429/空 caption になるか」を記録する。
"""
import gzip, html, json, os, re, sys, time, urllib.request
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"out")
UA="nanitabeyo/1.0"
def codes_from(fn, limit):
    d=json.load(open(fn))
    cs=[]
    for r in d.get("rows",[]):
        if "code" in r: cs.append(r["code"])
    return cs[:limit]
def fetch(code):
    t=time.time()
    try:
        req=urllib.request.Request(f"https://www.instagram.com/p/{code}/embed/captioned/", headers={"User-Agent":UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            h=r.read().decode("utf-8","replace"); st=r.status
    except urllib.error.HTTPError as e:
        return {"code":code,"status":e.code,"ms":round((time.time()-t)*1000)}
    except Exception as e:
        return {"code":code,"status":-1,"err":str(e)[:40],"ms":round((time.time()-t)*1000)}
    cap=re.search(r'class="Caption"(.*?)</div>', h, re.S)
    has_login=('/accounts/login' in h and 'Caption' not in h)
    return {"code":code,"status":st,"bytes":len(h),"has_caption":bool(cap),
            "login_wall":has_login,"ms":round((time.time()-t)*1000)}
def main():
    interval=float(sys.argv[1]) if len(sys.argv)>1 else 0.0
    n=int(sys.argv[2]) if len(sys.argv)>2 else 200
    src=sys.argv[3] if len(sys.argv)>3 else f"{OUT}/wat_to_embed.json"
    codes=codes_from(src, 9999)
    # 足りなければ繰り返して n 本にする（同一コードでもレート挙動は見える）
    while len(codes)<n: codes=codes+codes
    codes=codes[:n]
    t0=time.time(); rows=[]; ok=0; cap=0
    for i,c in enumerate(codes):
        r=fetch(c); rows.append(r)
        if r["status"]==200: ok+=1
        if r.get("has_caption"): cap+=1
        if interval: time.sleep(interval)
        if (i+1)%25==0:
            el=time.time()-t0
            print(f"  {i+1}/{n} ok200={ok} caption={cap} rate={ (i+1)/el*3600:.0f}/h "
                  f"last_status={r['status']}", flush=True)
        # 異常が出たら止めて記録
        if r["status"] in (429,401) or r.get("login_wall"):
            print(f"  !! ブロック検出 at {i+1}: {r}", flush=True); break
    el=time.time()-t0
    summ={"interval_s":interval,"attempted":len(rows),"ok200":ok,"with_caption":cap,
          "effective_rate_per_hour":round(len(rows)/el*3600),
          "elapsed_s":round(el,1),
          "status_counts":{}}
    from collections import Counter
    summ["status_counts"]=dict(Counter(r["status"] for r in rows))
    summ["blocked"]=any(r["status"] in (429,401) or r.get("login_wall") for r in rows)
    print(json.dumps(summ,ensure_ascii=False,indent=2))
    json.dump({"summary":summ,"rows":rows[-10:]}, open(f"{OUT}/embed_ratelimit.json","w"), ensure_ascii=False, indent=2)
if __name__=="__main__": main()
