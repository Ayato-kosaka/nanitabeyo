# Round2 検証: geo-matched-fuzzy-restaurant-linking

- slug: `geo-matched-fuzzy-restaurant-linking`
- 検証日: 2026-08-13
- 検証者: サブエージェント(実機検証)
- 結論: **PARTIALLY CONFIRMED → 却下寄り (needs_more_testing→reject寄り)**。
  仮説の前半(「Round1の0/6はアルゴリズムの限界ではなく地理的サンプリングのズレが主因」)は**実データで反証**された。
  地理を意図的に合わせても真の突き合わせ率は数%にとどまり、真因は「dev.restaurantsが全国70万件目標に対し
  2,439件(約0.35%)しかない」というカバレッジの薄さそのものである。ただしアルゴリズム自体(正規化+pg_trgm+
  PostGIS近傍)は閾値0.4以上で実測した限りでは偽陽性ゼロ(precision高)であり、「使えない」わけではなく
  「今のdev.restaurantsの規模では出番が少ない」というのが正確な結論。

---

## 1. 環境確認(実施済み)

```
$ psql "$DATABASE_URL" -c "SET search_path TO dev; SELECT count(*) FROM restaurants;"
 count
-------
  2439

$ psql ... -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_trgm','postgis');"
 extname | extversion
---------+------------
 pg_trgm | 1.6
 postgis | 3.3.7
```

`dev.restaurants` の列: `id, google_place_id, name, name_language_code, latitude, longitude, image_url,
address_components(jsonb), plus_code(jsonb), created_at, location(geography(Point,4326)), image_path`。

`similarity()` 等 pg_trgm の関数は `extensions` スキーマにあり、`search_path` に `extensions` を含めないと
`function similarity(text, unknown) does not exist` で失敗する(躓きポイントとして記録)。

## 2. dev.restaurants の密集エリア再確認(hypothesisの前提の検証)

```sql
SET search_path TO dev;
SELECT round(latitude::numeric,2) lat2, round(longitude::numeric,2) lng2, count(*)
FROM restaurants GROUP BY 1,2 ORDER BY 3 DESC LIMIT 4;
```

| lat(2桁) | lng(2桁) | 件数 | 推定エリア |
|---|---|---|---|
| 35.68 | 139.77 | 278 | 日本橋・京橋周辺(C1) |
| 35.66 | 139.70 | 213 | 芝・六本木周辺(C2) |
| 35.69 | 139.70 | 128 | 新宿駅周辺(C3) |
| 35.63 | 139.74 | 109 | 品川駅周辺(C4) |

hypothesisで述べられた数値と一致(実測で再確認)。各クラスタの実際のbboxも取得済み:

| cluster | lat範囲 | lng範囲 |
|---|---|---|
| C1 日本橋・京橋 | 35.6751–35.6847 | 139.7651–139.7750 |
| C2 芝・六本木 | 35.6556–35.6646 | 139.6971–139.7050 |
| C3 新宿駅 | 35.6874–35.6946 | 139.6951–139.7046 |
| C4 品川駅 | 35.6260–35.6335 | 139.7358–139.7447 |

## 3. Common Crawl取得ルートの障害と回避(重要な運用上の発見)

**`index.commoncrawl.org` は本セッションのサンドボックスから完全に到達不能**(`Connection refused`、
DNS解決自体はでき54.237.141.66に到達するがTCP接続が拒否される。4回リトライしても000固定)。一方
`data.commoncrawl.org`・`commoncrawl.org`・S3(`*.amazonaws.com`)・一般サイト(google.com, tabelog.com)は
すべて到達可能。Round1では`index.commoncrawl.org`のCDX APIが使えていた記録があるため、これは環境差(この
セッション固有のネットワーク制限)である可能性が高い。

回避策として、CDX APIを経由せず**CDXシャードファイルを`data.commoncrawl.org`から直接HTTP Rangeで取得**する
方式に切り替え、成功した:

1. `https://data.commoncrawl.org/cc-index/collections/CC-MAIN-2026-30/indexes/cluster.idx`(約94.5MB、圧縮
   なしプレーンテキスト、802,593行)を全件取得。各行は「ソートキー(reversed-domain URL) / シャードファイル名
   (`cdx-NNNNN.gz`) / バイトオフセット / 長さ」を表す約3,000レコード単位のインデックス。
