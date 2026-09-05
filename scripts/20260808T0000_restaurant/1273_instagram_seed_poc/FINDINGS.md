# #1273 重大発見 — 「投稿URLさえ発見できれば、dish_media 完成まで無料」

最終更新: 2026-08-28 / 作業ブランチ: `claude/instagram-seed-data-poc-te51my`

## 1. 結論（この 1 行が今回の核）

**Instagram 投稿 URL を 1 本手に入れさえすれば、そこから「料理カテゴリ + 店舗」を
確定して `dish_media` を作るところまで、追加費用ゼロ・API 審査ゼロで完結する。**

したがって残る問題は **ただ 1 つ**——「飲食の投稿 URL をどうやって発見するか」だけである。

## 2. なぜそう言えるか（実測の裏付け）

パイプラインは 3 段。**下 2 段は既に無料で解けている。**

```
[飲食の投稿URLを発見]      ← 未解決。ここだけが有料/無料の分かれ目（本ドキュメントの探索対象）
        │
        ▼  resolve（= instagram.com/p/{code}/embed/captioned/ の SSR HTML）
[キャプション全文を取得]    ← 無料・トークン不要・審査不要。500 連射で 500/500 = HTTP 200、約6,870/時、ブロック0
        │
        ▼  matchDishCategories(辞書) + matchRestaurantNames(近傍店舗)
[料理カテゴリ + 店舗を確定]  ← 無料。アプリに実装済み（api/src/v1/dish-media-imports/）
        │
        ▼  POST /v1/dish-media/imports
[dish_media 完成]
```

| 段 | 手段 | 実測 | 費用 |
| --- | --- | --- | ---: |
| エンリッチ | `embed/captioned` SSR | WATの裸URL 60本を 100% 取得。500連射 500/200・6,870/時・ブロック0 | 無料 |
| 分類・店舗づけ | `resolve`（dish-media-imports.service.ts） | 実装済み。キャプション→辞書→近傍店舗 | 無料 |
| 取り込み | `POST /v1/dish-media/imports` | url/restaurantId/dishCategoryId を受けて DB へ | 無料 |

`business_discovery`（App Review 無しで第三者店に通る・75%解決・中央値276投稿/店・200コール/時）も
エンリッチ経路として併用可能。

## 3. 発見経路は 2 本

```
① 店舗一覧 → 店の Instagram アカウント → そのアカウントの投稿URL
② 料理カテゴリ → その料理の投稿URL（誰の投稿でもよい）→ 逆に店舗を当てる
```

- **① は照合が自明**（アカウント＝店）。open data + Common Crawl で無料で約 8〜17万店の
  アカウントに到達でき、business_discovery/embed で投稿に変換できる。品質は最高
- **② は量が出る**が店舗照合が要る。無料の発見手段（WAT/データセット）は飲食率が低いか
  日本を含まず、飲食に絞った発見は現状は検索（有料 $317〜）が最効率

**この 2 経路の «発見» を無料または最安にすることが、残された唯一の課題。**
盲点の洗い出しは `REPORT.md` と `out/measurements.json` に追記していく。

---

## 4. 追記（2026-08-28 夜）— 無料の «第2の柱»: グルメインフルエンサー経路

route① は «店自身の IG» なので、公式サイトも IG も持たない地方・小規模店に届かない。
そこを埋めるのが **グルメインフルエンサー経路**（経路②の実装形）。

- **handle は無料で発見できる**（実測）: 公開リスト記事 6 本から **263 の異なり handle**、
  うち **146（55%）が地方特化**（`akita_select` `aomori.rinko` `allniigata` `ehime_select` …）。
  同種記事は多数あり、30〜50 本で 500〜2000 handle 見込み（`out/influencer_handles.json`）
- **1 アカウントが 300〜600 店をカバー**（推定・訪問ペース 1000〜1200 店/年、ほぼ 1 投稿 = 1 店）
- 各 handle → `business_discovery`（無料・200/時）で投稿一覧 → キャプションに店名 → resolve で店舗づけ
- **検索からの増幅は効かない**（検索結果は 0.90 アカウント/投稿と多様）。リストから直接 seed するのが正
- まとめメディアを無料クロールして投稿URLを抜く道（route④）は WAF・自社写真で全滅。
  メディアは «handle 発見源» としてのみ使う

