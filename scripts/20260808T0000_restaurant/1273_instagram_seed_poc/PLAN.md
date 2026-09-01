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

## 進捗更新 2026-08-31 17:10Z（★柱1は«pg母数シーディング»機構＝戦略的再定義）
- [x] **wave2 crawl 完了**（20,000店 crawl累計・店固有handle 3,432）。4_2 harvest 稼働中（168/800 acct・**4,916投稿**・~29投稿/店IG＝店アカウントも business_discovery 可）。
- ★**重要な気づき（戦略修正）**: 柱1は «店自身の IG» を収集するので、**投稿の店 google_place_id は crawl で既知**（sns_post_raw.discovery_seed_place_id、4,916/4,916 で充填確認）。→ **柱1 の store 特定は resolve の pg 照合に依存しない**＝柱2 を縛った «pg母数の壁»(94%が pg dev 不在) の影響を受けない。resolve は **カテゴリ抽出のためだけ**に使う。
  - 帰結: 柱1 の «matched»(resolve が pg で店発見) は低く出るが、それは柱1を過小評価する。柱1 の真の産出 = **既知店 × キャプション解決カテゴリ** = そのまま dish_media 化できる (store, posts, category) 三つ組。
  - **柱1 測定は2軸で出す**: (a) resolve-matched（今すぐ使える＝店が既に pg dev）／(b) 既知店×カテゴリ解決（status=matched または skipped_no_store。pg同期すれば使える柱1の潜在産出）。(b) が pg母数同期の投資根拠。
- **crawl は harvest 律速を追い越さない**: IG business_discovery 200/時が柱1のスループット律速。3,432 handle 既にキュー＝十数時間分。**wave3 crawl は harvest が追いつくまで出さない**（先行crawlは遊休backlog）。4_2 に shard/offset を足すのは (b) 測定で柱1価値を確認後に判断。
- **次**: 4_2(800)完了→5_1(version dev-2026-08-31-store)→柱1を(a)(b)で測定→意味あれば pg母数同期を選択肢提示（DB変更・承認要）。

## 進捗更新 2026-08-31 18:12Z（柱1 harvestの構造的スループット制約を確定）
- 4_2 harvest 順調に前進（17:19時点168acct→18:12時点 **385acct/11,313投稿**。停滞は逐次flush粒度の見え方だった）。~800は~19:30見込み。
- ★**柱1 harvest は IG business_discovery 200/時に構造的に律速。並列化しても速くならない**: 投稿一覧の取得は business_discovery しか手段が無く（embed 6,870/時は «既知postのcaption取得» 用で handle の投稿列挙には使えない）、レート制限は **app token 単位**。4_2 を --shards で6並列にしても同一 IG_TOKEN の同一バケットを share するので合算 200/時のまま backoff が増えるだけ。→ **4_2 sharding は無意味・実装しない**。2,532 handle の全収集は ~12.6h（200/時）。
- 帰結: **crawl は harvest を追い越さない**（wave3以降は backlog 消化まで保留、再確認）。柱1の near-term 測定は 800 sample で行う。全量 harvest は時間をかけて消化（毎tickで完了分を 5_1 に流す運用）。
- カテゴリrecall磨き(loop B)は、offline matcher 複製(fragile)ではなく **5_1 後の実 store-caption の cat=0 実ミス**で行う（evidence-first）。