2. `cluster.idx`をgrepして`com,tabelog)/tokyo/a13xx`周辺の行を特定し、該当チャンクの
   `offset`/`length`をそのまま`Range: bytes=start-end`ヘッダでシャード(`cdx-00133.gz`)に対して発行、
   206 Partial Contentで該当チャンク(286KB前後の自己完結gzipメンバー)のみ取得・展開。
3. 得られたJSON Lines形式のCDXレコード(`filename`, `offset`, `length`)を使い、`data.commoncrawl.org`に対して
   再度Range GETでWARCレコード単体(30〜50KB)を取得。

この方式で**index.commoncrawl.org不通環境でもCDX+WARC取得のフルパイプラインが成立する**ことを実証した
(下記の通り610件のWARC取得を実施し、598件成功)。今後のRoundでもindex.commoncrawl.orgが不通の場合の
フォールバックとして記録する。

## 4. CC東京都心部サンプルの取得とジオ・SNS抽出

`com,tabelog)/tokyo/a1301`〜`a1320`の範囲(2チャンク、6,000レコード)から正規の店舗詳細URL
(`https://tabelog.com/tokyo/A\d+/A\d+/\d+/`、クエリパラメータなし)を3,004件抽出。20エリアコードそれぞれから
最大30件(乱数シード固定)を層化サンプリングし、**600件**をWARC取得対象とした。

抽出パターン(1〜2件を目視確認の上で確定):
```
"@type":"Restaurant","@id":"...","name":"店名","address":{...,"addressLocality":"...","addressRegion":"..."},
"geo":{"@type":"GeoCoordinates","latitude":35.66862...,"longitude":139.76110...}
```
tabelogは全ページにJSON-LD `Restaurant` スキーマを埋め込んでおり、正規表現一発で店名・住所・緯度経度が
高精度に取れる(Round1で使ったmicrodata/JSON-LD混在パターンの目視確認が必要という想定より単純だった)。

**結果: 600件中598件WARC取得成功(2件SSLタイムアウト)、597件で緯度経度抽出成功(成功率99.5%)。**
副産物として、SNS(Instagram/Facebook/Twitter/X)リンクが本文中に検出できたのは597件中279件(**46.7%**)。
Round1(n=10, 70%)と近い水準で、tabelogページの半数弱に公式SNSリンクが埋め込まれていることを追加で確認できた。

## 5. dev.restaurants密集クラスタへの地理的絞り込み

C1〜C4の各bboxを緯度経度±0.01度(約1.1km)バッファして597件を判定:

| cluster | 該当件数(バッファ内) |
|---|---|
| C1 日本橋・京橋 | 59 |
| C2 芝・六本木 | 49 |
| C3 新宿駅 | 38 |
| C4 品川駅 | 14 |
| **合計** | **160**(名前+ジオ両方取れたもの) |

つまり無作為に取った597件中160件(26.8%)が「意図的にdev.restaurantsの密集地に絞った」候補になった。
Round1は全国無作為10件でこの絞り込みを一切していなかったため、この時点で母集団設計は仮説通り改善している。

## 6. pg_trgm + PostGIS グリッドサーチ(160候補 × 半径4パターン × 閾値3パターン = 12設定)

正規化関数(全角/半角統一=NFKC、括弧内除去、「店」「本店」「駅前店」等のブランチサフィックス除去、
空白除去、小文字化)を実装し、各候補につき

```sql
SELECT id, name, similarity(lower(name), :norm) sim, ST_Distance(location, ST_MakePoint(:lng,:lat)::geography) dist
FROM restaurants
WHERE ST_DWithin(location, ST_MakePoint(:lng,:lat)::geography, :radius)
ORDER BY sim DESC LIMIT 1;
```
を実行し、`sim >= threshold` をヒットと定義した。

| 半径\閾値 | 0.3 | 0.4 | 0.5 |
|---|---|---|---|
| 300m | 6 | 2 | 2 |
| 500m | 6 | 2 | 2 |
| 1000m | 7 | 2 | 2 |
| 2000m | 7 | 2 | 2 |

