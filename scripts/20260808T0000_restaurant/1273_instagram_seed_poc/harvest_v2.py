"""#1273 seed 拡張: 26本の公開リストから handle を抽出・重複除去（既存263に追加）。"""
import json,os,re,time,urllib.request
OUT=os.path.dirname(os.path.abspath(__file__)); OUT=os.path.join(OUT,"out")
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
SRCS="""https://find-model.jp/insta-lab/influencers-gourmet/
https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/
https://influencermarketing-company.com/influencer-column/food-influencer-instagram/
https://tokyo-mbfashionweek.com/gourmet-instagrammer.html
https://influencer-company.info/influencer-column/influencer-gourmet/
https://otomo.join-up.co.jp/instagram-gourmet/
https://wonderx.co.jp/magazine/casting-gourmet/
https://aidoly.net/I0001594
https://find-model.jp/insta-lab/instagram-reels-gourmet-influencers-accounts/
https://cevsty.com/gourmet-marketing-creator-instagram-account/
https://star-inc.co/topics/409/
https://star-inc.co/topics/411/
https://star-inc.co/topics/408/
https://michinokukikaku.jp/sendai-miyagi-influencer-list/
https://michinokukikaku.jp/sendai-restaurant-instagram-tieup/
https://umaimono-blog.com/aichi-gourmet-blogger/
https://www.bm-peekaboo.com/information/8-78/
https://www.kanazawabiyori.com/editors/2021/12/42467.html
https://tokyo-mbfashionweek.com/sweets-instagramer.html
https://find-model.jp/insta-lab/instagram-influencers-okinawa/
https://fukuoka-leapup.jp/writer/43
https://note.com/nohdomi/n/n0e0ad93e94b9
https://find-model.jp/insta-lab/instagram-cooking-influencer/
https://find-model.jp/insta-lab/instagram-sweets-influencer/
https://uchill.jp/blog/diary/utsuwa-instagrammer/""".split()
# star-inc topics 総当たり（400-420）
SRCS += [f"https://star-inc.co/topics/{i}/" for i in range(400,421)]
HANDLE=re.compile(r"instagram\.com/([A-Za-z0-9_.]{2,30})")
BAD={"p","reel","reels","tv","explore","accounts","stories","about","developer","legal","embed","embed.js","www","sharer","home","privacy","terms","directory","help"}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":UA}),timeout=40).read().decode("utf-8","replace")
def main():
    existing=set(json.load(open(f"{OUT}/influencer_handles.json"))["handles"])
    handles=dict(); per={}
    for u in SRCS:
        try: h=get(u)
        except Exception as e: per[u]=f"ERR {str(e)[:30]}"; continue
        found=set()
        for m in HANDLE.finditer(h):
            hd=m.group(1).lower().strip(".")
            if hd in BAD or hd.isdigit() or hd.endswith(".js"): continue
            if not re.fullmatch(r"[a-z0-9_.]{2,30}",hd): continue
            found.add(hd)
        for hd in found: handles.setdefault(hd,0)
        per[u]=len(found)
        time.sleep(0.8)
    allh=existing|set(handles)
    newh=set(handles)-existing
    out={"total_distinct_handles":len(allh),"was":len(existing),"new_from_v2":len(newh),
         "handles":sorted(allh),"per_source":per}
    json.dump(out, open(f"{OUT}/influencer_handles.json","w"), ensure_ascii=False, indent=2)
    print("既存:",len(existing),"→ 合計:",len(allh),"（新規",len(newh),"）")
    print("source別:")
    for u,c in per.items():
        if isinstance(c,int) and c>0: print(f"  {c:3}  {u.split('/')[2]}{u.split(u.split('/')[2])[-1][:30]}")
if __name__=="__main__": main()