**決定的な未測定点**（トークンがあれば 1〜2 時間）: 263 handle を business_discovery で叩き、
実投稿数・異なり店名・重複率・飲食率を測る。ここで «無料で追加何店» が確定する。

---

## 5. 追記（2026-08-30）— 柱1 最適化: 抽出 recall は天井、伸び代は precision と到達性

`pillar1_site_extract.py` で «店公式サイト本文 → 店固有 IG» を作り直し、Overture の website 保有店から
決定的抽出した 322 店（`out/pillar1_sample_stores.json`）へ **live fetch（proxy 直・robots 尊重・IG 非取得）**
して同一 HTML で before→after を測った（`out/pillar1_measure.json`）。

### 同一 HTML の A/B — parsing 改善は recall を上げない
- before（既存 byte-regex `instagram.com/handle`）: union **31.68%**
- after（`<a>`/`<link>`/`<meta>`/JSON-LD `sameAs`/フッター/`@handle` テキストの多経路）: union **31.68%**（変化なし）
- 異なり handle 99 → 99。**純新規は `@handle` テキストのみで 322 店中 1 店（+0.31pt）**。
- **真因**: 店の公式サイトでは IG リンクは href/meta/JSON-LD/フッターの**どこに出ても生 HTML に
  `instagram.com/<handle>` の literal を必ず含む**ため、素の byte-regex で既に回収済み。
  「取りこぼしている別経路」は実在せず、**抽出 recall は既に天井**だった。

### 伸び代 1 — precision（店固有への絞り込み）
既存 `cc_store_sites.py` は店固有フィルタを持たず union をそのまま出す（チェーン公式・集約メディアの
一般アカウントが混入）。改善版は **platform blocklist + コーパス内チェーン重複除去 + 集約メディア上は
店名裏取り必須** で union → 店固有へ絞る。
- union 102 店 → **店固有 77 店（緩い）/ 37 店（厳格＝domain・店名裏取り必須）**。
- 除外 25 店 = チェーン共通 12（`hitosara_official` `sukiya_jp` `31icecream_japan` `starbucks_j` …）＋ 集約メディア裏取り無し 14。
- 自前ドメイン店では union 85 → 店固有 76（**89%**）と綺麗。集約メディア店は union 17 → 店固有 1（generic ばかり）。
- ⚠️ 標本 322 では «標本内に 1 回だけ出るブランドチェーン»（`capricciosa_official` `tullyscoffeejapan` `jollypasta_jp` 等）を
  店固有に誤カウントする。本番規模では **handle → 複数 google_place_id のグローバル重複除去**で除かれ、
  真の独立店率は #1345 手動 **5.06%** 側へ寄る。

### 伸び代 2 — 到達性（parsing では取れない）
322 店中 **到達 252 / 未到達 70（21.74%）**（fetch_failed 61＝死にドメイン・403、robots_blocked 9）。
website 保有店の 27.6%（89/322）は «website» 自体が集約メディア（tabelog/gnavi/hotpepper/ameblo/…）で
店の自前サイトではない。**Common Crawl のキャッシュ HTML（`cc_store_sites.py` の本来の用途）は
死にドメイン・ブロック済みの一部を live fetch の代替で拾える** → live と union すれば到達性が上がる。

### 全国見込みの更新（× website 保有 545,560 店）
| 率 | 定義 | 全国見込み |
| --- | --- | ---: |
| union 31.68% | サイトから IG が 1 本でも取れる | 172,833 |
| store_specific 23.91%（緩い） | 上限。ブランドチェーン誤カウント込み | 130,443 |
| **store_specific 11.49%（厳格）** | domain/店名裏取り必須。**推奨の上限側** | **62,685** |
| 参考 5.06%（#1345 手動） | チェーン厳格除外の手動基準 | 27,605 |

**計画は 2.8万〜6.3万店の帯で持つ**のが妥当。本番のグローバルチェーン除去が自動率を下側へ引くため、
«柱1 で無料到達できる店固有 IG» は下限 2.8万に近い側で見積もるのが安全。柱2/3 の重要性は下がらない。

### 本番接続の設計（`4_1_discover_sns_accounts.py` が食える形）
既存 `--source open_data_socials` は `restaurant_catalog.social_urls` の `instagram.com/` を
`sns_source_account`（`account_type=store_branch`, `discovery_seed_place_id=google_place_id`）へ入れる。
柱1 の crawl 結果はこれに **新 source `official_site_crawl` として同スキーマで合流**させる。

