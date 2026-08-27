# 店 → Instagram ハンドル：まだ試していない取得経路の洗い出し

- 調査日: **2026-08-27（UTC）**
- 調査者: Claude（Claude Code）
- 依頼元: nanitabeyo（**商用**の飲食アプリ）。したがって「非営利なら可」の条項は該当しない
- 取得方法: `curl -sS -A "nanitabeyo-research/1.0"` および `python3 requests`。**規約は全て当日実際に取得した原文からの逐語引用**。件数は全て当日実行したクエリの実測値
- 母集団: Overture の日本の飲食 POI **789,612 件**（`fixtures/overture_jp_food.csv`）。3ソース統合の母集団は 1,132,482 件
- 既測の基準線: 店舗公式サイトのクロール **14.00%** / Overture `socials` **2.80%** / 併せて **15.17%**（取得失敗回収後 16.17%）

## 0. この調査で新しく分かった、いちばん重要なこと

**Overture の Instagram 層は、まるごと Foursquare 由来だった。**

`/tmp/overture-jp.parquet` の `sources[].dataset` で分解した実測（本日実行）:

| Overture の出所 | 店数 | うち `socials` に instagram を持つ店 |
|---|---:|---:|
| **Foursquare** | **85,913** | **13,882（16.16%）** |
| meta | 691,250 | **0（0.00%）** |
| Microsoft | 7,705 | — |
| AllThePlaces | 4,741 | — |
| PinMeTo | 3 | — |
| **Foursquare 以外の全て** | 703,699 | **0（0.00%）** |

つまり **Overture が持つ Instagram ハンドル 13,882 件は、1件残らず Foursquare 由来**であり、
**Overture は日本の飲食 789,612 店のうち 85,913 店（10.88%）分しか Foursquare を取り込んでいない。**

Foursquare は自社で **FSQ OS Places** を **Apache License 2.0** で公開しており、
そのスキーマには **`instagram` フィールドが明示的に存在する**（§3 に逐語引用）。
**Foursquare 本家を直接引けば、Overture 経由では落ちている分の Instagram ハンドルが取れる可能性がある。**
これが本調査で見つかった唯一の「規約が明確で、かつ万件規模を覆いうる新経路」である。

---

## 1. 一覧表

「推定カバー件数」は**実測できたものだけ数字を書き、推測では書かない**。
測れなかったものは「未計測」と明記する。

| # | 案 | 実在するか | 規約 | カバー件数（実測） | 判定 |
|---|---|---|---|---|---|
| 1 | **Foursquare OS Places（`instagram` 列）** | **実在**（スキーマに `instagram` 列あり） | **Apache 2.0**（商用可・帰属必須） | **未計測**（HF が gated、HTTP 401）。代理指標: Overture 内の FSQ 由来 85,913 店中 **13,882 店（16.16%）** | **◎ 最優先。ただし要ダウンロード** |
| 2 | Common Crawl（WARC から店サイトの IG リンク抽出） | 実在（127 クロール、最新 CC-MAIN-2026-34） | ToU に**商用禁止条項なし**。ただし「Crawled Content は元サイトの規約に従う」 | 既測: website 保有 305 店中 **85 店（27.87%）**が CC に収録 | **△ 規約は可。だが自社サイト経路 14.00% の再取得にしかならない** |
| 3 | Wayback Machine（アーカイブ済み店サイト） | 実在 | （本調査では規約原文を取得できず） | 既測: 120 店中 **70 店（58.33%）**がアーカイブあり | **△ 同上。CC より収録率は高い** |
| 4 | **Wikidata P2003** | 実在 | **CC0**（無条件可） | **日本のレストラン/カフェ/バーで P2003 を持つ = 184 件** | **× 桁が2つ足りない** |
| 5 | Wikipedia（ja）の外部リンク | 実在 | CC BY-SA | 未計測。ただし上限は Wikidata と同オーダー（日本のレストラン項目自体が 1,026 件） | **× 同上** |
| 6 | **OSM `contact:instagram`（日本の飲食）** | 実在 | **ODbL**（帰属＋Share-Alike） | **1,641 件**（Overpass 実測） | **× 既に使っている経路。かつ小さい** |
| 7 | Google Maps Platform / Places API | 実在 | **明示的に禁止**（No Scraping / No Caching） | — | **× 不可** |
| 8 | Google Business Profile | 実在 | 自店舗の管理者のみ | — | **× 不可（他店の情報は引けない）** |
| 9 | TableCheck 店舗ページ | 実在 | robots は店舗ページを許可。訪問者向け利用規約は**発見できず** | 店舗ページ **6,979 件**。15 件を実取得し IG リンクあり **1 件（6.7%）** → 期待値 約 465 件 | **× 規模が足りない** |
| 10 | EPARK | 実在 | robots は許可（`/mypage` `/search` のみ Disallow）。規約本文は**抽出できず** | 未計測 | **判断保留** |
| 11 | OMAKASE / 一休.comレストラン | 実在 | **robots.txt が HTTP 403**（アクセス拒否） | — | **× 取得しない** |
| 12 | Uber Eats | 実在 | **robots.txt が HTTP 403** | — | **× 取得しない** |
| 13 | 出前館 | 実在 | robots は店舗ページを許可 | 店舗ページの取得を試みたが **0 バイト（実質ブロック）** | **× 取得できない** |
| 14 | Wolt | 実在 | robots は **`Disallow:`（全許可）**。規約本文は取得できず（404／トップへ転送） | 未計測 | **判断保留。ただし配達系に SNS リンクを載せる慣行がない** |
| 15 | **Indeed** | 実在 | **「個人的、非商業的な目的で…利用できます」** | — | **× 不可** |
| 16 | タウンワーク / 求人ボックス / バイトル | 実在 | 規約ページが **404 / 403** で取得できず | 未計測 | **判断保留** |
| 17 | **data.go.jp（政府オープンデータ）** | 実在 | 規約ページ・CKAN API とも **HTTP 503「アクセスできません」** | 取得不能 | **取得できなかった** |
| 18 | **東京都オープンデータカタログ** | 実在 | **CC BY 4.0**（商用可） | 「飲食店」で **113 データセット**。**Instagram 列を持つものは 0**（カタログ全体で "Instagram" に当たるのは青少年携帯電話調査 1 件のみ） | **× ライセンスは可。だが IG が入っていない** |
| 19 | 商工会議所・商店街・地域ポータル | 実在 | 既測（`store_source_tos_survey.md`）: **いずれも事前許諾が必須** | — | **× スケールしない（既判定）** |
| 20 | ドメイン登録情報 / CT ログ（crt.sh） | 実在 | — | crt.sh が **HTTP 502** で取得できず | **× そもそも「ドメイン→店」を結べない** |
| 21 | Instagram 側から辿る | — | Instagram robots.txt が `Disallow: /`（対象外・前提） | — | **× 対象外** |
| 22 | Meta Graph API（Facebook ページ → IG） | 実在 | 既測（`meta_platform_terms_storage.json`）: Platform Terms 3.d が**保持と削除を義務づける** | Overture の Facebook 層は **701,284 店（88.81%）** | **△ 唯一の大量層。ただし規約とレビューが重い（既検討）** |
| 23 | 検索 API（Google CSE / Brave） | 実在 | 規約原文を**取得できなかった** | 未計測 | **判断保留** |
| 24 | HuggingFace / Kaggle の既存データセット | — | — | 検索したが**日本の飲食店 × SNS のデータセットは見つからなかった** | **× 存在しない** |
| 25 | 店に直接聞く / 利用者に登録してもらう | — | — | 既測（`contact_automatability.json` / `optin-reachability.json`） | **既検討。本書の対象外** |

