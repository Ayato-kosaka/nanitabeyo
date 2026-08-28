# Instagram 初期シード PoC — 4.1〜4.20 の実測（2026-08-28）

**判断に使う数字は Issue に置く。ここにあるのは、やり直すときの手順と実測値である。**

対象は「Instagram の投稿 URL を初期シードとして一定量確保できるか」。
判定条件は **(a) 無料であること / (b) 50万店舗以上 × 132 料理カテゴリを充足すること** の 2 つ。

生の測定値は [`out/measurements.json`](out/measurements.json)。

---

## 0. 結論

**(b) は入口で成立しない。(a) も、投稿一覧を取る唯一の公式経路が有料の本人確認を前提にするため成立しない。**

| | 必要 | 実測（最良の経路） | 到達率 |
| --- | ---: | ---: | ---: |
| Instagram アカウントに辿り着ける店 | **500,000 店** | **171,798 店**（母集団 1,132,482 の 15.17%） | **34.4%** |
| うちチェーン共通でない（店固有） | 500,000 店 | **57,304 店**（5.06%） | **11.5%** |

500,000 店に届くには経路存在率 **44.15%** が要る。実測は 15.17%。
**4.1〜4.5 はすべてこの 15.17% の内側にある**（同じ「店 → Instagram アカウント」の入口を、
別のデータソースから取っているだけ）ので、足し合わせても 44.15% にはならない。

料理カテゴリ側（132）は制約になっていない。1 店あたり 2.69 カテゴリ・7.69 枚
（#1342 の KPI②）が取れているので、**詰まっているのは店舗数の次元だけ**である。

---

## 1. 経路別の実測

分母は #1342 と同じ**飲食店母集団 1,132,482 店**。
（`restaurant_seed_catalog` は 1,513,803 行だが、そこから飲食店に絞った数が 1,132,482。）

| 項目 | 無料か | 到達できる店 | 異なりアカウント数 | 判定 |
| --- | --- | ---: | ---: | --- |
| 4.1 Overture `socials` | ○ | 18,437（1.71%） | **11,279** | 不足 |
| 4.2 Foursquare OS Places | △ 要アカウント | 測れず | 測れず | **測定不能** |
| 4.3 店舗公式サイト | ○ | **171,798（15.17%）** | 約 96/600店 | **最良だが不足** |
| 4.4 OpenStreetMap | ○ | 2,111（0.19%） | 2,050 | 不足 |
| 4.5 Wikidata P2003 | ○ | 146 | 146 | 不足 |
| 4.8 Meta Hashtag Search | ✗ 要 business verification | — | — | **用途審査で却下** |
| 4.11 Web 検索 API | ✗ 保存権は別契約 | — | — | 却下 |
| 4.14 Common Crawl | ○ ただし 15TB/回 | 投稿 URL **0 本** | — | 却下 |
| 4.20 ライセンス不明データセット | — | 該当 0 件 | — | 却下 |

**4.1 ∪ 4.4 の異なりアカウント数は 13,244 本**（BigQuery で実測）。
4.5 を足しても約 13,390 本にしかならない。ここに 4.3（自前クロール）を足したものが
15.17% の上限である。


### 4.1 Overture Maps Places の `socials` — **測定済み・不足**

BigQuery `restaurant_overture_raw`（`run_id=restaurant-2026-08-23`, 日本 1,081,471 レコード）:

| | 件数 | 割合 |
| --- | ---: | ---: |
| `socials` に instagram.com を持つ店 | **18,437** | **1.71%** |
| その **異なりハンドル数** | **11,279** | — |
| 参考: facebook.com を持つ店 | 963,579 | 89.1% |
| 参考: `website` を持つ店 | 545,560 | 50.4% |

18,437 店が共有しているアカウントは 11,279 本しかない。差の 7,158 店は
**チェーンのブランド共通アカウント**で、どの支店の料理かを決められない（#1273 §23）。

