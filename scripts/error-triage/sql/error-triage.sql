-- =============================================================================
-- error-triage / 25h スライド窓のエラー抽出                         ★READ ONLY★
--
-- ⚠️ このファイルは **生成物** です。直接編集しないでください。
--    生成元 : scripts/error-triage/sql-generator.js
--             （置換ルールの唯一の正は scripts/error-triage/normalize-rules.js）
--    再生成 : pnpm --filter error-triage generate:sql
--    生成物とルール表がズレると sql-generator.test.js が赤くなります。
--
-- fingerprint 定義（正規化ルール表 + キー構成 + ハッシュ合成）の世代。
-- constants.js の FP_ALGO_VERSION と一致することをユニットテストで検査する（横断レビュー 1-3）。
-- fpalgo: 2
--
-- 設計上の制約（守らないと壊れるもの）:
--   1. **単一文**であること。CREATE TEMP FUNCTION を使うと multi-statement script になり、
--      dry-run がバイト見積りを返さなくなってコストガードの第2層が黙って無効化される（B3）。
--   2. 窓は **run 開始時刻を時単位で切り捨て、そこから 25h 遡る**スライド窓（B5 / G1）。
--      境界は Workflow 側でリテラルに置換する。CURRENT_TIMESTAMP() を SQL 内で使わない
--      （パーティション枝刈りを確実に効かせるため）。
--   3. 生 Sink テーブルを timestamp（DAY パーティション）で直読みする。ビュー
--      （frontend_event_logs 等）は created_at が計算列で枝刈りが効かず 18.4GB/日かかる（#1196）。
--      `*_legacy` テーブルも参照しない。
--   4. **TO_JSON_STRING(jsonPayload) を使わない。** 使うと request_payload / response_payload を
--      含む全リーフを読むことになり、ビューと同じコスト爆発を再現する（#1197 §7）。
--   5. グルーピングのキーは fingerprint.js の FINGERPRINT_KEY_FIELDS と**完全に一致**させる。
--      SQL の1行と JS の1グループが 1:1 でないと affectedUsers が occurrences に退化する（B1）。
--   6. 出力は1行1JSON（kind: "group" | "run_summary"）。命名は全レイヤ camelCase（横断レビュー §7）。
-- =============================================================================

WITH
-- ---------------------------------------------------------------------------
-- 1) パーティション枝刈り + 3系統のエラー行だけを取る
--
-- 参照列はここに列挙したものが全て（＝コスト見積りの根拠）:
--   timestamp,
--   jsonPayload.{log_type, error_level, event_name, path_name, function_name,
--                user_id, created_commit_id, created_app_version,
--                api_name, endpoint, method, status_code, payload}
--
-- ★ jsonPayload.error_message は **STRUCT に存在しない**（オーナーが bq show --schema で確認済み）。
--   直接参照すると "Field name error_message does not exist in STRUCT" でクエリ全体が失敗する。
--   JSON_VALUE(TO_JSON_STRING(jsonPayload), '$.error_message') 経由なら失敗しないが、
--   TO_JSON_STRING(jsonPayload) は上記 4 のコスト爆発を招くため採れない。
--   横断レビュー §6-3 / #1197 §8-1 の退避策どおり CAST(NULL AS STRING) に固定する。
--   影響は E7 の正規表現条件が効かなくなることだけで、external のエラー判定は status_code で成立する。
-- ---------------------------------------------------------------------------
src AS (
  SELECT
    timestamp                                   AS ingestedAt,
    jsonPayload.log_type                        AS logType,
    jsonPayload.event_name                      AS eventName,
    jsonPayload.path_name                       AS pathName,
    jsonPayload.function_name                   AS functionName,
    jsonPayload.user_id                         AS userId,
    jsonPayload.created_commit_id               AS createdCommitId,
    jsonPayload.created_app_version             AS createdAppVersion,
    jsonPayload.api_name                        AS apiName,
    jsonPayload.endpoint                        AS extEndpoint,
    jsonPayload.method                          AS extMethod,
    SAFE_CAST(jsonPayload.status_code AS INT64) AS extStatusCode,
    -- payload は JSON 文字列を値に持つ STRING 列（logger.service.ts:190-201 が JSON.stringify する）。
    -- PARSE_JSON は通さない: JSON_VALUE / JSON_QUERY は STRING を直接受け取れるうえ、
    -- SAFE.PARSE_JSON(x, wide_number_mode => 'round') の構文は未実証で初回から詰まるリスクがある。
    jsonPayload.payload                         AS payloadText,
    CAST(NULL AS STRING)                        AS extErrorMessage
  FROM `food-scroll.nanitabeyo_logs_prod.run_googleapis_com_stdout`
  WHERE
    -- ★ パーティション枝刈り（DAY / timestamp）。ここがコストの全て
        timestamp >= TIMESTAMP '{{WINDOW_START}}'
    AND timestamp <  TIMESTAMP '{{WINDOW_END}}'
    AND jsonPayload.log_type IN ('frontend_event_logs', 'backend_event_logs', 'external_api_logs')
    AND (
      -- frontend / backend は error_level = 'error'
      (jsonPayload.log_type IN ('frontend_event_logs', 'backend_event_logs')
       AND jsonPayload.error_level = 'error')
      -- external は error_level 列そのものが無い（logger.service.ts:93-113）。
      -- error_message も使えない（上記）ので status_code だけで定義する。
      OR (jsonPayload.log_type = 'external_api_logs'
          AND (   SAFE_CAST(jsonPayload.status_code AS INT64) IS NULL
               OR SAFE_CAST(jsonPayload.status_code AS INT64) = 0
               OR SAFE_CAST(jsonPayload.status_code AS INT64) >= 400))
    )
),

