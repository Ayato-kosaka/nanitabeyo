# Forensics — 根本原因を確定させる

Issue 本文の `messagePattern` は正規化済みで、診断に必要な情報が落ちていることがある。
close / skip を決める前に、必ず生ログまで降りる。

前提として `.codex/bigquery/safety-policy.md` に従う。読み取り専用、時間窓を必ず付ける、`SELECT *` を使わない。

## 0. まず Issue 本文から拾うもの

| 項目 | 使い道 |
|---|---|
| `fp:xxxxxxxxxxxx` | 突合キー。ただし**BigQuery 側にこの値は無い**（JS が計算している）ので、クエリの絞り込みには使えない |
| **どこで** | `surface` / `functionName` / `route` / `eventName`。これがクエリの絞り込み条件になる |
| **どれだけ** | 件数と影響ユーザー数。25h 窓の値 |
| **観測窓** | クエリの `timestamp` 範囲にそのまま使う |
| **どのビルド** | `created_commit_id`。いつ入ったバグかの手がかり。§6 も見る |

fingerprint では引けないので、**「どこで」の欄をクエリ条件へ翻訳する**のがこのフェーズの入口になる。

## 1. payload のキーは系統ごとに違う

正規化前の生メッセージがどこにあるかは一定ではない。順に当たる。

| surface | 主なキー | 備考 |
|---|---|---|
| backend（例外系） | `$.error` | Prisma / 未捕捉例外はここ。**スタックトレース全体**が入る |
| backend（外部API系） | `$.error_message` | `callClaudeAPI` / `searchRestaurants` などはこちら。`$.error` は空 |
| frontend | `$.error` | `toErrorLogMessage()` の出力 |
| frontend（API呼び出し） | `$.status` / `$.endpoint` | HTTP ステータスと呼び先。原因の切り分けに効く |

`$.error` が空でも諦めず `$.error_message` を見る。両方空なら `jsonPayload.payload` を直接覗く。

## 2. 生ログを引く

**改行を ` | ` へ潰す**と1行で読める。スタックトレースは長いので `SUBSTR` で切る。

```sql
SELECT
  SUBSTR(
    REGEXP_REPLACE(
      REGEXP_REPLACE(IFNULL(JSON_VALUE(jsonPayload.payload, '$.error'),
                            JSON_VALUE(jsonPayload.payload, '$.error_message')),
                     r'[\r\n]+', ' | '),
      r'[0-9a-fA-F]{8}-[0-9a-fA-F-]+', '<uuid>'),
    1, 400) AS err,
  COUNT(1) AS n,
  COUNT(DISTINCT jsonPayload.user_id) AS users
FROM `food-scroll.nanitabeyo_logs_prod.run_googleapis_com_stdout`
WHERE timestamp >= TIMESTAMP '{{WINDOW_START}}'
  AND timestamp <  TIMESTAMP '{{WINDOW_END}}'
  AND jsonPayload.error_level = 'error'
  AND jsonPayload.log_type   = 'backend_event_logs'
  AND jsonPayload.function_name = '{{FUNCTION_NAME}}'
GROUP BY 1
ORDER BY n DESC
LIMIT 5
```

窓は Issue 本文の「観測窓」をそのまま使う。**ビューではなく `run_googleapis_com_stdout` を直接引く**こと（理由は下の落とし穴）。

## 3. frontend と backend を突き合わせる

「backend が 500 を返している」と「ユーザーに見えている」は別。フロントが `api_call_error` を出しているかで判定する。

```sql
SELECT
  JSON_VALUE(jsonPayload.payload, '$.status')   AS http_status,
  SUBSTR(JSON_VALUE(jsonPayload.payload, '$.endpoint'), 1, 60) AS endpoint,
  COUNT(1) AS n,
  COUNT(DISTINCT jsonPayload.user_id) AS users
FROM `food-scroll.nanitabeyo_logs_prod.run_googleapis_com_stdout`
WHERE timestamp >= TIMESTAMP '{{WINDOW_START}}'
  AND timestamp <  TIMESTAMP '{{WINDOW_END}}'
  AND jsonPayload.error_level = 'error'
  AND jsonPayload.log_type    = 'frontend_event_logs'
  AND jsonPayload.event_name  = 'api_call_error'
GROUP BY 1, 2
ORDER BY n DESC
LIMIT 8
```

**影響ユーザー数が backend 側と一致すれば、同一の障害を両側から見ている。**
初回トリアージでは Google Places のクォータ枯渇（backend 125人）と
frontend の `bulk-import` 500（125人）が一致した。

