# Instagram 初期シード PoC — 4.X ごとの実測（2026-08-28）

判定条件は **(a) 無料であること / (b) 50万店舗以上 × 132 料理カテゴリを充足すること**。
生の測定値は [`out/`](out/) に置いてある。

**オーナー指示により 4.6 / 4.7 / 4.9 / 4.10 / 4.12 / 4.13 / 4.15〜4.19 は対象外。**

---

## 0. 一覧

分母は #1342 と同じ飲食店母集団 **1,132,482 店**（FSQ 側の分母だけは後述の 1,177,934 店）。

| # | 手段 | (a) 無料 | (b) 充足 | 到達できる店 | 判定 |
| --- | --- | --- | --- | ---: | --- |
| 4.1 | Overture `socials` | ○ | ✗ | 18,437（1.71%） | 不足 |
| 4.2 | Foursquare OS Places | △ 要アカウント | ✗ | **57,897（4.92%）** | **供給は最大。ただし店単位では不足** |
| 4.3 | 店舗公式サイト | ○ | ✗ | 171,798（15.17%） | 不足 |
| 4.4 | OpenStreetMap | ○ | ✗ | 2,111（0.19%） | 不足 |
| 4.5 | Wikidata P2003 | ○ | ✗ | 146 | 不足 |
| 4.8 | Meta Hashtag Search | ✗ | ✗ | — | 用途審査で却下 |
| **4.11** | **Web 検索 API** | **△ PoC は無料 / 本番 $60〜$200** | **未確定（有望）** | **未測定** | **唯一 500,000 に届きうる** |
| 4.14 | Common Crawl | ○（15.1TB/回） | ✗ | 投稿 URL **0 本** | 却下 |
| 4.20 | ライセンス不明の公開データセット | ○ | ✗ | **該当 0 件** | 却下 |

**4.1〜4.5 は「店 → Instagram アカウント」という同じ入口の別ソース**にすぎない。
実測した異なりアカウント数の和は **約 40,000 本**（後述）で、500,000 店には桁が届かない。

**500,000 店に届く可能性があるのは 4.11 だけである。**

---

## 4.1 Overture Maps Places の `socials`

BigQuery `restaurant_overture_raw`（`run_id=restaurant-2026-08-23`、日本 1,081,471 レコード）。

| | 件数 | 割合 |
| --- | ---: | ---: |
| `socials` に instagram.com を持つ店 | **18,437** | **1.71%** |
| その異なりハンドル数 | **11,279** | — |
| 参考: facebook.com を持つ店 | 963,579 | 89.1% |
| 参考: `website` を持つ店 | 545,560 | 50.4% |

18,437 店が共有しているアカウントは 11,279 本しかない。差の 7,158 店は
チェーンのブランド共通アカウントで、どの支店の料理かを決められない（#1273 §23）。

**判定: 不足。** ただし後述 4.2 との和集合には効く。

---

## 4.2 Foursquare OS Places の `instagram`

### 仕様書の前提が古い — S3 は空、Hugging Face は gated

- S3 `s3://fsq-os-places-us-east-1/` に残っているのは `LICENSE.txt` と `NOTICE.txt` の **2 本だけ**
- Hugging Face `foursquare/fsq-os-places` は **gated**。無記名だと
  `HTTP 401` / `x-error-code: GatedRepo`
- ライセンスは **Apache-2.0 のまま**なので規約上は使える。**アカウントが要るだけ**である

オーナーからトークンを受け取り、release `dt=2026-08-11` の 100 parquet を全走査した。

### 実測（`out/fsq_instagram.json`）

| | 件数 | 割合 |
| --- | ---: | ---: |
| 日本の place | 5,017,666 | — |
| うち飲食（`Dining and Drinking` 配下） | 1,400,600 | — |
| うち閉店していない | **1,177,934** | 100% |
| **`instagram` 列を持つ店** | **57,897** | **4.92%** |
| **その異なりハンドル数** | **35,451** | — |
| 参考: `website` を持つ店 | 312,559 | 26.5% |

**Overture の 3.1 倍**（11,279 → 35,451）。**これが単一ソースとしては最大の供給源である。**

### Overture との重複

FSQ のハンドルから 300 本を無作為抽出（seed 20260828）して Overture 側と突き合わせた結果、
**72 / 300 = 24.0%** が Overture にも存在した。したがって

