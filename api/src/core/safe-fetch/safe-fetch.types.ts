// api/src/core/safe-fetch/safe-fetch.types.ts
//
// SafeFetch の契約。**実装（node:https / node:dns）から切り離してある。**
//
// 切り離す理由は 2 つある。
//  1. テストで実際に TikTok / YouTube を叩かないため（CI から外部へ出さない）。
//  2. 「SSRF ガードの判断」と「ソケットの都合」を混ぜないため。混ぜると、
//     ガードの分岐がソケットのモックを組まないと検査できなくなる。

/** SafeFetch が失敗した理由。**呼び出し側はこれを見て縮退する**（例外の文字列を読ませない） */
export type SafeFetchFailureKind =
  | 'invalid_url'
  | 'scheme_not_allowed'
  | 'port_not_allowed'
  | 'credentials_in_url'
  | 'host_not_allowed'
  | 'dns_failed'
  | 'blocked_ip'
  | 'too_many_redirects'
  | 'redirect_without_location'
  | 'timeout'
  | 'response_too_large'
  | 'unexpected_status'
  | 'unexpected_content_type'
  | 'invalid_body'
  | 'network_error';

/**
 * SafeFetch が投げる唯一の例外型。
 *
 * `kind` は機械可読で、HTTP レスポンスの `reason` へそのまま写せる粒度にしてある。
 * **`message` をユーザーに見せない**（内部ホスト名や IP が混ざりうるため）。
 */
export class SafeFetchError extends Error {
  constructor(
    readonly kind: SafeFetchFailureKind,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

/** 名前解決の結果 1 件 */
export type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type SafeFetchTransportRequest = {
  /** 接続先。**https のみ**（検証は SafeFetchService 側で済んでいる） */
  url: string;
  method: 'GET' | 'HEAD';
  headers: Record<string, string>;
  /**
   * 検証済みの接続先 IP。
   *
   * **指定されたら、この IP へ接続する。** ホスト名で再解決しない（DNS rebinding 対策）。
   * `Host` ヘッダと TLS SNI は URL のホスト名のままでなければならない。
   */
  pinnedAddress?: ResolvedAddress;
  /** 打ち切り。タイムアウトは SafeFetchService がこの signal 経由で効かせる */
  signal: AbortSignal;
};

export type SafeFetchTransportResponse = {
  status: number;
  /** キーは小文字化済み */
  headers: Record<string, string | undefined>;
  /** 本文。**読み切る責務とサイズ上限は SafeFetchService 側**にある */
  body: AsyncIterable<Uint8Array>;
  /** 本文を読み切る前に打ち切る */
  destroy(): void;
};

/**
 * ソケットに触る部分。テストではこれを差し替える。
 *
 * `lookupAll` が **全ての A/AAAA レコード**を返すことが重要で、
 * 1 件だけ返す実装にすると「1 件目は公開 IP、2 件目がループバック」を通してしまう。
 */
export interface SafeFetchTransport {
  lookupAll(hostname: string): Promise<ResolvedAddress[]>;
  request(
    request: SafeFetchTransportRequest,
  ): Promise<SafeFetchTransportResponse>;
}

export const SAFE_FETCH_TRANSPORT = Symbol('SAFE_FETCH_TRANSPORT');
