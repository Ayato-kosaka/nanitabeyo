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
| **どのビルド** | `created_commit_id`。いつ入ったバグかの手がかり |

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
frontend の `bulk-import` 500（125人）が一致し、「フォールバックしている」という仮説が否定された。

## 4. severity の妥当性を判定する

「`error` ではなく `warn` にすべきでは」を判断する材料は2つ。

1. **フロントが `api_call_error` を出しているか。** 出ていれば呼び出しは失敗しており、ユーザーに見えている。`warn` へ落とすと実障害が隠れる。
2. **フォールバック経路が実際に成功しているか。** `fallbackToClaude` のような関数自体がエラーを出していれば、フォールバックは効いていない。

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

---

# 落とし穴

## ビューを使うと 18.4GB/日 かかる

`frontend_event_logs` などのビューは `created_at` が計算列（`TO_JSON_STRING(jsonPayload)` を含む）で、
パーティション枝刈りが効かない。**必ず `run_googleapis_com_stdout` を `timestamp` で直接絞る。**

| 引き方 | 1日あたり |
|---|---|
| `frontend_event_logs` ビュー（`created_at` 絞り） | **18.4 GB** |
| 生テーブル（`timestamp` 絞り、3系統まとめて） | **約 77 MB** |

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

## 件数は窓をまたいで合算されない

25h スライド窓なので 1h ぶん重複する。「昨日より増えた」を見るときは窓の重なりを考慮する。