### 4.2 Foursquare OS Places の `instagram` — **無料では取得できなくなっている（仕様書の前提が古い）**

調査仕様は「Places Portal の Iceberg カタログから抽出する」としているが、実際に叩くと:

- S3 `s3://fsq-os-places-us-east-1/` に**データが無い**。残っているのは `LICENSE.txt` と `NOTICE.txt` の 2 本だけ
- Hugging Face `foursquare/fsq-os-places` は **gated** になっている。
  `HTTP 401` / `x-error-code: GatedRepo` / `Access to dataset ... is restricted`
- Places Portal 側もアカウント登録とトークン発行が前提

ライセンス自体は Apache-2.0 のままなので**規約上は使える**が、
**アカウント無しでは 1 バイトも取れない**。この PoC では測れなかった。

### 4.3 店舗公式サイトの通常リンク・JSON-LD `sameAs` — **最良だが 15.17% で頭打ち**

#1345 が 600 店の標本で目視ラベル付きで測っており（`1273_sns_dish_media_poc/out/instagram_handle_reach.json`）、
本 PoC はその数字を引き継ぐ。

| | 件数 | 割合 |
| --- | ---: | ---: |
| `website` がそのまま instagram.com | 7 | 1.17% |
| 店のサイトから Instagram リンクを抽出 | 84 | 14.00% |
| **和** | **91** | **15.17%** |
| 取れた異なりハンドル | 96 | — |
| うち店固有（チェーン共通を除く） | — | **5.06%** |

**これが全経路の中で最大**であり、4.1 / 4.4 / 4.5 はこの内側に入る。

### 4.4 OpenStreetMap の `contact:instagram` — **測定済み・不足**

BigQuery `restaurant_osm_raw`（日本 190,642 レコード）:

| | 件数 |
| --- | ---: |
| タグのどこかに instagram を含むレコード | **2,111** |
| `contact:instagram` キーを持つレコード | 1,574 |
| 　うち値が URL 形式 | 766 |
| 　うち値が素のハンドル（`@foo` 等） | 808 |
| `instagram` キー（`contact:` 無し）を持つレコード | 23 |
| `website` 等 別のタグにだけ instagram が出るレコード | 515 |
| **異なりハンドル数（上記すべてから抽出）** | **2,050** |

母集団 1,132,482 に対して **0.19%**。

ローダ（`1_5_load_osm.py`）は `contact:instagram` の 1,574 件を**取りこぼしていない**
（全件が `social_urls` に入っている）。落としているのは `contact:` の無い `instagram` キーの
**23 件だけ**で、直しても結論は動かない。

### 4.5 Wikidata P2003 — **測定済み・桁が足りない**

`query.wikidata.org` の SPARQL で実測:

| クエリ | 件数 |
| --- | ---: |
| 日本（P17=Q17）で P2003 を持つ item（全種別） | 9,954 |
| 日本のレストラン（P31/P279* = Q11707）item | **1,026** |
| **そのうち P2003 を持つもの** | **146** |

**店舗単位の網羅性が 1,026 件しかない。** 146 アカウントでは初期シードにならない。

### 4.8 Meta Hashtag Search — **用途審査で落ちる（一次資料で確認）**

`developers.facebook.com/docs/features-reference/instagram-public-content-access/` を 2026-08-28 に再取得。

> This permission or feature requires successful completion of the App Review process before your app can access live data.
> **This permission or feature is only available with business verification.**

**Allowed Usage は閉じた 5 項目**で、いずれも当該用途（第三者の飲食店の投稿を集めて自社アプリの
初期シードにする）に当たらない:

1. Discover content associated with its current campaign.
2. Provide customer support.
3. Identify entrants to its contests, competitions, or sweepstakes.
4. Understand public sentiment around brand.
5. Understand and manage their audience, develop their content strategy and obtain digital rights.

加えて量的にも足りない。Recent Media は**実行時点から 24 時間以内**の公開投稿しか返さず、
**7 日間で 30 タグ**が上限である。132 カテゴリを全国で回す規模に構造的に届かない。

