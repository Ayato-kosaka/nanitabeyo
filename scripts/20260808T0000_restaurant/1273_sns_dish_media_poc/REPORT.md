# Issue #1273 PoC report（無料範囲のみ）

実測日: 2026-08-12

## 判定

**TikTok oEmbed / X oEmbed / YouTube Data API v3 は無料・キー取得のみで即座に実機動作した（Go for Embed feasibility, Stage 0）。** Instagram Graph API / Threads APIは、#1269のInstagram PoCで判明した壁（Business Verification / App Review必須）を本PoCの実機テストで再確認した。business_discovery、instagram_oembedともに「審査未完了のため権限なし」というAPIエラーを実際に受け取っており、無料範囲では技術検証止まりで実データ取得はできない（ユーザーは法人未登記のためBusiness Verificationを断念、この経路は今回の対象外として確定）。

**dev.dishesの実restaurant×category 20組でdish_media_catalog/dish_media_external_embeddings相当のJSONを実際に生成できた（技術的にはGo）。** 設計→PoC→評価を3ラウンド回し、判定ロジックの改善（概要欄/チャンネル名も見る、誤検出の機械的排除）で歩留まりは5%→20%まで改善したが、`0000_open_data_poc`規模で必要な60%には無料のYouTubeキーワード検索単独では届かない可能性が高い。ボトルネックは「動画が見つからない」ことではなく「見つかった動画がその店舗を名指ししていない」ことで、これはissue本文が指摘する構造的な難所そのもの。Route A(店舗の公式SNSアカウントを直接見にいく)との組み合わせが本命というissue本文の当初方針を裏付ける結果になった。

## 実測

### TikTok oEmbed（無料・認証不要）

`https://www.tiktok.com/oembed` に公開動画URL 3件を投げ、3/3が200 OKでhtml/author_name/thumbnail_urlを取得できた。APIキーもMeta Appも一切不要。

```
tiktok oembed: 3/3 ok -> out/tiktok_oembed_2026-08-12.json
```

### X oEmbed（無料・認証不要）

`https://publish.x.com/oembed` に公開投稿URL 5件（うち3件は無添くら寿司/かっぱ寿司/はま寿司の公式ブランドアカウント、1件はラーメン二郎亀戸店の店舗アカウント、1件は一般ユーザー）を投げ、5/5が200 OKでhtmlを取得できた。X Search API（Discovery、pay-per-use）は課金対象のため未使用。oEmbedだけならDiscoveryを介さず既知URLのEmbed可否確認に使える。

```
x oembed: 5/5 ok -> out/x_oembed_2026-08-12.json
```

restaurant-branchレベルの公式アカウント（無添くら寿司、ラーメン二郎亀戸店など）でoEmbedが正常に機能したことは、issue本文の「Route A: Restaurant → Media」（公式Xアカウントの投稿を店舗確定済みmediaとして扱う）が技術的に成立することを裏付ける。

### YouTube Data API v3（無料枠キー、自己発行）

Google Cloud Console（既存の本番プロジェクト`food-scroll`）で、YouTube Data API v3のみに制限した専用APIキーを新規発行した（既存の本番キー群には触れていない）。

**設計方針（レビュー指摘を受けて修正）**: 当初`search.list`の生ヒットをそのまま結果とし、`videos.list`でのembeddable確認を別コマンドの後追いにしていたが、「embeddableでないものは表示できない以上、取得できたと呼ぶべきではない」という指摘を受け、`youtube-search`コマンド自体がsearch.list実行後に必ずvideos.listでembeddable確認まで行い、**embeddableな動画だけ**を`video_ids`/`titles`/`result_count`として返す設計に変更した。非embeddableは`rejected_non_embeddable`として別枠に分離し、funnelの可視性は保つ。

- `search.list`（Category-oriented Discovery相当）: 5クエリ（ラーメン 東京／寿司 大阪／カレー 名古屋／焼肉 福岡／パスタ 札幌）で25件ヒット、全件embeddable、消費501 units（search.list 500 + videos.list 1）

```
youtube search: 25 embeddable videos (0 rejected as non-embeddable) across 5 queries, 501 units -> out/youtube_search_2026-08-12.json
```