ただし**ここで止めない**。同じ突合を「その後の UX ログ」（`google_maps_fallback_dialog_shown` /
`google_maps_fallback_opened`）まで伸ばすと、ユーザーが実際に詰んだかが分かる。→ DOMAIN.md §2。

## 4. severity の妥当性を判定する

**レベルの定義そのものは TRIAGE.md「ログレベルの定義」にある**（`error` = 回復不能で人手が要る /
`warn` = 設計どおり回復した / 回復可能かを決めるのは呼び出し元）。ここではその判定に使う**材料の集め方**を書く。

3つ集める。

1. **フロントが `api_call_error` を出しているか。** 出ていれば呼び出しは失敗しており、ユーザーに見えている。`warn` へ落とすと実障害が隠れる。
2. **フォールバック経路が実際に成功しているか。** `fallbackToClaude` のような関数自体がエラーを出していれば、フォールバックは効いていない。
3. **同じ事象が別レベルで二重に記録されていないか。** 低レイヤの `XxxApiCallError`(error) と
   呼び出し元の `XxxFallback`(warn) が**同数**で並んでいたら、log-and-throw を疑う。
   BigQuery では `eventName` ごとの件数を同じ窓で並べれば分かる。件数が一致したらコードで
   呼び出し元を特定し、そこが回復設計を持っているなら低レイヤ側が誤り。

`app-expo/lib/logQueue.ts` の `TRANSIENT_STATUSES`（`401,408,425,426,429`）が
このリポジトリにおける「一時的 = 不具合ではない」の定義。ここに無い 4xx / 5xx は不具合として扱う。

## 5. 匿名ユーザーを見落とさない

`affectedUsers` は `COUNT(DISTINCT user_id)` なので、未認証リクエストは 0 人として数えられる。
サインアップ・ログイン・ヘルスチェック経路の障害は `anonymousOccurrences` を見る。

```sql
SELECT COUNTIF(jsonPayload.user_id IS NULL) AS anon_rows,
       COUNT(DISTINCT jsonPayload.user_id)  AS users,
       COUNT(1)                              AS rows_n
FROM `food-scroll.nanitabeyo_logs_prod.run_googleapis_com_stdout`
WHERE timestamp >= TIMESTAMP '{{WINDOW_START}}'
  AND timestamp <  TIMESTAMP '{{WINDOW_END}}'
  AND jsonPayload.error_level = 'error'
  AND jsonPayload.event_name  = '{{EVENT_NAME}}'
```

## 6. 現行コードで再現しないなら、コードではなくビルドを疑う

**「現行コードを読んでも、このエラーが出る経路が無い」に当たったら、コードを疑う前に
`created_commit_id` の分布を見る。** native アプリはユーザーが更新するまで旧ビルドが動き続けるので、
**既に直したバグがログに出続ける**。

```sql
SELECT
  SUBSTR(IFNULL(jsonPayload.created_commit_id, '(null)'), 1, 8) AS commit_sha,
  IFNULL(JSON_VALUE(jsonPayload.payload, '$.kind'), '(null)')   AS kind,
  SUBSTR(REGEXP_REPLACE(JSON_VALUE(jsonPayload.payload, '$.error'), r'[\r\n]+', ' | '), 1, 160) AS err,
  COUNT(1)                             AS n,
  COUNT(DISTINCT jsonPayload.user_id)  AS users
FROM `food-scroll.nanitabeyo_logs_prod.run_googleapis_com_stdout`
WHERE timestamp >= TIMESTAMP '{{WINDOW_START}}'
  AND timestamp <  TIMESTAMP '{{WINDOW_END}}'
  AND jsonPayload.error_level = 'error'
  AND jsonPayload.event_name  = '{{EVENT_NAME}}'
GROUP BY 1, 2, 3
ORDER BY n DESC
LIMIT 20
```

**実例（位置情報エラー）。** `payload.kind` の有無が commit で完全に分かれていた。

```
kind='denied'   commit c217a35e…（現行ビルド）        291件/101人  → E5 で除外され、起票されない
kind=null       commit 2f159544 / 24e95bcf /
                       e3afe9f4 / aa593170（旧ビルド）
                "Error: Calling the 'getCurrentPositionAsync' function has failed
                 → Caused by: Location permission is required to do this operation"
                → 意味は denied なのに kind が無いので E5 をすり抜けて起票される
```

裏は取れている: `kind` を payload へ載せ始めたのは #932（`fca177bb`, 2026-07-25）で、
それ以前の `current_location_fetch_failed` の payload は `{ error: String(error) }` だけだった
（`git show fca177bb^:app-expo/hooks/useLocationSearch.ts`）。

