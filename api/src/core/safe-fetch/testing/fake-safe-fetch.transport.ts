// api/src/core/safe-fetch/testing/fake-safe-fetch.transport.ts
//
// テスト用の `SafeFetchTransport`。**CI から実際の TikTok / YouTube を叩かないための土台。**
//
// 本番実装（`NodeSafeFetchTransport`）と差し替えられるように、ソケットに触る部分だけを
// この 1 か所へ寄せてある。ガードの分岐（許可ホスト・IP レンジ・リダイレクト上限・
// タイムアウト・サイズ上限）は `SafeFetchService` 側にあるので、ここを差し替えても
// 検査したい判断は本物のまま動く。

import {
  ResolvedAddress,
  SafeFetchTransport,
  SafeFetchTransportRequest,
  SafeFetchTransportResponse,
} from '../safe-fetch.types';

export type FakeRoute = {
  status: number;
  /** キーは小文字で書くこと */
  headers?: Record<string, string>;
  body?: string;
  /** 本文を分割して流す。サイズ上限の検査で使う */
  bodyChunks?: string[];
  /** ヘッダを返さずに黙り込む。タイムアウトの検査で使う */
  hangBeforeHeaders?: boolean;
  /** ヘッダは返すが本文が来ない。読み取り中のタイムアウトの検査で使う */
  hangDuringBody?: boolean;
};

export class FakeSafeFetchTransport implements SafeFetchTransport {
  /** ホスト名 → 名前解決の結果。未登録のホストは公開 IP を返す */
  readonly addresses = new Map<string, ResolvedAddress[]>();

  /** `https://host/path`（クエリ除く）→ 応答 */
  readonly routes = new Map<string, FakeRoute>();

  /** 実際に飛んだリクエスト。**「叩かれていないこと」の検査にも使う** */
  readonly requests: SafeFetchTransportRequest[] = [];

  /** 本文を読み切る前に打ち切られた回数 */
  destroyCount = 0;

  /** 名前解決が失敗するホスト */
  readonly failingLookups = new Set<string>();

  route(url: string, route: FakeRoute): this {
    this.routes.set(this.key(url), route);
    return this;
  }

  resolveHost(hostname: string, addresses: ResolvedAddress[]): this {
    this.addresses.set(hostname, addresses);
    return this;
  }

  lookupAll(hostname: string): Promise<ResolvedAddress[]> {
    if (this.failingLookups.has(hostname)) {
      return Promise.reject(new Error(`getaddrinfo ENOTFOUND ${hostname}`));
    }
    // 既定は公開 IP（example.com のもの）。個別に汚したいテストだけ `resolveHost` する
    return Promise.resolve(
      this.addresses.get(hostname) ?? [{ address: '93.184.216.34', family: 4 }],
    );
  }

  request(
    request: SafeFetchTransportRequest,
  ): Promise<SafeFetchTransportResponse> {
    this.requests.push(request);

    const route = this.routes.get(this.key(request.url));
    if (route === undefined) {
      return Promise.reject(
        new Error(`FakeSafeFetchTransport: no route for ${request.url}`),
      );
    }

    if (route.hangBeforeHeaders) {
      return new Promise<SafeFetchTransportResponse>((_resolve, reject) => {
        // 本物のソケットが abort されたときと同じく、素の Error で落ちる。
        // これを `timeout` へ写せるかどうかが SafeFetchService 側の責務
        request.signal.addEventListener('abort', () =>
          reject(new Error('socket hang up')),
        );
      });
    }

    const chunks =
      route.bodyChunks ?? (route.body === undefined ? [] : [route.body]);
    const hangDuringBody = route.hangDuringBody === true;

    const body = (async function* () {
      for (const chunk of chunks) {
        yield Buffer.from(chunk, 'utf8');
      }
      if (hangDuringBody) {
        await new Promise<void>((resolve) => {
          request.signal.addEventListener('abort', () => resolve());
        });
        throw new Error('aborted');
      }
    })();

    return Promise.resolve({
      status: route.status,
      headers: route.headers ?? {},
      body,
      destroy: () => {
        this.destroyCount += 1;
      },
    });
  }

  private key(url: string): string {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  }
}
