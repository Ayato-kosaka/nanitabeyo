# Yahoo!ロコ(YOLP)ローカルサーチAPI — エリア×料理カテゴリ掃引Discovery

- slug: `yolp-local-search-area-category-sweep`
- 検証日: 2026-08-13
- 検証方法: 実機curlのみ（Yahoo! JAPAN IDでのapp登録・appid発行はサンドボックス単体では完遂不可のため未実行。公開ドキュメントはcurl/WebFetchで原文確認）

## 実行したコマンドと結果（生データ）

### 1. appidなしでlocalSearchを叩く（疎通確認）
```
$ curl -sS -i "https://map.yahooapis.jp/search/local/V1/localSearch?query=%E3%83%A9%E3%83%BC%E3%83%A1%E3%83%B3&ac=13113&results=5&output=json"
HTTP/2 401
x-yahooj-autherror: Required authentication information is not found.
{"Error":{"Message":"Bad Request: Authentication parameters in your request incompleted."}}
```
→ hypothesis記載のエラーメッセージ「Authentication parameters in your request incompleted」と完全一致。ブロックではなく認証待ちの正常応答であることを実測確認。

### 2. でたらめなappid（fake but well-formed）で叩く
```
$ curl -sS -i "https://map.yahooapis.jp/search/local/V1/localSearch?appid=dj00aiZpPXFvbXBsZXRlbHlmYWtl&query=%E3%83%A9%E3%83%BC%E3%83%A1%E3%83%B3&ac=13113&results=5&output=json"
HTTP/2 403
x-yahooj-autherror: The AppID is denied: AppID was not allowed of URL.
{"Error":{"Message":"Your Request was Forbidden"}}
```
→ 未認証(401)と不正appid(403)を明確に区別して返しており、APIサーバーは通常運用中と判断できる。有効なappidを取れば200が返る蓋然性は高い。

### 3. 公式ドキュメント原文確認（WebFetch, developer.yahoo.co.jp/webapi/map/openlocalplatform/v1/localsearch.html）
- 無料枠: **「24時間中1アプリケーションにつき50,000件のリクエストが上限」** と明記 → hypothesis記載の5万回/日と一致。
- レスポンスフィールド: Name, Address, GovernmentCode, ReviewCount, Image1, Tel1, Genre, Station 等を確認 → hypothesis記載の項目と一致。
- パラメータ: `ac`=住所コード(JIS X 0401、都道府県2桁/市区町村5桁)、`gc`=業種コード、`query`=地域・拠点情報名称および業種の全文検索 → hypothesis記載通り。

### 4. 業種コード(gc)の実物確認（WebFetch, .../genre.html）
7桁の業種コードを確認。例:
- そば `0101017`
- うどん `0101018`
- 寿司(握り) `0101012`、回転寿司 `0101013`
- 天ぷら `0101014`
- 焼き鳥 `0101025`
「和食」中分類(0101)配下だけで53種類の飲食カテゴリが列挙されている、との抽出結果 → hypothesis記載の「50種以上」と一致。

### 5. アプリ登録ページの実際のフロー確認
```
$ curl -sS -L "https://e.developer.yahoo.co.jp/register" -o /tmp/yolp_register.html -w "HTTP:%{http_code}\n"
HTTP:200
```
本文抜粋（テキスト化）:
```
Yahoo! JAPAN Web APIのご利用には、アプリケーションを登録しアプリケーションIDを発行する必要があります。
1つのYahoo! JAPAN IDに対して10個まで登録できます。
続けるには、Yahoo! JAPAN IDでログインする必要があります。
Yahoo! JAPAN IDをお持ちでない方はこちら：Yahoo! JAPAN IDを取得（無料）
```
→ 法人情報の入力欄はページ上に存在せず、個人のYahoo! JAPAN ID（無料）でログインすればapp登録・appid発行に進める設計であることを確認（hypothesisの「個人IDのみで無料即時発行」という主張を裏付ける状況証拠）。ただしYahoo! JAPAN ID自体の新規取得は電話番号確認等を伴う対話的なフローであり、このサンドボックス環境（SMS受信・CAPTCHA突破手段なし）では完遂できないため、**実際のappid発行には至っていない**。

