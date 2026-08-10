// api/src/core/external-api/external-api.errors.ts
//
// #1196 【設計】外部APIの失敗のうち「上流のクォータ枯渇」だけを型で区別するためのモジュール。
//
// なぜ型が要るのか:
//   これまで callPlaceSearchText は失敗を全部 `new Error(...)` で投げていたため、
//   呼び出し側は message の文字列一致でしか分類できなかった。文字列一致は上流の文言変更で
//   静かに壊れるうえ、「予期しない障害（= 我々のバグかもしれない）」と
//   「予期できる容量枯渇（= 我々のコードは正しいが枠が尽きた）」を混ぜてしまう。
//   この2つは **HTTP ステータスもログレベルも別扱いにすべき** なので、境界に型を置く。

/**
 * 上流APIのクォータ／レート制限で拒否されたことを表すエラー。
 *
 * これは「上流の容量が尽きた」という**分類済みの想定内の失敗**であって、
 * サーバーの内部不整合（= 500 で表すべきもの）ではない。
 */
export class ExternalApiQuotaExceededError extends Error {
  /** どの外部APIか（ログのグルーピング用。例: 'Google Places Text Search API'） */
  readonly apiName: string;
  /** 上流が返した HTTP ステータス（Places Text Search のクォータ枯渇は 429） */
  readonly upstreamStatus: number;

  constructor(params: {
    apiName: string;
    upstreamStatus: number;
    message: string;
  }) {
    super(params.message);
    this.name = 'ExternalApiQuotaExceededError';
    this.apiName = params.apiName;
    this.upstreamStatus = params.upstreamStatus;
    // ES5 ターゲットでの instanceof 崩れを防ぐ（tsconfig の target に依らず成立させる）
    Object.setPrototypeOf(this, ExternalApiQuotaExceededError.prototype);
  }
}

/**
 * 上流のレスポンスがクォータ／レート制限由来かを判定する。
 *
 * - `429` … Places API (New) がクォータ超過に使うステータス。これ単独で十分な根拠。
 * - 本文の `RESOURCE_EXHAUSTED` / `Quota exceeded` … Google の一部APIは同じ意味を
 *   403 で返す歴史的経緯があるため、本文側でも拾えるようにしておく。
 *
 * ⚠️ ここを「4xx なら全部クォータ」に広げてはならない。400（リクエストが壊れている）は
 *    我々のバグであり、クォータ枯渇と同じ扱いにすると実バグが想定内の事象に埋もれる。
 */
export const isQuotaExceededUpstreamResponse = (
  status: number,
  bodyText: string | undefined,
): boolean =>
  status === 429 ||
  (status === 403 && /RESOURCE_EXHAUSTED|Quota exceeded/i.test(bodyText ?? ''));