- **入力**: `restaurant_catalog` の website 非集約・IG 未保有の行（google_place_id, website）。
- **crawl→抽出**: `pillar1_site_extract.extract_new()` で handle を取り、下の分類を通す。
- **グローバルチェーン除去（本番の肝）**: handle→distinct google_place_id 数を全件集計し、
  **≥2 place_id に付く handle は `account_type=brand` として除外**（store_branch にしない）。
  標本内では検出できないブランドチェーンをここで確実に落とす。
- **出力行（`sns_source_account` と同じ JSON）**:
  ```json
  {"account_id":"<handle>","provider":"instagram","handle":"<handle>",
   "account_type":"store_branch","discovery_method":"official_site_crawl",
   "discovery_seed_place_id":"<google_place_id>","followers":null,"media_count":null,
   "discovered_at":"<utc>","run_id":"<run_id>"}
  ```
- **流し方**: `4_1_discover_sns_accounts.py` に `--source official_site_crawl`（crawl 出力テーブル/JSONL を読む）を
  1 本足し、`_rows_from_open_data` と同型で yield。以降は既存どおり 4_2 収集 → resolve で店舗づけ。
  IG は叩かず handle 発見までが柱1、投稿収集は既存経路に委ねる。

### 実装済み（本番投入できる形）
上の設計は実装済み。エビデンスは `test_pillar1_official_site_crawl.py`（fetch 済み 322 店標本での純関数検証）。

- **`4_4_crawl_official_site_igs.py`**: restaurant_catalog(website 保有店) を crawl → 店固有フィルタ →
  中間テーブル `sns_store_site_ig` へロード。到達不能/robots/handle 無しも handle=NULL 行で残す。
  `--limit`/`--offset` でバッチ分割（google_place_id 昇順で互いに素）・そのバッチの place_id だけ
  DELETE して冪等。`--dry-run` は書き込まず summary のみ。抽出/robots/fetch は
  `pillar1_site_extract.py` の純関数をそのまま呼ぶ（写経しない）。
- **`4_1 --source official_site_crawl`**: `sns_store_site_ig` を全件読み、handle→distinct place_id を数えて
  **≥2 店に付く handle（チェーン）を除外**し、1 店固有 handle を `account_type=store_branch` /
  `discovery_method='official_site_crawl'` / `discovery_seed_place_id=google_place_id` で
  `sns_source_account` へ合流。グローバルチェーン除去は全件が見えるここでのみ行う（4_4 はバッチ分割で全件を見られない）。
- **中間テーブル**は migration `20260830T0000_create_sns_seed_tables.sql` に `sns_store_site_ig` として追加（4_0 で作成）。
- **標本 322 での実測**（ユニット）: 店固有 handle を持つ 86 店・異なり handle 84・裏取りあり 46。
  89 の (place_id, handle) → チェーン 9 handle を除外 → **store_branch 80 行**が 4_1 に載る。到達性: fetch_failed 61・robots 9・no_handle 166。

---

## 2026-09-03 — resolve 律速の除去（caption 持ち回り）と柱4 CC の却下確定

### 勝ち筋: resolve の律速だった «投稿ごとの IG 取得» を caption 同梱で消した
- resolve のレート制限の真因は、投稿ごとに `instagram.com/p/{code}/embed/captioned/`（公開SSR・
  トークン無し・IP 単位で制限）を取りに行くこと。並列 IG 取得で実測 73% 失敗、単発でも数時間で劣化。
- **収集時に得たテキストを caption として持ち回り、resolve へ渡すと IG を取りに行かず純テキスト処理**に
  なる。→ 好きなだけ並列できる。実測: concurrency 40 で **meta_fail=0**（search 経路 360件・柱1 2,038件とも）。
- 実装: dev API 側 PR #1805（`resolve` が `caption` を受けたら fetch を skip）。パイプライン側は
  `sns_post_raw.caption`（4_0b で列追加）＋ 5_1 `--concurrency`（ThreadPoolExecutor）。

### 柱1（店アカウント）も caption 付きで集め直せる — カテゴリ判定 43%→67%
- `4_2_collect_account_posts.py` の business_discovery フィールドに `caption` を追加（`id,permalink` と
  同じ 1 コールで返る＝**API コスト増ゼロ**、レート制限も増えない）。収集で 99.4% が実 caption（平均230字）。
