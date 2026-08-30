# Domain — このプロダクトでそのエラーが何を意味するか

ログとコードだけでは読めない前提を置く場所。**毎回オーナーに聞き直さないため**にある。

書いてよいのは「実データで確かめた」か「オーナーが確認した」ことだけ。推測を書くと次回以降の判断を汚す。
BigQuery の掘り方（手順・落とし穴）は FORENSICS.md、束ね方は CLUSTERING.md。ここには**意味**だけを書く。

---

## 1. Claude fallback は、日本の住所では本来通らない経路

`api/src/v1/dish-categories/dish-categories.service.ts` の `getRecommendations` は、SQL 候補が
0 件のとき `fallbackToClaude` へ落ちる（目印は `// #533 【フォールバック】候補0件の場合はClaude経路へ` と
`logger.log('FallbackToClaude', …, { reason: 'no_candidates' })`。同じ関数のスレート構成後と
catch 節にも `fallbackToClaude` 呼び出しがある）。

候補が消える場所は gate whitelist。`dish-categories.repository.ts` の
`findCategoryCandidatesWithScores` 内、`region_ok_categories` CTE:

```sql
WHERE dcf.feature_type = 'gate'
  AND (dcf.feature_key = ANY(p.region_tokens) OR dcf.feature_key = 'region:scope:global')
  AND dcf.score > 0
```

`region_tokens` は `normalizeInput` が `address` をカンマ分割して `region:` を前置したもの
（`region:country:JP` など）。そして **whitelist へ実際に投入されているのは `region:country:JP` と
`region:scope:global` だけ**（`scripts/20251213T0000_wikidata_food_graph/557_region_gate/README.md`、
`572_market_salience/config.yml` の `market_key`、`581_relevance_scoring/sql/` の publish 系 SQL）。

一方、address は `api/src/v1/locations/locations.service.ts` の `buildAddressFromComponents` が組み立て、
`primaryTypes` の順（country → administrative_area_level_1 → level_2 → locality）で出力する。
つまり **country が取れている住所は必ず `country:JP, …` の形で始まる**。

したがって:

- **日本の住所なのに Claude 経路へ行っていたら、それ自体がバグ。** Claude API の 400 や
  credit exhausted は症状であって原因ではない。
- Claude fallback は**真の海外ユーザーの唯一の経路なので消してはいけない**。直すのは
  「日本の住所が候補 0 件になる」側（address の欠損、gate データの欠落、正規化の崩れ）。
- トリアージ時の問い: **「Claude へ行ったリクエストの `address` は `country:` で始まっていたか？」**
  始まっていなければバグ。始まっていて `country:JP` 以外なら想定内。

> **原因と影響範囲を混同しない。** 初回トリアージで上位 Claude は「地理は無関係、真因は課金枯渇」と
> 結論した。課金枯渇は原因としては正しいが、オーナーが見ていたのは**誰が影響を受けるか**だった。
> 日本のユーザーがこの経路へ到達している時点で、課金を戻しても問題は残る。
> （TRIAGE.md「反証された仮説の例」に訂正を残してある）

**直すのはクライアント側。この API はバグっていない。**

> 「API はなにもバグってない綺麗な設計ができてる。フロントエンドのバグなのでフロントエンドで、直すように。」

`normalizeInput` は受け取った `address` をカンマ分割して `region:` を前置するだけで、仕様どおりに動く。
壊れた値を送っているのはクライアント（#1196 の実例では `useLocationSearch.ts` の現在地フォールバックが
expo の `city` をそのまま入れていた）。**サーバ側に形式検証を足したくなるが、やらない**:

- サーバでは値を復元できない（"大阪市" から国は推測できない）ので、検知しても直せない
- 送る側が直れば検知対象も消える。バグっていないコードに責務だけが残る
- ゲート照合は Postgres の `=` で**大小文字区別あり**なので `country:jp` も同じ結末になるが、
  これも大文字化はクライアントの責務（`app-expo/lib/addressFormat.ts`）