ヒットしたタイトルは実店舗名・地域名を含むものが多く（例:「春駒寿司」「御園」など）、issue本文のRoute B（Category → Media → restaurant逆引き）の入力として現実的な精度感触があった。

**重要な制約**: `search.list`は`maxResults`に関わらず一律100 units/callを消費する。実運用の134カテゴリを1回で全部回すと134 × 100 = 13,400 unitsとなり、無料の日次上限(10,000 units)を超過する。1日で回すには134カテゴリ全部は不可能で、複数日に分割するか、Google Cloud Consoleから無料の割り当て増加申請（審査あり、即時ではない）が必要。issue本文が「12. 最初から134カテゴリ全部やらない」と明記している方針とも整合する。

実データベース（`dev.dish_category_features` where `feature_type='gate' and score=1`）から134件の正式カテゴリ一覧（Wikidata QID・英語ラベル・日本語ラベル）を取得し `fixtures/dish_categories_134_gate.csv` に保存した。

#### Stage 1相当: High/Middle/Long-tail 18カテゴリでの追加実測

`dev.dish_category_features`の`feature_type='market_salience', feature_key='region:country:JP'`（日本国内の人気度スコア、0〜1）で134件のgateカテゴリを並べ替え、上位6件(score 0.97-0.98)・中位6件(score 0.72)・下位6件(score 0.42)を抽出し、issue本文が挙げる6都市タイプを一巡させて`fixtures/youtube_18category_stage1_queries.txt`を作成した。

```
youtube search: 51 embeddable videos (2 rejected as non-embeddable) across 18 queries, 1802 units -> out/youtube_search_stage1_18cat_2026-08-12.json
```

18クエリ全件で生ヒット(`maxResults=3`)が得られ（0件ヒットのクエリなし）、53件中51件がembeddable（2件は`rejected_non_embeddable`として除外）。「アクアパッツァ 東京」「プリンアラモード 名古屋」「四川料理 大阪」のようなLong-tailカテゴリでも実店舗名を含むembeddableな動画が見つかっており、YouTubeはLong-tailカテゴリの補完源として有望という感触を得た。消費は累計2,303 units（無料枠の23%）。

#### quota制約への対応策（ユーザー指摘を受けて追加調査）

134カテゴリ全量 × 複数地域を毎日回すには無料枠(10,000 units/日)が明確に不足する。2つの対応策を実機確認した。

1. **無料の割り当て増加申請**: Google Cloud ConsoleからYouTube Data API v3のquota増加を無料で申請できる。ただし審査ありで即時ではないため、PoCがGoと判断されてから申請するのが妥当。
2. **yt-dlp（非公式スクレイピング）**: 環境に事前インストール済みの`yt-dlp` (v2023.11.16, quota消費なし・APIキー不要)で`ytsearch3:ラーメン 東京`のような検索を実行したところ、**YouTubeは正常に動作**し、title/channel/view_countをGoogle側のquotaを一切消費せず取得できた（`youtube-search-ytdlp`コマンドとして実装、`out/youtube_search_ytdlp_sample_2026-08-12.json`）。ただし**TikTok側の抽出は失敗**した（`Unable to extract sigi state`）。原因を追ったところ、この環境のyt-dlpはPython 3.7向けの古い固定バージョンでインターネット経由のアップグレードができず（サンドボックス環境の制約）、TikTok側のページ構造変更に追従できていないことが分かった。YouTube抽出はTikTokほどページ構造に依存しないため今回は動いたが、**yt-dlpは非公式スクレイピングであり利用規約上のグレーゾーン**。本番採用時は法務確認と「壊れたら公式APIにフォールバック」という設計を前提にすべき。

### dish_media_catalog / dish_media_external_embeddings 生成パイプライン（実restaurant×category実データ）

issue本文の「candidate → restaurant match → category match → embed check → accepted dish_media」というfunnelを、`dev.dishes`（実際にrestaurant_id×category_idが紐づいている本番相当のレコード）を起点に、無料範囲（YouTube Data API v3のみ）で再現した。BigQueryやdev DBへの書き込みは一切行わず、`discover-restaurant-dish-media`コマンドの出力はすべて本ディレクトリ内のJSONに閉じている。

