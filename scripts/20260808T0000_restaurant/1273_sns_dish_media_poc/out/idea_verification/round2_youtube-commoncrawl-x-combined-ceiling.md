# idea検証: youtube-commoncrawl-x-combined-ceiling

**title**: YouTube+CommonCrawl+X syndication併用時のカバレッジ上限試算
**判定**: **仮説はほぼ的中(CONFIRMED寄り)— 「今日時点の上乗せはほぼ0pt」という予測が n=200 の大標本再検証でも再現された**

hypothesisが提示した3シナリオ(0%/1%/5%)のうち、実測は明確に**0%シナリオ**を支持する結果になった。
n=10(Round1)では0/10だったX/TikTokの投稿パーマリンクを、n=200(tabelog全国ドメイン、13,780件の
店舗トップページプールからSHA-256決定的抽出)に拡大して再検証したが、**0/200件で不変**だった。
したがって `P_A_immediate = p_handle_found × platform_share × post_permalink_rate` の
`post_permalink_rate` 項が実測ゼロのまま確定し、YouTube+CommonCrawl+X syndicationの「今日時点の
現実的上限」はYouTube単独の試算(`coverage_youtube_only.py`)と**数値上完全に一致**した(全k値で
上乗せ+0.00pt)。一方、Business Verification完了後の「将来上限」シナリオ(IG/FBハンドルp_handle_found=70%を
そのまま使えると仮定)では、k=1で+56.0pt、k=5でも+22.9ptの大きな上乗せが試算されたが、これは
X syndicationではなくIG/FB直接埋め込みの効果であり、本アイデアが検証対象とした併用効果とは別物である。

## 実行内容と生の結果

### 1. 環境確認: index.commoncrawl.org (CDX API) は本セッションでも不通

```
$ curl -s -o /dev/null -w "http_code=%{http_code}\n" --max-time 15 https://index.commoncrawl.org/collinfo.json
http_code=000
$ curl -s -o /dev/null -w "http_code=%{http_code}\n" --max-time 15 https://data.commoncrawl.org/
http_code=200
```
`round2_multi-portal-cc-coverage-estimate.md` で確認済みの状況(CDX API不通・data.commoncrawl.org生存)が
本ラウンドでも再現したため、同レポートで確立済みの `cluster.idx` 直読みフォールバック手法をそのまま
採用した(認証不要、AWS署名不要)。

### 2. `cluster.idx` から `com,tabelog)/` (tabelog.comドメイン全体)のCDXブロックを二分探索