---

## 2. 実測の根拠（案 1: Foursquare OS Places）

### 2.1 `instagram` フィールドが実在する（逐語）

`https://docs.foursquare.com/data-products/docs/places-os-data-schema`（HTTP 200, 758,045 B）から逐語:

> emailString	Primary contact email address of organization, if available
> facebook_idString	This POI's Facebook ID, if available
> **instagramString	This POI's Instagram handle, if available**
> twitterString	This POI's Twitter handle, if available

**「This POI's Instagram handle」= まさに欲しいもの**が、スキーマ上の 1 列として存在する。

### 2.2 ライセンスは Apache 2.0（逐語）

`https://fsq-os-places-us-east-1.s3.amazonaws.com/NOTICE.txt`（HTTP 200）から逐語:

> © 2025 Foursquare Labs, Inc. All rights reserved.
>
> The Foursquare OS Places dataset (the "Data") is licensed under the Apache License, Version 2.0 (the "License"). You may not use, modify, or distribute the Data except in compliance with the License.
>
> As set forth more fully in the License, if you use, modify, or distribute the Data, you must:
> * provide recipients with a copy of the License.
> * if applicable, include prominent notices to the extent you've changed the Data.
> * preserve attribution to Foursquare, including preserving the full content of this NOTICE.txt file.
>
> To ensure appropriate attribution to Foursquare, we recommend the following:
> * if using/distributing the Data in flat file form as-is or after making changes/modifications: include this NOTICE.txt file, which may be modified to include an additional notice of your changes/modifications, if any.
> * **if using/distributing the Data in API form as-is or after making changes/modifications: include a copy of the content from this NOTICE.txt file prominently in your developer documentation for such API**, which may be modified to include an additional notice of your changes/modifications, if any.

**営利目的の禁止条項は無い。** Apache 2.0 なので商用利用は明示的に許諾されている。
条件は「NOTICE.txt の全文を保持して帰属表示する」こと。
nanitabeyo は API 形態で使うことになるので、**開発者ドキュメントに NOTICE.txt の内容を掲載する**のが指定された作法である。

HuggingFace 側のクリックスルー条項（`extra_gated_prompt`、逐語）:

> By clicking the "I agree" checkbox below, you: (a) represent that if you are using the dataset on behalf of an organization (e.g., your employer or other entity), you are agreeing on behalf of that organization; (b) agree to allow repository authors to use your employer or entity name and logo in descriptions of its partners on its website, in media, and in marketing materials.

**利用範囲を制限する条項ではない。**（b）は「Foursquare がパートナーとして社名・ロゴを出せる」という広報上の許諾で、
データの使途には触れていない。**Apache 2.0 のまま。**

### 2.3 件数は数えられなかった（取得失敗の記録）

| URL | 結果 |
|---|---|
| `https://huggingface.co/datasets/foursquare/fsq-os-places/resolve/main/release/dt=2026-08-11/places/parquet/places_000000.parquet` | **HTTP 401**、`x-error-code: GatedRepo`、`x-error-message: Access to dataset foursquare/fsq-os-places is restricted. You must have access to it and be authenticated to access it. Please log in.` |
| `https://fsq-os-places-us-east-1.s3.amazonaws.com/?list-type=2&max-keys=100` | HTTP 200 だが**中身は `LICENSE.txt` と `NOTICE.txt` の 2 ファイルのみ**。`release/` プレフィックスは `KeyCount 0`（S3 配布は停止済み） |
| `https://huggingface.co/api/datasets/foursquare/fsq-os-places/tree/main/release/dt=2026-08-11/places/parquet?limit=1000` | HTTP 200。**parquet 100 ファイル、合計 11.53 GB** |