**サンプル抽出**: `dev.dishes` × `dev.restaurants` × `dev.dish_categories` をJOINし、日本国内(緯度24-46, 経度123-146)の2,648組から、SHA-256決定的サンプリングで20組を抽出(`fixtures/restaurant_dish_sample_20.csv`)。

**歩留まり改善ループ（設計→PoC→評価を3ラウンド実施）**: レビューで「dev.dishes全体で60%程度の紐付けが必要」という目標を示されたため、単発の実測で終わらせず設計を3回改善して評価するループを回した。

| ラウンド | 変更内容 | restaurant_matched | accepted_to_catalog |
|---|---|---:|---:|
| v1 | タイトル完全一致のみ、`maxResults=1`(top1のみ評価) | 1/20 (5%) | 1/20 (5%) |
| v2 | `maxResults=3`に増やし複数候補から最良を選択、概要欄(videos.list由来の全文)とチャンネル名も判定材料に追加、店名の括弧以降を除いた「コア名」でのマッチも許容 | 5/20 (25%) | 5/20 (25%) |
| v3 | v2で見つかった誤検出（下記）を踏まえ、「撮影協力」等のクレジット文脈直後の店名一致を機械的に除外 | 4/20 (20%) | **4/20 (20%)** |

```
v1: discover-restaurant-dish-media: 20 candidates -> 1 restaurant-matched -> 1 accepted (2001 units)
v2: discover-restaurant-dish-media: 20 candidates -> 5 restaurant-matched -> 5 accepted (2002 units)
v3: discover-restaurant-dish-media: 20 candidates -> 4 restaurant-matched -> 4 accepted (2002 units) -> out/dish_media_discovery_2026-08-12.json
```

**v2で見つけた誤検出（重要な発見）**: 「Studio Sweets box 宇治金時」が概要欄一致でrestaurant_match_confidence=1.0として採用されたが、中身を確認すると動画は無関係な短編ドラマで、店名は「【撮影協力】\nStudio Sweets box 宇治金時」というロケ提供クレジットに載っていただけだった。**動画の主題ではなく単なる場所提供クレジットに店名が載っているだけの偽陽性**である。v3ではクレジット系キーワード（撮影協力/取材協力/ロケ協力/提供 等）の直後20文字以内に店名が出現するケースを検出し、confidence 0.0（不採用）にする補正を入れた。これにより誤検出は消えたが、母数が5→4に減っている（v2の25%は本番期待値としては使えない数字だった）。

v3の最終判定基準は`evaluate_restaurant_match()`に実装した4段階（issue本文22項の強度階層に対応）:

| confidence | 根拠 | issue22項の対応 |
|---:|---|---|
| 1.0 | 店名がそのままタイトルに出現 | Very strong |
| 0.9 | コア名(括弧以前)が投稿者チャンネル名に出現 | Strong(公式アカウント相当) |
| 0.8 | コア名がタイトルに出現 | Strong寄り |
| 0.7 | 店名/コア名が概要欄に出現、クレジット文脈でない | Medium（採用ラインちょうど） |
| 0.0 | クレジット文脈のみ、または根拠なし | Weak（不採用） |

v3で採用された4件はいずれも目視確認済みの真陽性: 「LANDMARK.」（山口市、ラーメン、タイトル完全一致）、「札幌らーめん ほくと亭」（タイトル完全一致）、「マッシモッタヴィオ」（タイトル完全一致）、「一休 (もんじゃ焼き、お好み焼きなど)」（タイトルにコア名「一休」が出現、実際にこの店主へのインタビュー記事動画）。生成された`dish_media_catalog`行・`dish_media_external_embeddings`行はユーザー提示の列構成（google_place_id, category_id, provider, external_content_id, canonical_url, thumbnail_url, media_type, availability_status, restaurant_match_confidence, category_confidence, published_at, last_verified_at, build_run_id / dish_media_id, provider, external_content_id, canonical_url, sanitized_embed_html, cache_expires_at, availability_status, last_verified_at）とそのまま一致する形で`out/dish_media_discovery_2026-08-12.json`に出力した。