- これを並列 resolve → **カテゴリ判定率 42.9%→66.7%・meta_fail=0**。旧 43% は IG 取得失敗が主因だった。
- 柱1 は «店＝discovery_seed_place_id で確定・resolve はカテゴリ専用»（seed-trust, 7_1）。よって
  «収集した店アカウント × caption でカテゴリ» が取れれば seed-trust セルが増える。distinct-store エンジン。

### 柱4（Common Crawl WAT）は却下確定 — 蒸し返さない
- CC WAT の投稿URL 22,575 件を resolve して **matched 0 件（0.0%）**。option C（元ページ Title を caption に
  載せる）も実装・実測したが、Title は «IG 埋め込みを載せた無関係ページ» のもの（企業サイト・海外ブログ等）で
  日本の飲食店シグナルを持たない。jp-source は 3% でそれも飲食ではない。**CC は日本の飲食シードには使えない。**

### 現在地（全 run union・seed-trust・市区町村×dish_category・異なり店）
- ≥5 店セル = **35**、≥3 = 158、≥1 = 4,916。breadth はあるが depth が無い（≒1 店/セル）。
- 律速は «セルあたりの異なり店数»。柱1（店アカウント収集）を caption 付きで回して distinct 店を増やすのが主レバー。
  business_discovery スループット（単トークン ~130 アカウント/h 実測）が収集の壁。

---

## 2026-09-03 — 打開策（20 本並列検討）の結論と P0 の実測

### 前提の是正
- **KPI の分母**: 1,577 QID 全体ではなく **132/134 アプリカテゴリ限定**（`dish_category_catalog.label_ja` で 140 QID。`kpi_dish_categories.json`）。
- **集計バグ**: 7_1 の市区町村抽出が「都道府県で始まる住所」しか読めず、catalog 住所の 39% が対象外＝usable 店の 43% がセルに数えられていなかった。lat/lng 最近傍（1.5km・検証 99.3% 一致）で補完。

### P0 の実測（sns_coverage run `sns-2026-09-03-cov`、収集 8 run union）
| 対象 | ≥1店 | ≥3店 | ≥5店 |
|---|---|---|---|
| 134 限定（KPI） | 2,853 → 4,734 | 152 → 459 | **32 → 132** |
| 全 QID | 7,343 → 13,375 | 269 → 847 | 58 → 251 |

### 真因（なぜ business_discovery に 20h 詰まっていたか）
検索インデックスに `"@handle" site:instagram.com` を投げれば IG API なしで店の投稿が caption 付きで取れる（16 handle 中 14 ヒット・13.6 投稿/handle）。店は place_id で seed-trust 確定。さらに 4_7 は 429 で全体中断・10 件/クエリのままで、20 件＋リトライで収率 9 倍（1.3→11.9 投稿/q）。

### 却下確定（蒸し返さない）
CC WAT 飲食メディア限定（tabelog/retty は CC 上に IG リンク 0/300）／Wayback／店公式サイト埋め込み（3/98）／oEmbed（caption 返らず）／IG location ページ／店単位カテゴリ伝播（ペア増 0）／一覧外検索（CSE 新規停止・Bing 廃止・各 HTML は bot 壁）。

### 次（キー待ち）
P1: 未収集 17,456 店アカ handle を検索で投稿化（You.com 20k/Tavily 1k/Yep 1k/Linkup 4k ≈ 26k クエリ・規約 OK）。P2: 3-4 店セル（331）を店起点で狙い撃ち。P3: 料理×市区町村で depth。

### 2026-09-03 15:30Z — 事故: 辞書追加の dev デプロイで caption 持ち回り（#1805）が消えた

- 症状: storecap の辞書再 resolve（version `dev-2026-09-03-dict`）で 21,400 件中 9,597 件（45%）が
  `metadata_fetch_failed`。raw 側は 98.6% が caption 付きなのに、resolve が IG を取りに行っていた。
- 真因: 作業ブランチ `claude/instagram-seed-data-poc-te51my` は main から 459 コミット遅れており、
  PR #1805（caption を渡せば IG 取得をスキップ）を含んでいなかった。このブランチから api-deploy
  （development）を流した時点で dev API から持ち回りが消え、concurrency 40 で IG を叩く状態になった。
- 対処: 走っていた再 resolve を中断 → origin/main をマージ（辞書は本ブランチの上位集合を採用、
  spec 74/74 pass・tsc OK）→ dev 再デプロイ → storecap/fire/search を新 version で再 resolve。
