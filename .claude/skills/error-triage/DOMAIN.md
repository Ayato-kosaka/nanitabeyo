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

### 2-1. フォールバックがある失敗を、どの層でどう扱うか（オーナー確定方針）

**ログレベルは「事実を記録する層」、`err/skip` は「方針を決める層」。役割を混ぜない。**
ログを warn に歪めて見えなくするのではなく、事実は正直に残したうえで
「これは見なくてよい」をトリアージ側で宣言する。

| 層 | 事実 | ログ | トリアージ |
|---|---|---|---|
| **external**（外部 API の呼び出しそのもの） | 実際に落ちている | **`error` のままが妥当** | 起票される → **`err/skip`** で恒久無視 |
| **backend**（自社 API） | 上流の失敗を伝えているだけ。アプリは退避できる | **システムエラーにしない**（5xx にしない） | 4xx へ寄せれば E4 / E6 の除外に自然に乗る |
| **frontend** | 退避導線が出ている | 同上 | 同上 |

判断の順序:

1. **その失敗に退避導線があるか**を UX ログで確かめる（上の §2）。無ければこの方針は使えない。
   *退避導線は経路ごとに有無が違う。「この API を叩く画面は全部フォールバックがある」と仮定しない。*
2. あるなら、**自社 API の層では 5xx を返さない**。上流の分類済みの失敗（クォータ枯渇＝429 等）を
   5xx にすると「サーバーの予期しない内部異常」という嘘になる。適切な 4xx へ寄せると、
   `TRANSIENT_STATUSES`（§3）と `EXCLUDED_HTTP_STATUSES` に既に載っている値なら
   **除外ルールを1つも足さずに** frontend（E4）も backend（E6）もトリアージ対象から外れる。
3. **外部 API の呼び出し箇所は `error` のまま残す。** そこは本当に落ちているので、warn にするのは
   事実を曲げること。代わりに、その fingerprint の Issue へ `err/skip` を付けて恒久無視する。
4. **`err/skip` を付けるときは、直さないと決めた理由を本文へ必ず書く。** 恒久無視なので、
   後から「なぜ無視したのか」を辿れる必要がある。

実例（Google Places 日次クォータ枯渇 / 682件・125人/日）— オーナー判断は **「解消不要」**:

- `callPlaceSearchText` の `GooglePlacesQuotaExceeded` … **error のまま**。専用 `event_name` にし、
  payload に `statusCode` を**あえて入れない**ので E6 の除外に当たらず起票される → `err/skip` を付ける。
- `searchRestaurants` / `bulkImportFromGoogle` … warn。`POST /v1/dishes/bulk-import` は 500 → **429**。
- frontend `api_call_error`(429) … warn。E4 で除外。
- external ログ（`status_code=429`）… E7 `external_transient` で元々除外。

**この方針を使ってよくない場合**: 退避導線が無い経路、上流の 5xx / ネットワーク断（＝分類できていない
失敗。我々のバグの可能性がある）、400 / 409 / 422（このリポジトリでは「契約が壊れている＝バグ」と
定義済み。§3）。これらは 5xx + `error` のまま鳴らす。

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
| E5 | `user_denied_permission` | frontend | `payload.kind = 'denied'` **のみ** |
| E6 | `expected_client_error` | backend | `EXCLUDED_HTTP_STATUSES`（400 / 409 / 422 は**残す**） |
| E7 | `external_transient` | external | `status_code ∈ (0,408,429,502,503,504)` |

とくに件数が大きく、知らないと「巨大な障害が起票されていない」と誤認する2つ:

- **E2 — `health_check_error` が 561件/463人/日あるが、全部意図的に除外されている。**
  出所は `app-expo/hooks/useAPICall.ts` の `#1092 【設計】` チョークポイントで、JWT を要求する全経路が
  トークン未確立時に `{ code: 'unauthenticated', message: 'User is not authenticated: Supabase access_token is missing (endpoint: …)' }`
  を throw する。これを error レベルで拾っているのは `app-expo/components/HealthCheckInitializer.tsx`。
  **認証確立前のレースであって障害ではない**（`#1089` `#1092`）。
- **E5 — 位置情報の拒否は 78件/41人/日あるが起票されない。** 除外されるのは `kind = 'denied'` だけで、
  `timeout` / `unavailable` / `unsupported` は**意図的に残している**（端末側の障害・Web 非対応は見たい）。
  `kind` の値集合は `app-expo/hooks/locationPermissionError.ts` の `LocationPermissionErrorKind`。
  なお error レベルで `kind` を積んでいるのは `app-expo/hooks/useLocationSearch.ts` の
  `current_location_fetch_failed` と `app-expo/app/[locale]/(tabs)/search/index.tsx` の
  `current_location_failed` の2箇所（sql-generator.js のコメントが指す行番号は古い）。
  **`kind` が無いログは E5 をすり抜ける** → FORENSICS.md「旧ビルドが残っている」。

E7 の正規表現の段は現状効かない（`external_api_logs` に `error_message` が無い）。→ FORENSICS.md 落とし穴。

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