**funnelの内訳（v3, ボトルネックの所在）**: `video_found=18/20(90%)`に対し`restaurant_matched=4/20(20%)`。つまり**ボトルネックは「動画が見つからない」ことではなく「見つかった動画がその店舗を名指ししていない」こと**にある。18件中14件はグルメ系YouTuber/foodvlogの実食レビューで、料理そのものは映っていても店名をタイトル・概要欄で明示していないケースが大半だった。これはissue本文が指摘する「SNS投稿の最大の難所は『どの実店舗のものか』」という論点そのものであり、テキストの単純一致というアプローチの構造的な限界でもある。

**60%目標に対する評価**: 5%→20%まで4倍改善したが、`0000_open_data_poc`の数十万店規模で狙う60%には無料範囲のYouTubeキーワード検索単独では届かない可能性が高い。issue本文が最初から提案している以下のアプローチの方が本命：
- **Route A(restaurant-aware discovery)**: Overture `socials`等で店舗の公式SNSアカウントが分かっている場合、キーワード検索ではなくそのアカウントの投稿を直接見にいく（今回のRoute B型「キーワード検索→後から店名照合」より格段に精度が高いはず。ただし本PoCの20サンプルにはOverture social linkの有無を確認する時間が無く未検証）
- 複数プラットフォームの合算（YouTube単独ではなくTikTok/X/Instagramのdiscoveryも足す。ただし#1269・本PoCの通りTikTokは無料でのdiscovery手段が無く、Instagramは審査必須）
- caption/画像分類によるPhase 2的な照合精度向上（issue26項、無料範囲のPoCでは意図的に未実装）

**quota状況**: 本ラウンドの反復で日次無料枠(10,000 units)の大半を消費した（本PoC全体でのYouTube累計消費は約8,300 units）。Route Aサンプルでの追加検証や、20件を超えるサンプルでの統計的により意味のある検証は、quotaリセット後（翌日）に持ち越す。

### Instagram Graph API / Threads API（無料だが審査必須で実データ取得は不可）

#1269のInstagram PoCは「Meta App・access tokenが環境に無く、business-discovery/hashtag-discovery/oembed-checkのいずれも未実測」と報告していた。本PoCではこれをMeta for Developers上で実機再現し、具体的なAPIエラーとして再確認した。

**セットアップ経過**

1. 開始時点でこのChromeプロファイルはMeta for Developersに**未ログイン**だった。これは#1269より一段階手前の制約（ログインすら無いとAPI呼び出しの入口に到達できない）。ユーザーがログインを完了。
2. 既存の本番Meta App「なに食べよ」（App ID: 1362623322024977、開発中モード、Business Portfolio「なに食べよ」）が既に存在することを確認。本番Appへの影響を避けるため、**PoC専用の新規App**（`nanitabeyo-1273-sns-poc`, App ID: 1605989120913742）を分離して作成した。
3. 新規App作成フローで「Threads APIにアクセス」「Instagramでメッセージとコンテンツを管理」「他のウェブサイトにFacebook, Instagram, Threadsのコンテンツを埋め込む(oEmbed)」の3ユースケースを選択し、既存Business Portfolio「なに食べよ」にリンクした。
4. App作成の完了ステップでMetaが本人確認のためのパスワード再入力を要求したため、ユーザー本人に入力してもらった（エージェントはパスワード入力を代行しない）。
5. Instagram Professional Accountの連携状況をGraph API (`me/accounts`) で確認したところ、Facebookページ「なに食べよ｜グルメアプリ」(ID: 942369855616691) に Instagram Business Account **`nanitabeyo.social`**（ID: 17841477274403880、表示名「【アプリ】なに食べよ」）が既に連携済みであることが分かった。ユーザーの回答通り、Instagram Professional Accountは事前に用意済みだった。
6. グラフAPIエクスプローラで`instagram_basic` `instagram_content_publish` `business_management` `pages_read_engagement` `pages_show_list` を要求してUserアクセストークンを発行できた（Standard Access、審査不要で即時発行）。

**実機テスト結果（審査前のStandard Accessで到達できる範囲）**

