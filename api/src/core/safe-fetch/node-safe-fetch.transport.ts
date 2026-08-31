// api/src/core/safe-fetch/node-safe-fetch.transport.ts
//
// SafeFetchTransport の本番実装。**`fetch` ではなく `node:https` を使う。**
//
// #1399 独立レビュー M-6 のとおり、`fetch`（undici）では
// 「検証済みの IP へ接続しつつ、Host ヘッダと TLS SNI は元のホスト名にする」が書けない。
// `dispatcher` オプションを使うには `undici` を依存へ足す必要があり、`api/package.json` に無い。
//
// `node:https` なら `lookup` オプションを差し替えるだけで同じことができる。
// **`host` にホスト名を渡したまま名前解決だけを固定する**ので、`Host` ヘッダも SNI も
// Node が勝手に正しく設定する（IP を `host` に入れて Host/SNI を手で直す実装より事故りにくい）。

import { Injectable } from '@nestjs/common';
import * as dns from 'node:dns';
import * as https from 'node:https';

import {
  ResolvedAddress,
  SafeFetchError,
  SafeFetchTransport,
  SafeFetchTransportRequest,
  SafeFetchTransportResponse,
} from './safe-fetch.types';

@Injectable()
export class NodeSafeFetchTransport implements SafeFetchTransport {
  /**
   * ホスト名の **全ての** A / AAAA レコードを引く。
   *
   * `dns.lookup`（`getaddrinfo`）を使うのは、実際の接続でも同じ解決経路が使われるため。
   * `dns.resolve4/6` は OS の hosts ファイルや DNS64 を経由しないので、
   * 「検証した経路」と「接続する経路」がずれる。
   */
  async lookupAll(hostname: string): Promise<ResolvedAddress[]> {
    return new Promise((resolve, reject) => {
      dns.lookup(
        hostname,
        { all: true, verbatim: true },
        (error, addresses) => {
          if (error) {
            reject(
              new SafeFetchError(
                'dns_failed',
                `DNS lookup failed for ${hostname}`,
                { hostname },
              ),
            );
            return;
          }
          resolve(
            addresses.map((entry) => ({
              address: entry.address,
              family: entry.family === 6 ? 6 : 4,
            })),
          );
        },
      );
    });
  }

  async request(
    request: SafeFetchTransportRequest,
  ): Promise<SafeFetchTransportResponse> {
    const url = new URL(request.url);
    const pinned = request.pinnedAddress;

    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: request.method,
          headers: request.headers,
          // リダイレクトは自前で追う（`node:https` はそもそも追わない）
          signal: request.signal,
          // `servername` は既定でホスト名になるが、pin と一緒に読める位置に明示する
          servername: url.hostname,
          lookup: pinned
            ? (_hostname, _options, callback) => {
                // 検証済みの IP をそのまま返す。**ここで再解決しない**
                (
                  callback as (
                    err: NodeJS.ErrnoException | null,
                    address: string,
                    family: number,
                  ) => void
                )(null, pinned.address, pinned.family);
              }
            : undefined,
          agent: new https.Agent({ keepAlive: false }),
        },
        (res) => {
          const headers: Record<string, string | undefined> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            headers[key.toLowerCase()] = Array.isArray(value)
              ? value[0]
              : value;
          }

          resolve({
            status: res.statusCode ?? 0,
            headers,
            body: res,
            destroy: () => {
              res.destroy();
              req.destroy();
            },
          });
        },
      );

      req.on('error', (error: NodeJS.ErrnoException) => {
        if (error.name === 'AbortError' || request.signal.aborted) {
          reject(
            new SafeFetchError('timeout', 'Request aborted', {
              url: url.origin,
            }),
          );
          return;
        }
        reject(
          new SafeFetchError('network_error', error.message, {
            url: url.origin,
          }),
        );
      });

      req.end();
    });
  }
}
