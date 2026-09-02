// api/src/core/safe-fetch/safe-fetch.service.spec.ts
//
// #1399 SafeFetchService。**外部 HTTP は必ずモックする**（CI から実際の TikTok / YouTube を叩かない）。
//
// 固定してあるのは次の 6 つ。
//  1. 短縮 URL が展開されて最終 URL が確定する
//  2. リダイレクト先がプライベート IP なら拒否する（SSRF）
//  3. リダイレクト上限を超えたら拒否する
//  4. タイムアウトで打ち切られる
//  5. サイズ上限を超えたら打ち切られる
//  6. 衛生層（oEmbed 経路）にもタイムアウトとサイズ上限が効く

jest.mock('src/core/config/env', () => ({
  env: {
    API_COMMIT_ID: 'test',
    API_NODE_ENV: 'test',
  },
}));

import { AppLoggerService } from '../logger/logger.service';
import { SAFE_FETCH_DEFAULTS, SafeFetchService } from './safe-fetch.service';
import { SafeFetchError } from './safe-fetch.types';
import { FakeSafeFetchTransport } from './testing/fake-safe-fetch.transport';

/** 何でも通すホップ判定。ホスト allowlist そのものは呼び出し側の責務なので、ここでは緩めて他の分岐を見る */
const allowAnyHop = () => true;

const TIKTOK_SHORTLINK = 'https://vm.tiktok.com/ZMhqRBmXW/';
const TIKTOK_VIDEO =
  'https://www.tiktok.com/@scout2015/video/6718335390845095173';

function createLogger(): AppLoggerService {
  return {
    verbose: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    externalApi: jest.fn().mockResolvedValue(undefined),
  } as unknown as AppLoggerService;
}

describe('SafeFetchService — 既定値', () => {
  it('タイムアウト / サイズ上限 / リダイレクト上限が設計どおり', () => {
    // 数字を動かすときは safe-fetch.service.ts 冒頭の根拠表も直すこと
    expect(SAFE_FETCH_DEFAULTS.timeoutMs).toBe(5_000);
    expect(SAFE_FETCH_DEFAULTS.maxResponseBytes).toBe(256 * 1024);
    expect(SAFE_FETCH_DEFAULTS.maxRedirects).toBe(3);
    // チェーン全体の締め切りは 1 ホップより長くないと意味が無い
    expect(SAFE_FETCH_DEFAULTS.chainTimeoutMs).toBeGreaterThan(
      SAFE_FETCH_DEFAULTS.timeoutMs,
    );
  });
});

