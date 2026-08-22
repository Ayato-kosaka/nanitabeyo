# Issue #1273 SNS別 dish_media インポートPoC（無料範囲のみ）

各SNSの Discovery / Embed 経路が **課金なし・審査待ちなし** でどこまで実機動作するかを検証する、再実行可能なPoCです。BigQueryは使わず、このディレクトリ内のローカルJSONで完結します。画像・動画バイナリは取得・保存せず、oEmbed/Data APIのメタデータ（permalink、author、embeddable可否、HTTPステータス）だけを扱います。

実測結果と判定は [REPORT.md](./REPORT.md)、実装は [sns_dish_media_poc.py](./sns_dish_media_poc.py) にあります。

## ディレクトリ境界

このディレクトリは #1273 専用です。親 #843 の共通調査や、兄弟 #1269 Instagram PoC・#1270 Foursquare PoCの成果物は混在させません。

## 対象と対象外

| Provider | 経路 | 認証 | 費用 | 本PoCで実行 |
|---|---|---|---|---|
| TikTok | oEmbed (`https://www.tiktok.com/oembed`) | 不要 | 無料 | ✅ |
| X | oEmbed (`https://publish.x.com/oembed`) | 不要 | 無料 | ✅ |
| X | Search API (Discovery) | 必要 | **有料**(pay-per-use) | ❌ スキップ |
| YouTube | Data API v3 (search.list / videos.list) | APIキー | 無料枠 (1日10,000 units) | ✅ |
| Instagram | Graph API business_discovery(他店舗検索) | Meta App + Professional Account + App Review | 無料だが審査必須 | ⚠️ 実機確認: `OAuthException code 10`で拒否 |
| Instagram | oEmbed (Meta oEmbed Read) | Meta App + App Review | 無料だが審査必須 | ⚠️ 実機確認: `OAuthException code 10`で拒否 |
| Threads | keyword_search | Meta App + App Review | 無料だが審査必須 | ⏳ App作成画面で審査必須と確認、個別呼び出しは未実施 |
| YouTube | yt-dlp検索（非公式・quota消費なし） | 不要 | 無料だがToS上グレー | ✅（YouTubeのみ動作、TikTokは環境の制約で失敗） |

Instagram/Threadsは、Meta Appを作成しStandard Accessでアクセストークンまで発行できたが、`business_discovery`（他店舗検索）と`instagram_oembed`はいずれも`(#10) Application does not have permission for this action` 等のOAuthExceptionで拒否された。App Review（無料だが審査あり）とBusiness Verification（法人書類提出、ユーザー本人作業）が必須という結論を実機で再確認した。詳細は REPORT.md を参照。

## セットアップと実行

Python 3.11以上、標準ライブラリのみ使用（追加インストール不要）。

```bash
cd scripts/20260808T0000_restaurant/1273_sns_dish_media_poc

python3 -m unittest -v test_sns_dish_media_poc.py

# TikTok / X oEmbed: キー不要
python3 sns_dish_media_poc.py tiktok-oembed-check \
  --urls fixtures/tiktok_sample_urls.txt \
  --output out/tiktok_oembed_$(date +%F).json

python3 sns_dish_media_poc.py x-oembed-check \
  --urls fixtures/x_sample_urls.txt \
  --output out/x_oembed_$(date +%F).json

# YouTube Data API v3: 無料枠APIキーが必要
cp .env.example .env  # YOUTUBE_API_KEY= に値を設定
set -a && source .env && set +a

python3 sns_dish_media_poc.py youtube-search \
  --queries fixtures/youtube_sample_queries.txt \
  --output out/youtube_search_$(date +%F).json

# Stage 1相当(High/Middle/Long-tail 各6カテゴリ)のスモークテスト
python3 sns_dish_media_poc.py youtube-search \
  --queries fixtures/youtube_18category_stage1_queries.txt \
  --output out/youtube_search_stage1_$(date +%F).json

# yt-dlpが使える場合のみ: quota消費ゼロの代替Discovery(非公式スクレイピング、ToS要確認)
python3 sns_dish_media_poc.py youtube-search-ytdlp \
  --queries fixtures/youtube_18category_stage1_queries.txt \
  --output out/youtube_search_ytdlp_$(date +%F).json

# dev.dishes(実restaurant×category)からdish_media_catalog/dish_media_external_embeddings相当を生成
python3 sns_dish_media_poc.py discover-restaurant-dish-media \
  --pairs fixtures/restaurant_dish_sample_20.csv \
  --output out/dish_media_discovery_$(date +%F).json
```