一度サーバ側に検証モジュール（`api/src/core/utils/address-format.ts`）を新設して差し戻された。

### 検証結果（2026-08-15、BigQuery 実測）

`app-expo/lib/addressFormat.ts` の修正が効いているかを、`address` の形と `created_commit_id` の
両方から確認した。**修正は 100% 効いており、残っているのは旧ビルドの残存だけ**だった。

| 送られた address | Claude フォールバック |
|---|---|
| `country:JP` で始まる（正規形式） | **0 件** / 613 リクエスト・275 ユーザー |
| 壊れた形式（`大阪市` など） | **673 件 / 673 件（全件）** / 123 ユーザー |
| `country:XX`（海外） | 4 件 / 2 ユーザー（**仕様どおり**） |

`dish_category_recommendations_empty_retry` をビルド別に割ると、`addressFormat.ts` を**含む**ビルド
（`92f77562` / `19a4422d`、いずれも 08-13）は **0 件**、**含まない**ビルド（`c217a35e` 08-01 ほか）が
338 件すべてを出していた。含む/含まないは
`git ls-tree -r --name-only <sha> -- app-expo/lib/addressFormat.ts` で確定できる（→ FORENSICS.md §6）。

したがって Claude 系の Issue は **`err/skip`（旧ビルド残存）** で畳んでよい。
ただし**海外ユーザーの `country:XX` は最新ビルドでも必ず出る**ので、
「呼ぶ前にクライアントで止める」ガードを別途入れている（#1196 / `handleSearch` の 2 段ガード）。

## 2. エラーが出ている ≠ ユーザーが詰んでいる

Google Places Text Search の 429（日次クォータ枯渇）→ backend 500 → frontend `api_call_error`
という連鎖がある。ただしフロントには退避導線がある。

`app-expo/app/[locale]/(tabs)/search/result.tsx` の `#828 【設計】0件確定後の退避導線` の effect が、
`isLoading` 解除後に `ids.length === 0` なら `showGoogleMapsFallbackDialog` を出して `handleClose()` する。
実装は `app-expo/features/search/hooks/useGoogleMapsFallback.ts`（`dishCategoryGroupVotes` の
`useCandidateDishMediaCache.ts` も同じ hook を `source` 違いで使う）。ここが出すログ:

| event_name | error_level | 意味 |
|---|---|---|
| `google_maps_fallback_dialog_shown` | `warn` | 退避導線を提示した |
| `google_maps_fallback_opened` | `log` | ユーザーが実際に Google Maps を開いた |
| `google_maps_fallback_open_failed` | `error` | `Linking.openURL` が失敗した |

実データ: `api_call_error` 340件/125人 と `google_maps_fallback_dialog_shown` が**完全一致**し、
うち **115人（92%）が `google_maps_fallback_opened` まで到達**していた。

**severity を判断するときは、必ず「その後の UX ログ」まで見る。**
`api_call_error` が出ている＝ユーザーが詰んでいる、ではない。逆に、退避導線が出ていても
`opened` が伸びていなければ導線が機能していない。

> 初回トリアージで上位 Claude は `api_call_error` の存在だけを根拠に「フォールバックしていません」と
> 断定し、オーナーに訂正された。`api_call_error` は**入口の証拠にすぎない**。

### 2-1. 直さないと決めた失敗の畳み方（オーナー確定方針）

**ログレベルは「事実を記録する層」、`err/skip` は「方針を決める層」。役割を混ぜない。**
ログを warn に歪めて見えなくするのではなく、**事実は正直に error のまま残し、
「これは見なくてよい」だけをトリアージ側で宣言する。**

> 「API call が落ちてる箇所はエラーが妥当だと思うので、それは、skip のタグをトリアージに付けるのが良いと思ってます。」
> 「外部APIの失敗がエラーで出るのであれば、それに従って、エラートリアージでskipにすれば良い話。」