```
和集合 ≒ 35,451 + 11,279 − 0.24 × 35,451 ≒ 38,222 本
```

OSM 2,050・Wikidata 146 を足しても **約 40,000 本**である。

**判定: 供給は最大だが不足。** 57,897 店は 500,000 店の **11.6%**。

### 実務メモ

100 ファイルを一括 glob で読むと Hugging Face が **429** を返す（実測で 84 本目で停止）。
`fsq_instagram.py` は 1 ファイルずつ読み、失敗したら待って積み直す形にしてある。
parquet は国ごとに固まっているので、日本のレコードは特定のファイルに集中する。

---

## 4.3 店舗公式サイトの通常リンク・JSON-LD `sameAs`

#1345 が 600 店の標本で**目視ラベル付き**で測っている
（`1273_sns_dish_media_poc/out/instagram_handle_reach.json`）。本 PoC はこれを引き継ぐ。

| | 件数 | 割合 |
| --- | ---: | ---: |
| `website` がそのまま instagram.com | 7 | 1.17% |
| 店のサイトから Instagram リンクを抽出 | 84 | 14.00% |
| **和** | **91** | **15.17%** |
| 取れた異なりハンドル | 96 | — |
| うち店固有（チェーン共通を除く） | — | **5.06%** |

母集団に当てると **171,798 店**。**アカウント経路としてはこれが最大**だが、
500,000 店の **34.4%**、店固有まで絞ると **11.5%** にとどまる。

**判定: 不足。**

---

## 4.4 OpenStreetMap の `contact:instagram`

BigQuery `restaurant_osm_raw`（日本 190,642 レコード）。

| | 件数 |
| --- | ---: |
| タグのどこかに instagram を含むレコード | **2,111** |
| `contact:instagram` キーを持つレコード | 1,574 |
| 　うち値が URL 形式 | 766 |
| 　うち値が素のハンドル（`@foo` 等） | 808 |
| `instagram` キー（`contact:` 無し） | 23 |
| `website` 等 別のタグにだけ instagram が出るもの | 515 |
| **異なりハンドル数** | **2,050** |

母集団に対して **0.19%**。ローダ（`1_5_load_osm.py`）は `contact:instagram` の 1,574 件を
**取りこぼしていない**（全件が `social_urls` に入っている）。落としているのは
`contact:` の無い `instagram` キーの **23 件だけ**で、直しても結論は動かない。

**判定: 不足。**

---

## 4.5 Wikidata P2003

`query.wikidata.org` の SPARQL で実測。

| クエリ | 件数 |
| --- | ---: |
| 日本（P17=Q17）で P2003 を持つ item（全種別） | 9,954 |
| 日本のレストラン（P31/P279* = Q11707）item | **1,026** |
| **そのうち P2003 を持つもの** | **146** |

**店舗単位の網羅性が 1,026 件しかない。** 146 アカウントでは初期シードにならない。

**判定: 不足。**

---

## 4.8 Meta Hashtag Search

`developers.facebook.com/docs/features-reference/instagram-public-content-access/` を
2026-08-28 に再取得した。

> This permission or feature requires successful completion of the App Review process before your app can access live data.
> **This permission or feature is only available with business verification.**

**Allowed Usage は閉じた 5 項目**で、いずれも当該用途（第三者の飲食店の投稿を集めて
自社アプリの初期シードにする）に当たらない。

1. Discover content associated with its current campaign.
2. Provide customer support.
3. Identify entrants to its contests, competitions, or sweepstakes.
4. Understand public sentiment around brand.
5. Understand and manage their audience, develop their content strategy and obtain digital rights.

量的にも足りない。Recent Media は**実行時点から 24 時間以内**の公開投稿しか返さず、
**7 日間で 30 タグ**が上限である。132 カテゴリを全国で回す規模に構造的に届かない。

**判定: 却下（用途審査）。**

### Business Discovery は未検証（トークン失効）

オーナーから受け取った `IG_TOKEN` は **受領時点で失効していた**
（`OAuthException` code 190 / `Session has expired on Friday, 28-Aug-26 04:00:00 PDT`）。
したがって以下は**まだ実測できていない**。