(160候補中のヒット数。半径を広げても閾値0.4/0.5では2件で頭打ち)

### 目視precision確認

**閾値0.4/0.5(半径問わず2件)**: 2/2とも実質同一店舗の完全一致。
- `築地すし好 和 グランスタ丸の内店` → 同名, sim=0.50, **距離1.25m**
- `伊勢久` → 同名, sim=1.00, **距離1.19m**

距離が1m台という異常な近さは、dev.restaurants側も何らかの経路(Google Places等)で同じ番地・建物の
座標を取得しており、両者が実質同一点に収束していることを示す。**precision=100%(n=2、母数が小さい点は
留保が必要)**。

**閾値0.3・半径300m(6件)**を目視確認:

| CC店名 | DB店名 | sim | 距離 | 判定 |
|---|---|---|---|---|
| ウォルプタス 東京駅グランルーフ店 | ウォルプタス | 0.35 | 1m | **TP** |
| 幸の鳥 | 幸の鳥 うなぎのぼり | 0.36 | 179m | 疑わしい(別業態の可能性、**FP寄り**) |
| 築地すし好 和 グランスタ丸の内店 | 同左 | 0.50 | 1m | **TP** |
| スターバックス コーヒー 東急プラザ表参道オモカド店 | 東急プラザ表参道「オモカド」 | 0.31 | 21m | **FP**(スタバではなく商業施設そのものの店舗名とマッチ) |
| 茶茶 白雨 | 同左 | 0.38 | 1m | **TP** |
| 伊勢久 | 同左 | 1.00 | 1m | **TP** |

→ 6件中4件TP・1件FP・1件境界(precision目安 4/6=67%)。

**半径2000mまで広げた場合**、閾値0.3で7件目として `日本橋 二葉 → 日本橋長寿庵`(sim=0.30, 距離852m、
「日本橋」の3文字共有だけの明確な**FP**)が追加され、precisionは4/7=57%に低下。半径を広げるほど
偽陽性が増える(想定通り)。

### 結論: 精度は閾値0.4以上に絞れば実用域だが、再現率(recall)が極めて低い

160候補中、閾値0.4以上での真陽性は実質2件、**recall ≈ 1.25%**。閾値0.3まで緩めても真陽性は4〜5件程度で
**recall ≈ 2.5〜3%**にとどまる。

## 7. アブレーション: Round1の実サンプル(9/10件を実座標付きで再取得)

Round1がRSS-Bridge/SNS抽出に使った10件のtabelog URLのうち、9件をcluster.idx経由で再特定しWARC再取得
できた(1件`A1301/A130101/13013149`はCC-MAIN-2026-30のCDXインデックス内に見当たらず未回収)。
実際のJSON-LD店名・緯度経度・SNSリンクを取得できたのは重要な前進である(Round1時点ではSNSハンドル文字列
しか記録されておらず、公式店名や座標は未記録だった)。

| 店名(実際のtabelog正式名) | SNSハンドル | 緯度,経度 | 最寄りクラスタ | 距離 |
|---|---|---|---|---|
| 神戸牛焼肉 すき焼き 麗 渋谷 | - | 35.6557,139.7058 | C2 芝・六本木 | **0.65km** |
| DOBROGI HUNGARIAN BAR & DINING | dobrogi_akasaka | 35.6710,139.7406 | C1 日本橋・京橋 | 2.84km |
| ENEKO Tokyo | enekotokyo | 35.6584,139.7257 | C2 芝・六本木 | 2.23km |
| スパイラルカフェ | spiralcafe.jp | 35.6636,139.7118 | C2 芝・六本木 | **1.04km** |
| ブラフベーカリー 元町本店 | bluffbakery | 35.4385,139.6497(横浜市中区) | C4 品川駅 | 22.78km |
| シュラスコ＆ビアバー ゴッチバッタ 渋谷道玄坂 | gocchibatta | 35.6585,139.6981 | C2 芝・六本木 | **0.32km** |
| コンシールカフェ・サクラガオカ | - | 35.6572,139.7015 | C2 芝・六本木 | **0.32km** |
| パーラー江古田 | parlour_ekoda | 35.7399,139.6711 | C3 新宿駅 | 6.02km |
| ハッピー | kameari_happy | 35.7685,139.8468(葛飾区亀有) | C1 日本橋・京橋 | 12.04km |