- 教訓: **feature ブランチから api-deploy を流す前に `git merge-base --is-ancestor origin/main HEAD`
  を確認する**。dev は «main ＋ このブランチの差分» でなければ、他 PR の修正を静かに巻き戻す。

---

## 2026-09-05 — 発見経路の棚卸し: 律速は «経路の数» ではなく «1 コールの配り先»

新しい発見経路を 12 本洗い出して評価した結果、**新経路を足すより «既にあるハンドルを
どの順で収集するか» を変える方が 6 倍効く**と分かった。以下は全部 BigQuery の実測。

### 1. 経路ごとの取れ高（全 run union・投稿 953,731 / matched 店 16,305）

| 経路 | 投稿 | 未 resolve | 未 resolve 率 | matched 投稿 | 異なり店 | 店/1,000 投稿 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| store_account | 179,793 | 21,717 | 12.1% | 14,188 | 1,072 | 6.0 |
| cc_wat | 169,307 | 42,344 | 31.4% | 742 | 422 | 2.5 |
| influencer | 147,842 | 9,467 | 6.4% | 23,539 | 10,837 | **73.3** |
| gourmet_media | 140,679 | 23,711 | 17.2% | 4,035 | 2,234 | 15.9 |
| search_api | 31,981 | 3 | 0.0% | 3,227 | 2,591 | **81.0** |
| cc_index | 22,575 | 65 | 97.0% | 120 | 92 | 4.1 |
| store_site_embed | 18,679 | 0 | 0.0% | 551 | 128 | 6.9 |

未 resolve は全経路合わせて 97,307 投稿（全体の 10.2%）。各経路の «店/1,000 投稿» で
換算した取り切りの上積みは **約 1,300 店**（matched 16,305 の +8%）。
**«流し切っていない» ことは律速ではない。**

### 2. 本当の律速は 2 つ。どちらも発見ではない

- **resolve が seed を捨てている**: `discovery_seed_place_id` を持つ投稿 179,752 件のうち
  **85,718 件（48%）が `skipped_no_store`**。店は収集時点で確定しているのに捨てている。
  seed を prefill するだけで **3,842 店**（今どの投稿でも matched になっていない店）が立つ。
- **IG Graph API の枠**: business_discovery ~200 コール/時。1 ハンドル ≒ 1 コール。
  未収集ハンドルは 119,646 件あり、全部回すと 25 日かかる。**順番が成果そのもの。**

### 3. 検討した新経路 12 本の判定

| # | 経路 | 店が特定できるか | 無料か | 規約 | 判定（根拠） |
| --- | --- | --- | --- | --- | --- |
| 1 | ハンドルを取れ高順に並べ替える | ○ seed か caption | ○ | ○ BQ のみ | **採用**。同じ枠で 6 倍（→ 4_19、§4） |
| 2 | キャプションの `@`/素トークン言及 | △ | ○ | ○ | 4_17 が実施済み。`@` 付きで未収集かつ言及者 2 人以上は **76 件**しか残っていない＝枯れている |
| 3 | 店公式サイト crawl の残り | ○ place_id | ○ | ○ | 未 crawl 74,572 店 × ok 率 25.8% ≒ 19,000 handle。ただし D 段（0.216 店/コール）なので順番は最後 |
| 4 | Overture/OSM の `social_urls` | ○ place_id | ○ | ○ | 実施済み。IG リンクは 19,203 件で使い切り |
| 5 | IG 場所ページ (`/explore/locations/`) | ○ 会場＝店 | ○ | **×** | 却下。`robots.txt` の `User-agent: * → Disallow: /`。2026-09-03 にも別根拠で却下済み |
| 6 | IG プロフィール/ハッシュタグ HTML | △ | ○ | **×** | 同上（同じ `Disallow: /`）。ハッシュタグは Graph API の `ig_hashtag_search` なら可だが 30 タグ/7 日 |
| 7 | Wayback / Common Crawl の拡張 | × | ○ | ○ | 却下確定（2026-09-03）。CC WAT 22,575 投稿で **matched 0 件** |
| 8 | グルメ媒体の店舗ページ埋め込み | △ | ○ | △ | 実施済み（gourmet_media）。34,737 アカウントで 1.7 投稿・0.03 店/アカウント。**薄い** |
| 9 | 自治体・観光協会・タウン誌 | △ | ○ | ○ | 8 と同じ形（第三者ページの埋め込み）。8 の実測が薄いので優先しない |
| 10 | Linktree 等のリンク集 | △ | ○ | △ | 3 の下位互換（店サイト crawl で既に拾う host） |
| 11 | 既存店アカウントの深掘り | ○ | ○ | ○ | 却下済み（1 セル ~360 投稿 対 新規店 ~1.4 投稿） |
| 12 | 空セル（n=0〜4）名指し | ○ | ○ | ○ | 4_16 が実施中。**1 と併用する**（A/C 段を地域語で空セルの県へ絞る） |