| 呼び出し | 結果 |
|---|---|
| `me/accounts?fields=...instagram_business_account{...}` | ✅ 成功。自分の(開発者本人の)Instagram Business Accountの基本情報は取得できる |
| `{ig-user-id}?fields=business_discovery.username(kurasushi.jp){...}`（他店舗アカウントの検索） | ❌ `(#10) Application does not have permission for this action`（OAuthException） |
| `instagram_oembed?url=...`（App Access TokenでのInstagram oEmbed） | ❌ `(#10) To use 'Meta oEmbed Read', your use of this endpoint must be reviewed and approved by Meta.`（OAuthException） |
| ビジネス認証状態（`developers.facebook.com/apps/{id}/verification/`） | 「未認証」。「認証を開始」ボタンはあるが、事業者としての書類提出が必要なためユーザー本人の作業とし、エージェントは着手していない |

**結論**: 自分自身のInstagram Professional Accountの基本情報を読むことはStandard Accessで無料・即時にできるが、issue本文が必要とする「他店舗のアカウント/投稿を検索・確認する」(`business_discovery`)も、「投稿を自社サイトに埋め込む」(`instagram_oembed`)も、いずれもMetaの審査（App Review、無料だがリードタイムあり）を通らない限り`OAuthException code 10`で拒否される。TikTok/X oEmbedとは対照的に、**InstagramのoEmbedはMeta Graph API経由である以上「無料だが審査必須」の対象そのもの**であり、無審査で使える無料の抜け道は無い。

Threads APIは同じApp作成フローで「アプリレビュー必須（ユースケース3件）」が明示されていたが、Threads独自のOAuth（threads.net、Facebook Loginとは別建て）のセットアップは時間の都合で本PoCでは未実施。ただしInstagram/oEmbedと同じ審査ゲートが明記されていたため、同様の結論になる可能性が高い。

**Business Verificationは断念。** App Review・Business Verificationとも金銭的には無料だが、Business Verificationには法人登記情報の提出が必須。今回のユーザーは法人登記をしていないため、この経路は選択しないと決定した。したがって、Instagram/Threadsは「開発者自身のアカウントのStandard Accessのみ利用可能、他店舗検索・oEmbedを含む一般利用は不可」で確定とする。issue本文が当初から示していた「Instagramは主探索エンジンではなく補助ソース」という位置づけと整合する結論になった。

## API capability matrix（無料範囲のみ）

| Provider | 経路 | 認証/キー | 費用 | 到達点 |
|---|---|---|---|---|
| TikTok | oEmbed | 不要 | 無料 | ✅ 実機確認済み(3/3) |
| X | oEmbed | 不要 | 無料 | ✅ 実機確認済み(5/5) |
| X | Search API | 必要 | 有料(pay-per-use) | ❌ 未実行(課金のためスキップ) |
| YouTube | Data API v3 search/videos(embeddable-onlyで返す) | APIキー(無料枠) | 無料(10,000 units/日) | ✅ 実機確認済み(5クエリ+18クエリ, 76件embeddableを取得・2件非embeddableは除外, 累計2,304 units) |
| YouTube | yt-dlp検索(非公式) | 不要(quota消費なし) | 無料だがToS上グレー | ✅ 実機確認済み(YouTube側は動作) |
| TikTok | yt-dlp検索/抽出(非公式) | 不要 | 無料だがToS上グレー | ❌ この環境の固定バージョンでは抽出失敗(ページ構造変更に未追従) |
| Instagram | 自分のIG Business Accountの基本情報取得 | Meta App + Professional Account | 無料・審査不要 | ✅ 実機確認済み(nanitabeyo.social) |
| Instagram | Graph API business_discovery(他店舗検索) | Meta App + App Review | 無料だが審査必須 | ❌ 実機確認: OAuthException code 10で拒否 |
| Instagram | oEmbed (Meta oEmbed Read) | Meta App + App Review | 無料だが審査必須 | ❌ 実機確認: OAuthException code 10で拒否 |
| Threads | keyword_search / oEmbed | Meta App + App Review | 無料だが審査必須 | ⏳ App作成画面で審査必須と明示。個別API呼び出しは未実施 |
| Meta共通 | Business Verification | ビジネスの法人確認書類 | 無料だが審査必須・ユーザー本人作業 | 未着手(「未認証」を確認、開始ボタンのみ) |

## Discovery無料スケール化ループ(Round1/Round2)と本番データ検証

issue #1273のコメントで開始した「アイデア→検証→評価」の反復ループを2ラウンド実施し、issue #1278〜#1284としてsub issue化した(詳細は各issue参照)。要点:

- **採用**: yt-dlp経由YouTube検索(#1283)。ただし持続負荷(2,000クエリ)でソフトなレート制限(403、8〜16%でプラトー)を発見し、単純な連続実行ではなくセッション分割+リトライキュー設計が必要と判明。
- **却下(事業モデル抵触)**: YOLP・ホットペッパー(#1282)。「飲食店から対価を得るビジネスでの利用禁止」条項があり、nanitabeyoの事業モデルと確定的に抵触。
- **却下(技術的に不可能)**: TikTok全アプローチ(#1280)、Instagram公開ページ直接アクセス(#1284)。
- **技術検証済みだが現状価値ゼロ**: Common Crawl経由ポータル逆引き(#1281)、X syndication API(#1278)。理由はいずれもInstagram Business Verification待ちという共通のボトルネック。
- **最重要**: dish_media発見のカバレッジ構造的上限(#1279)。`1-(1-p)^k`モデル(p=reverse-match成功率20%、k=店舗あたり独立クエリ試行数)でYouTube単独のcoverage点推定は20〜23%、issue当初の60%目標に届かない。

**本番データでの検証(オーナー指示、2026-08-13実施)**: `public.dishes`(103,528店舗、123,761dish)で店舗あたりカテゴリ数分布を再集計した結果、平均1.204・中央値1・p75=1・p90=2・最大10 — **dev環境(平均1.17)とほぼ同一の分布**。したがって「dev環境が手薄なだけ」という楽観的な説明は成立せず、この制約は本番データでも現に存在する。

ただし#1279に記載の通り、この試算は**Route A的な運用(店舗が既に登録しているdishカテゴリの範囲内でしか検索しない)を前提にkを見積もっている**。issue本文が提案するRoute B(カテゴリ×エリアの掃引を既存dish登録に関係なく独立に行い、見つかった投稿を逆引きマッチさせてその場でdish行を新規作成する)であれば、kは「店舗の既存dish登録数」に制約されない可能性があり、この場合のcoverage再試算が最優先の未解決事項として残っている。

## 次のgate

1. **Instagram/Threadsを無料範囲の主力にするのは見送る。** business_discovery・oEmbedとも審査必須というエラーを実機で確認済みのため、これ以上無料範囲で追加検証できることはない。Business Verification（法人書類提出、ユーザー本人作業）とApp Reviewの完了を待つか、Instagramを「主探索エンジンではなく補助ソース」とするissue本文の当初方針に沿って優先度を下げる。
2. YouTube Data API v3の134カテゴリ全量スイープ(13,400 units)は無料枠(10,000 units/日)を超過する。18カテゴリでのStage 1スモークテストは実行済み(2,301 units, 23%消費)。本実行(134カテゴリ×複数地域)に向けては、(a) PoCがGoと判断された場合にGoogle Cloud Consoleから無料のquota増加を申請する、(b) yt-dlpでYouTube検索をquota消費ゼロで補完する、の2案を確認済み。どちらを本線にするかはPoC後の設計判断とする。
3. TikTok/X oEmbedは技術的に即戦力であることが分かったため、Discovery側（TikTok URLの人手収集、Xの無料範囲でのDiscovery方法）を次のPoC対象にする。
4. Threads APIは同じApp Review要件が画面上に明示されたのみで個別エンドポイントは未実行。無料範囲追加の価値は低いと見て本PoCでは打ち切るが、Threads独自OAuth(threads.net)経由でのSDK/oEmbed個別テストは将来必要なら別issueで実施する。
5. **restaurant×category歩留まり改善の次の一手はRoute A(公式SNSアカウント直接参照)の検証。** Overture Placesの`socials`フィールドが埋まっている店舗に絞り、キーワード検索ではなく「その店の公式アカウントの投稿」を直接確認する方式でYouTube/X/TikTokのembeddable率・restaurant精度がどれだけ上がるかを次ラウンドで測る。20件では統計的な意味を持たせにくいため、YouTube quotaリセット後によりまとまった件数（100件規模）で再検証することが望ましい。
6. 本PoCで消費したYouTube quotaは日次枠の大部分（累計約8,300 units）に達した。追加のPoCラウンドは翌日のquotaリセット後に実施する。
