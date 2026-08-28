// api/src/core/safe-fetch/safe-fetch.service.ts
//
// ユーザーが貼った URL を起点に外部を叩くための共通ラッパ（#1399 §3-3 / 独立レビュー M-2）。
//
// ## なぜ `ExternalApiService.makeExternalApiCall` を使わないのか
//
// `api/src/core/external-api/external-api.service.ts:596` は素の `fetch(endpoint, {method, headers, body})`
// で、`signal` も `redirect` も指定していない。Google Places のような**自分で組み立てた URL**を
// 叩くぶんには実害が出ていないが、
//
//  - 応答が返らないとリクエストが永久に待つ（Cloud Run の同時実行スロットが埋まり、
//    無関係な API まで巻き添えで詰まる）
//  - `redirect` 既定の `follow` なので、リダイレクト先の検証ができない
//
// の 2 点があり、ユーザー入力 URL 起点の取得には使えない。
//
// ## 2 つの関心を分けてある
//
// | 層 | 効かせる範囲 | 中身 |
// | --- | --- | --- |
// | **衛生（hygiene）** | **全ての外部取得**（oEmbed を含む） | タイムアウト / レスポンスサイズ上限 / Content-Type 検証 / https 強制 |
// | **SSRF ガード** | **ユーザー入力 URL だけ** | ホップごとの許可判定 + **名前解決した IP の検証** + 自前リダイレクトループ |
//
// oEmbed の取得先は provider ごとの固定エンドポイントなので SSRF は原理的に成立しないが、
// **タイムアウトとサイズ上限は SSRF 対策ではない**ので必ず効かせる（M-2）。
//
// ## 数値の根拠
//
// | 値 | 既定 | 根拠 |
// | --- | --- | --- |
// | 1 ホップのタイムアウト | 5,000 ms | 設計 §3-3。ユーザーが URL を貼って待つ同期 API なので、体感で待てる上限。oEmbed の実測は 1 秒未満 |
// | チェーン全体のタイムアウト | 10,000 ms | 5s × 最大 4 リクエストが直列に最悪値を取っても、Cloud Run のインスタンスを 20 秒占有させないため |
// | レスポンスサイズ上限 | 256 KiB | 設計 §3-3。実測の oEmbed JSON は 1 KiB 未満で、256 KiB は 200 倍以上の余裕がある |
// | リダイレクト上限 | 3 ホップ | 設計 §5-1 / §3-3。実測は `vm.tiktok.com` → `www.tiktok.com/@/video/{id}` の 1 ホップ。3 で足りる |

import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../logger/logger.service';
import { classifyIpAddress } from './ip-guard';
import {
  ResolvedAddress,
  SAFE_FETCH_TRANSPORT,
  SafeFetchError,
  SafeFetchTransport,
  SafeFetchTransportResponse,
} from './safe-fetch.types';

/** 既定値。**変えるときは冒頭の根拠表も一緒に直すこと。** */
export const SAFE_FETCH_DEFAULTS = {
  /** 1 リクエストのタイムアウト（ms） */
  timeoutMs: 5_000,
  /** リダイレクトチェーン全体のタイムアウト（ms） */
  chainTimeoutMs: 10_000,
  /** レスポンス本文のサイズ上限（バイト） */
  maxResponseBytes: 256 * 1024,
  /** 追ってよいリダイレクトの回数 */
  maxRedirects: 3,
} as const;

/**
 * 送るヘッダ（設計 §3-4）。
 *
 * - **UA を詐称しない。** ブロックされたら「メタデータが取れなかった」として縮退する
 *   （それが本設計の想定内の状態）。
 * - **Cookie を送らない。** ユーザーを特定しうる値をリクエストに載せない。
 * - `accept-encoding: identity` は**サイズ上限を意味のあるものにするため**。圧縮されたまま
 *   受けると「上限 256 KiB」が展開後の大きさを保証しない。
 */
const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  'user-agent': 'nanitabeyo/1.0 (+https://app.nanitabeyo.net; url-import)',
  'accept-encoding': 'identity',
};

/** JSON として受けてよい Content-Type */
export const JSON_CONTENT_TYPES = [
  'application/json',
  'text/json',
  'application/oembed+json',
] as const;