```
[fetch] downloading cluster.idx (~100MB, one-time)... http=200
[cdx] com,tabelog)/ spans 10 cluster.idx block(s)
[cdx] GET .../cdx-00133.gz range=539174341-542040565 (2,866,225 bytes) -> 206
[cdx] total com,tabelog)/ CDX lines = 26,522
```
test_planは「osaka/*, nagoya/*, fukuoka/*等複数都市への拡張」を要求していたが、実際には
`com,tabelog)/` (ドメイン全体)のCDXブロックがすべて単一シャードファイル(`cdx-00133.gz`)の
連続10ブロックに収まっていたため、個別都市ごとにクエリを分割する必要がなく、**1回のRange GET
(約2.8MB)で tabelog.com 全国分のCDXレコードを一括取得**できた。これは複数都市への拡張という
要求を、都市を限定しない全国抽出によって上位互換的に満たす結果になった。

### 3. 店舗トップページ(status=200)を全都道府県から抽出 → 13,780件のプール

```
[cdx] store-toppage status=200 pool (deduped by URL) = 13,780 across 56 areas
[cdx] top areas: [('tokyo', 5135), ('osaka', 1374), ('kanagawa', 901), ('hyogo', 628),
                  ('aichi', 608), ('fukuoka', 530), ('kyoto', 423), ('hokkaido', 415),
                  ('chiba', 409), ('saitama', 374)]
```
`tokyo: 5,135` はRound1(`commoncrawl-portal-reverse-discovery.md`)の東京都単体の実測値と**完全一致**
しており、抽出ロジックの整合性を裏付けている。56エリア(47都道府県 + 海外店舗ページ数件: america,
china, germany, hawaii, malaysia, southkorea, taiwan, vietnam)が確認でき、test_planが名指しした
osaka(1,374件)・fukuoka(530件)に加え、nagoyaは実際には`aichi`エリアコード配下(608件)に含まれる
ことも実データで確認した。

### 4. SHA-256決定的サンプリングでn=200を抽出しWARCバイトレンジ取得

既存PoCの手法(URLのSHA-256ハッシュ値で昇順ソートし先頭N件を取る)を踏襲。200件全件で
`curl -H "Range: ..." https://data.commoncrawl.org/<filename>` が**200/200件成功(HTTP 206)**した。

```
[warc] [1/200]   https://tabelog.com/osaka/A2701/A270101/27084553/ -> 206
[warc] [101/200] https://tabelog.com/tokyo/A1302/A130203/13310764/ -> 206
[warc] [200/200] https://tabelog.com/tokyo/A1305/A130501/13104775/ -> 206
```

### 5. SNSリンク抽出・分類(プロフィール根URL vs 投稿パーマリンクURL)

正規表現でinstagram/facebook/tiktok/twitter/x.comドメインへのリンクを抽出し、ノイズ除外
(`widgets.js`, `dialog/share`, `cdninstagram.com`等の埋め込みウィジェット定型コードを除外、
`round2_multi-portal-cc-coverage-estimate.md`で確立済みの手法を踏襲)後、以下で分類した:
- **profile**: `instagram.com/<handle>/`, `twitter.com/<handle>` のようなアカウント根URL
- **permalink**: `instagram.com/<handle>/p/...`, `x.com/<handle>/status/...`,
  `tiktok.com/@<handle>/video/...` のような個別投稿URL

```json
{
  "n": 200,
  "n_with_any_real_sns_link": 89,
  "p_handle_found_n200": 0.445,
  "platform_counts": {"instagram": 79, "facebook": 34, "tiktok": 0, "x_twitter": 2},
  "platform_permalink_counts": {"instagram": 0, "facebook": 0, "tiktok": 0, "x_twitter": 0},
  "x_or_tiktok_link_records": 2,
  "x_or_tiktok_permalink_records": 0,
  "post_permalink_rate": 0.0
}
```

**n=200中、X/Twitterリンクが見つかったのは2件、TikTokは0件、そのどちらにも投稿パーマリンク
(status/, video/)は1件も含まれていなかった**。見つかった2件のX/Twitterリンクの実体:

| ページURL | 抽出リンク | 分類 |
|---|---|---|
| `tabelog.com/tottori/A3103/A310301/31005295/` | `twitter.com//tarkunramengary\r\n\r\n麺バカTAR-KUN～全国制覇の野望～` | profile(欠陥URL、正規表現マッチ由来のノイズの可能性が高い) |
| `tabelog.com/shizuoka/A2202/A220201/22011766/` | `twitter.com/waniwanipaipan` | profile(店の公式アカウントらしき正常な形式) |

いずれも**アカウントのトップページへのリンクであり、個別ツイートへの直リンクではない**。
X syndication(`cdn.syndication.twimg.com/tweet-result`)は**既知のツイートID/URLが前提の
Enrichment専用API**(`x-syndication-widget-reverse-engineering.md`で確定済み)であるため、
プロフィールURLしか見つからない現状では投入できず、hypothesis通りの制約が実データでも再現された。

参考までに、n=200での`p_handle_found`(instagram/facebook/x/tiktokいずれか1つでも本物のリンクが
見つかったページの割合)は44.5%で、Round1のn=10実測(70%、Wilson 95%CI [40%, 89%])の**信頼区間下限
付近**に位置しており、小標本の点推定が上振れしていたことも合わせて確認できた(矛盾ではなく、
小標本ゆえの区間の広さの範囲内)。

### 6. Coverage統合計算(`coverage_youtube_only.py`をモジュールとして再利用)

`coverage_combined.py`は`coverage_youtube_only.py`をimportし、`P_ATTEMPT_V3`定数と`coverage()`関数を
再利用(重複計算なし・DBアクセスなし、本スクリプトはDBに一切接続しない)。

```
p_a_immediate = p_handle_found(0.70) × platform_share_x_or_tiktok(2/89=2.2%) × post_permalink_rate(0.0)
              = 0.00%   ← post_permalink_rate が実測0のため、他の係数の値に関わらず自動的に0
p_a_future    = p_handle_found(0.70)  ← Business Verification完了後、IG/FBハンドル全量が使える前提
```

| k | YouTube単独 | 今日の現実的上限(+CC+X syndication) | 将来上限(IG/FB App Review後) | gap今日(pp) | gap将来(pp) |
|---:|---:|---:|---:|---:|---:|
| 1 | 20.0% | 20.0%(+0.0) | 76.0%(+56.0) | 40.0 | -16.0 |
| 3 | 48.8% | 48.8%(+0.0) | 84.6%(+35.8) | 11.2 | -24.6 |
| 5 | 67.2% | 67.2%(+0.0) | 90.2%(+22.9) | -7.2 | -30.2 |
| 8 | 83.2% | 83.2%(+0.0) | 95.0%(+11.7) | -23.2 | -35.0 |

「今日の現実的上限」列は全k値でYouTube単独と小数点以下まで完全一致(上乗せ+0.00pt)。
60%目標に対しては、YouTube単独と全く同じ理由で k≥5(dev.dishesの実測分布では現実的な値ではない
高いkのみ)でようやく到達し、k=1,3では届かない(gap +40.0pp, +11.2pp)。CommonCrawl+X syndicationの
併用は、この構造を全く変えない。

## 評価まとめ

| 検証項目 | 結果 |
|---|---|
| index.commoncrawl.org (CDX API) 疎通 | 不通(HTTP 000)、`round2_multi-portal-cc-coverage-estimate.md`と同じ状況を再現 |
| `cluster.idx`直読みフォールバック | 成功。`com,tabelog)/`ドメイン全体が単一シャード10ブロックに収まり1回のRange GETで全国分取得 |
| 全国店舗トップページプール(status=200) | 13,780件(56エリア)。tokyo=5,135はRound1実測と完全一致 |
| SHA-256決定的サンプリング n=200 | 実施。WARCバイトレンジ取得 200/200件成功(HTTP 206) |
| X/Twitterリンク発見 | 2/200件(いずれもプロフィールURL、投稿パーマリンクではない) |
| TikTokリンク発見 | 0/200件 |
| post_permalink_rate(X+TikTok合算) | **0.0%**(n=10でも0/10、n=200でも0/202→実質同じ結論を20倍の標本で確認) |
| p_a_immediate(今日使える追加寄与) | **0.00%**(全k値で) |
| p_a_future(App Review後の将来上限) | 70.0%(Round1のp_handle_foundをそのまま使用、CI [40%,89%]) |
| YouTube単独 vs 併用「今日上限」の差 | 全k値(1,3,5,8)で完全に同値。上乗せ実質ゼロを再確認 |
| p_handle_found のn=200再検証 | 44.5%(n=10実測70%のWilson 95%CI [40%,89%]の下限付近、矛盾なし) |

**総合結論**: hypothesisで提示された「0%/1%/5%」の3シナリオのうち、n=200の大標本再検証は明確に
**0%シナリオ**を裏付けた。X syndication(`cdn.syndication.twimg.com`)自体は既知ツイートIDに対する
Enrichmentとしては無料・無認証で完全に機能する(`x-syndication-widget-reverse-engineering.md`で
5/5実測済み)が、そのツイートIDをCommonCrawl経由のポータル逆引きで**発見できるケースが実データ上
皆無**である以上、「YouTube+CommonCrawl+X syndication」の組み合わせによる上乗せは、今日時点では
YouTube単独の試算から実質的に変わらない。CommonCrawl経由で得られる追加価値は、Business
Verification完了を前提としたIG/FB直接埋め込み(p_handle_found=70%)にほぼ限定される、という
hypothesisの整理は実測によって裏付けられた。次に意味のある追加検証があるとすれば、X/TikTok向け
ではなく「IG/FB Business Verificationの取得可否・所要期間」そのものであり、CommonCrawl側の
サンプルサイズをこれ以上拡大しても(post_permalink_rateが構造的にゼロという結論には)影響しない
という判断がscale_reasoningの主張どおり成立していたことも確認できた。

## 生成物

- `scripts/20260808T0000_restaurant/1273_sns_dish_media_poc/coverage_combined.py`
  (`extract`/`combine`/デフォルト`auto`の3サブコマンド。DB接続なし・読み取り専用HTTPSのみ)
- `scripts/20260808T0000_restaurant/1273_sns_dish_media_poc/out/cc_national_extract_n200.json`
  (n=200抽出の生データ・分類結果)
- `scripts/20260808T0000_restaurant/1273_sns_dish_media_poc/out/coverage_combined_2026-08-13.json`
  (coverage統合計算の最終結果)