describe('SafeFetchService.resolveRedirectChain', () => {
  let transport: FakeSafeFetchTransport;
  let service: SafeFetchService;

  beforeEach(() => {
    transport = new FakeSafeFetchTransport();
    service = new SafeFetchService(transport, createLogger());
  });

  it('短縮 URL を展開して最終 URL を返す', async () => {
    transport
      .route(TIKTOK_SHORTLINK, {
        status: 302,
        headers: {
          location: `${TIKTOK_VIDEO}?_r=1&share_item_id=6718335390845095173`,
        },
      })
      .route(TIKTOK_VIDEO, { status: 200, body: '<html></html>' });

    const result = await service.resolveRedirectChain(TIKTOK_SHORTLINK, {
      apiName: 'tiktok shortlink',
      functionName: 'test',
      allowHop: allowAnyHop,
    });

    expect(result.finalUrl).toBe(
      `${TIKTOK_VIDEO}?_r=1&share_item_id=6718335390845095173`,
    );
    expect(result.hops).toHaveLength(2);
    expect(result.finalStatus).toBe(200);
  });

  it('相対 Location を解決する', async () => {
    transport
      .route(TIKTOK_SHORTLINK, {
        status: 301,
        headers: { location: '/@scout2015/video/6718335390845095173' },
      })
      .route('https://vm.tiktok.com/@scout2015/video/6718335390845095173', {
        status: 200,
      });

    const result = await service.resolveRedirectChain(TIKTOK_SHORTLINK, {
      apiName: 'tiktok shortlink',
      functionName: 'test',
      allowHop: allowAnyHop,
    });

    expect(result.finalUrl).toBe(
      'https://vm.tiktok.com/@scout2015/video/6718335390845095173',
    );
  });

  it('stopAt が真になった時点でリクエストせず打ち切る', async () => {
    transport.route(TIKTOK_SHORTLINK, {
      status: 302,
      headers: { location: TIKTOK_VIDEO },
    });
    // TIKTOK_VIDEO のルートは**わざと登録しない**（叩いたら例外になる）

    const result = await service.resolveRedirectChain(TIKTOK_SHORTLINK, {
      apiName: 'tiktok shortlink',
      functionName: 'test',
      allowHop: allowAnyHop,
      stopAt: (url) => url.pathname.includes('/video/'),
    });

    expect(result.finalUrl).toBe(TIKTOK_VIDEO);
    expect(result.finalStatus).toBeNull();
    expect(transport.requests).toHaveLength(1);
  });

  /* ---------------------------------------------------------------- */
  /*  SSRF                                                            */
  /* ---------------------------------------------------------------- */

  it('リダイレクト先がループバックへ解決されたら拒否する（DNS rebinding）', async () => {
    transport
      .route(TIKTOK_SHORTLINK, {
        status: 302,
        headers: {
          location: 'https://www.tiktok.com/@a/video/1234567890123456789',
        },
      })
      // ホスト名は許可リストを通るのに、A レコードが 127.0.0.1 を指している
      .resolveHost('www.tiktok.com', [{ address: '127.0.0.1', family: 4 }])
      .route('https://www.tiktok.com/@a/video/1234567890123456789', {
        status: 200,
      });

    await expect(
      service.resolveRedirectChain(TIKTOK_SHORTLINK, {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
      }),
    ).rejects.toMatchObject({ kind: 'blocked_ip' });

    // 2 ホップ目のリクエストは**飛んでいない**（検証は接続前に行われる）
    expect(transport.requests).toHaveLength(1);
  });

  it('プライベート IP（10/8）へ解決されたら拒否する', async () => {
    transport
      .route(TIKTOK_SHORTLINK, {
        status: 302,
        headers: { location: 'https://internal.tiktok.com/@a/video/1' },
      })
      .resolveHost('internal.tiktok.com', [{ address: '10.0.0.5', family: 4 }]);

    await expect(
      service.resolveRedirectChain(TIKTOK_SHORTLINK, {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
      }),
    ).rejects.toMatchObject({ kind: 'blocked_ip' });
  });

  it('クラウドのメタデータサーバ（169.254.169.254）へ解決されたら拒否する', async () => {
    transport.resolveHost('vm.tiktok.com', [
      { address: '169.254.169.254', family: 4 },
    ]);

    await expect(
      service.resolveRedirectChain(TIKTOK_SHORTLINK, {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
      }),
    ).rejects.toMatchObject({ kind: 'blocked_ip' });

    expect(transport.requests).toHaveLength(0);
  });

  it('公開 IP が 1 つでも禁止レンジなら拒否する（全件検証）', async () => {
    transport.resolveHost('vm.tiktok.com', [
      { address: '93.184.216.34', family: 4 },
      { address: '::1', family: 6 },
    ]);

    await expect(
      service.resolveRedirectChain(TIKTOK_SHORTLINK, {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
      }),
    ).rejects.toMatchObject({ kind: 'blocked_ip' });
  });

  it('検証済みの IP へ接続する（ホスト名で解決し直さない）', async () => {
    transport
      .resolveHost('vm.tiktok.com', [{ address: '203.0.113.200', family: 4 }])
      .route(TIKTOK_SHORTLINK, { status: 200 });

    // 203.0.113.0/24 はドキュメント用レンジなので拒否される。
    // 「pin した IP が実際に使われている」ことを、拒否されること自体で示す
    await expect(
      service.resolveRedirectChain(TIKTOK_SHORTLINK, {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
      }),
    ).rejects.toMatchObject({ kind: 'blocked_ip' });

    transport.resolveHost('vm.tiktok.com', [
      { address: '93.184.216.34', family: 4 },
    ]);
    await service.resolveRedirectChain(TIKTOK_SHORTLINK, {
      apiName: 'tiktok shortlink',
      functionName: 'test',
      allowHop: allowAnyHop,
    });

    expect(transport.requests[0].pinnedAddress).toEqual({
      address: '93.184.216.34',
      family: 4,
    });
  });

  it('許可されないホップは拒否する', async () => {
    transport.route(TIKTOK_SHORTLINK, {
      status: 302,
      headers: { location: 'https://evil.example/collect' },
    });

    await expect(
      service.resolveRedirectChain(TIKTOK_SHORTLINK, {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: (url) => url.hostname.endsWith('.tiktok.com'),
      }),
    ).rejects.toMatchObject({ kind: 'host_not_allowed' });
  });

  it('https 以外のスキームへのリダイレクトを拒否する', async () => {
    transport.route(TIKTOK_SHORTLINK, {
      status: 302,
      headers: { location: 'http://www.tiktok.com/@a/video/1' },
    });

    await expect(
      service.resolveRedirectChain(TIKTOK_SHORTLINK, {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
      }),
    ).rejects.toMatchObject({ kind: 'scheme_not_allowed' });
  });

  it('認証情報つきの URL を拒否する', async () => {
    await expect(
      service.resolveRedirectChain('https://user:pass@vm.tiktok.com/ABC/', {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
      }),
    ).rejects.toMatchObject({ kind: 'credentials_in_url' });
  });

  it('非既定ポートを拒否する', async () => {
    await expect(
      service.resolveRedirectChain('https://vm.tiktok.com:8443/ABC/', {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
      }),
    ).rejects.toMatchObject({ kind: 'port_not_allowed' });
  });

  /* ---------------------------------------------------------------- */
  /*  リダイレクト上限                                                 */
  /* ---------------------------------------------------------------- */

  it('リダイレクト上限を超えたら拒否する', async () => {
    // 5 段のリダイレクトを作る。既定の上限は 3
    for (let i = 0; i < 6; i += 1) {
      transport.route(`https://vm.tiktok.com/hop${i}`, {
        status: 302,
        headers: { location: `https://vm.tiktok.com/hop${i + 1}` },
      });
    }

    await expect(
      service.resolveRedirectChain('https://vm.tiktok.com/hop0', {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
      }),
    ).rejects.toMatchObject({ kind: 'too_many_redirects' });

    // 上限 3 ＝ 追うのは 3 回まで。4 回目のリクエストで「まだリダイレクト」なら打ち切る
    expect(transport.requests).toHaveLength(
      SAFE_FETCH_DEFAULTS.maxRedirects + 1,
    );
  });

  it('上限ちょうどのリダイレクトは通す', async () => {
    for (let i = 0; i < 3; i += 1) {
      transport.route(`https://vm.tiktok.com/hop${i}`, {
        status: 302,
        headers: { location: `https://vm.tiktok.com/hop${i + 1}` },
      });
    }
    transport.route('https://vm.tiktok.com/hop3', { status: 200 });

    const result = await service.resolveRedirectChain(
      'https://vm.tiktok.com/hop0',
      {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
      },
    );

    expect(result.finalUrl).toBe('https://vm.tiktok.com/hop3');
  });

  it('Location の無いリダイレクトを拒否する', async () => {
    transport.route(TIKTOK_SHORTLINK, { status: 302 });

    await expect(
      service.resolveRedirectChain(TIKTOK_SHORTLINK, {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
      }),
    ).rejects.toMatchObject({ kind: 'redirect_without_location' });
  });

  /* ---------------------------------------------------------------- */
  /*  タイムアウト                                                     */
  /* ---------------------------------------------------------------- */

  it('応答が返らなければタイムアウトで打ち切る', async () => {
    transport.route(TIKTOK_SHORTLINK, { hangBeforeHeaders: true, status: 200 });

    await expect(
      service.resolveRedirectChain(TIKTOK_SHORTLINK, {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('名前解決に失敗したら dns_failed', async () => {
    transport.failingLookups.add('vm.tiktok.com');

    await expect(
      service.resolveRedirectChain(TIKTOK_SHORTLINK, {
        apiName: 'tiktok shortlink',
        functionName: 'test',
        allowHop: allowAnyHop,
      }),
    ).rejects.toMatchObject({ kind: 'dns_failed' });
  });
});

describe('SafeFetchService.fetchJson（衛生層 / oEmbed 経路）', () => {
  let transport: FakeSafeFetchTransport;
  let service: SafeFetchService;

  const OEMBED =
    'https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40a%2Fvideo%2F1';

  beforeEach(() => {
    transport = new FakeSafeFetchTransport();
    service = new SafeFetchService(transport, createLogger());
  });

  it('JSON を返す', async () => {
    transport.route(OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        title: 'ラーメン #ラーメン',
        author_name: '一蘭',
      }),
    });

    const payload = await service.fetchJson<{ title: string }>(OEMBED, {
      apiName: 'TikTok oEmbed',
      functionName: 'test',
    });

    expect(payload.title).toBe('ラーメン #ラーメン');
  });

  it('4xx は unexpected_status（ステータスを detail に載せる）', async () => {
    transport.route(OEMBED, {
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    await expect(
      service.fetchJson(OEMBED, {
        apiName: 'TikTok oEmbed',
        functionName: 'test',
      }),
    ).rejects.toMatchObject({
      kind: 'unexpected_status',
      detail: { status: 404 },
    });
  });

  it('5xx も unexpected_status', async () => {
    transport.route(OEMBED, {
      status: 503,
      headers: { 'content-type': 'text/html' },
      body: 'oops',
    });

    await expect(
      service.fetchJson(OEMBED, {
        apiName: 'TikTok oEmbed',
        functionName: 'test',
      }),
    ).rejects.toMatchObject({
      kind: 'unexpected_status',
      detail: { status: 503 },
    });
  });

  it('JSON でない Content-Type を拒否する', async () => {
    transport.route(OEMBED, {
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<html></html>',
    });

    await expect(
      service.fetchJson(OEMBED, {
        apiName: 'TikTok oEmbed',
        functionName: 'test',
      }),
    ).rejects.toMatchObject({ kind: 'unexpected_content_type' });
  });

  it('壊れた JSON を拒否する', async () => {
    transport.route(OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"title":',
    });

    await expect(
      service.fetchJson(OEMBED, {
        apiName: 'TikTok oEmbed',
        functionName: 'test',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_body' });
  });

  it('サイズ上限を超えたら打ち切る（Content-Length は信用しない）', async () => {
    transport.route(OEMBED, {
      status: 200,
      // ヘッダは小さいと言い張るが、実際には流し続ける
      headers: { 'content-type': 'application/json', 'content-length': '10' },
      bodyChunks: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
    });

    await expect(
      service.fetchJson(OEMBED, {
        apiName: 'TikTok oEmbed',
        functionName: 'test',
        maxResponseBytes: 100,
      }),
    ).rejects.toMatchObject({
      kind: 'response_too_large',
      detail: { maxResponseBytes: 100 },
    });

    // ソケットを開けっぱなしにしない
    expect(transport.destroyCount).toBeGreaterThan(0);
  });

  it('oEmbed の取得にもタイムアウトが効く（ヘッダは来たが本文が来ない）', async () => {
    transport.route(OEMBED, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyChunks: ['{"title":'],
      hangDuringBody: true,
    });

    await expect(
      service.fetchJson(OEMBED, {
        apiName: 'TikTok oEmbed',
        functionName: 'test',
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('固定エンドポイントのリダイレクトは追わない', async () => {
    transport.route(OEMBED, {
      status: 302,
      headers: { location: 'https://evil.example/' },
    });

    await expect(
      service.fetchJson(OEMBED, {
        apiName: 'TikTok oEmbed',
        functionName: 'test',
      }),
    ).rejects.toMatchObject({
      kind: 'unexpected_status',
      detail: { status: 302 },
    });
    expect(transport.requests).toHaveLength(1);
  });

  it('https 以外の固定エンドポイントを拒否する', async () => {
    await expect(
      service.fetchJson('http://www.tiktok.com/oembed', {
        apiName: 'TikTok oEmbed',
        functionName: 'test',
      }),
    ).rejects.toMatchObject({ kind: 'scheme_not_allowed' });
  });

  it('SafeFetchError は kind を持つ（呼び出し側はこれで縮退する）', async () => {
    transport.route(OEMBED, {
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    const error = await service
      .fetchJson(OEMBED, { apiName: 'TikTok oEmbed', functionName: 'test' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SafeFetchError);
  });
});