**したがって「日本の飲食店で `instagram` が入っているのは何件か」は本調査では確定できていない。**
必要なのは **HuggingFace アカウントを作り、ゲートに同意する**という一度きりの人手だけである（HTTP トークンがあれば以後は自動化できる）。

### 2.4 代理指標（実測）— なぜこれが有望だと言えるのか

`/tmp/overture-jp.parquet` × `fixtures/overture_jp_food.csv`（789,612 店）を DuckDB で分解した本日の実測:

```
total                          789,612
Foursquare 由来                 85,913   うち socials に instagram: 13,882 (16.16%)
meta 由来                      691,250   うち socials に instagram:      0 ( 0.00%)
Foursquare 由来でない          703,699   うち socials に instagram:      0 ( 0.00%)
```

`socials` のホスト別内訳（distinct 店数、実測）:

```
facebook.com   701,284
instagram.com   13,882
twitter.com     12,471
```

Foursquare 由来 85,913 店だけに絞った `socials` 内訳（実測）:

```
instagram.com   13,882
twitter.com     12,471
facebook.com    10,019
```

**Instagram も Twitter も、Foursquare 由来の店にしか付いていない。**
Overture の Instagram 層 = Foursquare の Instagram 層である。

そして Overture が取り込んでいる Foursquare は日本の飲食 POI の **10.88%（85,913 / 789,612）**でしかない。
Foursquare 本家の日本の飲食 POI 数がこれより多ければ、その差分に同じ 16.16% を掛けた分が**純増候補**になる。
**その「本家の日本の飲食 POI 数」が、いま測れていない唯一の数字である。**

---

## 3. 実測の根拠（案 4: Wikidata P2003）

エンドポイント `https://query.wikidata.org/sparql`、本日実行。全て HTTP 200。

| クエリ | 結果 |
|---|---:|
| 世界の全アイテムで `wdt:P2003` を持つもの | **395,255** |
| 日本（`wdt:P17 wd:Q17`）のアイテムで P2003 を持つもの（クラス不問） | **9,953** |
| 日本のレストラン `?i wdt:P31/wdt:P279* wd:Q11707 ; wdt:P17 wd:Q17`（総数） | **1,026** |
| 同上 かつ P2003 あり | **146** |
| 日本の **レストラン(Q11707)＋カフェ(Q30022)＋バー(Q187456)**（subclass 展開）かつ P17=Q17 かつ P2003 あり | **184** |
| 同上 で所在地を `P17 = Q17` **または** `P131→P17 = Q17` に緩めたもの | **184**（増えない） |
| 日本のレストランで `P131` が日本の行政区画（総数） | **564**、うち P2003 あり **85** |
| 日本のレストランで公式サイト `P856` あり | **401** |

実行したクエリ（案 A、逐語）:

```sparql
SELECT (COUNT(DISTINCT ?i) AS ?c) WHERE {
  VALUES ?cls { wd:Q11707 wd:Q30022 wd:Q187456 }
  ?i wdt:P31/wdt:P279* ?cls .
  ?i wdt:P17 wd:Q17 .
  ?i wdt:P2003 ?ig .
}
```
→ `{"c": {"value": "184"}}`（HTTP 200）

**結論: 184 件。** 母集団 789,612 に対して **0.023%**。
ライセンスは CC0 で申し分ないが、**桁が 2 つ足りない。この経路は閉じている。**

- 【自戒・訂正】最初に投げた広いクラス集合には `Q11289` `Q2360219` `Q1358913` を含めていたが、
  ラベルを引いたらそれぞれ「パナビジョン」「政府代表部」「Pascal Giefing」で**飲食とは無関係**だった。
  上表の 184 は、飲食3クラスだけで引き直した値である。
- 総数側のクエリ（レストラン＋カフェ＋バーの日本総数）は **HTTP 502 / 504（`upstream request timeout`）で 3 回とも失敗**した。
  レストラン単独の総数 1,026 のみ取得できている。

---

## 4. 実測の根拠（案 6: OpenStreetMap の Instagram タグ）

### 4.1 taginfo（全世界、HTTP 200）

`https://taginfo.openstreetmap.org/api/4/key/stats?key=contact%3Ainstagram`（`data_until: 2026-08-27T00:59:00Z`）:

```json
{"type":"all","count":288496,"values":155585}
```

`key=instagram`（旧式タグ）: `{"type":"all","count":6556,"values":5371}`
参考 `key=contact:facebook`: `{"type":"all","count":449632}`

### 4.2 Overpass（日本の飲食のみ、HTTP 200）

```
[out:json][timeout:180];
area["ISO3166-1"="JP"][admin_level=2]->.jp;
(
 nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|biergarten)$"]["contact:instagram"](area.jp);
 nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|biergarten)$"]["instagram"](area.jp);
);
out count;
```

結果（`timestamp_osm_base: 2026-08-27T11:56:11Z`）:

```json
{"nodes":"1515","ways":"126","relations":"0","total":"1641"}
```

**日本の飲食 POI で Instagram タグを持つのは 1,641 件。** 母集団比 **0.21%**。

- 注意: `https://overpass-api.de/robots.txt` は `User-agent: *` に対し **`Disallow: /api/`** としている（HTTP 200 で確認）。
  本調査では 1 クエリだけ実行したが、**運用では Geofabrik の日本 `.osm.pbf` 抽出をダウンロードしてローカルで数えるべき**である。
  OSM 本体の robots.txt も「We encourage you to use these instead of scraping our site.」と一括配布を推奨している（既測）。

---

## 5. 実測の根拠（案 2: Common Crawl）

### 5.1 利用規約（逐語、HTTP 200）

`https://commoncrawl.org/terms-of-use`（LAST UPDATED: March 7, 2024）:

> 2. UNLAWFUL AND PROHIBITED USE AND CONDUCT
> You agree that your use of the Service and Crawled Content must comply with all applicable local, state, national, and international laws, and that you will not use the Service for any illegal purpose. You also acknowledge and agree that all information, data, text, scripts, web pages, web sites, software, html page links, open data APIs, metadata or other materials contained in, or otherwise made accessible to you in, the Service (collectively the "Crawled Content") **may be subject to separate terms of use or terms of service from the owners of such Crawled Content.**

> (l) collecting or harvesting any personally identifiable information or personal information for use separately from the Crawled Content;

> **CC strongly recommends that you obtain the advice of legal counsel before making any use, including commercial use, of the Service and/or the Crawled Content.**

> BY USING THE CRAWLED CONTENT, YOU AGREE TO RESPECT THE COPYRIGHTS AND OTHER APPLICABLE RIGHTS OF THIRD PARTIES IN AND TO THE MATERIAL CONTAINED THEREIN.

**読み方:**
- **商用利用そのものを禁じる条項は無い。**「commercial use の前に弁護士に相談することを強く推奨する」と書いてあるだけで、禁止ではない
- ただし **(l)** は「Crawled Content と切り離した個人情報の収集」を禁じている。店舗の Instagram ハンドルは事業者情報であって個人情報ではないが、**個人名義の店の扱いには注意が必要**
- そして決定的に重要なのは **「Crawled Content は元サイトの規約に従う」**という一文である。
  CC の中には食べログやぐるなびのページも（CCBot を拒否していない限り）入りうるので、
  **抽出対象を「店の自社ドメイン」に限定するホワイトリスト運用が必須**になる

### 5.2 収録状況（本調査では数えられなかった）

| URL | 結果 |
|---|---|
| `https://index.commoncrawl.org/collinfo.json` | 初回 **HTTP 200**（34,947 B、127 クロール、最新 `CC-MAIN-2026-34`、期間 2026-08-07 〜 2026-08-20） |
| `https://index.commoncrawl.org/CC-MAIN-2026-34-index?url=<host>/*&output=json&limit=20` | **数百回の照会後、恒久的に HTTP 000**（`curl: (52) Empty reply from server` / `curl: (35) Recv failure: Connection reset by peer`、応答 0.4〜6.1 秒）。20 秒間隔・7 分間のバックオフを挟んで再試行しても復旧せず |
| `https://index.commoncrawl.org/robots.txt` | **HTTP 000**（同上。robots.txt 自体が取得できない） |
| `https://data.commoncrawl.org/robots.txt` | **HTTP 200。内容は `User-Agent: *` / `Disallow: /`** |
| `https://data.commoncrawl.org/cc-index/collections/CC-MAIN-2026-34/indexes/cluster.idx` | HEAD で HTTP 200、`content-length: 103,401,192`。**ただし上記 robots.txt が全 UA を Disallow しているため、本文は取得しなかった** |

**したがって「日本の飲食店ドメインが CC に何件収録されているか」は本調査では確定できていない。**
指示（robots.txt が自分を Disallow しているサイトは取得しない）に従い、`data.commoncrawl.org` からの一括取得は行っていない。

対象ホスト集合だけは作ってある（Overture の websites から、1〜4 店しか指さない非ポータルのホスト）:
**175,541 ホスト / 210,629 店**。これに CDX を当てれば数えられる。

### 5.3 ただし、既に測った数字がある

`out/archived-html.json`（2026-08-13 実測、CC-MAIN-2026-30 / 25 / 21 に照会）:

```
website 保有 305 店中、CC に収録されていた店:  85 (27.87%)
Wayback にアーカイブがあった店（120店の部分集合）: 70 (58.33%)
アーカイブ経由で料理画像まで取れた店: 49 → 600店比 8.17%
```

**この数字が意味すること: CC / Wayback は「自社サイト経路 14.00% を、店を叩かずに取り直す」経路であって、
新しいハンドルを増やす経路ではない。** 純増は 6 店（`n_rescued_from_1304_failures`）にとどまっている。

---

## 6. 実測の根拠（案 7・8: Google）

### 6.1 Google Maps Platform 利用規約（逐語、HTTP 200）

`https://cloud.google.com/maps-platform/terms`:

> **3.2.3 Restrictions Against Misusing the Services.**
> **(a) No Scraping.** Customer will not export, extract, or otherwise scrape Google Maps Content for use outside the Services. For example, Customer will not: (i) pre-fetch, index, store, reshare, or rehost Google Maps Content outside the services; (ii) **bulk download** Google Maps tiles, Street View images, geocodes, directions, distance matrix results, roads information, **places information**, elevation values, and time zone details; (iii) **copy and save business names, addresses, or user reviews**; or (iv) use Google Maps Content with text-to-speech services.
> **(b) No Caching.** Customer will not cache Google Maps Content except as expressly permitted under the Maps Service Specific Terms.
> **(c) No Creating Content From Google Maps Content.** … (vii) use Google Maps Content to improve machine learning and artificial intelligence models, including to train, test, validate or fine-tune the models.

`https://developers.google.com/maps/documentation/places/web-service/policies`（HTTP 200）:

> You must not pre-fetch, cache, or store Places API content beyond the allowed exceptions, although the **place_id is exempt from caching restrictions**.

> **Exceptions from caching restrictions**
> Note that the place ID, used to uniquely identify a place, is exempt from the caching restrictions. **You can therefore store place ID values indefinitely.**

**判定: 不可。** 「店→ハンドルの対応表を作って保存する」は (a)(iii) と (b) に真正面から当たる。
恒久保存が許されているのは **place_id だけ**である。

### 6.2 そもそも Places API は SNS を返さない