## 進捗更新 2026-08-31 20:10Z（柱1 4_2完了→5_1 6並列resolve起動）
- [x] **柱1 4_2 harvest 完了**（run 215 success 19:42Z）: **19,396投稿 / 662アカウント / 異なり既知店 599**（800中662がbusiness_discovery可、残は非公開/不可）。
- [~] **柱1 5_1 resolve 6並列起動**（run sns-2026-08-31, resolve_version=dev-2026-08-31-store, shard0..5, suffix -p1r0..5）: 柱1投稿のカテゴリ抽出。~1-3h(embed fetch律速)。
- **5_1完了後にこの2軸を測定して報告**（クエリはそのまま流せる）:
  - (a) resolve-matched: `WITH l AS (SELECT provider,post_id,status,google_place_id,ROW_NUMBER()OVER(PARTITION BY provider,post_id ORDER BY resolved_at DESC)rn FROM restaurant_recommendation.sns_post_resolved WHERE run_id='sns-2026-08-31') SELECT COUNTIF(status='matched')matched_posts,COUNT(DISTINCT IF(status='matched',google_place_id,NULL))matched_stores FROM l WHERE rn=1`
  - (b) 既知店×カテゴリ解決(pg同期で使える潜在産出): `WITH l AS (SELECT provider,post_id,status,dish_category_id,ROW_NUMBER()OVER(PARTITION BY provider,post_id ORDER BY resolved_at DESC)rn FROM restaurant_recommendation.sns_post_resolved WHERE run_id='sns-2026-08-31') SELECT COUNTIF(l.status IN('matched','skipped_no_store')AND l.dish_category_id IS NOT NULL)usable_posts,COUNT(DISTINCT IF(l.status IN('matched','skipped_no_store')AND l.dish_category_id IS NOT NULL,raw.discovery_seed_place_id,NULL))usable_known_stores FROM l JOIN restaurant_recommendation.sns_post_raw raw ON raw.run_id='sns-2026-08-31'AND raw.provider=l.provider AND raw.post_id=l.post_id WHERE l.rn=1`
  - status内訳・cat=0率（＝柱1のカテゴリrecall磨き対象）・柱1新規異なり店(sns-2026-08-30に無い)も。
- 完了・(a)(b)が出たら §1 6項目でオーナーへ。(b)が大きければ pg母数同期を選択肢提示。

## ⚠️ 20:15Z 発見: dev API が 15:17Z 以降 main で稼働＝私の resolve 改善が効いていない
- api-deploy 履歴: run 327(main, 15:17Z)・run 328(main, 16:30Z)が dev を main で再デプロイ。**私の branch の dev デプロイは run 326(10:33Z)が最後**。#1691 は未マージなので、dev は 15:17Z 以降 **辞書修正(buildJapaneseLabelVariants / findAllCategoryLabelsForMatching / DISH_CATEGORY_JA_LABEL_SYNONYMS)を持たない main の resolve** を走らせている（変数インデックスは6h TTLだが再デプロイでプロセス再起動→キャッシュ消失→main版で再ロード）。別ワークストリーム(#1641)が import 400 対策で dev を main から再デプロイし続けている＝**共有 dev の奪い合い**。
- 影響: **柱1 の 5_1(20:10Z起動) は辞書修正なしで解決**＝カテゴリ recall が ~6pp + 24カテゴリ分 過小。ただし (b) の usable_known_stores は «店の~29投稿のどれか1つが常用料理に当たれば店として数える» ので degraded でも頑健＝下限として有効。store-matching 改善は柱1では不要(店は既知)。
- 対応方針（deploy 戦争はしない）: 5_1 は下限測定として完走させる。**正確な柱1測定と両ワークストリーム双方の利益のため «resolve 改善(API差分)を main へ載せる» はオーナー【判断】**（#1691 全体=56k行PoCは不適、API差分だけの focused PR 抽出＋マージが要る）。22:00 測定チェックで cat=0 実率を見て過小度を実測し、報告に caveat を添える。
- **未解決台帳へ**: 「共有 dev の deploy 競合（#1273 resolve改善 vs #1641 main）＝どの resolve を dev の正にするか」オーナー判断待ち。