-- ---------------------------------------------------------------------------
-- 2) 系統判定 + エラーメッセージ抽出（#1197 §1 のフォールバック順）
--
-- payload のキーは系統ごとに違う。backend の最大の発生源 ApiExceptionFilter は
-- `error` の値が文字列（stack）のこともオブジェクト（HttpException）のこともあるため、
-- JSON_VALUE がオブジェクトに対して NULL を返すぶんを JSON_QUERY で拾う段が要る。
-- ---------------------------------------------------------------------------
extracted AS (
  SELECT
    ingestedAt, userId, createdCommitId, createdAppVersion,
    eventName, pathName, functionName,
    apiName, extEndpoint, extMethod, extStatusCode, extErrorMessage,
    CASE logType
      WHEN 'frontend_event_logs' THEN 'frontend'
      WHEN 'backend_event_logs'  THEN 'backend'
      ELSE 'external'
    END AS surface,
    CASE logType
      WHEN 'backend_event_logs' THEN COALESCE(
        JSON_VALUE(payloadText, '$.error'),
        JSON_VALUE(payloadText, '$.error_message'),
        JSON_VALUE(payloadText, '$.errorMessage'),
        JSON_VALUE(payloadText, '$.originalError'),
        JSON_VALUE(payloadText, '$.message'),
        JSON_VALUE(payloadText, '$.error.message'),
        JSON_VALUE(payloadText, '$.error.response.message[0]'),
        NULLIF(JSON_QUERY(payloadText, '$.error'), 'null')
      )
      WHEN 'frontend_event_logs' THEN COALESCE(
        JSON_VALUE(payloadText, '$.error'),
        JSON_VALUE(payloadText, '$.error_message'),
        JSON_VALUE(payloadText, '$.errorMessage'),
        JSON_VALUE(payloadText, '$.message'),
        JSON_VALUE(payloadText, '$.error.message'),
        JSON_VALUE(payloadText, '$.errorPayload.message'),
        JSON_VALUE(payloadText, '$.errorPayload.error'),
        JSON_VALUE(payloadText, '$.errorPayload.errorCode'),
        NULLIF(JSON_QUERY(payloadText, '$.error'), 'null')
      )
      ELSE extErrorMessage
    END AS rawMessage,
    -- 補助キー（fingerprint と除外判定に使う。いずれも非PII）
    JSON_VALUE(payloadText, '$.status')                 AS feHttpStatus,  -- useAPICall.ts:278
    JSON_VALUE(payloadText, '$.endpoint')               AS feEndpoint,    -- useAPICall.ts:276
    JSON_VALUE(payloadText, '$.kind')                   AS feKind,        -- useLocationSearch.ts:314
    JSON_VALUE(payloadText, '$.errorPayload.errorCode') AS feErrorCode,
    JSON_VALUE(payloadText, '$.statusCode')             AS beHttpStatus,  -- api-exception.filter.ts:46
    JSON_VALUE(payloadText, '$.url')                    AS beUrl          -- api-exception.filter.ts:45
  FROM src
),