**実装は 0 行が既定。** `err/skip` ラベルを付けて、本文へ理由を書く。それで終わり。

実例（Google Places 日次クォータ枯渇 / 682件・125人/日、オーナー判断は **「解消不要」**）:

- 退避導線が成立している（`api_call_error` 340件/125人 と `google_maps_fallback_dialog_shown` が
  完全一致し、うち 115人＝92% が Maps を開いている）
- → `callPlaceSearchText` / `searchRestaurants` / `bulk-import` / frontend の各 Issue に **`err/skip`**
- → **コードは 1 行も触らない**

`err/skip` は fingerprint 単位で、fingerprint は `messagePattern` を含む。
**クォータ枯渇を skip しても、同じ関数の他の失敗は別 fingerprint なので起票され続ける**
（→ TRIAGE.md「`err/skip` は fingerprint 単位なので、思ったより狭く効く」）。

#### ⚠️ ここで実装に踏み込んで差し戻された（2026-08-10）

「自社 API は 5xx をやめて 4xx へ寄せれば除外ルールに自然に乗る」という**教科書的には正しい整理**を
実装に落とし、**22 ファイル / +1,785 行**を出して全面差し戻しになった。内訳は
共通の `ApiExceptionFilter` の書き換え、クォータ枯渇だけを型で切り出す新モジュール、
`TRANSIENT_STATUSES` の切り出し、各層のログレベル分岐。

**教科書的に正しいことと、この案件でやるべきことは別。** 「解消しない」と決まっている問題に
実装を足す時点で釣り合っていない。判断基準は TRIAGE.md「修正の大きさを、問題の大きさに合わせる」。

**HTTP ステータスの設計そのものを見直したくなったら、トリアージから切り離して
独立した設計課題としてオーナーへ出す。** トリアージの片手間でやらない。

## 3. transient / bug の境界はリポジトリ側で定義済み

`app-expo/lib/logQueue.ts` の `TRANSIENT_STATUSES` = `[401, 408, 425, 426, 429]` が唯一の正で、
`classifyFailure` が「5xx と TRANSIENT は transient / それ以外の 4xx は rejected（＝契約が壊れている＝バグ）」
と定義している。各値の理由はソースのコメントにある（401 はトークン失効レース、426 は強制アップデート等）。

トリアージ側の `scripts/error-triage/constants.js` はこれに 403 / 404 を足して
`EXCLUDED_HTTP_STATUSES` としている（脆弱性スキャナー対策）。**新しく「これは一過性では」と思ったら、
まず `TRANSIENT_STATUSES` に無いことを確認する。** 無ければバグとして扱うのがこのリポジトリの合意。

実測: 除外ルール適用前 526 グループ → 適用後 21 グループ。消えた 505 はほぼ全て脆弱性スキャナー。

## 4. bulk-import は「ID を先に返して、行は後で書く」

`POST /v1/dishes/bulk-import`（`dishes.service.ts` の `bulkImportFromGoogle`）は、
`dish_media.id` を `deterministic-id.ts` の `uuidV5`（`(placeId, categoryId)` 由来）で採番して
**レスポンスで即返す**。行を実際に INSERT するのは Cloud Tasks 経由の非同期ハンドラ
（`enqueueCreateDishMediaEntryJob` → `cloudTasksService.enqueueCreateDishMediaEntry` →
`api/src/internal/dishes/create-dish-media-entry.service.ts`）。

- 決定論 ID にした理由は `deterministic-id.ts` 冒頭の `#829 【設計】` に書いてある
  （レースした2本の bulk-import が別 UUID を採番して `dish_reviews` が二重登録された事故の修正）。
- `media_processing_status: 'processing'`（`dishes.service.ts` の `#511 【設計】` コメント）は
  **「行はあるがメディアは未完成」をスキーマが想定している証拠**。