## 進捗更新 2026-08-31 20:57Z（障害後の立て直し・(d)完了）
- **障害**: 真因は run 216 の 62万行×62万行（店舗同期 #843/#1706、17:10:12開始が推薦38.5s悪化と秒一致）。私のresolveは相乗り負荷でオーナーが切り分け・免責。恒久対策として db-script-run を単一グループ直列へ戻した（77226e0。共有DB同時負荷の安全弁）。
- **オーナー決定**: (a)オフライン突合✓ (b)再開✓（本番回復）(c)Supabase分離は今はしない (d)resolve改善をmainへ✓。
- [x] **(d) 完了**: resolve改善の API/shared 9ファイルだけを focused PR #1756 に抽出→**main へ squash マージ(5f82c638)**。ローカル全緑(shared131/api22/typecheck)。repository.tsは main #1629 と合流。**dev を main から再デプロイ中**（api-deploy target=development）。完了で dev resolve が正しく効き、共有dev競合も解消。
- [x] **#1748 突合の影響を実測**: 3件（焼肉/かき氷/餃子）は誤QID(picker)がfeatures不在＝検索到達不可。私の旧カバレッジは検索側QIDで既に充足済みでセルはほぼ動かない（誤QID分 計72投稿は正カテゴリへ統合されるだけ）。#1748本体はアプリ取り込み→検索の製品バグで、#1748側の承認ゲート付きロールアウト。
- **次（再開後・DBに優しく）**:
  1. dev再デプロイ完了を確認（api-deploy run 成功・/livez 200）。
  2. **(b) 柱1 再計測**: 5_1 を **--shards 1 で直列・本番ピーク回避**、run sns-2026-08-31、resolve_version=`dev-2026-08-31-p1fix`（新版）。完了で (a)resolve-matched /(b)既知店×カテゴリ の2軸＋補正済み134カバレッジ→オーナー報告。**6並列はしない**（障害の反省）。
  3. **(a) カテゴリ突合の磨き上げ**: shared/utils 純関数＋BQ辞書＋#1748補正をオフラインで回し recall 計測（DB非書込）。
  4. crawl/harvest 再開は柱1測定の後、直列で。
- **不変則追加**: resolve(5_1)は共有DBを叩くので **必ず直列・本番ピーク回避・版を上げて非破壊**。並列シャードは使わない。

## 進捗更新 2026-08-31 21:11Z（dev再デプロイ完了→柱1 5_1 直列開始）
- [x] dev 再デプロイ完了（api-deploy run 329, main 5f82c638, 21:04Z success）＝dev resolve に私の改善が反映。
- [~] **柱1 5_1 直列実行中**（run sns-2026-08-31, resolve_version=`dev-2026-08-31-p1fix`, **--shards 1**・--limit 4000, 06:10 JST off-peak）。~30-40分。**6並列はしない**。
- **次tick**: ①走っているrun確認（5_1が in_progress なら再dispatchせず待つ）。②5_1完了で柱1を2軸測定（(a)resolve-matched /(b)既知店×カテゴリ、クエリはPLAN 20:10Z項）＋#1748ピッカー→検索remap＋134カバレッジ増分→**初の柱1数値をオーナー報告**。③残り投稿(19,396中4,000超)は次のoff-peakで直列 --limit で継続。④並行 (a) オフライン辞書磨き（3,333変数行をshared/utils純関数に通しrecall計測）。

## 進捗更新 2026-08-31 22:20Z（柱1 早期計測＋cat=0の真因＝構造的）
- **#1760 反映**: db-script-run に並列(suffix)を復活（コメントを実因=店舗同期62万行×62万行に修正、resolveはoff-peak・控えめ並列の不変則付き。commit e9dafd1）。
- **柱1 5_1(p1fix) 部分計測（2,800/4,000, 正しいdev resolve）**: matched **5.0%(a)** / skipped_no_store 50.4% / **cat=0 44.3%**。→ (b)«既知店+カテゴリ» = matched+no_store = **55.4%**（pg同期で使える柱1潜在産出）。
- ★**cat=0 の真因を実キャプション16本で確認（IG embed直fetch・DB非接続）**: 大半が**辞書ギャップではなく構造的**。
  1. **店投稿は«告知»が多くて料理語が無い**（休業日/新年挨拶/セール/出店告知）＝正当にcat=0。
  2. **アプリ134外/非飲食の店**が crawl に混入（パン屋[パンは134に無い]・茶園・美容室）。
  3. **非日本語キャプション**（韓国語のコーヒー/デザート店が複数）。
  → **(a) 辞書magnificationの柱1 ROIは小さい**（告知には料理語が無い）。辞書磨きは料理を語る**柱2(インフルエンサー)**に効く。柱1は**(b)店単位が正しい指標**（店の~30投稿の1つに料理があれば店として数える＝告知ノイズに頑健）。
