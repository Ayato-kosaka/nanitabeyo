# アイデア検証: commoncrawl-portal-reverse-discovery

## 結論: 動作した (WORKS)

Common Crawl経由で食べログ店舗ページからSNSハンドルを逆引き抽出する手法は、実機で再現確認できた。
認証・課金なしのHTTPSアクセスのみで、CDXインデックス検索→WARCバイトレンジ取得→SNSリンク抽出、の
全ステップが成立した。

## 実行内容と生の結果

### 1. CDXインデックスの疎通確認
```
curl -s https://index.commoncrawl.org/collinfo.json
```
→ HTTP 200、最新コレクション `CC-MAIN-2026-30` (2026-07-10〜2026-07-23クロール分) を確認。

### 2. 店舗ページ一覧のCDX検索
```
curl -s "https://index.commoncrawl.org/CC-MAIN-2026-30-index?url=tabelog.com%2Ftokyo%2F*&output=json&limit=20000"
```
→ 7,541レコード取得（認証不要、200 OK）。正規表現 `^https://tabelog\.com/tokyo/A\d+/A\d+/\d+/(\?.*)?$`
でstatus=200の店舗トップページのみフィルタした結果 **5,135件** ヒット。
(元アイデアのA1301単体での4,441件という数字とは母集団が異なるが、同オーダーの規模感であることを
独立に確認。CDX APIはlimit指定より少ない件数しか返さないケースがあり、全件取得には`showNumPages`による
ページング拡張が必要な点は追加の実装課題として判明。)

### 3. WARCバイトレンジ取得(認証不要)
上記5,135件からランダムに10件抽出し、各レコードの`filename`/`offset`/`length`を用いて
```
curl -H "Range: bytes=${OFFSET}-${OFFSET+LENGTH-1}" "https://data.commoncrawl.org/${FILENAME}"
```
を実行。**10/10件すべてHTTP 206 (Partial Content)で成功**、AWS署名やAPIキーは一切不要だった。
取得サイズは35KB〜46KB(gzip)で、解凍後は完全なHTML(`</html>`まで閉じている)だった。

### 4. SNSリンク抽出
```
grep -oE 'https?://[^"'"'"' >]*(instagram|tiktok|facebook|twitter|x\.com)\.[^"'"'"' >]*' rec_N.warc
```
10件中 **7件(70%)** で公式Instagram/Facebookリンクを実際に抽出できた。例:
- `https://www.instagram.com/kameari_happy?igsh=...` (亀有エリアの店舗)
- `https://www.instagram.com/dobrogi_akasaka` + `https://www.facebook.com/＠dobrogiakasaka` (赤坂の店舗)
- `https://www.instagram.com/enekotokyo/` + `https://www.facebook.com/enekotokyo/`
- `https://www.instagram.com/spiralcafe.jp/` (Facebookのみ)
- `https://www.instagram.com/bluffbakery/`
- `https://www.instagram.com/gocchibatta/`
- `https://www.instagram.com/parlour_ekoda/` + `https://www.facebook.com/profile.php?id=100052543644685`

残り3件はHTMLが正常に閉じておりページ取得自体は成功していたが、そのページ内にSNSリンク記載が
そもそも無かった(該当店舗がSNS未登録、または取得失敗ではなく実データとしての「無し」)。
これは抽出ロジックの不備ではなく、ポータル側のデータ欠損であり、想定通りの結果。

### 5. dev.restaurants との突き合わせ(参考実施)
`scripts/.env`のDATABASE_URL(dev schema、読み取り専用)に対し、抽出できた店舗名の一部
(「亀有」「dobrogi」「eneko」「bluff」「ごっち」「parlour」等)でLIKE検索したが、**0件ヒット**。
ただしdev.restaurantsは約2,435件のスナップショットで東京の当該エリア店舗が必ずしも含まれておらず、
これは手法自体の失敗ではなく「小規模devデータとサンプリングした実店舗の単純な重複不足」による
想定内の結果。本番相当のマッチ率検証には別途、抽出ハンドル群とrestaurant_seed_catalog全量との
突き合わせスクリプトが必要(未実施、今回のスコープ外)。

## 評価まとめ

| 検証項目 | 結果 |
|---|---|
| CDXインデックスAPI疎通(認証不要) | 成功 (200 OK) |
| 店舗ページのCDXフィルタ検索 | 成功 (5,135件ヒット、同オーダー確認) |
| WARCバイトレンジ取得(認証不要) | 成功 10/10 (206 Partial Content) |
| SNSリンク抽出 | 成功 7/10 (70%) が公式Instagram/Facebookハンドルを含む |
| dev.restaurantsとの実マッチ | 未検証(devデータ規模不足のため0件、要本番規模での再検証) |

コア仮説(「SNS側を直接検索せずポータル経由でCommon Crawlから逆引きすれば認証・Bot対策・App Review
を回避して無料でSNSハンドルに到達できる」)は独立再現実験でも成立を確認した。ボトルネックは
SNS側の制約ではなく、(a) CDX APIの`limit`パラメータが必ずしも全件を返さずページング実装が必要な点、
(b) 抽出したハンドルを実店舗レコードへ紐付ける名寄せロジックの精度、の2点に移る。