-- ---------------------------------------------------------------------------
-- 3) 正規化（normalize-rules.js からの生成物）
--
-- B3: CREATE TEMP FUNCTION を使えないので、正規化式を5回コピペするのではなく
--     UNNEST([...]) WITH OFFSET で **1回だけ**書いて配列 norm[] に落とす。
--     ARRAY_AGG は NULL 要素を許さないので、入力は必ず IFNULL(..., '') で埋める
--     （空文字は取り出す側の NULLIF(..., '') で NULL に戻す）。
-- ---------------------------------------------------------------------------
normalized AS (
  SELECT
    e.ingestedAt, e.userId, e.createdCommitId, e.createdAppVersion,
    e.surface, e.eventName, e.functionName, e.apiName, e.extMethod, e.extStatusCode,
    e.rawMessage, e.extErrorMessage,
    e.feHttpStatus, e.feKind, e.feErrorCode, e.beHttpStatus,
    (
      SELECT ARRAY_AGG(
        TRIM(
          SUBSTR(
            TRIM(
              REGEXP_REPLACE(
                REGEXP_REPLACE(
                  REGEXP_REPLACE(
                    REGEXP_REPLACE(
                      REGEXP_REPLACE(
                        REGEXP_REPLACE(
                          REGEXP_REPLACE(
                            REGEXP_REPLACE(
                              REGEXP_REPLACE(
                                REGEXP_REPLACE(
                                  REGEXP_REPLACE(
                                    v
                                  , r'''[\r\n][\x{0000}-\x{10FFFF}]*$''', '')  -- rule(0) first-line-only
                                , r'''\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?''', '<ts>')  -- rule(1) iso8601-timestamp
                              , r'''\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b''', '<uuid>')  -- rule(2) uuid
                            , r'''\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+''', '<jwt>')  -- rule(3) jwt
                          , r'''[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+''', '<email>')  -- rule(4) email
                        , r'''\bChIJ[A-Za-z0-9_-]{8,}''', '<placeid>')  -- rule(5) google-place-id
                      , r'''\?[^\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}"')]*''', '?')  -- rule(6) url-query
                    , r'''\b[0-9a-fA-F]{8,}\b''', '<hex>')  -- rule(7) hex-run
                  , r'''\b(?:[0-9][A-Za-z0-9_-]{27,}|[A-Za-z_-]{1}[0-9][A-Za-z0-9_-]{26,}|[A-Za-z_-]{2}[0-9][A-Za-z0-9_-]{25,}|[A-Za-z_-]{3}[0-9][A-Za-z0-9_-]{24,}|[A-Za-z_-]{4}[0-9][A-Za-z0-9_-]{23,}|[A-Za-z_-]{5}[0-9][A-Za-z0-9_-]{22,}|[A-Za-z_-]{6}[0-9][A-Za-z0-9_-]{21,}|[A-Za-z_-]{7}[0-9][A-Za-z0-9_-]{20,}|[A-Za-z_-]{8}[0-9][A-Za-z0-9_-]{19,}|[A-Za-z_-]{9}[0-9][A-Za-z0-9_-]{18,}|[A-Za-z_-]{10}[0-9][A-Za-z0-9_-]{17,}|[A-Za-z_-]{11}[0-9][A-Za-z0-9_-]{16,}|[A-Za-z_-]{12}[0-9][A-Za-z0-9_-]{15,}|[A-Za-z_-]{13}[0-9][A-Za-z0-9_-]{14,}|[A-Za-z_-]{14}[0-9][A-Za-z0-9_-]{13,}|[A-Za-z_-]{15}[0-9][A-Za-z0-9_-]{12,}|[A-Za-z_-]{16}[0-9][A-Za-z0-9_-]{11,}|[A-Za-z_-]{17}[0-9][A-Za-z0-9_-]{10,}|[A-Za-z_-]{18}[0-9][A-Za-z0-9_-]{9,}|[A-Za-z_-]{19}[0-9][A-Za-z0-9_-]{8,}|[A-Za-z_-]{20}[0-9][A-Za-z0-9_-]{7,}|[A-Za-z_-]{21}[0-9][A-Za-z0-9_-]{6,}|[A-Za-z_-]{22}[0-9][A-Za-z0-9_-]{5,}|[A-Za-z_-]{23}[0-9][A-Za-z0-9_-]{4,}|[A-Za-z_-]{24}[0-9][A-Za-z0-9_-]{3,}|[A-Za-z_-]{25}[0-9][A-Za-z0-9_-]{2,}|[A-Za-z_-]{26}[0-9][A-Za-z0-9_-]{1,}|[A-Za-z_-]{27}[0-9][A-Za-z0-9_-]*|[A-Za-z_-]{28,}[0-9][A-Za-z0-9_-]*)\b''', '<token>')  -- rule(8) opaque-token
                , r'''\d+(?:\.\d+)?''', '<n>')  -- rule(9) number
              , r'''[\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+''', ' ')  -- rule(10) whitespace
            , '\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')  -- post(0) trim
          , 1, 200)  -- post(1) truncate
        , '\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')  -- post(2) trim-after-truncate
        ORDER BY off
      )
      FROM UNNEST([
        IFNULL(e.rawMessage, ''),           -- OFFSET(0) messagePattern: 契約の messagePattern
        IFNULL(e.pathName, ''),             -- OFFSET(1) pathName: frontend の groupKey.pathName
        IFNULL(e.feEndpoint, ''),           -- OFFSET(2) feRoute: frontend の groupKey.route（$.endpoint）
        IFNULL(e.beUrl, ''),                -- OFFSET(3) beRoute: backend の groupKey.route（$.url）
        IFNULL(e.extEndpoint, '')           -- OFFSET(4) extEndpoint: external の groupKey.endpoint
      ]) AS v WITH OFFSET off
    ) AS norm
  FROM extracted e
),

