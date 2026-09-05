"""#1273 増幅戦略の検証: 検索で得た投稿URL群を embed し、投稿主アカウントを集める。

狙い: «検索は投稿主（グルメ探索アカウント）の発見に使い、そのアカウントを
business_discovery で丸ごと回収する» という増幅の効き目を測る。
- 投稿URL 1本 → embed → アカウント名（無料）
- 同じアカウントが何本の投稿に出るか＝1アカウントの被覆
- アカウントが «店» か «探索/まとめ» か（後者ほど 1 人で多数店をカバー）
"""
import html, json, os, re, sys, time, urllib.request
from collections import Counter
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"out")
UA="nanitabeyo/1.0"
POST=re.compile(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]{5,})")
def embed_account(code):
    try:
        h=urllib.request.urlopen(urllib.request.Request(
            f"https://www.instagram.com/p/{code}/embed/captioned/",
            headers={"User-Agent":UA}), timeout=25).read().decode("utf-8","replace")
    except Exception: return None,None
    a=re.search(r'class="Username"[^>]*>.*?>([^<]+)<', h, re.S)
    m=re.search(r'class="Caption"(.*?)</div>', h, re.S)
    cap=html.unescape(re.sub(r'<[^>]+>',' ',m.group(1))) if m else ""
    return (a.group(1).strip() if a else None), cap

def main():
    n=int(sys.argv[1]) if len(sys.argv)>1 else 300
    d=json.load(open(f"{OUT}/serper_cell_yield.json"))
    codes=[]
    for c in d["cells"]:
        for r in c.get("results",[]):
            m=POST.search(r.get("link","") or "")
            if m: codes.append(m.group(1))
    seen=set(); uniq=[]
    for c in codes:
        if c not in seen: seen.add(c); uniq.append(c)
    import random; random.seed(7); random.shuffle(uniq)
    uniq=uniq[:n]
    acct_count=Counter(); rows=[]; ok=0
    for i,code in enumerate(uniq):
        acc,cap=embed_account(code)
        if acc is None: continue
        ok+=1; acct_count[acc]+=1
        rows.append({"code":code,"account":acc,"cap":cap[:80]})
        time.sleep(0.15)
        if (i+1)%50==0: print(f"  {i+1}/{len(uniq)} ok={ok} distinct_acct={len(acct_count)}", flush=True)
    # まとめ/探索アカウントの気配（bio でなく、複数投稿に跨るか＋アカウント名パターン）
    multi=[(a,n2) for a,n2 in acct_count.items() if n2>=2]
    gourmet_name=re.compile(r'(gurume|gourmet|foodie|tabe|meshi|グルメ|食べ|飯| me_shi|lunch|cafe|tokyo|osaka)', re.I)
    gourmet_accts=[a for a in acct_count if gourmet_name.search(a)]
    summ={"post_urls_embedded":ok,"distinct_accounts":len(acct_count),
          "accounts_per_post": round(len(acct_count)/max(ok,1),3),
          "accounts_with_2plus_posts":len(multi),
          "gourmet_named_accounts":len(gourmet_accts),
          "top_accounts":acct_count.most_common(20)}
    print(json.dumps(summ,ensure_ascii=False,indent=2))
    json.dump({"summary":summ,"rows":rows}, open(f"{OUT}/account_multiplier.json","w"), ensure_ascii=False, indent=2)
if __name__=="__main__": main()
