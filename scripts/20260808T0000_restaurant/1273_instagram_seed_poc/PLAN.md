# #1273 初期シード調達の実装プラン（確定した打開策の統合）

最終更新: 2026-08-28 / 詳細な実測は `REPORT.md` `FINDINGS.md` `out/measurements.json`

## 大原則（実測で確定）

**投稿URLを 1 本得れば、そこから `dish_media` 完成まで無料・審査不要。**
- エンリッチ = `instagram.com/p/{code}/embed/captioned/`（500連射100%・6,870/時・ブロック0）
- 分類・店舗づけ = `resolve`（api/src/v1/dish-media-imports/、実装済み）
- 取り込み = `POST /v1/dish-media/imports`

したがって設計は「**飲食の投稿URL/アカウントをどう発見するか**」に集約される。

## 3 本柱（無料 → 最安の順）

### 柱1【無料・確度高】店 → 店の公式IGアカウント → 投稿
- 発見: open data socials（Overture/FSQ/OSM/Wikidata の union ≈ 4万アカウント）
  ＋ Common Crawl で店の公式サイトを読む（website店の18.3%）
- 到達: **約9〜17万店**。アカウント＝店で照合自明・最高品質
- エンリッチ: business_discovery（200/時）または embed（6,870/時）

### 柱2【無料・今回の本命】グルメインフルエンサー → 投稿 → 店
- 発見: 公開リスト記事から handle 抽出（実測: 6本で263、55%が地方特化）
- **柱1が届かない «公式サイトもIGも無い地方・小規模店» を第三者投稿で拾う**
- エンリッチ: business_discovery で各人の全投稿（解決率94%・media_count中央値≈1,667・飲食率0.98[n=2速報]）
- 制約: business_discovery 200/時。複数IGアカウントで並列化
- 追加カバー: 【測定中】

### 柱3【最安・仕上げ】料理カテゴリ×市区町村 → 検索 → 投稿
- 柱1+2 で埋まらない残りだけを Serper で発見
- 費用: 132カテゴリ×800市区町村×3ページ ≈ 31.6万クエリ ≈ **$95**（Serper $0.30/1k）
- 実測: 108セル全部で「対象地域5店以上」、地域一致58.6%

## 却下した発見手段（実測済み・再検討不要）
- IG 場所ページ/web_profile_info/投稿JSON/サイトマップ = 全滅（embed 以外死亡）
- WAT 素 = 飲食2%・散在 / WAT+WET join = 偽陽性だらけ（非飲食ページが大半）
- まとめメディア無料クロール = WAF or 自社写真で permalink 0
- 既製データセット（Kaggle/Zenodo/HF/DataCite/archive.org/GDELT）= 日本の飲食ほぼ0
- 無料検索API（Gemini grounding 等）= 規約でリンク収集禁止

## コスト早見
| 目標 | 手段 | 費用 |
| --- | --- | ---: |
| 〜17万店 | 柱1（無料） | $0 |
| ＋地方無サイト店 | 柱2（無料・要IGアカウント×時間） | $0 |
| 50万店まで仕上げ | 柱3（Serper 増分） | 〜$95 |

## 次のアクション
1. 柱2の追加カバーを business_discovery で実測（進行中）
2. スノーボール検証: インフルエンサー投稿の @メンションから新規«店アカウント»を採れるか（柱1へ還流）
3. 実装は #1318（スキーマ/書き込み経路）と接続して Sub-issue 化

---

## 現在地ログ 2026-08-30（本番«止まらない»ループ開始）

正本はこの PLAN.md ＋ Issue #1273 台帳。毎時トリガー(`trig_01VLS3H4bCgjeWTGjrSuADtq`)で下記2ループを回す。

### 本番パイプラインの実測（run_id=`sns-2026-08-30`, dev resolve）
- 収集1085(influencer 55×20) → resolve 100% → **matched 23 / 異なり店20 / 15カテゴリ**。
- 天井分解: カテゴリ候補が出た 12% ・住所取れて pg 検索 40% ・pg店ヒット 26%。→ **律速はカテゴリ抽出**。
- 地域×料理カバレッジ = 47都道府県×132カテゴリ=6,204セルのうち充足 ≈ 0.3%（「1セル≥5店」は0）。