- enqueue 自体が失敗すると「返した ID が永久に DB に存在しない」orphan になる。
  その場合 `AsyncJobEnqueueError`（`#1053`）が出る。

したがって **`dish_media_impressions` / `dish_media_views` の FK 違反（Prisma `P2003`）は、
まずこのタイミング障害を疑う。** クライアントは返された `dish_media.id` で計測を打てるが、
その時点で行が無ければ FK が落ちる。

FK の向き（`infra/supabase/migrations/20251025T020{2,3}_*.sql`）:

```
dish_media_impressions.dish_media_id → dish_media(id)              NOT NULL
dish_media_views.impression_id       → dish_media_impressions(id)  NULL 許容
dish_media_views.dish_media_id       → dish_media(id)              NOT NULL
```

書き込みは `api/src/v1/dish-media/dish-media.repository.ts` の
`tx.dish_media_impressions.create` / `tx.dish_media_views.create`。
impression が落ちれば、それを参照する view も落ちる。**この2つは重複ではなく連鎖**
（→ CLUSTERING.md「束ねてはいけないもの」）。

## 5. 除外ルール（E1〜E7）を知らないと「なぜ起票されないのか」が読めない

`scripts/error-triage/sql-generator.js` の `excludedReason` の CASE 式が唯一の正。
識別子の一覧は `scripts/error-triage/constants.js` の `EXCLUSION_REASONS`。

| | reason | 対象 | 落とすもの |
|---|---|---|---|
| E1 | `unknown_build_meta` | frontend | `created_commit_id` が `unknown-` 始まり（regression 判定が原理的に不能） |
| E2 | `unauthenticated_race` | frontend | メッセージに `Supabase access_token is missing` を含む |
| E3 | `client_network` | frontend | `api_call_error` かつ `status = 0`（端末の回線起因） |
| E4 | `transient_status` | frontend | `EXCLUDED_HTTP_STATUSES` |
| E5 | `device_location_failed` | frontend | `current_location_*` の event かつ `payload.kind ∈ (denied, timeout, unavailable)` |
| E6 | `expected_client_error` | backend | `EXCLUDED_HTTP_STATUSES`（400 / 409 / 422 は**残す**） |
| E7 | `external_transient` | external | `status_code ∈ (0,408,429,502,503,504)` |

とくに件数が大きく、知らないと「巨大な障害が起票されていない」と誤認する2つ:

- **E2 — `health_check_error` が 561件/463人/日あるが、全部意図的に除外されている。**
  出所は `app-expo/hooks/useAPICall.ts` の `#1092 【設計】` チョークポイントで、JWT を要求する全経路が
  トークン未確立時に `{ code: 'unauthenticated', message: 'User is not authenticated: Supabase access_token is missing (endpoint: …)' }`
  を throw する。これを error レベルで拾っているのは `app-expo/components/HealthCheckInitializer.tsx`。
  **認証確立前のレースであって障害ではない**（`#1089` `#1092`）。
- **E5 — 端末が現在地を返せない事象は起票されない。** `current_location_*` の event かつ
  `kind ∈ (denied, timeout, unavailable)` を除外する。`unsupported`（Web で Geolocation 非対応）だけは
  オーナー判断で**意図的に残している**。`kind` の値集合は
  `app-expo/hooks/locationPermissionError.ts` の `LocationPermissionErrorKind`（4値）。
  error レベルで `kind` を積むのは `app-expo/hooks/useLocationSearch.ts` の `current_location_fetch_failed` と
  `app-expo/app/[locale]/(tabs)/search/index.tsx` / `features/search/hooks/useLocationField.ts` の
  `current_location_failed`。
  **`kind` が無いログは E5 をすり抜ける** → FORENSICS.md「旧ビルドが残っている」。

  **訂正（2026-08-22 / #1492）**: 以前ここには「除外されるのは `denied` だけ。timeout / unavailable は
  端末側の障害なので意図的に残している」と書いていた。**その運用は破綻した。** 残したことで
  Issue が 10 件立ち、`err/skip` を付けても文言違いで立ち続けた（→ TRIAGE.md
  「`err/skip` で止まらないエラーがある」）。除外を 3 値へ広げ、代わりに **event 名で範囲を閉じた**。
  実測（本番 08-08〜08-23 / error 行）: 新ルールでの除外 1,122 件、
  旧ルールで除外されていて新ルールで残るもの **0 件**、`kind` を持つ非位置情報 event **0 件**。
  識別子も `user_denied_permission` → `device_location_failed` へ改名（timeout を畳む以上、
  「権限拒否」の名前では run サマリの内訳が実態と食い違うため）。