**重要な発見**: hypothesisは「Round1サンプルはdev.restaurantsクラスタとほぼ非重複」と推定していたが、
実測では**9件中5件が0.32km〜2.84kmという至近距離**にあった(特に渋谷・六本木エリアの3件は300m台)。
「地理的に遠いから0/6だった」という前提は部分的にしか成立しない。

この5件+DOBROGI/ENEKOの計7件(距離2.84km以内)に対し、実際に正規化+pg_trgm+PostGIS
(半径500m/1000m/2000m)で本番と同じロジックを実行した:

```
=== radius=2000m ===
神戸牛焼肉 すき焼き 麗 渋谷    -> best sim=0.05  (渋谷 マスダ亭, 688m)
DOBROGI HUNGARIAN BAR & DINING -> best sim=0.14  (Yanbaru Diner, 1964m)
ENEKO Tokyo                    -> best sim=0.00  (東京油組総本店 渋谷組, 1975m)
スパイラルカフェ                -> best sim=0.09  (スパゲッティーのパンチョ渋谷店, 1240m)
ブラフベーカリー 元町本店        -> best sim=0.00  (麺処 おおぎ 蓬莱町店, 1387m)
シュラスコ...ゴッチバッタ渋谷道玄坂 -> best sim=0.09  (モスバーガー渋谷道玄坂店, 88m)
コンシールカフェ・サクラガオカ    -> best sim=0.09  (to your Farm サクラステージ店, 41m)
パーラー江古田                  -> nearby_count=0(dev.restaurantsが半径2km以内に1件も存在しない)
ハッピー                        -> nearby_count=0
```

**半径2000m・類似度は最も緩い設定でも9件中0件がヒット**(最良類似度は全て0.14以下で、テストしたどの
閾値(0.3/0.4/0.5)も大きく下回る)。特に渋谷・六本木の至近距離(88m〜688m)にあった4件でさえ、
dev.restaurants側にそもそも該当店舗のレコード自体が存在しない(ST_DWithin 2000mで返る近傍店舗数は
0〜3件のみで、単に別の店がヒットしているだけ)。

## 8. 総合結論: 何が0/6(Round1)・低recall(Round2)の真因か

仮説は「Round1のCCサンプルがdev.restaurantsの密集地とほぼ非重複だったこと」を主因として提示していたが、
アブレーションの結果、**この説明は反証された**。理由:

1. Round1サンプル9件中5件は実際には0.32〜2.84kmという至近距離で、地理的には十分「重なって」いた。
2. それにもかかわらず、Round2の本番ロジック(正規化+pg_trgm+PostGIS、半径2000mまで)を適用しても
   9件全てで有意な類似度(閾値0.3未満)すら得られなかった。
3. Round2の意図的な地理絞り込みサンプル(160件、dev.restaurants密集地に厳密限定)でも、真陽性はわずか
   2〜5件(recall 1.25〜3%)にとどまった。

**真因は「dev.restaurantsの絶対的なレコード数の少なさ」である。** dev.restaurantsは現状2,439件しかなく、
issueが掲げる全国目標(約70万件)の**約0.35%**にすぎない。今回最も店舗密度が高いはずの東京都心4クラスタ
(日本橋・六本木・新宿・品川、合計728件)に絞ってすら、tabelogから無作為抽出した160件のうち実際に
dev.restaurantsに存在した店はわずか2〜5件だった。つまり「dev.restaurants側にその店が登録されている
確率」自体が数%しかなく、これは名寄せアルゴリズムの精度をどれだけ上げても解決しない構造的な制約である。

一方で、**アルゴリズム自体の精度(precision)は良好**であることも確認できた。閾値0.4以上・地理的近傍
(ST_DWithin)を先に掛けるという設計により、確認した2件は完全一致(100% precision, ただしn=2で統計的
信頼性は低い)。閾値0.3まで緩めると偽陽性が増える(4/6〜4/7、約60〜70%)ため、本番投入するなら
閾値0.4以上を推奨する。チェーン店・商業施設同居店(スターバックス×東急プラザの例)のような偽陽性パターンも
実データで確認できた。

