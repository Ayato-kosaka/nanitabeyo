# idea検証: rss-bridge-selfhosted-mirror-frontends

**title**: RSS-Bridge自前ホスティング + Instagramミラーフロントエンド(Picuki/Picnob系)によるハッシュタグRSS化
**判定**: 却下 — ミラーフロントエンド(Picnob/Picuki)経路はCloudflareにより広範にブロックされており、
自サンドボックスのIPだけの問題ではないことを**RSS-Bridge公式デモインスタンス経由**で実機確認した。
一方、仮説文中で代替案として触れられている「検索エンジンDiscovery + Instagram公式embedページ
Enrichment」の組み合わせは実データで裏付けが取れた(ただし別アイデアで検証済みのGoogle CSE 403問題は
未解消)。

## 実施内容と生の結果

### 1. ミラーサイトの生存確認(自サンドボックスIP)

```
$ curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://www.picnob.com/tag/ramen"
HTTP 403
$ curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://www.picuki.com/tag/ramen"
HTTP 403
```

両方とも `<title>Attention Required! | Cloudflare</title>` を含むCloudflareチャレンジページが返り、
既知情報(データセンターIPからの403)を再確認した。

### 2. RSS-Bridge公式デモインスタンス(rssbridge.auda.io)経由での切り分け

test_planの1(a)「自宅/モバイル回線からの比較」は本セッションに住宅IP/モバイル回線が無いため実施不可
だったが、代わりに**test_planの1(b)を実施し、"サンドボックスIP限定の問題か"を別ネットワーク経由で
直接切り分けた**。

`rssbridge.auda.io`自体は疎通OK(HTTP 200)で、`?action=list&format=Json`で全546ブリッジのリストが
取得でき、`PicnobBridge`(status: active)・`PicukiBridge`(status: active)ともに存在することを確認:

```json
"PicnobBridge": {
  "status": "active", "uri": "https://www.picnob.com/",
  "parameters": {
    "Username": {"u": {"name": "username", "required": true}},
    "Hashtag":  {"h": {"name": "hashtag",  "required": true}}
  }
}
```

正しいパラメータ名(`h=<tag>`, `bridge=Picnob`/`Picuki`, `context=Hashtag`)で実行した結果:

```
$ curl -s "https://rssbridge.auda.io/?action=display&bridge=Picnob&context=Hashtag&h=ramen&format=Json"
HTTP 200
{"...","items": []}                          # 0件(パース失敗を示唆、明示エラーなし)

$ curl -s "https://rssbridge.auda.io/?action=display&bridge=Picnob&context=Hashtag&h=food&format=Json"
HTTP 200
{"items":[{"title":"Bridge returned error 404! (20678)", ...
  "content_html":"...https://www.picnob.com/tag/food/ resulted in 404 Not Found..."}]}

$ RAND=$(date +%s%N)
$ curl -s "https://rssbridge.auda.io/?action=display&bridge=Picnob&context=Hashtag&h=ramen$RAND&format=Json"
HTTP 200
{"items":[{"title":"Bridge returned error 404! (20678)", ...}]}   # 新規タグでもキャッシュ抜きで再現

$ curl -s "https://rssbridge.auda.io/?action=display&bridge=Picnob&context=Username&u=instagram&format=Json"
HTTP 200
{"items":[{"title":"Bridge returned error 403! (20678)",
  "content_html":"...The website is protected by CloudFlare... 403 Forbidden..."}]}

$ curl -s "https://rssbridge.auda.io/?action=display&bridge=Picuki&context=Hashtag&h=ramen&format=Json"
HTTP 200
{"items":[{"title":"Bridge returned error 404! (20678)",
  "content_html":"...https://www.picuki.com/tag/ramen resulted in 404 Not Found..."}]}

$ for tag in tokyo sushi ramen; do curl -s ".../PicnobBridge?...h=$tag..." ; done
tokyo -> HTTP 200 -> items_empty
sushi -> HTTP 200 -> items_empty
ramen -> HTTP 200 -> items_empty
```

**結論**: `rssbridge.auda.io`(このサンドボックスとは別のホスティング環境・別IP、`server: nginx` /
`via: Caddy`のVPS)から実行しても、Picnob/Picukiは
- ユーザー名指定 → 明示的にCloudflare 403で拒否("The website is protected by CloudFlare")
- ハッシュタグ指定 → リクエストごとに「200だが0件」「404」がランダムに切り替わる不安定な挙動

のいずれかで、**一度も実際の投稿データ(post URL、キャプション等)を取得できなかった**。3回連続で
同じ3つのタグ(tokyo/sushi/ramen)を叩いても常に0件で、キャッシュ経由の偶然の成功もなかった。
これはtest_planが仮定していた「データセンターIP限定ブロックか、全面ブロックか」という切り分けに対し、
**「少なくとも2つの独立したホスティング環境(本サンドボックス及びRSS-Bridge公式デモインスタンスの
VPS)の両方でブロック/不安定」**という、仮説文の「一部のIPレンジでは機能しない」よりも悲観的な結果を
示している。