`.env` はgit管理外です。APIキーは出力JSONにも書き込みません。`YOUTUBE_API_KEY` 未設定時は `youtube-search` / `youtube-embed-check` が exit code 2 でfail closedし、推測値を生成しません（#1269と同じ方針）。

## カバレッジ試算スクリプト

```bash
# #1279 Route B前提の再モデル化（DB接続不要、fixtures/のCSVのみ使用）
python3 coverage_route_b.py
```

`coverage_route_b.py` が現行のカバレッジ試算です。`coverage_youtube_only.py` と `coverage_combined.py` のカバレッジ部分は Route A 前提（k = その店舗が既に `dishes` に持っているカテゴリ数）で `1-(1-p)^k` を使っており、#1279 でモデル誤りと判定されたため **SUPERSEDED**（Round2時点の記録として残置）。`coverage_combined.py` のうち Common Crawl 逆引きの実測部分（#1281）は引き続き有効。

Route B での再モデル化は、試行単位が「店舗」ではなく「クエリ」になる点と、カバレッジが `S(供給上限) × R_eff(retrieval効率)` に分解され `coverage <= S` で頭打ちになる点が要点。あわせて #1273 §32 のKPI（area×categoryセルごとに異なる5店舗）が、SNS側の発見率とは無関係に店舗密度とメニュー幅だけで決まる鳩の巣原理の上限を持つことを本番データで定量化している。詳細は REPORT.md。

必要なfixtures（`.gitignore`で`*.csv`が除外されているためgit管理外。DBから再エクスポートすること）:

- `fixtures/public_restaurants.csv` — 本番 `public.restaurants` 全件（列: name, latitude, longitude）
- `fixtures/public_dish_categories_134_gate.csv` — 134 gateカテゴリ（列: dish_category_id, label_en, label_ja, market_salience_jp）

## サンプルURL・カテゴリ

- `fixtures/tiktok_sample_urls.txt` / `fixtures/x_sample_urls.txt`: 2026-08-12にWeb検索で見つけた公開投稿。店舗紐付け精度やcoverage measurementのためのものではなく、あくまで技術的なEmbed feasibility（issue本文 Stage 0）確認用。
- `fixtures/dish_categories_134_gate.csv`: `dev.dish_category_features`(feature_type='gate', score=1)から取得した本番の134カテゴリ一覧（Wikidata QID・英語ラベル・日本語ラベル）。
- `fixtures/youtube_18category_stage1_queries.txt`: 134カテゴリを`market_salience`(日本国内人気度)で並べ替え、High/Middle/Long-tail各6件を抽出したStage 1相当のクエリセット。

## yt-dlpについて（任意・非公式）

`youtube-search-ytdlp` はGoogleのAPI quotaを一切消費しない代替Discovery経路です。`yt-dlp`コマンドが無い環境では `"yt-dlp not installed"` をerrorとして返すだけで、他のコマンドには影響しません。yt-dlpはYouTube/TikTok等の利用規約上「非公式なスクレイピング」であり、本番採用前に法務確認が必要です。

## Expo埋め込みテスト画面（実機確認用）

このPoCとは別に、`app-expo/app/[locale]/dev-tools/sns-embed-poc.tsx` にTikTok/X oEmbed・YouTube iframeをWebViewで描画するテスト画面を追加した。`contribution-tasks/`はユーザー投稿レビュー用のため、エンジニアリングQA画面は`dev-tools/`に分離している。通常のアプリ導線には接続しない一時的な画面で、EAS Build Developmentで `/{locale}/dev-tools/sns-embed-poc` を直接開いて目視確認する想定。

- 依存追加: `react-native-webview` を `app-expo/package.json` に追加済み（`npx expo install react-native-webview` で導入、`pnpm-lock.yaml`も更新済み）。lockfileの差分が大きく見えるのはpnpmのYAMLクォート形式の違いによる整形差分で、実際の依存バージョン変更はreact-native-webview 1件のみ。
- TikTok/Xは画面表示時に実際にoEmbed APIを叩いてhtmlを取得し、WebViewへ差し込む（静的HTMLを埋め込んでいないため、投稿削除/非公開化の失効も実機で再現される）。
- YouTubeはREPORT.mdの実測で採用された動画(`HSY_cevheSo`)を公式iframeで直接描画する。