`https://developers.google.com/maps/documentation/places/web-service/data-fields`（HTTP 200）を
`instagram` / `socialMedia` で検索した結果、**該当なし**。連絡系のフィールドは

> Website URI	`websiteUri`	Place Details Enterprise

**`websiteUri` のみ。** 店が「ウェブサイト」欄に Instagram の URL を入れていれば拾えるが、
それは規約上保存できないうえ、同じ情報は Overture の `websites` 列に既に入っており（instagram を含む店 **8,201 件 = 1.04%**、実測）、
**新規性がない。**

### 6.3 Google Business Profile

Google Business Profile API は**自分が管理権限を持つロケーションにしかアクセスできない**設計であり、
第三者の店舗情報を引く用途には使えない。**この経路は成立しない。**

---

## 7. 予約・順番待ちサービス

### 7.1 TableCheck（実測）

- `https://www.tablecheck.com/robots.txt`（HTTP 200、**gzip 圧縮されている**ので `--compressed` が必要）:
  `User-agent: *` / `Allow: /` / `Disallow: /assets/` `/reservations/` `/static/` `/v2/` `/rss/` および各言語の `/reservation/` `/request/` `/survey/` `/voucher/`。
  **`/ja/shops/` は Disallow されていない。**
- サイトマップ `sitemap_booking0.xml` 〜 `sitemap_booking33.xml`（34 本）から
  `/ja/shops/<slug>` を重複排除して数えた結果 → **6,979 店**
- そのうち 15 店のページを実際に取得し `instagram\.com/[A-Za-z0-9_.]+` を検索:

```
/ja/shops/sarabeth-shinagawa-pickup   131,649 B  ig=0
/ja/shops/alohatable-minatomirai      170,121 B  ig=1
/ja/shops/toriya-kou                   78,690 B  ig=0
/ja/shops/dominique-bouchet           179,729 B  ig=0
/ja/shops/il-pinologinza              217,646 B  ig=0
/ja/shops/dancingcrabosaka             82,654 B  ig=0
/ja/shops/sarabeth-tokyo              232,330 B  ig=0
/ja/shops/danielasetagaya              73,616 B  ig=0
/ja/shops/yakiniku-takanawa-mobileorder 45,823 B ig=0
/ja/shops/imahanhaneda                 91,891 B  ig=0
/ja/shops/il-pinoloumeda              166,434 B  ig=0
/ja/shops/bekoteitama-pickup           62,503 B  ig=0
/ja/shops/aoyamagusai                  74,906 B  ig=0
/ja/shops/berugu-no-shigatsu          939,303 B  ig=0
/ja/shops/iinoji                      178,402 B  ig=0
```

**15 店中 1 店（6.7%）。** 6,979 店に外挿しても期待値は **約 465 件**（n=15 なので幅は広い）。

規約: `https://www.tablecheck.com/ja/join/terms/`（HTTP 200、292,715 B）を取得したが、
これは**加盟店（申込者）向けの契約**であって、サイト訪問者に対する利用規約ではない。
第9条（禁止事項）は「有害なプログラム」「なりすまし」「脆弱性スキャン」等で、
**営利目的の閲覧・自動取得を禁じる条項は無い。**
`https://www.tablecheck.com/ja/terms`（HTTP 200）も同一文書だった。
**訪問者向けの利用規約は発見できなかった。**

**判定: 規約上の障害は見つからなかったが、期待値 約 465 件では 15.17% を動かせない。**

### 7.2 その他

| サービス | robots.txt | 結果 |
|---|---|---|
| トレタ（toreta.in） | HTTP 200、`Disallow: /wp-admin/` のみ | **toreta.in はコーポレートサイト。消費者向け店舗ページを持たない**（予約は加盟店サイトに埋め込まれる）ため、辿る起点がない |
| EPARK（www.epark.jp） | HTTP 200、`Disallow: /mypage` `/search` のみ | 規約 `https://www.epark.jp/rule/`（HTTP 200、18,202 B）を取得したが、**本文のテキスト抽出に失敗**（JS 描画と思われる）。**判断保留** |
| OMAKASE（omakase.in） | **HTTP 403** | robots.txt すら読めない = アクセス拒否。**取得しない** |
| ポケットコンシェルジュ（pocket-concierge.jp） | HTTP 200、113 B | 未調査 |
| 一休.comレストラン | **HTTP 403**（既測） | **取得しない** |

---

## 8. デリバリー

| サービス | robots.txt | 結果 |
|---|---|---|
| Uber Eats（www.ubereats.com） | **HTTP 403**（7,757 B のブロックページ） | **robots.txt が読めない = 取得しない** |
| 出前館（demae-can.com） | HTTP 200。`/shop/address/*` 等は Disallow だが `/shop/menu/` は許可 | `https://demae-can.com/shop/menu/{1000000,1200000,1500000}` を `--http1.1` で取得 → **いずれも 0 バイト**（`HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR` も併発）。**実質ブロックされている** |
| Wolt（wolt.com） | HTTP 200。**`User-agent: *` / `Disallow:`（＝全許可）** | 規約ページ（`/ja/about/terms-of-service`, `explore.wolt.com/ja/jpn/terms-of-service`）はいずれもトップページ相当の内容しか返らず、**規約本文を取得できなかった** |

**共通の構造的理由:** デリバリープラットフォームの店舗ページは「メニューと価格」を売る面であって、
**店の SNS へ客を逃がすリンクを置く動機がない。** TableCheck ですら 6.7% だったことを踏まえると、
デリバリー系の期待値はそれ以下と考えるのが自然である（未実測）。

---

## 9. 求人サイト

### 9.1 Indeed — 不可（逐語）

`https://jp.indeed.com/legal`（HTTP 200、598,922 B）の「求職者の利用規約」から逐語:

> 求職者であるユーザーは、**就職活動または求職に関する情報収集という個人的、非商業的な目的**で本サイトおよびそのコンテンツを利用できます。ユーザーは、**それ以外の目的のために本サイトを使用しようとした場合、ユーザーは、本サイトの使用許諾が自動的に取り消されること**に同意します。

**判定: 不可。** 食べログ型（用途を私的・非商業に限定）である。

robots.txt について: `https://jp.indeed.com/robots.txt`（HTTP 200、13,097 B）には
`ClaudeBot` と `anthropic-ai` が **GPTBot / CCBot / Bytespider などと同じ User-agent グループ**に列挙されているが、
そのグループに続く指示は `Allow: /*&start=0&` 〜 と `Disallow: /*rt=nc` 等で、**`Disallow: /` ではない**。
つまり robots.txt は名指しの全面拒否ではない。**しかし利用規約が上記の通りなので、いずれにせよ不可。**

### 9.2 その他（規約を取得できなかった）

| サイト | robots.txt | 規約ページ |
|---|---|---|
| タウンワーク（townwork.net） | HTTP 200、2,571 B。クエリ付き URL を大量に Disallow。店舗ページ相当は許可 | `/guide/rules/` `/kiyaku/` `/manual/kiyaku/` とも **HTTP 404**。**取得できなかった** |
| 求人ボックス（xn--pckua2a7gp15o89zb.com） | HTTP 200、1,014 B。`/api/` `/map/` 等を Disallow | `/terms/` `/kiyaku` `/help/terms` `/company` とも **HTTP 404**。**取得できなかった** |
| バイトル（www.baitoru.com） | **HTTP 403** | **robots.txt が読めない = 取得しない** |

**判定: 判断保留。** ただし求人票は「店名・住所・時給」を書く面であり、
Instagram を載せる欄が構造化されていない。TableCheck（6.7%）より高いとは考えにくい（未実測）。

---

## 10. 自治体・政府のオープンデータ

### 10.1 data.go.jp — 取得できなかった

| URL | HTTP |
|---|---|
| `https://www.data.go.jp/terms-of-use` | **503** |
| `https://www.data.go.jp/terms` | **503** |
| `https://www.data.go.jp/data/api/3/action/package_search?q=飲食店&rows=3` | **503**（`<title>アクセスできません｜e-Gov</title>`） |
| `https://data.e-gov.go.jp/api/3/action/package_search?q=飲食店&rows=3` | **503**（同上） |

`https://www.data.go.jp/robots.txt` は **HTTP 301**。**規約原文もカタログも取得できていない。**

### 10.2 東京都オープンデータカタログ — 引けたが、Instagram は入っていない

`https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_search`（HTTP 200）:

- `q=飲食店` → **`count: 113`** データセット
- 上位 3 件のライセンス（実測）: いずれも
  **`クリエイティブ・コモンズ 表示（CC BY）` / `https://creativecommons.org/licenses/by/4.0/deed.ja`**
  → **商用利用可。ライセンス面は完全にクリア。**
- **`q=Instagram` → `count: 1`。** その 1 件は「家庭等における青少年の携帯電話・スマートフォン等の利用等に関する調査」で、
  **飲食店データではない。**

本調査で中身まで確認した飲食店データセットのうち最も列数が多い「東京都内の飲食店のバリアフリー情報」の CSV ヘッダ（実取得、逐語）:

```
店名,店舗電話番号,住所,営業時間,定休日,アクセス,入口幅が80cm以上である,入口の移動経路は平坦または段差が2cm以下である,
店舗内の椅子は移動可能である,店舗内は車椅子での移動が可能である,テーブル下にスペースがある（高さ65cm×幅70cm×奥行45cm程度）,
店舗内または同じフロア内にトイレがある,車椅子使用者対応トイレがある（施設内の他フロアを含む）またはオストメイトがある,
写真メニューがある,英語等外国語のメニューがある,点字表記のメニューがある,筆談によるコミュニケーションがある,
手話のできるスタッフがいる,事前申請によるアレルギー対応が可能,事前申請によるベジタリアンまたはヴィーガン対応が可能,
事前申請によるハラール対応が可能,店舗URL
```

**`店舗URL` で終わっている。SNS 列は存在しない。**

**判定: ライセンスは理想的（CC BY 4.0）だが、自治体オープンデータの飲食店データに Instagram ハンドルは入っていない。**
これは東京都 1 カタログの結果だが、営業許可データ・観光施設データという性質上、他自治体でも同様と考えられる
（自治体が集めているのは「営業許可の届出項目」であって SNS ではない）。

---

## 11. その他の案

### 11.1 ドメイン登録情報 / SSL 証明書透明性ログ

- `https://crt.sh/?q=%25.jp&output=json&limit=1` → **HTTP 502**（`nginx` の Bad Gateway）。**照会できなかった**
- `https://whois.jprs.jp/robots.txt` → HTTP 200（29 B）

**ただし、この案は取得可否以前に成立しない。**
CT ログから得られるのは**ドメイン名だけ**であり、「そのドメインがどの店のものか」を結ぶ手段がない。
Overture 側から店→ドメインを引く経路（`websites` 列）は既にあり、**そこから 175,541 ホストが取れている**。
CT ログが増やせるのは「Overture が website を持っていない 346,289 店のドメイン」だが、
**店名との突合ができないので、増やしたところで対応表にならない。**

### 11.2 HuggingFace / Kaggle の既存データセット

`https://huggingface.co/api/datasets?search=<q>` で検索（全て HTTP 200）:

| クエリ | 結果 |
|---|---|
| `restaurant` | `cs_restaurants`（チェコ語対話）, `NL_restaurant_reviews`（オランダ語）, `blinoff/restaurants_reviews`（ロシア語）等。**日本のものなし** |
| `tabelog` | `[]` |
| `instagram japan` | `[]` |
| `japanese restaurant` | `[]` |
| `飲食店` | `[]` |
| `places japan` | `JapanDegitalMaterial/Places_in_Japan` → **CC0 の画像データセット（`size_categories: n<1K`、text-to-image 用）**。店舗情報ではない |
| `social media handles` | `[]` |

Kaggle（`https://www.kaggle.com/api/v1/datasets/list?search=japan restaurant`、HTTP 200）:
返ってきた先頭は `zomato-bangalore-restaurants`（インド）。**日本の飲食店 × SNS のデータセットは見つからなかった。**

**判定: 存在しない。**

### 11.3 Wikipedia（ja）の外部リンク

`https://ja.wikipedia.org/w/api.php?action=query&list=exturlusage&euquery=instagram.com` は **HTTP 200 で動く**が、
**総件数を返さない API**（`continue` トークンで逐次列挙するのみ）。本調査では総数を数えられなかった。

ただし上限は Wikidata で押さえられる。**日本のレストランの Wikidata アイテムは 1,026 件**しかなく、
Wikidata アイテムは主に Wikipedia 記事から作られるので、**ja.wikipedia の日本の飲食店記事も同オーダー**である。
**この経路は数千件に届かない。**

### 11.4 Meta Graph API（Facebook ページ → Instagram）

これは**本調査の範囲外**（既に `out/meta_platform_terms_storage.json` と
`out/meta-gate-feasibility.json` で調査済み）だが、規模の観点では触れておく必要がある。

Overture の Facebook 層は **701,284 店（88.81%）**で、他のどの経路より 2 桁大きい。
唯一これだけが 15.17% を大きく動かしうる。ただし既測の通り、
Meta Platform Terms 3.d が **Platform Data の保持と削除**を義務づけており（既に原文取得済み）、
かつ Facebook 経路の料理写真は `socials_only` 層で **0/47** だった（REPORT.md 冒頭）。

**本調査は「まだ試していない経路」を洗い出すのが目的なので、ここは既検討として扱う。**

### 11.5 検索 API（Google Custom Search / Brave Search）

「店名＋地名 → `site:instagram.com`」で引く経路。**規約原文を取得できなかった。**

| URL | HTTP | 備考 |
|---|---|---|
| `https://developers.google.com/custom-search/v1/overview` | 200（65,071 B） | 規約に相当する記述をテキスト抽出できず |
| `https://developers.google.com/custom-search/docs/tos` | **404** | |
| `https://developers.google.com/terms` | 200（70,913 B） | Google APIs 全般の ToS。Custom Search 固有の保存条件は含まれない |
| `https://brave.com/search/api/guides/terms-of-service/` | **404** | |
| `https://api.search.brave.com/robots.txt` | **403** | |

**判定: 判断保留。** ただし構造的な弱点は分かっている——
検索 API は「店名で検索して IG アカウントを当てる」経路であり、
既測の `name_searchability` / `recovery_name_gate` が示す通り、
**同名店の取り違えが主要な誤りの型**になる。規約が通っても精度の壁が先に来る。

---

## 12. 結論 — 規約上クリアで、かつ数千件以上を覆えそうな案

| 順位 | 案 | 規約 | 規模の根拠 | やること |
|---|---|---|---|---|
| **1** | **Foursquare OS Places を直接引く** | **Apache 2.0（商用可）**。条件は NOTICE.txt の全文保持による帰属表示のみ | **Overture の Instagram 13,882 件は 100% Foursquare 由来**（実測）。Overture は FSQ を日本の飲食 POI の **10.88% 分しか取り込んでいない**（85,913/789,612）。その中での IG 保有率は **16.16%** | HuggingFace アカウントを作りゲートに同意 → `release/dt=2026-08-11/places/parquet/*.parquet`（100 ファイル、11.53 GB）をダウンロード → 日本の飲食カテゴリに絞って `instagram` 列の非 NULL を数える |
| **2** | **Common Crawl / Wayback から自社サイトの IG を抜く** | CC ToU に**商用禁止条項なし**（逐語確認済み）。ただし「元サイトの規約に従う」ので**自社ドメインに限定するホワイトリスト必須** | CC 収録 **27.87%**、Wayback **58.33%**（既測）。対象ホスト集合は **175,541 ホスト / 210,629 店** を本日抽出済み | 自社サイト経路 14.00% の**再取得コストを下げる**手段として使う。**純増は期待できない**（既測で 6 店） |
| **3** | 東京都ほか自治体オープンデータ | **CC BY 4.0（商用可）** | 「飲食店」で 113 データセット | **Instagram 列が存在しないので、この目的には使えない**。母集団の補強としてのみ価値がある |

**それ以外の全ての案（Google Maps / 予約 / デリバリー / 求人 / Wikidata / Wikipedia / CT ログ / 既存データセット）は、
規約で不可であるか、実測で規模が 2 桁足りないかのいずれかだった。**

**したがって、この調査が出した唯一の実行可能な提案は「Foursquare OS Places を直接引く」である。**
これは既存の Overture 経路と同じデータ系譜でありながら、Overture が捨てている 89.12% を取り戻す可能性がある。
**しかもコストは HuggingFace アカウント 1 つと 11.53 GB のダウンロードだけである。**

### 【重要な留保】

案 1 の効果は**まだ確定していない。**
「Foursquare 本家の日本の飲食 POI が 85,913 件より多いか」を測っていないからである。
もし Foursquare 本家も 85,913 件しか持っておらず、Overture が全量を取り込んでいるなら、**純増はゼロである。**
**この 1 つの数字を測るまで、案 1 を成功と呼んではいけない。**