### 3. RSS-Bridgeの自前Dockerホスティング

```
$ which docker
(該当なし)
$ docker --version
/bin/bash: line 1: docker: command not found
$ apt-cache policy docker.io
docker.io:
  Installed: (none)
  Candidate: 18.09.1+dfsg1-7.1+deb10u3
```

本サンドボックスにDockerランタイムが存在せず、`docker run rssbridge/rss-bridge`によるレート上限計測
(test_plan 3)は実施できなかった。ただし2で確認した通り、自前ホスティングしても上流のPicnob/Picuki
自体がCloudflareで不安定/ブロックされる以上、自前運用による改善効果は限定的と考えられる
(RSS-Bridge公式デモも同じ壁にぶつかっているため)。

### 4. 代替案(検索エンジンDiscovery + Instagram公式embedページEnrichment)の裏付け

test_plan 2の簡易版として、`WebSearch`ツールで`site:instagram.com/p ラーメン 渋谷`を検索したところ、
実在するInstagram投稿10件が返り、Instagramの公開投稿が検索エンジンにインデックスされているという
仮説文の主張を裏付けた(例: `https://www.instagram.com/p/CajIWHEvhy2/`「青いラーメンで有名な渋谷の
吉法師」、`https://www.instagram.com/p/DG-5j8lzlYp/`「渋谷『#らーめん侍』さん ラーメン+半ライス」)。
さらにヒットした投稿の公式embedページを実際に取得できることも再確認した:

```
$ curl -s -o /tmp/ig_embed.html -w "HTTP %{http_code}\n" \
    "https://www.instagram.com/p/CajIWHEvhy2/embed/captioned/"
HTTP 200   (body 211,000 bytes)
```

ただし`WebSearch`はAnthropic製品内蔵ツールであり、本番パイプラインに組み込める無料枠APIではない
(既知情報の通りGoogle Custom Search JSON APIは403で権限不足、これは別アイデアファイル
`managed-serp-api-google-cse-bypass.md`で検証済み)。従ってこの部分は「代替アプローチの技術的成立性の
裏付け」であり、「本番で無料実行できる手段の確保」はまだ未解決のまま。

## 結論

- **仮説の中心的主張(Picnob/Picuki RSS化)は却下**: 自サンドボックスIPだけでなく、RSS-Bridge公式デモ
  インスタンス(別ホスティング環境)経由でも、Picnob/Picukiはユーザー名指定で明示的Cloudflare 403、
  ハッシュタグ指定で「200だが0件」「404」を不規則に返し、**一度も実データを取得できなかった**。
  「一部のIPレンジでは機能しない」という仮説文の想定より悪く、「(少なくとも検証した2環境では)
  実運用に足る安定性が無い」という判定が妥当。
- Docker未導入のため自前ホスティングでのレート上限計測(test_plan 3)は未実施だが、上流サイト自体が
  ブロックされている以上、自前運用の有無は結論を左右しない。
- 一方、仮説文が代替として挙げた「検索エンジンDiscovery(`site:instagram.com/p`) + 公式embedページ
  Enrichment」は実データで機能を確認できた(検索結果10件・embedページ200 OK)。ただし無料枠で実行
  可能な検索APIの確保(Google CSE 403問題)は本アイデアの範囲外の既知の未解決課題であり、
  別アイデア(`managed-serp-api-google-cse-bypass.md`)側の結論に依存する。
- **次アクション**: RSS-Bridge/ミラーフロントエンド経路はこれ以上の投資価値が低いため打ち切りを推奨。
  Instagram Discoveryを続けるなら、ミラーサイトではなく「検索エンジン経由 + 公式embed」経路に一本化し、
  検索API側の無料枠確保(Google CSE有効化のUI操作、またはBing/Brave等の代替)を優先課題とすべき。

## 実行コマンド一覧(再現用)

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://www.picnob.com/tag/ramen"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://www.picuki.com/tag/ramen"
curl -s -w "HTTP %{http_code}\n" "https://rssbridge.auda.io/?action=list&format=Json"
curl -s "https://rssbridge.auda.io/?action=display&bridge=Picnob&context=Hashtag&h=ramen&format=Json"
curl -s "https://rssbridge.auda.io/?action=display&bridge=Picnob&context=Hashtag&h=food&format=Json"
curl -s "https://rssbridge.auda.io/?action=display&bridge=Picnob&context=Username&u=instagram&format=Json"
curl -s "https://rssbridge.auda.io/?action=display&bridge=Picuki&context=Hashtag&h=ramen&format=Json"
which docker; docker --version; apt-cache policy docker.io
curl -s -o /tmp/ig_embed.html -w "HTTP %{http_code}\n" "https://www.instagram.com/p/CajIWHEvhy2/embed/captioned/"
```