### 6. 利用ガイドライン・商用利用制限の原文確認（未確定・要注意）
- `developer.yahoo.co.jp/guideline/` を確認したところ、明記されているのは(a)クレジット表示義務、(b)アプリケーションID付与義務、(c)アプリケーションID情報送信、の3点のみで、「利益を得ているサービス」条項の原文はこのページ単体には見当たらなかった。
- `developer.yahoo.co.jp/webapi/map/` ページの要約では「Services earning profit from users through the use of information provided by YOLP」に該当する場合ライセンス終了となり得る旨、およびYOLP Premier（`map.yahoo.co.jp/promo/yolp/yolppremier.html`、無料枠超過時の有償版）への言及が確認された。ただしこのURLはJS必須のプロモページで、curlでは`var TLDataContext = ...`のスクリプトタグしか取得できず（本文長2049文字、「利益」等のキーワードはヒットせず）、原文の直接確認はできなかった。
- サポート記事 `support.yahoo-net.jp/PccDeveloper/s/article/H000011080` はSalesforce製JS SPA(CSP付き)で、curlでは空のシェルHTML（22,528バイトだが本文はJS実行前で実質0文字）しか取得できず、WebFetch経由の一次要約で「非商用目的のみ」という記述が示唆されたが、**このサンドボックスでは原文を直接検証できなかった**（curlではJSレンダリング不可、ブラウザ操作も不可）。仮にYDN全体が「非商用目的のみ」を原則としているなら、hypothesisが想定する「有償版YOLP Premierへのアップグレードで済む」より厳しい制約（そもそも収益化サービスでは無償枠自体が対象外）である可能性があり、**人間が実ブラウザでガイドライン・利用規約の原文を確認する必要がある**。

## 未実施の項目とその理由（重大な制約）
test_planのステップ1（appid取得）以降がすべて実appidに依存するため、以下は未実施:
- ステップ2: 実際のqueryパラメータでのlocalSearch疎通確認（200応答・Feature配列の実データ取得）
- ステップ3: 業種コードCSVとdev.dish_categories(134件)のrapidfuzzマッチング
- ステップ4: 東京都1都道府県での試験実行・ヒット件数/Image1充足率/ReviewCount分布の集計
- ステップ5: 47都道府県×134カテゴリの全国1巡目掃引・restaurantsへのリバースマッチ・マッチ率計測
- ステップ6: 利用ガイドライン全文の精読による法務チェックリスト化（上記6.の通り原文が未確認のため未完了）

理由: Yahoo! JAPAN IDの新規取得（app登録の前提）は電話番号確認等を伴う対話的な本人確認フローであり、SMS受信・CAPTCHA突破の手段を持たないこのCLIサンドボックス単体では完遂できない。ホットペッパーAPI検証（メール確認リンク必須で未完遂）と同種の「登録フローに人間の介在が必須」というブロッカー。

## 判定
- **API疎通性・エラーハンドリング・無料枠上限(5万件/日)・パラメータ仕様(ac/gc/query)・レスポンスフィールド・gcコードの粒度(7桁、和食だけで53種)**は全て実機curl/公式ドキュメント原文で裏取りでき、hypothesis記載の技術的主張と完全に一致した。
- 一方で、**中核となる「appidを無料即時発行できる」という主張自体は、Yahoo! JAPAN IDの新規取得が対話的な本人確認を要するため、この環境単体では実証できなかった**（登録ページの構造・個人ID前提であることは確認できたが、実際のトークン発行・実データ取得(Feature配列・ヒット件数・Image1充足率)には至っていない）。
- **法務上の重要な未解決点**: hypothesisが「有償版が必要という趣旨の条項」と想定していた商用利用制限について、一次情報源(ガイドラインページ)には明記が見当たらず、二次情報源(サポート記事)ではJSレンダリング必須のため原文を直接確認できなかった。WebFetchの要約では「非商用目的のみ」という、hypothesisの想定より厳しい制約が示唆されており、**技術検証を先に進める前に、人間が実ブラウザで `developer.yahoo.co.jp/guideline/` 配下の全リンクおよびLINEヤフー共通利用規約の原文を確認し、nanitabeyoの収益モデルとの適合性を法務判断する必要がある**（この点はhypothesisが想定していたリスクより深刻化している可能性がある）。
- 総合すると、本アイデアは「APIの技術仕様・無料枠・エリア/カテゴリ掃引の実現可能性は原文レベルで裏付けが取れたが、実データによる歩留まり計測（ヒット率・リバースマッチ精度）は未実施」であり、かつ「商用利用可否の法務確認」というブロッカーが従来の想定より重い可能性がある、という位置づけでPoCは未完了。

## 次のアクション（人間向け）
1. 人間の担当者が個人のYahoo! JAPAN IDで `https://e.developer.yahoo.co.jp/register` からログイン・app登録し、appid（Client ID）を取得。`scripts/.env`に`YOLP_CLIENT_ID`として保存（絶対にコミットしない）。
2. 取得後、test_planのステップ2〜5（疎通確認→gcコードマッピング→東京都サンプル→全国1巡目掃引・リバースマッチ計測）を実行。
3. **最優先で並行実施すべき事項**: 実ブラウザで`developer.yahoo.co.jp/guideline/`のリンク先（LINEヤフー共通利用規約、YOLP Premierページ、サポート記事H000011080）の原文を精読し、「非商用目的のみ」「利益を得ているサービス」に該当する条項の正確な文言を確認した上で、nanitabeyoの収益モデル（広告/送客手数料等の有無）がこれに抵触しないか法務・プロダクト側に確認する。原文がhypothesisの想定より厳しい場合（無償枠が最初から商用サービスを想定していない場合）、appid取得や技術検証に工数を投じる前にこの判断を優先すべき。