### この日の前進（コミット済み・本番ブランチ）
- **柱2 seed 413→572**（新規159・40/47都道府県。地方特化まとめ記事から無料抽出）。
- **resolve精度 真因特定＋修正**: `dish_category_variants` のグローバル一意化で 134中24カテゴリが日本語ラベル欠落
  → `labels.ja` を索引へ足し戻す。標本1798で カテゴリ当たり **59.2%→64.9%**、誤爆ほぼ0、strictly additive。

### ⚠️ 効かせるのに要る依存（未完）
- 上の resolve 修正は **dev へデプロイされて初めて本番パイプライン（dev resolve を叩く）に効く**。
  デプロイ前に harvest を再 resolve しても旧辞書のまま。→ dev 反映が次のクリティカルパス。
- 柱2フル harvest（全413×50, run 170）実行中。完了後: 4_1で572を source_account へ→新規handleを4_2→5_1。

### 走っているワーカー / ジョブ
- 柱1（公式サイト→店IG抽出の最適化）Agent 稼働中（別worktree）。
- 柱2フル harvest（GitHub Actions run 170）。
- 毎時トリガーで回収・次手・新ルート検証。

### 次に積むキュー（頭打ちなら新ルート）
1. resolve改善を dev 反映 → harvest 再 resolve で matched 率の実本番リフトを測る。
2. 柱2: 572で harvest 全量 → カバレッジ更新。seed を 1000+ へ次周も拡張。
3. 柱1: 公式サイト抽出をスケール、store IG を 4_1 へ接続。
4. 柱3: Serper 無料枠で 料理×市区町村 の穴埋め（4_3、既存）。
5. resolve の店舗照合(matchRestaurantNames)側の recall も同様に磨く。

## RESUME 2026-08-31 07:30Z（毎時ループの次アクション）

- **harvest 完了**: `sns_post_raw` run_id=`sns-2026-08-30` に **18,560投稿 / 374アカウント**（柱2フル）。
- **resolve辞書修正を dev へデプロイ済み**（api-deploy run 325, 00:25Z success。dev resolve は新辞書）。
- 旧辞書の resolved 1085件は削除済み。**新辞書で全18,560を再resolve中**（5_1 を `--limit 2500` でバッチ、resolve_version=`dev-2026-08-31-newdict`）。
- **毎時ティックの次アクション**: 
  1. `sns_post_resolved`(run_id=`sns-2026-08-30`) の件数を見る。18,560未満なら 5_1 を `--limit 2500` で**もう1バッチ** dispatch（既resolveはLEFT JOINでskip、冪等）。
  2. 18,560に到達したら**測定**: status内訳・matched率・異なり店/カテゴリ・地域×料理カバレッジ（47×132セル充足）。旧12%→新辞書での改善を出す。
  3. 測定が出たらオーナーへ §1 6項目で報告（これは «意味のある変化»）。
  4. 並行して柱1本番接続（`4_1 --source official_site_crawl`）・柱3（`out/cell_queries.tsv`をSerper無料枠で）・インフルエンサー拡張の次周も進める。

## RESUME 2026-08-31 07:45Z（更新: 並列シャードで再resolve中）
- 直列バッチは遅く不可視だったので廃止。**5_1 を --shards 6 で並列** + 200件ごと逐次ロードに改修。
- いま **shard 0..5 の6 run が並列稼働**（run_id=sns-2026-08-30, resolve_version=dev-2026-08-31-newdict）。resolved が18,560へ向けて増える。
- **毎時ティック**: resolved 件数を見る。①まだ増加中なら待つ（直列バッチは追加dispatchしない＝二重防止）。②失敗/停止したシャードがあれば同じ --shard 引数で再dispatch（LEFT JOINでskip冪等）。③18,560到達で**測定**→オーナーへ報告。
