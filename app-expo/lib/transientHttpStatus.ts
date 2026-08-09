// #1196 【設計】「一時障害」として扱う HTTP ステータスの唯一の正。
//
// もともと app-expo/lib/logQueue.ts の中にだけ存在していた（#1079）が、
// useAPICall.ts でも同じ判定が要るようになったのでここへ切り出した。
// logQueue.ts はここから import するだけになり、app-expo 内の定義は 1 つのままになる。
//
// ★ 同じ集合が scripts/error-triage/constants.js の `TRANSIENT_HTTP_STATUSES` と
//   api/src/core/filters/api-exception.filter.ts にもある（別パッケージから import できないため）。
//   **変更するときは 3 つ揃えること。** 片方だけ書き換えると
//   「このリポジトリが不具合とみなす 4xx」の定義が割れる。

/**
 * 4xx でも「クライアント側の契約違反」ではないステータス。
 *
 *   401 Unauthorized      … flush中のトークン失効レース。次のトークンで送れば通る
 *   408 Request Timeout   … サーバ/経路側のタイムアウト
 *   425 Too Early         … リプレイ懸念による再送要求
 *   426 Upgrade Required  … アプリバージョン起因（maintenance.guard）。ログ本文とは無関係
 *   429 Too Many Requests … レート制限。#1196 以降は「上流(Google Places)のクォータ枯渇」も含む
 */
export const TRANSIENT_STATUSES: readonly number[] = [401, 408, 425, 426, 429];

/**
 * #1196 このステータスは「アプリの不具合」ではなく「時間や環境で解消する一時障害」か。
 *
 * ログレベルの判定に使う。ここが true のものを error で記録すると、
 * 本当に直すべき不具合（500 や 400）が同じ棚に埋もれる。
 */
export const isTransientHttpStatus = (status: number): boolean => TRANSIENT_STATUSES.includes(status);