-- ---------------------------------------------------------------------------
-- 4) fingerprint のキー列を surface ごとに確定させる + 除外理由を付ける
--
-- ★ ここに並ぶ key* 列の集合が、そのまま fingerprint.js の FINGERPRINT_KEY_FIELDS と
--   1:1 で対応する。使わない surface では NULL に潰し、GROUP BY をこの集合ちょうどにする。
--   （JS 側で再グルーピングしないための前提。契約の不変条件 1）
--
-- 除外は WHERE で消さずに理由を付けて残し、runSummary.excludedBreakdown へ
-- (reason, eventName, httpStatus) 単位で出す。除外が効きすぎて本物のバグを
-- 消していることに、数字を見て気づけるようにするため（横断レビュー §6-4 / G5）。
-- ---------------------------------------------------------------------------
keyed AS (
  SELECT
    n.surface,
    n.ingestedAt,
    n.userId,
    n.createdCommitId,
    n.createdAppVersion,
    n.eventName,
    n.feErrorCode,
    IF(n.surface IN ('frontend', 'backend'), n.eventName, NULL)     AS keyEventName,
    -- ★ fpalgo 2: pathName は「正規化 → 先頭ロケール剥がし」の2段。
    --   ルール表は normalize-rules.js の PATH_LOCALE_RULES（唯一の正）。
    --   剥がしたロケールは捨てず localeTag として残し、下で localeCounts に集計する
    --   （「1ロケールだけなら別物の可能性がある」を人間が確かめられなくなるため / CLUSTERING.md 類型1）。
    IF(n.surface = 'frontend', NULLIF(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          n.norm[OFFSET(1)]
        , r'''^/(?:[a-z]{2,3}(?:-[A-Z][a-z]{3})?-(?:[A-Z]{2}|<n>)|[a-z]{2,3}-[A-Z][a-z]{3}|[a-z]{2}|\[locale\])(?:/\[locale\])*/''', '/')  -- pathLocale(0) path-locale-prefix
      , r'''^/(?:[a-z]{2,3}(?:-[A-Z][a-z]{3})?-(?:[A-Z]{2}|<n>)|[a-z]{2,3}-[A-Z][a-z]{3}|[a-z]{2}|\[locale\])(?:/\[locale\])*$''', '/')  -- pathLocale(1) path-locale-only
    , ''), NULL)                                                    AS keyPathName,
    -- 剥がした先頭ロケール部そのもの（'ja-JP' / '[locale]' / 'es-ES/[locale]'）。
    -- 旧 fingerprint（fpalgo 1）の pathName は '/' || localeTag || keyPathName で厳密に復元できる。
    IF(n.surface = 'frontend', REGEXP_EXTRACT(n.norm[OFFSET(1)], r'''^/((?:[a-z]{2,3}(?:-[A-Z][a-z]{3})?-(?:[A-Z]{2}|<n>)|[a-z]{2,3}-[A-Z][a-z]{3}|[a-z]{2}|\[locale\])(?:/\[locale\])*)(?:/|$)'''), NULL)
                                                                    AS localeTag,
    IF(n.surface = 'backend', n.functionName, NULL)                 AS keyFunctionName,
    IF(n.surface = 'external', n.apiName, NULL)                     AS keyApiName,
    IF(n.surface = 'external', NULLIF(n.norm[OFFSET(4)], ''), NULL) AS keyEndpoint,
    IF(n.surface = 'external', n.extMethod, NULL)                   AS keyMethod,
    IF(n.surface = 'external', n.extStatusCode, NULL)               AS keyStatusCode,
    -- 数値のまま独立フィールドにする（<n> に潰すと 4xx と 5xx が同一グループへ落ちる / 矛盾E）
    CASE n.surface
      WHEN 'frontend' THEN SAFE_CAST(n.feHttpStatus AS INT64)
      WHEN 'backend'  THEN SAFE_CAST(n.beHttpStatus AS INT64)
    END                                                             AS keyHttpStatus,
    -- route は必ず正規化後の値を使う（生 URL はクエリ文字列に APIキーが載り得る / 契約の不変条件 3）
    CASE n.surface
      WHEN 'frontend' THEN NULLIF(n.norm[OFFSET(2)], '')
      WHEN 'backend'  THEN NULLIF(n.norm[OFFSET(3)], '')
    END                                                             AS keyRoute,
    -- external の fingerprint は message 非依存（#1196）。グルーピングキーから外す
    IF(n.surface = 'external', NULL, NULLIF(n.norm[OFFSET(0)], '')) AS keyMessagePattern,
    NULLIF(n.norm[OFFSET(0)], '')                                   AS messagePatternAny,
    -- excludedBreakdown 用。external では extStatusCode を採る
    COALESCE(
      CASE n.surface
        WHEN 'frontend' THEN SAFE_CAST(n.feHttpStatus AS INT64)
        WHEN 'backend'  THEN SAFE_CAST(n.beHttpStatus AS INT64)
      END,
      n.extStatusCode
    )                                                               AS reportHttpStatus,
    CASE
      -- (E1) ビルドメタ欠落。commit が引けず regression 判定が原理的に不能（frontend 限定）
      WHEN n.surface = 'frontend'
       AND STARTS_WITH(IFNULL(n.createdCommitId, ''), 'unknown-')
        THEN 'unknown_build_meta'
      -- (E2) 認証確立前レース（useAPICall.ts:104-107 / #1089 #1092）
      WHEN n.surface = 'frontend'
       AND REGEXP_CONTAINS(IFNULL(n.rawMessage, ''), r'''Supabase access_token is missing''')
        THEN 'unauthenticated_race'
      -- (E3) 端末の回線起因（useAPICall.ts:225-245 の status: 0）
      WHEN n.surface = 'frontend'
       AND n.eventName = 'api_call_error'
       AND SAFE_CAST(n.feHttpStatus AS INT64) = 0
        THEN 'client_network'
      -- (E4) 一時障害系ステータス。constants.js の EXCLUDED_HTTP_STATUSES が唯一の正
      WHEN n.surface = 'frontend'
       AND SAFE_CAST(n.feHttpStatus AS INT64) IN (401, 403, 404, 408, 425, 426, 429)
        THEN 'transient_status'
      -- (E5) 端末が現在地を返せない。kind の値集合は denied/timeout/unavailable/unsupported の4値
      --      （locationPermissionError.ts）。denied / timeout / unavailable を除外する。
      --
      --      当初は denied だけを除外していたが、それでは止まらなかった。fingerprint は
      --      messagePattern を含むため、**同じ「位置情報が取れない」が OS ごとの文言で割れる**。
      --      実測で event 名 2 種 × 文言 9 種 × 経路 3 種に分かれ、err/skip ラベル を付けても
      --      文言違いで新しい Issue が立ち続けた（実際に 10 件立った / #1196）。
      --      kind は既に 3 値へ正規化済みなので、そちらで畳むのが唯一の止め方である。
      --
      --      ⚠️ **kind の値だけで判定しないこと。** kind は payload の汎用キーで、
      --      将来 位置情報と無関係な機能が kind: 'timeout' を積んだら、その不具合が
      --      «理由も告げずに» 除外される。除外の取りこぼし（Issue が立つ）は見えるが、
      --      過剰な除外（Issue が立たない）は見えない。見えるほうの失敗に倒すため
      --      event 名で範囲を閉じる。
      --      前方一致にしてあるのは、位置情報の event が現状 5 つあり
      --      （current_location_{fetch_failed,failed,auto_fetch_failed,backend_failed_fallback,
      --      expo_fallback_failed}）今後も増えうるため。この命名規約が唯一の前提。
      --
      --      unsupported（Web で Geolocation 非対応）はオーナー判断により除外せず残す。
      WHEN n.surface = 'frontend'
       AND STARTS_WITH(IFNULL(n.eventName, ''), 'current_location_')
       AND n.feKind IN ('denied', 'timeout', 'unavailable')
        THEN 'device_location_failed'
      -- (E6) 期待された 4xx。E4 と**同じ定数**を共有する（横断レビュー §6-4 / S3）。
      --      400 / 409 / 422 は残す: このリポジトリは logQueue.ts で既に
      --      「400/422 は契約が壊れている状態＝不具合」と定義済みで、この API の一次クライアントは
      --      自前の app-expo なので ValidationError 400 はほぼ常に自分たちの DTO 不整合＝実バグ。
      WHEN n.surface = 'backend'
       AND SAFE_CAST(n.beHttpStatus AS INT64) IN (401, 403, 404, 408, 425, 426, 429)
        THEN 'expected_client_error'
      -- (E7) 外部API側の一時障害。error_message が STRUCT に無いため、
      --      現状は status_code 側の条件だけが効く（正規表現の段は将来 error_message が
      --      生えたときのために残してある）。
      WHEN n.surface = 'external'
       AND (n.extStatusCode IN (0, 408, 429, 502, 503, 504)
            OR REGEXP_CONTAINS(IFNULL(n.extErrorMessage, ''),
                 r'''(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed)'''))
        THEN 'external_transient'
      ELSE NULL
    END                                                             AS excludedReason
  FROM normalized n
),