- `business_discovery` が実際に他店のアカウントを返すか
- 返るのは Business / Creator アカウントだけなので、**個人アカウント運用の店で何割落ちるか**

`business_discovery` の要求権限は `instagram_basic` + `instagram_manage_insights` +
`pages_read_engagement`（一次資料で確認済み）。他人のアカウントへ使うには App Review が要る。

---

## 4.11 保存権を明示した Web 検索 API — **唯一 500,000 に届きうる**

### まず、検索エンジンに Instagram の投稿ページは入っている

`instagram.com/robots.txt`（2026-08-28 取得）を読むと、**Googlebot と Bingbot は
`/p/` `/reel/` を巡回できる**。禁じられているのは `/*/c/` `/*/comments/` `/*/liked_by/`
と API 系のパスだけである。

```
User-agent: Googlebot
Disallow: /*/c/
Disallow: /*/comments/
Disallow: /*/liked_by/
Disallow: /accounts/login/*?next=
...
```

一方、**リストに無いエージェント（＝我々）は `User-agent: *  Disallow: /`** で全面禁止である。
自前クロールは不可、検索エンジン経由なら可、という構造になっている。

なお robots.txt は末尾で **Instagram 自身のサイトマップ**を公開している
（`ig_places_sitemap` / `ig_seo_profile_sitemap` / `ig_seo_location_sitemap` など）。
店の一覧としては理想的だが、**`*` の `Disallow: /` が掛かるので我々は取得できない。**
取得していない。

### 実際に検索して歩留まりを測った

`site:instagram.com/p <カテゴリ> <地域>` を 5 セル叩いた結果（各 10 件）:

| セル | 投稿 URL | 対象地域の店名が読み取れたもの |
| --- | ---: | ---: |
| 焼き鳥 × 東京 | 10 / 10 | 約 6 |
| ラーメン × 青森 | 10 / 10 | 約 6 |
| ラーメン × 高松 | 10 / 10 | 約 5 |
| 寿司 × 高松 | 10 / 10 | 約 6 |
| **うなぎ × 高松** | 9 / 10 | **1** |

**平均 約 4.8 店 / クエリ。** タイトルにキャプションが入るので、
**店名がそのまま読める**（例: 焼鳥 鍈輝 / 焼き鳥 足るを知る / 小江戸鳥や / 麺道 一休 /
横浜家系ラーメン 高松家 / 寿司濱野 / 寿し勝 / 鰻松）。

**うなぎ × 高松だけが 1/10 に落ちる。** これは経路の失敗ではなく、
そのセルに店自体が少ないという #1273 §32 の «restaurant shortage» である。
**カテゴリ × 地域のセルごとに測り直す必要がある**（108 セルの本測定は未実施）。

### 保存権 — ベンダによって条文が正反対だった

| ベンダ | 無料枠 | 単価 | 結果の保存・DB 化 |
| --- | --- | --- | --- |
| **Brave Search API** | $5/月クレジット ＝ 約 1,000 req | $5 / 1,000 | **明確に禁止**。「store, cache, or create a database of Search Results, in whole or in part, other than transient storage required for operation of Customer Applications」。**プラン別の例外は規約本文に無い** |
| **Serper** | **2,500 クエリ（カード不要）** | **$0.30〜/1,000** | **禁止条項が無い**。制限は «出典の詐称» と «付加価値の無いミラーリング» のみ |
| SerpApi | 250 検索/月 | $5.90 / 1,000（$1,475/月 25万） | 保存に関する条項は無い。代わりに **US Legal Shield 最大 $2M** を提供 |
| Google Custom Search JSON | 100 クエリ/日 | $5 / 1,000 | **新規受付終了**。既存顧客も 2027-01-01 までに移行 |
| Bing Search APIs | — | — | **2025-08-11 終了済み** |
| DataForSEO | — | 最低入金 $50 | 保存条項はページ上に記載なし |

**Brave と Serper で条文が正反対である。** 仕様書は Brave を前提に「標準プランのまま
検索結果 DB を作らない」としているが、**その判断は Brave 固有**であり、
Serper には当てはまらない。

### 規模と費用

500,000 店 ÷ 4.8 店/クエリ ＝ **約 104,000 クエリ**（重複ゼロの理想値）。
重複を 2 倍と見て **約 200,000 クエリ**。