- **次**: 4,000完了で (a)(b) 確定＋#1748 remap＋134カバレッジ増分→報告。残り~15kは #1760 の並列で3shard・off-peakで。柱1の«量»レバーは crawl拡大＋pg母数同期（承認要）。辞書磨きは柱2キャプションで測る。

## 進捗更新 2026-08-31 23:18Z（★柱1 初計測確定→律速はpg母数）
- **柱1 計測（3,000投稿/176店サンプル・正しいdev resolve p1fix）**:
  - **(b) 店産出率 87.5%**（154/176店が«料理カテゴリ付き投稿≥1»＝seedable dish_media）。店単位集計は告知ノイズに頑健（予測どおり）。
  - **(a) pg dev在籍は約26%**（resolve-matched 46店・投稿単位4.8%）＝今すぐ使える分。
  - → **柱1の seedable 店の約74%が pg dev 不在**。**律速は pg母数（restaurant_catalog 621k のうち pg dev に居る分だけ使える）**で確定。柱1のcrawl/harvestは «料理付きの店» を大量に出せる（87.5%）が、pg同期が無いとカバレッジに変わらない。
- **戦略ピボット**: 柱1の«発見»は実証済み。次の最大レバーは **pg母数同期（#843/#1706 の store-sync 領域）**。※これは障害を起こした 62万行×62万行ジョブ本体なので、走らせるなら off-peak・その pipeline の作法で。私(#1273)の領分ではなく、オーナー判断＋当該WSの調整。
- **残**: 5_1 直列4000完了間近→残~15kは #1760 並列(3shard・off-peak)。全量後に134カバレッジ増分を確定。柱2(741 harvest)/柱3(地方Serper)は辞書magnificationの効く柱2優先で。

## 進捗更新 2026-08-31 23:35Z（★pg母数投入予告→post-sync再resolveを予約）
- **オーナー連絡**: restaurant_catalog 621k を **~01:34Z（+2h）に pg dev へ投入**。**~02:35Z（+3h）に続きを止まらず進めよ**。→ 柱1のpg母数律速が解消される＝本命。
- [x] **post-sync 継続を予約**: `trig_01DJVppVMd2GqwaLUTyEpagy`（02:35Z）。内容: pg投入確認(restaurant_pg_sync_logs＋小バッチで matched 跳ね確認)→ 新版 `dev-2026-09-01-pgfull` でベースライン(18,560)+柱1(19,396)を **--shards 3・off-peak** で再resolve→ 7_1で134カバレッジ確定(旧793セル12.6%/matched17.2%/2,705店と比較)→ オーナー6項目報告→ 柱1crawl拡大/柱2/柱3。
- ⚠️ **同期中(now〜01:34Z)は新規 resolve を走らせない**（共有DB配慮）。現行の直列 5_1(p1fix,~3000/4000)は pre-sync・gentle なので**完走させる**が、完了後は post-sync までresolveを追加しない。
- **interim 毎時ティック(00:16/01:16Z)**: resolve・pg叩くジョブは出さない。OKなのは柱2 harvest(4_2=IG+BQ)・柱3準備・柱1 crawl(4_4=BQのみ)・状況確認だけ。02:35Z の trigger が本命を回す。