**正しい処置は `err/skip` + close。現行コードを直すことではない。**
本文には必ず commit id を根拠として残す（`err/skip` は恒久無視なので、後から辿れる必要がある）。

**見分け方**: 件数の commit 分布が「現行ビルドで 0、旧ビルドだけ」になっているか。
現行ビルドにも出ているなら旧ビルド残存ではなく、現に生きているバグ。

---

# 落とし穴

## ビューを使うと 18.4GB/日 かかる

`frontend_event_logs` などのビューは `created_at` が計算列（`TO_JSON_STRING(jsonPayload)` を含む）で、
パーティション枝刈りが効かない。**必ず `run_googleapis_com_stdout` を `timestamp` で直接絞る。**

実測値と対処の正は [`.codex/bigquery/safety-policy.md`](../../../.codex/bigquery/safety-policy.md)
（ビュー 18.4 GB/日 に対し生テーブル約 77 MB/日）。

## スキャン上限に当たったら、上げる前に「増えたのは何か」を切り分ける

`dry-run の見積り … が上限 … を超えています` で run が落ちたら、**上限を上げる前に
error 率を見る**。ログ量が増えた理由が利用者増なのか障害なのかで、やることが正反対になる。

```sql
SELECT DATE(timestamp) AS d,
       COUNT(DISTINCT jsonPayload.user_id)                       AS users,
       COUNTIF(jsonPayload.error_level = 'error')                AS err_n,
       ROUND(COUNTIF(jsonPayload.error_level = 'error') / COUNT(1) * 100, 2) AS err_pct
FROM `food-scroll.nanitabeyo_logs_prod.run_googleapis_com_stdout`
WHERE timestamp >= TIMESTAMP '{{WINDOW_START}}'
  AND timestamp <  TIMESTAMP '{{WINDOW_END}}'
GROUP BY 1 ORDER BY 1 DESC
```

- **error 率が横ばい** → 利用者が増えただけ。上限を上げる。
- **error 率が跳ねている** → 障害。上限を上げてはいけない（上げると障害を課金で吸収するだけになる）。

実例（2026-08-19）: 上限 200MB に対し見積り 249,701,781 バイトで abort。
ユーザーが 394 → **1,478 人/日**（3.75倍）に増えた一方 error 率は 4.17% → 4.48% で横ばいだったので、
利用者増と判断して上限を 1GB へ引き上げた。

**クエリ側で削れる余地はほぼ無い**ことも実測済み。同じ窓の dry-run で
全列 382MB / `jsonPayload.payload` を除くと 59MB、つまり **85% が `payload` の 1 列**で、
これは messagePattern の素材なので落とせない。さらに Sink テーブルは `timestamp` の
DAY パーティションのみで**クラスタリングが無い**ため、`error_level = 'error'`（全行の約 4%）で
絞ってもスキャンバイトは減らない。**「WHERE で絞れば安くなる」は BigQuery では成り立たない。**

## `jsonPayload.error_message` は存在しない

STRUCT に無いので**直接参照するとクエリ全体が失敗する**（NULL が返るのではない）。
`jsonPayload.payload` の中の `$.error_message` とは別物なので混同しない。

## `TO_JSON_STRING(jsonPayload)` を使わない

`request_payload` / `response_payload` を含む全リーフを読むのでコストが跳ねる。
特定のキーが欲しいときは `JSON_VALUE(jsonPayload.payload, '$.key')` を使う。

## `external_api_logs` は `error_level` を持たない

`logger.externalApi()` は `error_level` を出力しない。
`error_level = 'error'` で絞ると external が丸ごと消える。external は `status_code` で判定する
（`0` = 通信断、`>= 400` = HTTPエラー。成功時は `error_message` が null）。

## 除外ルールで消えているものがある

`401,403,404,408,425,426,429` は SQL 段階で落としている。
「このエラーが起票されない」と思ったらまずここを疑う。
403/404 は外部の脆弱性スキャナ（`wp-login.php` `.env` `wp-json/` 等）が大量に叩くため除外している。
初回の実測では、除外前 526 グループのうち **505 件がスキャナ由来**だった。

ステータス以外の除外（認証確立前レース、位置情報の権限拒否など）は DOMAIN.md §5 に E1〜E7 の一覧がある。

## 件数は窓をまたいで合算されない

25h スライド窓なので 1h ぶん重複する。「昨日より増えた」を見るときは窓の重なりを考慮する。