### 4.11 保存権を明示した Web 検索 API — **無料枠では DB を作れない**

| | 実測（2026-08-28） |
| --- | --- |
| Brave Search API | $5/1,000 requests。**毎月 $5 のクレジット = 実質 1,000 requests/月**が無料枠 |
| Brave の保存権 | 「結果を保存したいなら **storage rights を明示的に付与するプランの契約が要る**」。標準プランには無い |
| Google Custom Search JSON API | 100 queries/日 無料。ただし **新規受付終了**。既存顧客も **2027-01-01** までに移行 |
| Bing Search APIs | **2025-08-11 に終了済み** |

無料枠 1,000 requests/月では、50万店舗の探索に **41年**かかる。
保存権付きプランは見積ベースで、**無料条件と両立しない**。

### 4.14 Common Crawl — **Instagram 本体は 1 本も入っていない。外向きリンク経路は 15TB/回**

最新 crawl `CC-MAIN-2026-34` の URL index を実測（`cc_instagram_index.py` と同じ手順）:

| | 件数 |
| --- | ---: |
| cluster.idx の行数 | 873,102 |
| **instagram.com の cdx レコード** | **78** |
| うち robots.txt | **77** |
| **投稿 URL（`/p/`・`/reel/`）** | **0** |

Instagram は robots.txt でクロールを拒否しているので、**Common Crawl に投稿 URL は存在しない**。
仕様書が言うとおり経路は「他サイトの外向きリンク（WAT）」しかないが、その規模は:

- WAT ファイル数 **100,000**、1 ファイル約 **151 MB** → **1 crawl あたり約 15.1 TB**

無料でダウンロードできるが、**この環境で 1 回走らせるだけで数十時間の I/O** になる。
しかも仕様書自身が「既知の公式サイトドメインに限定せよ」と言っており、
それは **4.3（自分で 62万サイトをクロールする）と同じことを遠回りにやる**ことになる。

### 4.20 ライセンス不明の公開データセット — **該当なし**

Hugging Face の datasets 検索で `instagram` の上位 20 件を確認した。

- **日本の飲食店に絞ったものは 0 件**
- **再利用可能なライセンスが明示されているものは 0 件**（`license:unknown` か、ライセンスタグ自体が無い）

規約状態が不明なものは使えない、という仕様書の判定のとおり。

---

## 2. 未測定（4.6 / 4.7 / 4.9 / 4.10 / 4.12 / 4.13 / 4.15〜4.19）

**依頼された調査仕様に本文が無かった 11 項目**。項目名が分からないため測定していない。
本文をもらえれば同じ形式で測る。

---

## 3. パイプライン側（`@account → Business Discovery → 投稿一覧`）

アプリ側の受け口は**すでにある**。`POST /v1/dish-media/imports`（#1399）が
`url` / `restaurantId` / `dishCategoryId` を受けて `dish_media` と
`dish_media_external_embeddings` まで書く。URL はサーバで再解決されるので、
機械的に流し込むこと自体は成立する。

詰まるのは**その手前**である。

- `business_discovery` は `instagram_basic` + `instagram_manage_insights` +
  `pages_read_engagement` を要求し、他人のアカウントに対して使うには App Review が要る
- `business_discovery` が返すのは **Business / Creator アカウントだけ**である。
  個人アカウントで運用している店は、アカウントが分かっていても投稿一覧を取れない。
  **この歩留まりは未測定**（アカウント種別を知るには API を通す必要があるため）

---

## 4. やり直すときの手順

```bash
# 4.14: Common Crawl の URL index に Instagram がどれだけあるか
python3 cc_instagram_index.py CC-MAIN-2026-34
```

4.1 / 4.4 / 4.5 は BigQuery と SPARQL の一発クエリで、`out/measurements.json` に
クエリ結果をそのまま置いてある。4.2 は Hugging Face か Places Portal の
**アカウントが要る**ので、この環境からは再現できない。