## 進捗更新 2026-09-01 02:55Z（★重要訂正: pg母数は律速ではなかった）
- **pg母数投入の結果＝0%転換**: 01:35Z同期(updated 621,966/inserted 0=全件refresh)後、baseline skipped_no_store 3,600件を dev-2026-09-01-pgfull で再resolve→ **matched 0**（still_no_store 3,162 / no_cat 438）。
- **確定事実**: pg dev restaurants は **8/24 に 569,661 insert 済**、以後~57〜62万店。**pg母数は最初から足りていた**。私の«pg母数が律速»（12:45Z/23:18Z）は**誤診**。«5.75%転換»「柱1 26%在籍」は店数ではなく resolve照合結果の取り違えだった。
- **真の律速（3,600の内訳）**: 51% `area_not_provided`（キャプションから場所抽出できず検索が走らない）＋ 40% `searched`・候補0（近傍検索したが店名照合で一致0）。→ **resolveの照合精度が律速**（=元々オーナーが言っていた磨き上げループ）。
- **やめること**: pg狙いの全量再resolveは無意味＝しない。追加pg同期も不要（母数十分）。
- **戻す方針（loop B）**: (a)場所抽出の底上げ（駅名/地名/市区町村geocodeをexact-matchで安全に。以前の駅名調査を活かす）、(b)店名照合recall。**オフラインで実キャプション(infl_captions.jsonl等)に対し測定→改善→dev反映→再resolveでリフト測定**。DB負荷小。
- **柱1の価値は不変**: «既知店×カテゴリ» は resolve照合に依存しない（店IDはcrawl既知）ので、pg母数とは別に seedable。柱1のdish_media化はresolve照合ではなく直接 discovery_seed_place_id を使う設計にすればよい（別途）。

## 進捗更新 2026-09-01 03:12Z（真の律速を精緻化: 実キャプション12本）
- searched/rst=0（=場所は取れたが店0）の実キャプション12本を fetch。多くが **【店名】＋【住所】をフル記載**（matome系: wakayama_lunch_dinner 等）なのに resolve は候補0＝**明白な recall 失敗**。
- restaurant_catalog(621k) 突合: **KORI庵 は catalog に在る**（住所 和歌山県和歌山市東鍛冶屋町19）のに rst=0。キャプションの住所は **異体字「鍜」(catalogは「鍛」)** ＝ geocode が外れて近傍に出ない疑い＝**resolveのgeocode/正規化 recall バグ（私が直せる）**。
- 一方 すながわ製麺所・TRAIL HUT・元祖博多だるま・HIYORI WASANBON・perotto・ブレーメン は **catalog に無い**（7中6）＝ **restaurant_catalog の網羅性が足りない**（＝pg-syncではなく catalog 母集団自体。#843/#1706 の領分）。
- **精緻化した律速マップ**（matched を縛るもの）:
  1. resolve **場所抽出**（area_not_provided 51%）… 私が直す（loop B）。
  2. resolve **geocode/店名照合 recall**（catalogに在るのに0＝KORI庵型・異体字/正規化）… 私が直す（loop B）。
  3. **restaurant_catalog の網羅性**（そもそも catalog に無い店）… #843/#1706（別WS・私の領分外）。
- pg-sync は無関係（pg=catalog全量）で確定。
- **私の次手（loop B・DB負荷小）**: ①住所正規化を NFKC＋異体字吸収（鍜↔鍛等）して geocode 命中を上げる ②【住所】ラベルの市区町村住所抽出の取りこぼし確認 ③店名照合recall。オフラインで実キャプションに測って改善→dev反映→再resolveでリフト測定。

