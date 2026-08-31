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

## BACKLOG（棚卸し 2026-08-31 09:50Z）— 責任者Claude・止めずに1つずつ進める
優先度順。完了したら [x]、進行中は [~]。各周でここを見て次を出す。

- [~] **B1 resolve店舗照合の磨き上げ**（agent稼働中）: カテゴリは12→70%済。残律速は「カテゴリ有・店無し56pt」。住所/地名抽出とmatchRestaurantNamesのrecall改善。(b)pg母数不足は別レバーとして数値化。
- [~] **柱1 公式サイト→店IG 本番化**（agent稼働中）: 4_4_crawl_official_site_igs.py + 4_1 --source official_site_crawl。店固有〜6万店。完了後 db-script-run で本番投入（DB書込は承認込みで私が実行）。
- [~] **柱2 handle拡張 第2周**（agent稼働中）: 572→720+→最終1000+。
- [ ] **② resolve全量完了→地域×料理カバレッジ確定測定**（20分自己チェックで自動継続。18,560到達で7_1+132絞り集計→オーナー報告）。
- [ ] **柱3 検索**: out/cell_queries.tsv(2412) を Serper無料枠で。**カバレッジの穴（132×都道府県で未充足セル）に絞って**使う（無料枠~2500の一撃なので測定後に穴を特定してから）。
- [ ] **pg母数のレバー**: restaurant_catalog 621k のうち pg dev に居る分だけが matched になる。B1の(b)実測後、pg dev への店同期が要るなら **DB変更サブIssue+承認** で提案（オーナー判断）。
- [ ] **恒久自走版②**: GitHub側で resolve→集計まで回り続ける形（私のセッション非依存）。オーナー合図で着手。
- [ ] **柱2 深掘り**: business_discovery を 50投稿/人 から増やす（今回50で18,560。深めれば投稿増だが距離店は飽和気味）。カバレッジ測定後に費用対効果で判断。

### 運用ルール（このループの不変則）
- SELECTは execute_sql_readonly のみ（execute_sqlは書込で承認が出る）。1GB超のスキャンだけ確認。
- 並列は Agent(worktree) と GitHub Actions(db-script-run.yml, 並列は concurrency_group_suffix -xxx)。
- 各周「必ず次の一手を出す」。意味ある変化だけオーナーへ1-2行。有料はオーナーが言うまで出さない。

## 進捗更新 2026-08-31 10:15Z
- [x] **柱2 handle拡張 第2周** 統合済: 572→**741**（+169・42都道府県）。次周で1000+へ（中国四国の残県）。
- [x] **柱1 本番化コード** 統合済（4_4_crawl_official_site_igs.py / 4_1 --source official_site_crawl / sns_store_site_ig）。**未dispatch**。
  - 柱1 dispatch 手順（resolve確定測定の後・DB新表作成なので実行時に一言添える）:
    1. BQ(execute_sql=書込・承認可): 単発CREATE で `sns_store_site_ig` を作成（**4_0は使わない**＝DROPで稼働中データ消滅。SQLは 20260830T0000_create_sns_seed_tables.sql の該当CREATE部を単独実行）。
    2. db-script-run: `4_4_crawl_official_site_igs.py` args `--run-id sns-2026-08-31 --catalog-run-id restaurant-2026-08-23 --limit 5000 --offset 0`（offset 5000刻みで全量、concurrency_group_suffix -crawlN で並列可）。まず `--limit 300 --dry-run` で動作確認。
    3. db-script-run: `4_1_discover_sns_accounts.py` args `--run-id sns-2026-08-31 --source official_site_crawl --crawl-run-id sns-2026-08-31`。
    4. その後 4_2(店アカ収集)→5_1(resolve) を回して 柱1 の matched を測る。
- [~] **resolve店舗照合の磨き上げ** agent 稼働中（56pt分解＋住所/店名照合改善）。
- [ ] resolve全量→確定測定（自己チェック継続）。

## 進捗更新 2026-08-31 10:20Z（3ワーカー統合完了）
- [x] **resolve店舗照合の磨き上げ** 統合済（commit patch）: (a)市区町村始まり住所抽出 53→64%・カテゴリ陽性58→71%、(c)【店名】括弧の完全一致prefill 発火19→100%(誤爆0)。**strictly additive/契約・DB不変/テスト緑**。
  - ⚠️ **本番反映に2回目のdevデプロイが必要**。今稼働中の resolve(18,560) は **辞書修正のみ**の状態(store-matchingは未反映)なので、その確定測定=辞書修正ベースライン。
- **次の段取り（測定後）**:
  1. 現resolve完了→**辞書修正ベースラインの確定測定**（地域×料理カバレッジ）をオーナー報告。
  2. store-matching改善を **api-deploy(target=development)** で dev反映（2回目）。
  3. skipped_no_store の行を消して**再resolve**（store-matchingリフト測定）。または全消し→全再resolve。
  4. 柱1 dispatch（PLAN前掲の手順）→ store IG を sns_source_account へ→ 4_2/5_1 で柱1 matched測定。
  5. 柱2は741で harvest 全量を回すか、深掘り（50→N投稿/人）をカバレッジ穴に応じて。