-- ---------------------------------------------------------------------------
-- 5) エラーグループへ畳み込む（GROUP BY = fingerprint のキー集合ちょうど）
--
-- ANY_VALUE() は使わない。fingerprint に含まれない列へ使うと出力が非決定的になり、
-- 同じ入力から違う Issue 本文が出る（横断レビュー N4）。MIN() か「最新行の値」に固定する。
-- ---------------------------------------------------------------------------
grouped AS (
  SELECT
    surface,
    keyEventName,
    keyPathName,
    keyFunctionName,
    keyApiName,
    keyEndpoint,
    keyMethod,
    keyStatusCode,
    keyHttpStatus,
    keyRoute,
    -- external は message でグルーピングしないので、代表値として最小値を採る（決定的）
    IF(surface = 'external', MIN(messagePatternAny), keyMessagePattern) AS messagePattern,
    MIN(feErrorCode)                                  AS errorCode,
    COUNT(*)                                          AS occurrences,
    -- user_id が NULL の行は数えない。未認証経路は anonymousOccurrences で救う（横断レビュー S4）
    COUNT(DISTINCT userId)                            AS affectedUsers,
    COUNTIF(userId IS NULL)                           AS anonymousOccurrences,
    MIN(ingestedAt)                                   AS firstSeen,
    MAX(ingestedAt)                                   AS lastSeen,
    ARRAY_AGG(createdCommitId IGNORE NULLS ORDER BY ingestedAt DESC, createdCommitId LIMIT 1)[SAFE_OFFSET(0)]
                                                      AS representativeCommit,
    -- hourlyCounts / commits / appVersions は下の出力段でこの1本の配列から導出する
    -- （集約を二重に書かずに済ませるため）
    ARRAY_AGG(STRUCT(
      TIMESTAMP_TRUNC(ingestedAt, HOUR) AS hourUtc,
      createdCommitId                   AS sha,
      createdAppVersion                 AS appVersion,
      -- fpalgo 2: 剥がしたロケール。NULL は「ロケール接頭辞が無かった」（'/store' 等）
      localeTag                         AS locale
    ))                                                AS samples
  FROM keyed
  WHERE excludedReason IS NULL
  GROUP BY
    surface, keyEventName, keyPathName, keyFunctionName, keyApiName,
    keyEndpoint, keyMethod, keyStatusCode, keyHttpStatus, keyRoute, keyMessagePattern
),