### 4. 採用した 1 本 — `4_19_rank_account_candidates.py`（実測）

未収集ハンドルを «1 コールあたりの期待異なり店数» で並べ替えるだけ。外部 API を 1 回も使わない。
段は **ハンドル文字列**（料理語・地域語）と `discovery_seed_place_id` の有無だけで決まる。

| 段 | ハンドル | 収集済 | 未収集 | 異なり店/コール | 未収集を全部回した期待店数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| A 料理語 × 地域語 | 274 | 120 | 154 | **18.625** | 2,868 |
| B 料理語のみ | 1,827 | 582 | 1,245 | 1.723 | 2,146 |
| C 地域語のみ | 19,254 | 4,849 | 14,405 | 1.090 | 15,694 |
| D 店アカウント | 34,743 | 5,316 | 29,427 | 0.216 | 6,344 |
| E その他 | 107,117 | 32,702 | 74,415 | 0.154 | 11,453 |

- **同じ 15,804 コールを A→B→C に配ると期待 20,708 店。D（今の P1 の並び）に配ると 3,414 店。約 6 倍。**
- 選択バイアス除去: 誰も選んでいない `cc_wat_profile`/`embedded_authors` だけで数え直しても
  **4.698 対 0.067（70 倍）**。効果は curation 由来ではない。
- 見積もりの水増しも実測: 段内の «同じ店を複数アカウントが出す» 率は A 1.02 / B 1.02 /
  C 1.08 / DE 1.12 倍。ご当地アカウントは担当地域が違うので**ほぼ重ならない**。
- 参考: A+B+C の収集済み 500 アカウント（全収集アカウントの 1.1%）が、matched 店 16,305 のうち
  **7,751 店（47.5%。段をまたぐ重複を除いた union）**を出している。

**限界（正直に）**: A 段の未収集は 154 件しかない。伸びの本体は C 段（14,405 件・1.09 店/コール）で、
これは «2 週間ぶんの IG 枠» に相当する。A 段を増やすには «ご当地グルメアカウントを新しく見つける»
必要があり、そこは本 script の範囲外（検索 API 枠 ~26k/月 を 47 都道府県ぶん使うのが次の候補）。

---

## 2026-09-05 — 却下確定: ハンドルの **綴り** では取れ高を予測できない（蒸し返さない）

再実行用の script: [`handle_spelling_yield.py`](handle_spelling_yield.py)（BQ 読み取りのみ・IG コール 0）。

### 何を試そうとしたか

直前の節（`4_19_rank_account_candidates.py`）の較正表で «A 段 = 料理語×地域語 が 18.625 店/コール、
D 段 = 店アカウント の 86 倍» と出たので、**`sapporo_gourmet` 型のハンドルを地域語×料理語×区切り文字で
機械的に組み立て、実在するものだけ残せば A 段を量産できる**、という案が立った。

### 結論 — 成立しない。**IG のコールを 1 回も使わずに否定できた**

較正表は成果を `sns_post_resolved` の matched で数えていた。成果を
**«配信カタログ `sns_dish_media_catalog` に載った異なり店»** に替え、さらに
**«人が選んだ一覧（`discovery_method='influencer_list'`）に載っているか»** で層別すると、
効いていたのは綴りではなく curation だった。

| 段（ハンドルの綴り） | curated あり | **curated なし** | 収集済アカウント（curated あり / なし） |
| --- | ---: | ---: | --- |
| A 料理語 × 地域語 | 49.911 | **0.061** | 45 / 212 |
| B 料理語のみ | 38.960 | **0.121** | 25 / 704 |
| C 地域語のみ | 38.280 | **0.134** | 132 / 5,820 |
| D 店アカウント | — | **0.592** | 0 / 5,364 |
| E 語なし | 21.377 | **0.051** | 175 / 42,110 |