## 進捗更新 2026-08-31 12:45Z（store-matching 本番リフト確定・非破壊）
- [x] **resolve 版管理（非破壊再解決）をパイプラインに組込み**: delete廃止。`5_1`は版を上げると追記、`--reresolve-prev-status`で狙い撃ち、`7_1`は最新版集計。→ 以後 resolve改善は «版を上げて回すだけ»。
- [x] **store-matching 改善を dev反映(2回目)→ skipped_no_store 10,366件を非破壊再解決（version dev-2026-08-31-store）**:
  - **matched 14.0%→17.2% / 異なり店 2,221→2,705（+484）**（最新版集計）。全47都道府県。
  - newly_matched 596（skipped_no_storeの5.75%に店が付いた）。
  - **残り94%は pg dev に店が無い＝pg母数が店側の主律速**（resolveでは直せない）。ベースライン18,560(version dev-2026-08-30)は無傷。
- **現在の確定ファネル（run_id=sns-2026-08-30, 最新版）**: 収集18,560 → matched **3,194（17.2%）** / 異なり店 **2,705** / 全47都道府県 / セル充足（132-JP絞りは未算出、7_1で地域×料理更新中）。
- **次（自律）**: [~]柱1(公式サイト→店IG)本番投入（12:54Z自己チェックで起動）／[ ]柱3検索(cell_queries.tsv Serper)／[ ]柱2 741 harvest増。pg母数同期はDB変更=承認要、効果を見てから選択肢提示。

## 進捗更新 2026-08-31 15:40Z（柱1本番wave起動＋134絞りカバレッジ確定）
- [x] **柱1 crawl-test 歩留まり確認**（run 197, 300店）: 店固有裏取りhandle **58（18%）**＝PoC 5-11%目安超え。website保有店は282,163/621,966 → 18%外挿で**店IG ~5万**（柱1天井の実証）。
- [~] **柱1 本番crawl wave 起動**: db-script-run 5並列（run 201-205, offset 0/2000/4000/6000/8000・各--limit 2000・suffix -crawl0..4）。~90分で~1万店crawl→handle抽出。完了後 4_1 --source official_site_crawl → 4_2 → 5_1 で柱1 matched測定。
- [x] **«何割埋まる»を134アプリカテゴリ絞りで確定**（run_id=sns-2026-08-30・最新版・sns_coverage×dish_category_catalog[QID→label_ja]絞り）:
  - 47都道府県×134カテゴリ=6,298セル中 **充足(≥1店) 793セル=12.6%** / **≥5店 29セル=0.46%** / カバー済カテゴリ **105/134**（29カテゴリは全国0）。
  - 薄い県: 長野(2/134)・高知(4)・山形(5)・宮崎/島根(7)…＝地方。都市部は厚い。→ 柱3/柱1/柱2の投入先はこの地方セル。
  - matched総2,705店の内 ~1,269店分が134内（残りは コーヒー/ご飯 等アプリ外カテゴリ）。
- [x] **resolve店側レバーの実測評価**: skipped_no_store の内訳＝`area_not_provided`(~4,500,住所抽出0)・`searched/rst=0`(~5,270,店pg不在)。住所抽出は63.9%（駅名geocodeで+~7%可能だが GSI先頭結果が誤地点[渋谷駅→福島]でexact一致のみ安全＝中程度・偽陽性リスク）。→ **matchedの律速はpg母数**（store側resolve改善は二次）。station geocode は投機実装せず保留。
- **次**: 柱1 wave完了(~17:06Z)→handle集計→4_1/4_2/5_1で柱1 matched。並行 柱3(地方セル絞りSerper)・柱2 741 harvest。

## 進捗更新 2026-08-31 16:25Z（柱1 wave1完了→4_1/4_2起動・wave2投入）
- [x] **柱1 crawl wave1 完了**（run 201-205 全success, ~30分/batch）: 1万店crawl → 店固有裏取りhandle **1,722店(17.2%)**（testの18%を維持＝歩留まり実証）。handle保有 3,106店(31%)・異なりhandle 2,822。
- [x] **4_1合流 完了**: sns_source_account に **store_branch 2,532**（1店だけに付くhandle。グローバルチェーン除去済）。
- [~] **柱1 4_2 harvest 起動**（run sns-2026-08-31, store_branch, --max-accounts 800 --limit-per-account 30, ~4h, 逐次flush）: 店IGの投稿を business_discovery で収集中。完了後 5_1(resolve版上げ)で **柱1 matched** を測る。⚠️店IGは個人アカウント率が影響（business_discovery不可なら空）＝この歩留まりは初測定。
- [~] **柱1 crawl wave2 投入**（offset 10000-18000, suffix -crawl5..9）: 次の1万店。完了後 4_1再実行で handle 追加合流。
- **辞書メモ（loop B用）**: dish_category_variant_catalog = 93,738 surface form → 14,522カテゴリ。本番matchedは490カテゴリのみ出現。カテゴリrecall磨きは別tick。
- **次**: 4_2完了→5_1→柱1 matched測定。wave2完了→4_1再合流→さらにwave3(offset 20000+)。柱2/柱3は柱1測定後にキュー。