-- ---------------------------------------------------------------------------
-- 6) 上位 500 件に絞る（S6）
--
-- LIMIT ではなく QUALIFY を使う。runSummary.groupCount は**制限前**の grouped から数えるので、
-- 切り捨てが起きたこと（groupCount > groupLimit）を JS 側が必ず検知できる（G3）。
-- LIMIT で絞ったあとの件数から数えると、切り捨て検知が原理的に不能になる。
--
-- ★ QUALIFY は WHERE / GROUP BY / HAVING と併用する必要がある（QUALIFY は予約語ではないため）。
--   ここでは契約の不変条件 6（surface は既知3値のみ）を SQL 側でも明示して兼ねる。
-- ---------------------------------------------------------------------------
limited AS (
  SELECT
    surface, keyEventName, keyPathName, keyFunctionName, keyApiName,
    keyEndpoint, keyMethod, keyStatusCode, keyHttpStatus, keyRoute,
    messagePattern, errorCode, occurrences, affectedUsers, anonymousOccurrences,
    firstSeen, lastSeen, representativeCommit, samples
  FROM grouped
  WHERE surface IN ('frontend', 'backend', 'external')
  QUALIFY ROW_NUMBER() OVER (
    ORDER BY affectedUsers DESC, occurrences DESC, firstSeen ASC, surface ASC, IFNULL(messagePattern, '') ASC
  ) <= 500
),