## 進捗更新 2026-09-01 05:20Z（loop B オフライン計測: レバーを実測で選別）
- **実キャプション1,798本に resolve の実regex(verbatim)＋GSI実叩きで計測**（DB非接続・GSIは無料）:
  1. `extractPostalAddress` 抽出率 **64.0%**（1151/1798, bare586/labeled373/citylead192）。未抽出647本の内訳は大半が**構造的**（住所が書かれていない＝📍店名だけ・bioの地域署名・イベントまとめ）。**regex磨きのROIは小**。
  2. **GSI geocode 命中率 100%**（抽出済み住所140標本 140/140）。NFKC/異体字正規化の**リフト=0**。→ **«KORI庵型 異体字/geocode drift» レバーは死んでいる**（単発の逸話を過大評価していた）。**作らない**。
  3. 未抽出647本のうち **📍/【】店名あり=463**、そのうち**地域語も併記=139のみ**。名前だけ(地域なし)=324、名前も無し=184。
- **確定したレバーマップ（matched を縛るもの・私の領分）**:
  - ~~異体字/geocode正規化~~ → **リフト0で棄却**（#1)。
  - 住所regex磨き → 未抽出は構造的が大半でROI小（#2)。
  - ★**name-first（📍/【店名】→ 店名で店照合）＝唯一の生きたレバー**。ただし**地域スコープ必須**（621k全件ILIKEは障害の元＝禁止）。DB安全に叩けるのは地域語併記の**139本≒7.7%**。地域なし324本は全件走査が要る＝**やらない**。
  - 残りは restaurant_catalog 網羅性（#843領分）。
- **次tick（実装・DB負荷小）**: sns-address に `extractStoreName`（📍/【】）＋ «市区町村だけ geocode して広め半径で area を張る» フォールバックを足し、既存 `searchNearbyRestaurants(q=店名)` に載せる。**地域語が取れた時だけ**張る（全件走査しない）。オフラインで139本の回収率を測り、効くなら dev反映→新版で再resolveしてmatchedリフト測定。効かなければ棄却して報告。
- **オーナー報告はしない**（matchedリフト未確定。レバー選別は内部の磨き上げ工程）。

## 進捗更新 2026-09-01 05:35Z（loop B: name-first フォールバックを実装・緑・commit済み）
- [~] **実装完了・ローカル全緑**（commit 28c0c3b, branch poc）:
  - `sns-address.ts`: `extractStoreName`（📍/【店名】/店名ラベル、ふりがな括弧除去、📍住所/アクセスは店名扱いしない）＋ `extractCoarseArea`（都道府県+市区町村 / 市区町村単独、「楽天市場」型の偽陽性ガード）。
  - `dish-media-imports.service.ts`: フル住所(地番)が取れない時、店名+市区町村なら**市区町村中心12km で店名一致(q)だけ**を引くフォールバック（`nameQueryOnly`。q なし一覧は張らない＝粗い地点で無関係店を入れない）。author_name に加えキャプション本文の店名も q に。
  - **DB安全**: 地域スコープ必須→ 621k 全件 ILIKE を回避。地域 or 店名が取れなければ従来どおり縮退（純増）。**設計不変**（interface 不変）。
  - specs: sns-address 22 緑 / service 42 緑 / tsc clean。
- **安全性の根拠**: 誤抽出は «候補0» にしかならない（matchRestaurantNames がキャプション本文に店名が出るか再確認する＝誤 prefill しない）。純粋な additive。
- **残（実測リフト・オフピーク限定）**: dev へ反映（api-deploy target=development を **ref=poc ブランチ**で dispatch＝checkout が ref を引くので main を汚さず測れる）→ 新版 `dev-2026-09-01-namefirst` で area_not_provided/no_store 標本を**オフピーク（JST深夜=15:00Z以降）・控えめ**に再resolve→ matched リフト測定。効けば focused PR を main へ＋オーナー6項目報告。効かなければ棄却＋1行FYI。
- **interim ティック（〜15:00Z, 日中）**: DB叩く再resolveはしない。BQのみの柱1 crawl / 柱2 harvest / 状況確認に充てる。名前先レバーの実測は off-peak で。