## 9. 実用上の位置づけ(所見)

- **Discovery(未知の店を見つける)手段としては不採用**: この手法はdev.restaurantsに**既に登録済みの店**を
  前提にした「既存店の名寄せ・SNSハンドル補完(Enrichment)」であり、CC全体から新規店舗を発掘する経路には
  ならない。かつ、既存店であってもヒット率は2〜3%と低い。
- **将来的な価値**: dev.restaurantsが将来的にGoogle Places API等で本格的に70万件規模までスケールした
  場合、この手法のrecallは店舗マスターの充実度に比例して改善するはずである(現状のボトルネックは
  アルゴリズムでなくデータ量)。したがって「今は時期尚早だが、restaurantsテーブルが十分育った後の
  補完チャネルとして再評価する価値はある」という位置づけが妥当。
- **現時点でのコスト対効果**: 600件のtabelogページ取得(WARC Range GET、無料・認証不要)に対し実質2〜5件
  のヒットしか得られず、対象を東京都心の最密集エリアに絞ってもこの水準である。全国70万件×134カテゴリという
  スケールに対しては、実装・運用コスト(正規化ロジック保守、閾値チューニング、FPレビュー)に見合わない。

## 10. ToS/データ設計上の留意点(test_plan項目8への回答)

本アイデアは「ポータル(tabelog)の店名・住所・SNSリンクを抽出し、自社のgoogle_place_idベースの店舗
マスターに恒久的に紐付けて保存する」設計であり、Idea Aで検証した単発Enrichment(既知ツイートIDの
本文取得)よりも、ポータル側directoryの体系的な複製・転記に近い性質を持つ。特に緯度経度と店名の組み合わせは
各ポータルが独自に収集・アノテーションした付加価値情報であり、そのまま自社DBに複製・保存することは
「情報の商用目的での再配布」とみなされるリスクが単なるSNSハンドル抽出より高い。

したがって実装する場合は以下を推奨する:
- ポータル側の緯度経度・住所文字列は**名寄せのための一時的な中間キーとしてのみ**使用し、DBに永続保存しない。
- 永続保存するのは、既存の`restaurants`テーブルの正規カラム(Google Place APIから独自取得した自社の
  緯度経度・店名)と、そこに紐付くSNSハンドル文字列のみに限定する。
- 本検証で使ったWARC取得はすべて`data.commoncrawl.org`(Common Crawl財団が提供するオープンデータの
  再配布インフラ)からのRange GETであり、tabelog.comへの直接アクセスは一切発生していない(Round1の
  結論を踏襲)。

## 11. 使用データ量(スケール確認)

- `cluster.idx`: 1ファイル、約94.5MB(索引全体、圧縮なし、無料・認証不要)
- CDXシャードのRange GET: 3チャンク、合計約850KB
- WARC個別レコードのRange GET: 610件(本番サンプル600件 + Round1アブレーション用9件 + 動作確認1件)、
  1件あたり30〜50KB、合計約20〜25MB
- DB(dev, 読み取り専用): 集計SELECT数本 + グリッドサーチ用SELECT 約2,000件(pg_trgm類似度 + PostGIS近傍)
- 課金が発生する呼び出しは一切なし。書き込みも一切なし(読み取り専用トランザクションを明示指定)。

---

## 付録: 主要な生データファイル(サブエージェント作業ディレクトリ、本リポジトリ外)

- `/tmp/candidates.json` — CC CDXから抽出した東京都tabelog正規URL 3,004件
- `/tmp/round2_results.json` — 層化サンプル600件のWARC取得結果(店名・緯度経度・SNSリンク)
- `/tmp/cluster_matches.json` — dev.restaurants密集クラスタ内160件の抽出結果
- `/tmp/grid_results.json` — 半径×閾値グリッドサーチのヒット数一覧
- `/tmp/hits_r300_t0.3.json`, `/tmp/hits_r2000_t0.3.json`, `/tmp/hits_r500_t04.json` — 目視precision確認に
  使ったヒット詳細
- `/tmp/round1_10_refetch.json` — Round1サンプル9/10件の実座標・実店名再取得結果
- `/tmp/normalize.py` — 店名正規化関数(NFKC正規化・括弧除去・ブランチサフィックス除去)