-- ---------------------------------------------------------------------------
-- 7) 除外分の内訳（reason だけでなく eventName / httpStatus 単位 / 横断レビュー §6-4）
-- ---------------------------------------------------------------------------
excludedAgg AS (
  SELECT
    excludedReason   AS reason,
    eventName        AS eventName,
    reportHttpStatus AS httpStatus,
    COUNT(*)         AS cnt
  FROM keyed
  WHERE excludedReason IS NOT NULL
  GROUP BY reason, eventName, httpStatus
)

-- ---------------------------------------------------------------------------
-- 8) 出力（1行 = 1 JSON 文字列）。型が STRING へ丸められないよう TO_JSON_STRING で1列に固める。
--    fingerprint と fpAlgoVersion / schemaVersion は **SQL は出さない**。JS が注入する（矛盾B / 1-3）。
--
--    集合演算（UNION ALL）の入力に ORDER BY / LIMIT を付けると括弧が要るので、
--    どちらの入力にも付けない（並べ替えは JS 側の責務 / S6）。
-- ---------------------------------------------------------------------------
SELECT TO_JSON_STRING(STRUCT(
  'group'                AS kind,
  g.surface              AS surface,
  STRUCT(
    g.keyEventName    AS eventName,
    g.keyPathName     AS pathName,
    g.keyFunctionName AS functionName,
    g.keyApiName      AS apiName,
    g.keyEndpoint     AS endpoint,
    g.keyMethod       AS method,
    g.keyStatusCode   AS statusCode,
    g.keyHttpStatus   AS httpStatus,
    g.keyRoute        AS route,
    g.errorCode       AS errorCode
  )                      AS groupKey,
  g.messagePattern       AS messagePattern,
  g.occurrences          AS occurrences,
  g.affectedUsers        AS affectedUsers,
  g.anonymousOccurrences AS anonymousOccurrences,
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', g.firstSeen, 'UTC') AS firstSeenUtc,
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', g.lastSeen,  'UTC') AS lastSeenUtc,
  (
    SELECT ARRAY_AGG(STRUCT(
      FORMAT_TIMESTAMP('%Y-%m-%dT%H:00:00Z', b.hourUtc, 'UTC') AS hourUtc,
      b.n AS `count`
    ) ORDER BY b.hourUtc)
    FROM (SELECT s.hourUtc AS hourUtc, COUNT(*) AS n FROM UNNEST(g.samples) AS s GROUP BY s.hourUtc) AS b
  )                      AS hourlyCounts,
  (
    SELECT ARRAY_AGG(STRUCT(b.sha AS sha, b.n AS `count`) ORDER BY b.n DESC, b.sha LIMIT 5)
    FROM (
      SELECT s.sha AS sha, COUNT(*) AS n
      FROM UNNEST(g.samples) AS s
      WHERE s.sha IS NOT NULL
      GROUP BY s.sha
    ) AS b
  )                      AS commits,
  (
    SELECT ARRAY_AGG(b.appVersion ORDER BY b.appVersion LIMIT 5)
    FROM (SELECT DISTINCT s.appVersion AS appVersion FROM UNNEST(g.samples) AS s WHERE s.appVersion IS NOT NULL) AS b
  )                      AS appVersions,
  -- fpalgo 2: 剥がしたロケールの内訳。**pathName から消した情報をここへ移す**。
  -- 用途は2つ: (1) Issue 本文に「どのロケールで何件」を残す（1ロケールだけなら別物の可能性がある）
  --            (2) 旧 fingerprint（fpalgo 1）を復元して既存 Issue と突合する（移行）
  -- locale が NULL の要素は「ロケール接頭辞が無かった」を意味する（frontend 以外は常に NULL）。
  (
    SELECT ARRAY_AGG(STRUCT(b.locale AS locale, b.n AS `count`) ORDER BY b.n DESC, b.locale LIMIT 50)
    FROM (SELECT s.locale AS locale, COUNT(*) AS n FROM UNNEST(g.samples) AS s GROUP BY s.locale) AS b
  )                      AS localeCounts,
  g.representativeCommit AS representativeCommit
)) AS triageRow
FROM limited g

UNION ALL

SELECT TO_JSON_STRING(STRUCT(
  'run_summary' AS kind,
  -- ★ 制限「前」の総グループ数。これと groupLimit の比較が切り捨て検知（G3）の唯一の根拠
  (SELECT COUNT(*) FROM grouped)                    AS groupCount,
  500                               AS groupLimit,
  (SELECT IFNULL(SUM(occurrences), 0) FROM grouped) AS keptRows,
  (SELECT IFNULL(SUM(cnt), 0) FROM excludedAgg)     AS excludedRows,
  -- 上位100件まで。合計（excludedRows）は常に全件ぶんなので、内訳を切っても総数は狂わない
  (
    SELECT ARRAY_AGG(STRUCT(
      x.reason     AS reason,
      x.eventName  AS eventName,
      x.httpStatus AS httpStatus,
      x.cnt        AS `count`
    ) ORDER BY x.cnt DESC, x.reason LIMIT 100)
    FROM excludedAgg x
  )                                                 AS excludedBreakdown
)) AS triageRow