| | 費用 |
| --- | ---: |
| Serper（$0.30〜$1.00 / 1,000） | **$60 〜 $200** |
| SerpApi（$5.90 / 1,000） | 約 $1,180 |
| Brave（$5 / 1,000） | 約 $1,000（**ただし保存禁止**） |
| 無料枠だけ（Serper 2,500 + SerpApi 250/月 + Brave 1,000/月） | **約 1〜6 年** |

**(a) 無料は満たさない。ただし 108 セルの本 PoC（約 1,000〜2,000 クエリ）は
Serper の無料枠 2,500 に収まるので、PoC 自体は無料でできる。**

**判定: 唯一 500,000 に届きうる経路。本測定を推奨。**

---

## 4.14 Common Crawl の外部ページ外向きリンク

最新 crawl `CC-MAIN-2026-34` の URL index を実測した（`cc_instagram_index.py`）。

| | 件数 |
| --- | ---: |
| cluster.idx の行数 | 873,102 |
| **instagram.com の cdx レコード** | **78** |
| うち robots.txt | **77** |
| **投稿 URL（`/p/`・`/reel/`）** | **0** |

Instagram は robots.txt で `*` を拒否しているので、**Common Crawl に投稿 URL は存在しない**。
仕様書が言うとおり経路は「他サイトの外向きリンク（WAT）」だけだが、その規模は

- WAT ファイル **100,000 本** × 約 **151 MB** ＝ **1 crawl あたり約 15.1 TB**

しかも仕様書自身が「既知の公式サイトドメインに限定せよ」と言っており、
それは **4.3（自前で 62 万サイトをクロールする）と同じ作業を遠回りにやる**ことになる。

**判定: 却下。**

---

## 4.20 ライセンス不明の公開データセット

「明確な商用ライセンスと provenance があるものだけ再評価」という仕様書の判定基準に沿って、
**ライセンスを機械可読で持っている先を全部当たった**（`dataset_survey.py` / `out/dataset_survey.json`、
`out/kaggle_survey.json`）。

| 先 | クエリ | 一意ヒット | Instagram 関連 | **日本の飲食店** | **投稿 URL の一覧** |
| --- | ---: | ---: | ---: | ---: | ---: |
| Kaggle（API は無認証で叩けた） | 12 | 145 | 64 | **0** | **0** |
| Zenodo | 10 | 138 | 10（題名一致） | **0** | **0** |
| Hugging Face | 10 | 50 | 50 | **0** | **0** |
| GitHub（repo 検索 / code 検索） | 3 | 0 repo / 119 code | 119 は全部**巻き添え**（ツイート dump に URL が混ざっただけ） | **0** | **0** |

- Kaggle の Instagram 系 64 件のライセンス分布は CC0 22 / Unknown 6 / Apache-2.0 5 / その他。
  **日本に言及するものは 1 件も無い。** 飲食に言及する唯一の 1 件は
  「New York Turk Restaurants Visited」（**2.3 KB**）
- Zenodo で題名に Instagram を含む 10 件は、すべて**単一テーマの研究コーパス**
  （ギリシャの政治家の投稿 / スペインの美術館 / greenfluencer / バレンシア洪水報道 等）
- Hugging Face は日本語タグ **0 件**、飲食 0 件

**判定: 却下。** 規約が不明だから却下なのではなく、**そもそも存在しない。**

---

## やり直すときの手順

```bash
# 4.2 Foursquare（HF_TOKEN が要る。トークンはコミットしない）
HF_TOKEN=... python3 fsq_instagram.py 2026-08-11

# 4.14 Common Crawl の URL index に Instagram がどれだけあるか
python3 cc_instagram_index.py CC-MAIN-2026-34

# 4.20 Kaggle / Zenodo / Hugging Face の棚卸し
HF_TOKEN=... python3 dataset_survey.py
```

4.1 / 4.4 / 4.5 は BigQuery と SPARQL の一発クエリで、結果は `out/measurements.json` にある。
4.11 の本測定（108 セル）は Serper のキーが要る。**この環境からは `web.archive.org` へ出られない**
（egress proxy が 000 を返す。`archive.org` 本体は 200）ので、Wayback CDX 経由の追試は
`.claude/skills/ec2-chrome-operate` の EC2 からになる。
