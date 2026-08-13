# Issue #843 日本の飲食店オープンデータ網羅性 POC 調査報告

調査・実測日: 2026-08-08  
関連: [Issue #843](https://github.com/Ayato-kosaka/nanitabeyo/issues/843)、[調査コメント](https://github.com/Ayato-kosaka/nanitabeyo/issues/843#issuecomment-5226108294)

> 技術・データライセンスの意思決定資料であり、個別案件の法律意見ではない。規約、著作権、ODbLによる公開義務は本番採用前に法務確認する。

## 1. 結論

**全国seedはOverture Maps Placesを第一候補にする。** 固定snapshot `2026-07-22.0`の日本`food_and_drink`を実際に取得・集計したところ789,612行あり、名称・座標・住所が揃い、source横断dedupeも済んでいた。

ただし789,612行は「営業中飲食店を78万店網羅」の意味ではない。`operating_status`は789,612行中789,609行がnullで、バー、ワイナリー、フードトラック等も含む。**採用条件は現行DB全件をreferenceとして照合し、未照合を0件にすること**である。

IFASは補完に使う。公開CSVは全許可施設ではなく、**電子申請され、申請者がオープンデータ掲載に同意したものだけ**である。地域差が極端で全国主軸にできない。一方、許可・廃業・満了日、電話、座標を持つため、存在確認、閉店候補、Overture未収録候補として価値がある。

OSMは第二補完とする。コア8業態199,798件で、全国seedとしてはOvertureより大幅に少ない。料理種別や営業時間タグは有用だが疎で、ODbLを考慮した分離設計が必要になる。

画像・レビューは次の判断とする。

- **Google MapsレビューをcrawlしてLLM要約する案は本番採用しない。** scraping、レビュー等の保存・複製、Maps Contentを基にしたコンテンツ作成が規約で制限される。要約文に新たな表現上の著作権が生じ得ても、入力データの権利・契約違反・来歴は消えず、「自社著作権化」は合法化手段にならない。
- **公式ページの画像crawlは発見用途まで。** 公開やrobots.txtの取得許可は、複製・公衆送信・商用利用の許諾ではない。無許諾で自社CDNへ再保存しない。ownerの権利保証付きupload、UGC、個別license、撮影で取得する。
- Hot Pepper APIの店舗トップ画像は候補になるが、attribution、鮮度・cache規定、事業モデル制限に従うlive enrichmentであり、自社media masterにはしない。レビュー本文は同APIにない。

### 採用判断

| 候補 | 実測規模 | 商用・license | 判断 | 主な問題 |
|---|---:|---|---|---|
| Overture Places | 789,612 | featureごとにCDLA Permissive 2.0 / Apache 2.0等、attribution必須 | **主軸POC継続** | active/closedがほぼ不明、真の網羅率未検証 |
| IFAS公開CSV | 有効397,011行、名称住所dedupe 278,247 | 政府公開データ、公開条件をsnapshot単位で保存 | **補完** | 同意済み電子申請だけ、地域偏在、給食・露店等を含む |
| OSM | コア8業態199,798 | ODbL 1.0 | **補完/別レイヤ** | 件数・項目不足、派生DBの公開義務設計 |
| Hot Pepper API | 全国件数未実測 | 無料APIだがcredit、cache、事業モデル制限あり | **live enrichment候補** | open dataではない、永続master化不可 |
| Yahoo!ローカルサーチAPI | 全国電話帳を標榜、1日5万request | Client ID・credit・規約準拠 | **比較POC候補** | start最大3000、bulk snapshot不向き |
| Google Places | API検索では強い | place ID以外の保存・派生利用に強い制限 | **ユーザー起点liveのみ** | seed、review収集、画像再配布には使わない |
| 公式サイトcrawl | 規模不明 | assetごとの権利 | **metadata発見のみ** | copyright、規約、更新・削除 |
| Google/Tabelog等の無許諾crawl | 規模大 | 規約・著作権等の高risk | **No-Go** | 停止・削除・紛争risk、来歴を消せない |

## 2. 実測結果

### Overture Maps Places

[release 2026-07-22.0](https://docs.overturemaps.org/release-calendar/)のPlaces Parquetから、`addresses[1].country = 'JP'`かつtaxonomy hierarchyに`food_and_drink`を含む行を抽出した。bboxだけでは韓国等が混入するため国コード条件が必須である。

| 指標 | 実測 |
|---|---:|
| 日本`food_and_drink` | 789,612 |
| 名称・住所 | 789,612（100%） |
| 電話 | 722,826（91.54%） |
| website | 443,323（56.14%） |
| SNS | 714,103（90.44%） |
| email | 71,354（9.04%） |
| confidence ≥ 0.8 | 479,677（60.75%） |
| 同一正規化名・座標小数4桁の余剰重複 | 90（約0.011%） |
| operating status | open 3、null 789,609 |

主なcategoryはrestaurant 498,237、bar 99,715、cafe 66,051、casual_eatery 62,287、coffee_shop 30,900、fast_food_restaurant 11,407。source行数はMeta 691,250、Foursquare 85,913、Microsoft 7,705、AllThePlaces 4,741、PinMeTo 3である。一つのfeatureに複数sourceが付く場合がある。[Overtureのlicense説明](https://docs.overturemaps.org/attribution/)に従い、source licenseをfeature単位で保持する。

### IFAS

[IFAS FAQ](https://i2fas.mhlw.go.jp/faq.htm)と公開ページから2026年6月末snapshot、157自治体CSV、合計約358.8 MiBを取得した。CSVには同意された場合の施設名、住所、緯度経度、電話番号等が含まれる。以前の仮説「座標がない」は誤りである。

| 指標 | 実測 |
|---|---:|
| 全許可・届出行 | 1,089,349 |
| unique行番号 | 993,483 |
| 重複行 | 95,866 |
| `飲食店営業` / `喫茶店営業` | 400,816 |
| 2026-08-08時点で廃業なし・期限内 | 397,011 |
| 名称+住所exact dedupe | 278,247 |
| 上記のうち座標あり | 261,924（94.13%） |
| active行の名称欠損 | 108,002（27.20%） |
| active行の住所欠損 | 112,557（28.35%） |
| active行の座標欠損 | 129,295（32.57%） |
| active行の電話欠損 | 210,737（53.08%） |

active行の例は福岡36,739、静岡33,298、千葉32,690、東京10,656、大阪6,803、愛知1,786、兵庫1,477、福島197、大分157、島根118。実際の市場規模で説明できない差であり、同意済み電子申請という公開条件の偏りを示す。

業態には空欄118,290、居酒屋15,390、食堂14,993のほか、露店11,561、コンビニ8,629、キッチンカー5,844、給食3,364等が含まれる。固定店舗の定義に合わせた除外・分類が必要である。

Overtureとの保守的な重なりを「正規化名称が完全一致かつ100m以内」で測ると、IFASの座標付きdedupe 261,924件中37,083件（14.16%）だけが一致した。表記差を拾わない下限値だが、source横断entity resolutionが独立課題であることを示す。

### OpenStreetMap

[Geofabrik Japan Taginfo](https://taginfo.geofabrik.de/asia/japan/)の2026-08-07T20:20:18Z時点を集計した。

| 指標 | 件数 | 率 |
|---|---:|---:|
| コア8業態 | 199,798 | 100% |
| name | 188,687 | 94.4% |
| cuisine | 87,560 | 43.8% |
| opening_hours | 24,571 | 12.3% |
| phone | 20,415 | 10.2% |
| website | 14,566 | 7.3% |
| wheelchair | 9,941 | 5.0% |
| internet_access | 3,432 | 1.7% |
| payment:credit_cards | 1,178 | 0.6% |

OSMは[ODbL 1.0](https://www.openstreetmap.org/copyright)である。「混ぜたら必ず全DBが感染」のような単純化は避けつつ、derived database/collective databaseの境界を法務確認し、source snapshot、変換、配布を分離する。

## 3. 現行DBの100%網羅を証明する方法

1. 現行`restaurants`をUUID、名称、座標、google_place_id付きでreference exportする。
2. Overture候補を名称・距離で照合する。
3. 未照合のみIFAS、必要ならOSMで照合する。
4. 曖昧・未照合を人手確認する。営業継続を確認できた現行行は`legacy_current_db`としてcarry-forwardする。
5. 新core IDにOverture/IFAS/OSM/GoogleのIDを別々に紐付ける。
6. `accepted match + reviewed carry-forward = 現行DB総件数`のときだけGoにする。

100%網羅とは、すべての現行restaurantが新しいsource-aware coreで失われないことを指す。open data IDが見つからない現行店を削除しない。

| gate | 合格条件 |
|---|---|
| 現行DB保全 | 100.00%。unmatched/ambiguousは全件review済みcarry-forward |
| provenance | source、source record ID、release、license、retrieved_at、checksumを100%保持 |
| Google非依存 | seed必須fieldのGoogle由来値0件 |
| 誤結合 | 層化標本監査で0.5%未満を目標 |
| duplicate | 余剰0.5%未満を目標 |
| 再現性 | pinned snapshotから同じ件数・checksum・差分reportを生成可能 |

## 4. `google_place_id`の紐付け

現行`restaurants`は`google_place_id`、`image_url`、`address_components`が必須で、Place Detailsから店舗を作る前提になっている。open-data seedより前にGoogleをcoreから分離する。

```sql
restaurant_external_ids (
  restaurant_id uuid not null,
  provider text not null,
  external_id text not null,
  match_status text not null,
  match_method text,
  match_confidence numeric,
  matched_at timestamptz,
  last_verified_at timestamptz,
  primary key (provider, external_id)
);

restaurant_source_records (
  restaurant_id uuid not null,
  provider text not null,
  source_record_id text not null,
  release text not null,
  license text not null,
  source_url text,
  checksum text,
  observed_at timestamptz not null,
  raw_object_path text,
  primary key (provider, source_record_id, release)
);
```

place ID運用:

1. Google機能を使うユーザー操作時だけ、coreの名称・座標で候補を取得する。
2. Googleの名称、住所、電話、review、photoをmasterへ保存せずrequest中だけ比較する。
3. exact/normalized name、距離、必要ならユーザー選択を組み合わせる。複数候補、商業ビル、chain、移転は自動確定しない。
4. 保存するGoogle要素は原則`place_id`と照合状態だけにする。[Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies)ではplace IDはcache制限の例外だが、その他contentは制限対象になる。
5. place IDの変更・廃止に備え、失敗時に再検索し`last_verified_at`を更新する。core IDは変えない。

## 5. 項目coverage

| 項目 | Overture | IFAS | OSM | Hot Pepper API | 推奨source of truth |
|---|---|---|---|---|---|
| 名称・座標・住所 | 強い | 中 | 中 | API | Overture + owner訂正 |
| 電話 | 91.5% | 46.9% | 10.2% | API | Overture/owner |
| 公式URL | 56.1% | なし | 7.3% | 提供元店舗URL | owner確認URL |
| SNS | 90.4% | なし | 疎 | なし | Overture候補 + owner確認 |
| 曜日別営業時間 | なし | なし | 12.3% | 自由文 | owner、OSM補助 |
| 臨時休業・売切れ・営業中 | なし | 廃業/期限のみ | 疎 | API/free text | ownerのリアルタイム更新 |
| ラストオーダー | なし | なし | 自由tag | 自由文に含む場合 | owner |
| menu category/item | なし | なし | 稀 | なし | owner/UGC |
| 税込価格・提供時間・売切れ | なし | なし | なし | なし | owner/POS |
| コース | なし | なし | なし | 有無のみ | owner/予約partner |
| 料理写真 | なし | なし | 稀 | 店舗トップ画像 | owner/UGC/権利処理済み媒体 |
| アレルゲン | なし | なし | なし | なし | owner、menu item単位 |
| 個室・禁煙・駐車場 | なし | なし | 疎 | あり | owner/UGC、API補助 |
| 子連れ・バリアフリー | なし | なし | 疎 | あり | owner/UGC、OSM補助 |
| Wi-Fi | なし | なし | 1.7% | あり | owner/UGC |
| 現金/カード/QR/電子マネー | なし | なし | カード0.6% | 一部 | owner/PSP/POS |
| review本文 | なし | なし | なし | なし | 自社UGCまたは契約partner |

[Hot Pepper API](https://webservice.recruit.co.jp/doc/hotpepper/reference.html)はトップ画像、営業時間、定休日、Wi-Fi、個室、カード、禁煙、駐車場、バリアフリー、子連れ等を持つ。一方、[利用案内](https://webservice.recruit.co.jp/doc/hotpepper/guideline.html)と[利用規約](https://webservice.recruit.co.jp/regulation.html)はcredit、鮮度、cache、再販、事業モデル等を制約する。自由に永続保存できるopen dataではない。

[Yahoo!ローカルサーチAPI](https://developer.yahoo.co.jp/webapi/map/openlocalplatform/v1/localsearch.html)は全国電話帳・owner投稿を検索対象と説明し、名称、座標、住所、電話、review数/URL、画像、駐車場、card、smoking、指定時刻のopen検索を持つ。無料枠は1app 50,000 request/日だが、start最大3000で全国bulk snapshotには向かない。法人・商用・保存・review本文の条件は書面確認する。

## 6. 画像取得

| 手段 | 判断 | 条件 |
|---|---|---|
| owner upload | **推奨** | 権利保証、商用利用許諾、削除/異議申立て、原本証跡 |
| 自社UGC | **推奨** | 非独占的商用license、人物・商標・privacy、moderation |
| 自社/委託撮影 | **推奨** | 撮影者・店舗との契約、用途・期間 |
| Wikimedia Commons等 | 条件付き | assetごとのlicense/attribution/改変条件を保存 |
| 正式API画像 | 条件付き | live表示、credit、cache TTL、停止時削除 |
| 公式siteのimage URL発見 | 条件付き | owner claim画面で候補提示、許諾後にingest |
| 公式site画像の無許諾rehost | **No-Go** | 公開・robots許可だけでは複製/公衆送信を許諾しない |
| Google Maps/Tabelog等のcrawl | **No-Go** | platform規約、投稿者/撮影者の権利、削除追随不能 |

公式site crawlerはschema.org、Open Graph、JSON-LDからURLとmetadataだけ抽出し、本番CDNへbinaryを保存しない。`source_url`, `rights_holder`, `license`, `license_proof`, `allowed_use`, `attribution`, `retrieved_at`, `delete_at`をmedia assetに必須化する。

最短の現実解は、category placeholder → owner claim/domain verification → owner/UGC upload → 正式API画像をsource badge付きlive componentで追加、の順である。

## 7. レビューとLLM要約

[Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms)はMaps Contentのscrape/export/extract、business name/address/review等のcopy/save、Maps Contentに基づくcontent作成等を制限する。したがって次は本番利用しない。

```text
Google Maps reviewをcrawl → DB保存 → LLMへ入力 → 要約だけ公開 → 原文削除
```

問題は取得時のplatform契約、投稿者の文章の権利、翻案・複製、削除要求、名誉毀損、個人情報、hallucinationに残る。「要約文は自社著作権」という主張が一部成り立ってもこれらを消さない。LLMは権利洗浄装置ではない。

採用可能route:

- 自社UGCを主軸にし、投稿規約で機械処理・要約・商用表示を許諾してもらう。
- `input_review_ids`, prompt/model version, generated_at, moderation statusを保存する。
- review削除時にsummaryを再生成するcascadeを実装する。
- partnerから契約供給を受ける場合、原文/要約/保存/再許諾/削除を契約に明記する。
- 正式APIのreviewはprovider UI、attribution、TTLに従うlive表示としmasterから分離する。

食べログの[利用規約](https://tabelog.com/help/rules/)で投稿者がカカクコムへ広い利用許諾を与えていることは、第三者crawlerへの許諾を意味しない。

## 8. 実装順序とGo/No-Go

1. 現行DBのreference CSVを作り、POCで`reference_matches.csv`と`unmatched_reference.csv`を生成。
2. `google_place_id`をexternal IDsへ移し、Google由来必須列をcoreから分離。
3. Overtureをstagingへloadし、license/provenance/diff/重複を記録してmerge。
4. IFASを閉店候補・long-tail、OSMをODbL-awareな補完として取り込む。
5. owner claim、営業時間、menu、payment、allergen、media、review UGCを実装。

Go:

- Overtureを全国seedの主軸として現行DB照合を続ける。
- IFASを許可・閉店・未収録候補の補助にする。
- 現行restaurantはopen-data matchの有無にかかわらず100%carry-forwardする。
- Googleはplace IDだけを外部IDとして保持し、ユーザー起点live機能に限定する。
- 画像・reviewはowner/UGC/正式契約を主軸にする。

No-Go:

- Overture 789,612行を無検証で「営業中restaurant」として公開する。
- IFASを全許可飲食店の全国完全DBとみなす。
- Google由来の名称、住所、写真、reviewをseed/masterへcopyする。
- Google reviewをcrawlし、LLM要約で安全になると考える。
- 公式site・予約site・口コミsite画像をrobots許可だけで自社CDNへrehostする。

## 一次資料

- Overture: [Places guide](https://docs.overturemaps.org/guides/places/)、[Getting data](https://docs.overturemaps.org/getting-data/)、[release](https://docs.overturemaps.org/release-calendar/)、[license](https://docs.overturemaps.org/attribution/)
- IFAS: [公開system](https://i2fas.mhlw.go.jp/)、[FAQ](https://i2fas.mhlw.go.jp/faq.htm)
- OSM: [copyright/license](https://www.openstreetmap.org/copyright)、[OSMF guidance](https://osmfoundation.org/wiki/Licence/Community_Guidelines)
- Google: [Maps Platform Terms](https://cloud.google.com/maps-platform/terms)、[Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)、[service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
- Recruit: [API reference](https://webservice.recruit.co.jp/doc/hotpepper/reference.html)、[利用案内](https://webservice.recruit.co.jp/doc/hotpepper/guideline.html)、[利用規約](https://webservice.recruit.co.jp/regulation.html)
- 日本: [経済センサス](https://www.stat.go.jp/data/e-census/2021/kekka/index.html)、[文化庁 AIと著作権](https://www.bunka.go.jp/seisaku/bunkashingikai/chosakuken/seisaku/r06_02/pdf/94089701_05.pdf)、[経産省 AI事業者ガイドライン](https://www.meti.go.jp/shingikai/mono_info_service/ai_shakai_jisso/pdf/20250328_1.pdf)
