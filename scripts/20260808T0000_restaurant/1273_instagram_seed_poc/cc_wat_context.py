"""WAT の日本ドメイン由来 Instagram 投稿が「飲食か」「どのサイトから来たか」を見る。"""
import gzip, json, os, re, sys, urllib.request
OUT=os.path.dirname(os.path.abspath(__file__)); OUT=os.path.join(OUT,"out")
UA="nanitabeyo-poc/1.0"
POST=re.compile(r"instagram\.com/(?:p|reel|tv)/[A-Za-z0-9_-]{5,}")
FOOD=re.compile(r"(ラーメン|寿司|鮨|焼肉|カレー|そば|うどん|居酒屋|カフェ|喫茶|定食|中華|イタリアン|フレンチ|パン|ケーキ|焼鳥|焼き鳥|天ぷら|うなぎ|鰻|餃子|とんかつ|丼|グルメ|レストラン|食堂|ランチ|ディナー|バル|ビストロ|酒場|料理|美味|飲食|menu|restaurant|cafe|food|dining|gourmet|グルメ|ごはん|ご飯|食べ)", re.I)
path=sys.argv[1]
url=f"https://data.commoncrawl.org/{path}"
req=urllib.request.Request(url,headers={"User-Agent":UA})
from collections import Counter
dom=Counter(); food=0; nonfood=0; samples=[]
with urllib.request.urlopen(req,timeout=600) as r:
    gz=gzip.GzipFile(fileobj=r)
    cur=None
    for line in gz:
        if line.startswith(b"WARC-Target-URI:"):
            u=line.decode("utf-8","replace").split(":",1)[1].strip()
            cur=u if (".jp" in u) else None
        if cur and b"instagram.com/p" in line:
            s=line.decode("utf-8","replace")
            if POST.search(s):
                host=re.sub(r"^https?://","",cur).split("/")[0]
                isfood=bool(FOOD.search(cur))
                dom[host]+=1
                if isfood: food+=1
                else: nonfood+=1
                if len(samples)<25: samples.append((host,cur[:80]))
                cur=None  # 1ページ1カウント
print(f"jp posts total={food+nonfood} food_by_url={food} ({100*food/max(food+nonfood,1):.0f}%)")
print("top domains:", dom.most_common(12))
print("samples:")
for h,u in samples[:20]: print("  ",h,"|",u)