E7 の正規表現の段は現状効かない（`external_api_logs` に `error_message` が無い）。→ FORENSICS.md 落とし穴。

### ⚠️ 除外ルールが見るのは «トップレベルの» `payload.status` だけ

frontend の除外（E3 / E4）は `JSON_VALUE(payload, '$.status')` を読む。したがって
**ステータスを入れ子にして記録している event は、除外対象のステータスでも起票される。**

実例（#1476 / 2026-08-20、同一ミリ秒に 2 本）:

| event | payload | E4（403 を除外） |
|---|---|---|
| `api_call_error` | `{"status":403,...}` | **効く**（起票されない） |
| `tools_categories_error` | `{"error":{"status":403,...}}` | **効かない**（起票される） |

**「このステータスは除外されるから起票されないはず」は、payload がその形のときだけ成り立つ。**
除外されていないのを見て「ルールが壊れた」と考える前に、まず payload の形を見ること。

同じ理由で **E3 は event 名でも閉じている**（`api_call_error` かつ `status = 0`）。
`authInitError` は `status: 0`（supabase-js が fetch 失敗をラップした値＝端末の回線断）を
トップレベルに持つが、event 名が違うため E3 をすり抜ける（#1475）。
広げれば回線起因をまとめて畳めるが、**除外を広げる変更は見えない失敗を増やす**ので、
実測してから判断すること（2026-08-23 時点では見送り）。

---

## コードへ日本語コメントを残す（トリアージの成果物）

トリアージ中に「**コードを読んだだけでは設計意図が分からず、オーナーに聞いて初めて目線が合った**」箇所が
出たら、その場でソースへ日本語コメントを足す。次に読む人（と次の Claude）が同じ質問をしないための投資。

**書く場所の典型**（このスキルで実際に詰まった箇所）:

- フォールバックの入口と出口 — `fallbackToClaude`、`useGoogleMapsFallback`
- 本来通らないはずの経路 — gate whitelist をすり抜ける条件（§1）
- 非同期化されている境界 — bulk-import の「ID 先返し」と Cloud Tasks handler（§4）
- whitelist / gate / 定数など、**データの中身を知らないと意図が読めない**箇所 —
  `region_ok_categories`、`TRANSIENT_STATUSES`、`excludedReason` の各 CASE

**書く内容**: 「何をしているか」ではなく **「なぜそうなっているか」「これを変えると何が壊れるか」**。
コードを読めば分かることは書かない。

**形式はリポジトリ既存のタグに合わせる。** 実際に使われているもの（本文中の出現数が多い順、実測）:

```
【設計】 【仕様】 【修正】 【バグ】 【UX】 【セキュリティ】 【目的】 【責務】 【状態】
【テスト】 【処理】 【パフォーマンス】 【背景】 【互換性】 【フォールバック】 【観測】 【重要】
```

Issue 番号を前置する慣習がある（`// #533 【設計】…`）。**根拠になった Issue / PR 番号を必ず添える。**

**PR の載せ方**: コメント追加は修正 PR に相乗りさせる。修正が不要な場合（＝理解だけが更新された場合）は、
**コメントだけの PR を立ててよい**。