---

## 13. 数えられなかったもの（取得失敗の一覧）

| 対象 | URL | HTTP / 症状 |
|---|---|---|
| **Foursquare OS Places の日本件数** | `https://huggingface.co/datasets/foursquare/fsq-os-places/resolve/main/release/dt=2026-08-11/places/parquet/places_000000.parquet` | **401** `x-error-code: GatedRepo`（要ログイン） |
| **Common Crawl の日本飲食ドメイン収録数** | `https://index.commoncrawl.org/CC-MAIN-2026-34-index?url=<host>/*` | **000**（`Empty reply from server` / `Connection reset by peer`）。7 分バックオフ後も復旧せず |
| Common Crawl の robots.txt | `https://index.commoncrawl.org/robots.txt` | **000**（同上） |
| Common Crawl の一括インデックス | `https://data.commoncrawl.org/cc-index/collections/CC-MAIN-2026-34/indexes/cluster.idx` | HEAD は 200（103,401,192 B）だが **`data.commoncrawl.org/robots.txt` が `User-Agent: * / Disallow: /` のため取得せず** |
| Wikidata: 日本のレストラン＋カフェ＋バーの**総数** | `https://query.wikidata.org/sparql` | **502 / 504**（`upstream request timeout`）× 3 回。P2003 ありの 184 は取得済み |
| data.go.jp の利用規約 | `https://www.data.go.jp/terms-of-use`, `https://www.data.go.jp/terms` | **503**（`アクセスできません｜e-Gov`） |
| data.go.jp / e-Gov の CKAN API | `https://www.data.go.jp/data/api/3/action/package_search`, `https://data.e-gov.go.jp/api/3/action/package_search` | **503** |
| 東京都オープンデータカタログの利用規約 | `https://portal.data.metro.tokyo.lg.jp/terms-of-use/` | **403**（ライセンスは CKAN のメタデータから CC BY 4.0 と確認済み） |
| EPARK の利用規約本文 | `https://www.epark.jp/rule/`, `https://www.epark.jp/agreement/` | HTTP 200（18,202 B）だが**テキスト抽出に失敗**（JS 描画と思われる） |
| Wolt の利用規約 | `https://wolt.com/ja/about/terms-of-service`, `https://explore.wolt.com/ja/jpn/terms-of-service` | 404 / トップページ相当の内容しか返らない |
| 出前館の利用規約 | `https://demae-can.com/contents/rule/`, `https://www.demae-can.com/contents/rule/` | **000**（`HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR`）／302 |
| 出前館の店舗ページ | `https://demae-can.com/shop/menu/{1000000,1200000,1500000}` | **0 バイト**（実質ブロック） |
| タウンワークの利用規約 | `/guide/rules/`, `/kiyaku/`, `/manual/kiyaku/` | **404**（3 種とも） |
| 求人ボックスの利用規約 | `/terms/`, `/kiyaku`, `/help/terms`, `/company` | **404**（4 種とも） |
| Uber Eats の robots.txt | `https://www.ubereats.com/robots.txt` | **403** → 取得しない判断 |
| バイトルの robots.txt | `https://www.baitoru.com/robots.txt` | **403** → 取得しない判断 |
| OMAKASE の robots.txt | `https://omakase.in/robots.txt` | **403** → 取得しない判断 |
| Uber の利用規約 | `https://www.uber.com/legal/en/document/?name=general-terms-of-use&country=japan&lang=ja` | **406** |
| crt.sh（CT ログ照会） | `https://crt.sh/?q=%25.jp&output=json&limit=1` | **502** |
| Brave Search API の利用規約 | `https://brave.com/search/api/guides/terms-of-service/` | **404**。`https://api.search.brave.com/robots.txt` は **403** |
| Google Custom Search の利用規約 | `https://developers.google.com/custom-search/docs/tos` | **404** |
| iタウンページの利用規約 | `https://itp.ne.jp/guide/agreement/` | **000**（`HTTP/2 stream 1 was not closed cleanly`）。robots.txt は 200 で取得済み |
| ja.wikipedia の instagram.com 外部リンク総数 | `https://ja.wikipedia.org/w/api.php?action=query&list=exturlusage` | HTTP 200 だが **総件数を返さない API** |
| 求人サイト・デリバリーの IG 掲載率 | — | **未実測**（ページを取得できないか、規約で不可のため） |

---

## 14. 本調査で自分が守った制約と、その記録

- **robots.txt が自分を Disallow しているサイトは取得していない。**
  - `data.commoncrawl.org`: `User-Agent: * / Disallow: /` → 一括インデックスを取得しなかった（HEAD のみ）
  - `www.ubereats.com` / `www.baitoru.com` / `omakase.in`: robots.txt 自体が **403** → ページを取得しなかった
  - `jp.indeed.com`: `ClaudeBot` は AI ボット群に列挙されているが `Disallow: /` ではなかったため、規約ページのみ取得した
  - `overpass-api.de`: `Disallow: /api/` を**事後に確認した**。1 クエリ実行済み。運用では Geofabrik の一括配布を使うべき
- **記憶で書いていない。** 規約は全て当日取得した原文からの逐語引用であり、件数は全て当日実行したクエリの実測値である
- **推測で件数を書いていない。** 測れなかったものは §13 に URL と HTTP ステータスを列挙した
- **自分の誤りを 1 件訂正した。** Wikidata の広いクラス集合に飲食と無関係な QID（Q11289 = パナビジョン、
  Q2360219 = 政府代表部、Q1358913 = Pascal Giefing）を混ぜていた。ラベルを引いて発見し、飲食 3 クラスで引き直した