export type SafeFetchHygieneOptions = {
  /** `logger.externalApi` に出す名前（例: `'TikTok oEmbed'`） */
  apiName: string;
  functionName: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type SafeFetchGuardOptions = {
  /**
   * **各ホップで呼ばれる許可判定。** `false` を返したホップで即座に打ち切る。
   *
   * provider の判定ロジックをこの層へ持ち込まないための口。
   * #1399 の呼び出し側は `parseSnsUrl()` の結果で判定する（判定を 2 か所に書かないため）。
   */
  allowHop: (url: URL) => boolean;
  /**
   * ここで `true` を返したらリクエストせずに打ち切って良い、という早期終了の判定。
   *
   * 「Location が既に目的の形になっている」ときに無駄な 1 リクエストを省くためのもの。
   */
  stopAt?: (url: URL) => boolean;
  maxRedirects?: number;
  /** チェーン全体のタイムアウト（ms） */
  chainTimeoutMs?: number;
};

export type SafeFetchRedirectChainResult = {
  /** 最終的に到達した URL */
  finalUrl: string;
  /** 通過した URL（先頭が入力）。ログと調査用 */
  hops: string[];
  /** 最終ホップの HTTP ステータス。`stopAt` で打ち切ったときは `null` */
  finalStatus: number | null;
};

/** 追うリダイレクトのステータス */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

@Injectable()
export class SafeFetchService {
  constructor(
    @Inject(SAFE_FETCH_TRANSPORT)
    private readonly transport: SafeFetchTransport,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  衛生層: 固定エンドポイントからの JSON 取得                          */
  /* ------------------------------------------------------------------ */

  /**
   * **provider ごとの固定エンドポイント**から JSON を取る（oEmbed 用）。
   *
   * ユーザーの URL はクエリパラメータの値としてしか渡らないので、この経路に SSRF は
   * 原理的に成立しない。したがって名前解決の検証は行わない。
   * ただし**タイムアウト・サイズ上限・Content-Type 検証は必ず効かせる**（M-2）。
   *
   * **リダイレクトは追わない。** 固定エンドポイントが 3xx を返すのは想定外なので、
   * 追わずに `unexpected_status` として縮退させる（呼び出し側は候補ゼロ＋理由を返す）。
   */
  async fetchJson<T = unknown>(
    rawUrl: string,
    options: SafeFetchHygieneOptions,
  ): Promise<T> {
    const url = this.assertHygienicUrl(rawUrl);
    const deadline =
      Date.now() + (options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs);

    const { status, contentType, body } = await this.performRequest(url, {
      method: 'GET',
      headers: { ...DEFAULT_HEADERS, accept: 'application/json' },
      deadline,
      perRequestTimeoutMs: options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs,
      maxResponseBytes:
        options.maxResponseBytes ?? SAFE_FETCH_DEFAULTS.maxResponseBytes,
      apiName: options.apiName,
      functionName: options.functionName,
    });

    if (status < 200 || status >= 300) {
      throw new SafeFetchError(
        'unexpected_status',
        `Unexpected status ${status}`,
        { status },
      );
    }

    if (
      !JSON_CONTENT_TYPES.some((allowed) => contentType.startsWith(allowed))
    ) {
      throw new SafeFetchError(
        'unexpected_content_type',
        `Unexpected content-type ${contentType}`,
        {
          contentType,
        },
      );
    }

    try {
      return JSON.parse(body.toString('utf8')) as T;
    } catch {
      throw new SafeFetchError(
        'invalid_body',
        'Response body is not valid JSON',
      );
    }
  }

  /**
   * **provider ごとの固定エンドポイント**から HTML/テキストを取る。
   *
   * #1399 Instagram の埋め込み SSR（`https://www.instagram.com/p/{code}/embed/captioned/`）用。
   * fetchJson と同じ衛生（固定ホスト・タイムアウト・サイズ上限・リダイレクト非追従）で、
   * Content-Type だけ text/html を受ける。呼び出し側は **HTML を保存せず**、
   * 使うフィールドを抽出したら捨てること（#1273 §14 の規律はここでも同じ）。
   */
  async fetchText(
    rawUrl: string,
    options: SafeFetchHygieneOptions,
  ): Promise<string> {
    const url = this.assertHygienicUrl(rawUrl);
    const deadline =
      Date.now() + (options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs);

    const { status, contentType, body } = await this.performRequest(url, {
      method: 'GET',
      headers: { ...DEFAULT_HEADERS, accept: 'text/html' },
      deadline,
      perRequestTimeoutMs: options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs,
      maxResponseBytes:
        options.maxResponseBytes ?? SAFE_FETCH_DEFAULTS.maxResponseBytes,
      apiName: options.apiName,
      functionName: options.functionName,
    });

    if (status < 200 || status >= 300) {
      throw new SafeFetchError(
        'unexpected_status',
        `Unexpected status ${status}`,
        { status },
      );
    }

    if (!contentType.startsWith('text/html')) {
      throw new SafeFetchError(
        'unexpected_content_type',
        `Unexpected content-type ${contentType}`,
        { contentType },
      );
    }

    return body.toString('utf8');
  }

  /**
   * provider が返した **画像 URL** からバイナリを取る（#1399 サムネイルの自ストレージ保存用）。
   *
   * URL はユーザー入力ではなく provider のレスポンス由来だが、それでも信用しない:
   * - https のみ / 呼び出し側が `allowHost` でホストを検証してから渡す
   * - Content-Type は image/* のみ
   * - サイズ上限（既定より大きめを呼び出し側が指定する想定）
   * - リダイレクトは追わない（CDN の画像 URL が 3xx を返すのは想定外）
   */
  async fetchImage(
    rawUrl: string,
    options: SafeFetchHygieneOptions & { allowHost: (host: string) => boolean },
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const url = this.assertHygienicUrl(rawUrl);
    if (!options.allowHost(url.hostname)) {
      throw new SafeFetchError('host_not_allowed', 'Host not allowed', {
        host: url.hostname,
      });
    }
    const deadline =
      Date.now() + (options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs);

    const { status, contentType, body } = await this.performRequest(url, {
      method: 'GET',
      headers: { ...DEFAULT_HEADERS, accept: 'image/*' },
      deadline,
      perRequestTimeoutMs: options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs,
      maxResponseBytes:
        options.maxResponseBytes ?? SAFE_FETCH_DEFAULTS.maxResponseBytes,
      apiName: options.apiName,
      functionName: options.functionName,
    });

    if (status < 200 || status >= 300) {
      throw new SafeFetchError(
        'unexpected_status',
        `Unexpected status ${status}`,
        { status },
      );
    }

    if (!contentType.startsWith('image/')) {
      throw new SafeFetchError(
        'unexpected_content_type',
        `Unexpected content-type ${contentType}`,
        { contentType },
      );
    }

    return { buffer: body, contentType };
  }

  /* ------------------------------------------------------------------ */
  /*  SSRF ガード層: ユーザー入力 URL のリダイレクト解決                  */
  /* ------------------------------------------------------------------ */

  /**
   * ユーザーが貼った短縮 URL を展開する。**サーバがユーザー由来のホストへ接続する唯一の経路。**
   *
   * 各ホップで次を全部やる。1 つでも落ちたら `SafeFetchError` を投げる。
   *
   * 1. https / 認証情報なし / 既定ポート であること
   * 2. `allowHop` が許すホストであること（呼び出し側の判定を使う）
   * 3. **名前解決した A/AAAA を全件検証し、1 つでも禁止レンジなら拒否**
   * 4. 検証済みの IP へ接続する（`Host` と TLS SNI は元のホスト名のまま）
   *
   * 3 と 4 が対になっていることが重要で、「検証してから名前で繋ぎ直す」実装にすると
   * 検証と接続の間に DNS の答えを差し替えられる（DNS rebinding）。
   */
  async resolveRedirectChain(
    rawUrl: string,
    options: SafeFetchHygieneOptions & SafeFetchGuardOptions,
  ): Promise<SafeFetchRedirectChainResult> {
    const maxRedirects =
      options.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;
    const perRequestTimeoutMs =
      options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs;
    const deadline =
      Date.now() +
      (options.chainTimeoutMs ?? SAFE_FETCH_DEFAULTS.chainTimeoutMs);

    let current = this.assertHygienicUrl(rawUrl);
    this.assertHopAllowed(current, options.allowHop);

    const hops: string[] = [current.href];

    if (options.stopAt?.(current)) {
      return { finalUrl: current.href, hops, finalStatus: null };
    }

    for (let hop = 0; ; hop += 1) {
      const pinnedAddress = await this.resolveAndAssertSafeAddress(
        current.hostname,
      );

      const { status, headers } = await this.performRequest(current, {
        method: 'GET',
        headers: { ...DEFAULT_HEADERS, accept: '*/*' },
        deadline,
        perRequestTimeoutMs,
        // 展開に要るのはヘッダだけ。本文は読まずに捨てる（サイズ上限を待つ理由が無い）
        discardBody: true,
        maxResponseBytes:
          options.maxResponseBytes ?? SAFE_FETCH_DEFAULTS.maxResponseBytes,
        pinnedAddress,
        apiName: options.apiName,
        functionName: options.functionName,
      });

      if (!REDIRECT_STATUSES.has(status)) {
        return { finalUrl: current.href, hops, finalStatus: status };
      }

      if (hop >= maxRedirects) {
        throw new SafeFetchError(
          'too_many_redirects',
          `Exceeded ${maxRedirects} redirects`,
          {
            maxRedirects,
            hops: hops.length,
          },
        );
      }

      const location = headers['location'];
      if (!location) {
        throw new SafeFetchError(
          'redirect_without_location',
          `Status ${status} without Location header`,
          {
            status,
          },
        );
      }

      let next: URL;
      try {
        // 相対 Location（`/@user/video/123`）も来る
        next = new URL(location, current);
      } catch {
        throw new SafeFetchError(
          'invalid_url',
          'Location header is not a valid URL',
        );
      }

      next = this.assertHygienicUrl(next.href);
      this.assertHopAllowed(next, options.allowHop);

      current = next;
      hops.push(current.href);

      if (options.stopAt?.(current)) {
        return { finalUrl: current.href, hops, finalStatus: null };
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  内部                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * URL そのものの衛生検査。**https のみ / 認証情報なし / 既定ポートのみ。**
   *
   * `http` を https へ昇格させない。ユーザーが `http://` を貼ったときに黙って
   * https へ読み替えると、「平文で送られたつもりが無い」という誤解を生むうえ、
   * リダイレクト先の検証と組み合わせたときの挙動が読みづらくなる。
   */
  private assertHygienicUrl(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new SafeFetchError('invalid_url', 'Not a valid absolute URL');
    }

    if (url.protocol !== 'https:') {
      throw new SafeFetchError(
        'scheme_not_allowed',
        `Scheme ${url.protocol} is not allowed`,
        {
          scheme: url.protocol,
        },
      );
    }
    if (url.username !== '' || url.password !== '') {
      throw new SafeFetchError(
        'credentials_in_url',
        'URL must not contain credentials',
      );
    }
    // 443 は URL API が空文字へ正規化する。明示された非既定ポートは受け付けない
    if (url.port !== '') {
      throw new SafeFetchError(
        'port_not_allowed',
        `Port ${url.port} is not allowed`,
        { port: url.port },
      );
    }

    return url;
  }

  private assertHopAllowed(url: URL, allowHop: (url: URL) => boolean): void {
    if (!allowHop(url)) {
      throw new SafeFetchError(
        'host_not_allowed',
        `Host ${url.hostname} is not allowed for this hop`,
        {
          host: url.hostname,
        },
      );
    }
  }

  /**
   * ホスト名を解決し、**全てのアドレス**が接続してよいレンジか検証する。
   *
   * 1 件目だけ検証する実装にすると「1 件目は公開 IP・2 件目がループバック」を通してしまう。
   * 接続に使うのは検証済みの 1 件目で、これを `pinnedAddress` として引き回す。
   */
  private async resolveAndAssertSafeAddress(
    hostname: string,
  ): Promise<ResolvedAddress> {
    let addresses: ResolvedAddress[];
    try {
      addresses = await this.transport.lookupAll(hostname);
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      throw new SafeFetchError(
        'dns_failed',
        `DNS lookup failed for ${hostname}`,
        { hostname },
      );
    }

    if (!addresses || addresses.length === 0) {
      throw new SafeFetchError('dns_failed', `No address for ${hostname}`, {
        hostname,
      });
    }

    for (const candidate of addresses) {
      const reason = classifyIpAddress(candidate.address);
      if (reason !== null) {
        this.logger.warn(
          'SafeFetchBlockedAddress',
          'resolveAndAssertSafeAddress',
          {
            hostname,
            reason,
          },
        );
        throw new SafeFetchError(
          'blocked_ip',
          `Resolved address for ${hostname} is not routable`,
          {
            hostname,
            reason,
          },
        );
      }
    }

    return addresses[0];
  }

  /**
   * 1 リクエストを実行し、本文をサイズ上限つきで読む。
   *
   * タイムアウトは「1 リクエストの上限」と「チェーン全体の締め切り」の**短い方**で効かせる。
   * 片方だけだと、5 秒ぎりぎりのホップが 4 回続いて 20 秒占有される。
   */
  private async performRequest(
    url: URL,
    params: {
      method: 'GET' | 'HEAD';
      headers: Record<string, string>;
      deadline: number;
      perRequestTimeoutMs: number;
      maxResponseBytes: number;
      apiName: string;
      functionName: string;
      pinnedAddress?: ResolvedAddress;
      discardBody?: boolean;
    },
  ): Promise<{
    status: number;
    headers: Record<string, string | undefined>;
    contentType: string;
    body: Buffer;
  }> {
    const remaining = params.deadline - Date.now();
    if (remaining <= 0) {
      throw new SafeFetchError('timeout', 'Deadline exceeded before request', {
        url: url.origin,
      });
    }

    const controller = new AbortController();
    const timeoutMs = Math.min(params.perRequestTimeoutMs, remaining);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    let response: SafeFetchTransportResponse | null = null;
    try {
      response = await this.transport.request({
        url: url.href,
        method: params.method,
        headers: params.headers,
        pinnedAddress: params.pinnedAddress,
        signal: controller.signal,
      });

      const contentType = (response.headers['content-type'] ?? '')
        .toLowerCase()
        .split(';')[0]
        .trim();

      const body = params.discardBody
        ? Buffer.alloc(0)
        : await this.readBody(
            response,
            params.maxResponseBytes,
            controller.signal,
          );

      if (params.discardBody) response.destroy();

      await this.logExternalApi(
        params,
        url,
        response.status,
        Date.now() - startedAt,
        null,
      );

      return {
        status: response.status,
        headers: response.headers,
        contentType,
        body,
      };
    } catch (error) {
      response?.destroy();

      const normalized = this.normalizeError(error, controller.signal, url);
      await this.logExternalApi(
        params,
        url,
        0,
        Date.now() - startedAt,
        normalized.kind,
      );
      throw normalized;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 本文をサイズ上限つきで読む。**`Content-Length` を信用しない。**
   *
   * 実際に流れてきたバイト数で判定し、超えた時点でソケットを落とす。
   * `Content-Length` を見て弾く実装は、ヘッダを詐称した chunked レスポンスに素通しされる。
   */
  private async readBody(
    response: SafeFetchTransportResponse,
    maxResponseBytes: number,
    signal: AbortSignal,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of response.body) {
      if (signal.aborted) {
        response.destroy();
        throw new SafeFetchError('timeout', 'Aborted while reading body');
      }

      total += chunk.byteLength;
      if (total > maxResponseBytes) {
        response.destroy();
        throw new SafeFetchError(
          'response_too_large',
          `Response exceeded ${maxResponseBytes} bytes`,
          {
            maxResponseBytes,
          },
        );
      }
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  private normalizeError(
    error: unknown,
    signal: AbortSignal,
    url: URL,
  ): SafeFetchError {
    if (error instanceof SafeFetchError) return error;
    if (signal.aborted) {
      return new SafeFetchError('timeout', 'Request timed out', {
        url: url.origin,
      });
    }
    return new SafeFetchError(
      'network_error',
      error instanceof Error ? error.message : 'Unknown error',
      {
        url: url.origin,
      },
    );
  }

  /**
   * 外部呼び出しのログ。既存の `logger.externalApi()` に相乗りする（設計 §3-5）。
   *
   * **クエリ文字列は落とす。** 短縮 URL の解決先には `share_item_id` などの
   * 発信者を特定しうるパラメータが乗ってくるため、ログに残さない。
   * 同じ理由で `response_payload` も入れない（この層は本文の意味を知らない）。
   */
  private async logExternalApi(
    params: { apiName: string; functionName: string; method: string },
    url: URL,
    statusCode: number,
    responseTimeMs: number,
    errorKind: string | null,
  ): Promise<void> {
    await this.logger.externalApi({
      api_name: params.apiName,
      endpoint: `${url.origin}${url.pathname}`,
      method: params.method,
      request_payload: {},
      response_payload: null,
      status_code: statusCode,
      response_time_ms: responseTimeMs,
      function_name: params.functionName,
      error_message: errorKind,
    });
  }
}