（分母＝収集済アカウント数＝business_discovery のコール数、分子＝そのアカウント由来で
配信カタログに載った異なり `google_place_id` の合計）

- 未収集プールはほぼ全部 curated ではない。**組み立てたハンドルの期待値は 0.05〜0.13 店/コール**で、
  店アカウント（**0.592**）より **1 桁悪い**。
- 非 curated の中では **A 段が最下位**。綴りの «効果» は大きさどころか**符号が逆**である。
- 直前の節にある «選択バイアス除去（cc_wat_profile / embedded_authors だけで 4.698 対 0.067）» は
  **確認になっていなかった**。成果を matched で数えていたうえ、`influencer_list` に載っている
  ハンドルが他の discovery_method からも入るため、経路で切っても curation は抜けない。
  **バイアスの確認は、指標を確定させてからでないと確認にならない。**

### なぜ綴りが効いて見えたか（2 つ）

1. **選択バイアス**: A 段の収集済み 257 件のうち 45 件（17.5%）が `influencer_list`。
   この 45 件が段の合計（2,259 店）のうち 2,246 店、**99.4%** を作っていた。
2. **部分文字列の誤爆**: `FOOD_TOKENS` の `eat` が theatre / create / meat / great / breath /
   retreat / sweat に、`umai` が sumai（住まい）に、`oishi` が koishikawa に当たる。
   A 段 273 件のうち **71 件（26%）は料理語が部分文字列でしか当たっていない**
   （`nationaltheatre_tokyo` `sumai_yokohama` `mariakoishikawa` `aichi_creative`
   `kodamaya_retreat_matsumoto` …）。`4_19` の段は**この誤爆を含んだまま**である。

### 綴りの «型» 自体は実在する（が、取れ高を予測しない）

A 段の実在ハンドルのうち誤爆でない 74 件を数えた分布（`shapes()`）。組み立て案はここから型を取っていた。

| 並び × 区切り | 件数 | 例 |
| --- | ---: | --- |
| 地域語 `_` 料理語 | 21 | `okayama_gourmet` `kagawa_lunch` `gifu_gourmet` |
| 地域語 + 語 + 料理語 | 12 | `kagoshima_no1_foods` `tokyo_highcosper_gourmet` |
| 地域語 直結 料理語 | 12 | `okayamagurume` `yamaguchigurume` `fukuieat` |
| 料理語 + 語 + 地域語 | 12 | `gourmetdemiyazaki` `tabimeshi_fukushima` |
| 地域語 `.` 料理語 | 8 | `toyama.gourmet` `shiga.meshi` `tokushima.food` |
| 料理語 `_` 地域語 | 6 | `gourmet_wakayama` `gurume_fukushima` |
| 地域語 `__` 料理語 | 3 | `aichi__gourmet` `tochigi__gurume` `oita__gohan` |

接尾辞は 74 件中 47 件が無し、7 件が数字（`osaka_gourmet1` `tokyogourmet3` `chiba.gourmet2021`）、
3 件が `_`（`osaka_gourmet_` `hiroshimagurume_`）。**型は確かに予測可能**で、
数字・`_` 付きが存在することは «素の形は既に誰かが取っている» ことまで示唆する。
**それでも組み立てが効かない**のは、当たり外れを決めているのが綴りではなく
«そのアカウントが多店舗を回るキュレーターかどうか» だからである。

### 蒸し返さないために

- **綴り（地域語・料理語・区切り）から «1 コールあたり異なり店» を予測しようとしない。**
  やるなら `handle_spelling_yield.py` を 1 回回す。答えは上の表に出る。
- 段別の取れ高を語るときは、**成果を配信カタログの異なり店で数え、curation で層別してから**にする。
  matched で数えた段の差は curation の写し絵である。
- `4_19` の段は `eat` 系の部分文字列誤爆を 26% 含む。段を使い続けるなら、まずそこを直す。

---

## 2026-09-05 — influencer が唯一の高単価の蛇口。その «見つけ方» を測る

### 1. `account_type='influencer'` はどこから来ているか（コードを辿った）

`4_1_discover_sns_accounts.py` の 3 経路。**2 つは既に自動規則である。**

| 出所 | 規則 | 件数 |
| --- | --- | ---: |
| `influencer_list` | **人が手で作った seed ファイル** `sns_influencer_seed_handles.txt`（741 行） | 413 |
| `embedded_authors` | «2 つ以上のホストに埋め込まれた» → influencer | 183 |
| `caption_mentions` | «2 人以上の投稿者から言及された» → influencer | 4 |

### 2. 既存の自動規則は効いていない（＝ 新しい蛇口が要る根拠）

成果 = 配信カタログ（`sns_dish_media_catalog` 最新 run）の異なり店。

| 群 | アカウント | 配信店/アカウント | 投稿/アカウント | 配信店/投稿 |
| --- | ---: | ---: | ---: | ---: |
| `influencer_list`（人が選んだ） | 313 | **33.645** | 193.7 | **0.1737** |
| `embedded_authors`（自動判定） | 183 | 0.475 | 12.7 | 0.0374 |
| 店アカウント | 6,396 | 0.555 | 31.0 | 0.0179 |
| unknown | 36,858 | 0.091 | 4.4 | 0.0208 |

- **«2 ホスト以上に埋め込まれた» は influencer らしさを表していない**（0.475 ≒ 店アカウント 0.555）。
- 手作り一覧だけが桁違いで、しかも **投稿数（9.7 倍）と投稿あたりの店（9.7 倍）の両方**で勝つ。
  つまり «深く掘っただけの見かけ» ではなく、アカウントの質そのものが違う。

### 3. 判定器 — «25 投稿の probe で異なり店 4 以上»

収集済み 5,025 アカウント（25 投稿以上）で、ランダム 25 投稿を probe と見なして実測。

| probe の異なり店 | アカウント | 総配信店の平均 | 総配信店 10 以上 |
| --- | ---: | ---: | ---: |
| 0 | 2,003 | 0.12 | 2 |
| 1 | 2,663 | 1.09 | 7 |
| 2-3 | 136 | 8.19 | 35 |
| **4-6** | 75 | **34.79** | 66 |
| **7+** | 148 | **58.05** | 146 |

«4 以上» は総配信店 10 以上を **precision 95.1% / recall 82.8%** で当てる。
probe は business_discovery **1 コール**（25 投稿 = 1 ページ）で済む。

### 4. 損得の分岐点 — p > 4.07%

母集団の influencer 級の割合を p、通過分の総配信店を Y、深掘りの追加コールを 7 とすると
**stores/call = p·Y/(1+7p)**。非 curated の実測 Y=17.1 で店アカウント 0.542 を超える条件は

    p · 17.1 / (1 + 7p) > 0.542  →  **p > 4.07%**

実測の p:

| 母集団 | 25 投稿以上のアカウント | 通過 | **p** | 通過分の総配信店 |
| --- | ---: | ---: | ---: | ---: |
| 人が選んだ一覧 | 371 | 203 | **54.72%** | 53.5 |
| 既存の自動発見プール（非 curated） | 4,654 | 20 | **0.43%** | 17.1 |

**既存プールを probe しても割に合わない（0.43% ≪ 4.07%）。**
検索経路の成否は «既存プールの 10 倍濃い候補を出せるか» に尽きる。

### 5. `4_20_search_influencer_accounts.py`

47 都道府県 × 4 型 = 188 クエリ。狙いは投稿ではなく **プロフィール**
（`instagram.com/<handle>/` の link と、まとめ記事本文の `@handle`）。

**IG のコールを 1 回も使わずに p を推定する**: 検索で出た handle のうち
**既に収集済みのもの**へ §3 の判定器を当てる。柱1 とクォータを奪い合わずに
«この経路をやる価値があるか» が先に分かる。

### 6. あわせて直した — 段判定の部分一致（`4_19`）

`eat` が `theatre`/`create`/`beats` に、`umai` が `sumai`（住まい）に、`oishi` が
`koishikawa` に当たっていた。左右に «英字でないもの» か端を要求する規則へ変更
（`\b` はハンドルが `[a-z0-9._]` なので使えない）。
実測: 料理語に当たる handle は **2,101 → 437 件（-79.2%）**、増えたものは 0 件。
⚠️ `ouchigohan` `anagomeshi_ueno` のような **区切り無しの連結も落ちる**。それでも
この規則を採るのは、段が取れ高を予測しないと実証済み（C 0.057 / D 0.056 / E 0.055）で、
段は `--candidate-tiers` のラベルにしか使わないため。
