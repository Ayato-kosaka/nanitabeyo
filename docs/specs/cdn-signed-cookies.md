# CDN 署名付き Cookie（動画配信の認可）

動画（HLS）を Cloud CDN から配信するための署名付き Cookie の**外部契約**。
クライアント実装者と CDN 運用者が読む。処理の流れはコードを見た方が早い（下記の実装位置を参照）。

## 実装位置

| 役割                 | 場所                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Cookie の生成・署名  | `api/src/core/storage/storage.service.ts`（`generateCdnSignedCookies`）                                        |
| レスポンスへの載せ方 | `api/src/core/cookie-queue/cookie-queue.service.ts` + `api/src/core/interceptors/response-wrap.interceptor.ts` |
| 発行のトリガー       | `api/src/v1/dish-media/dish-media.assembler.ts`（動画 entry を含むレスポンスで enqueue）                       |

## Cookie の契約

```
Cloud-CDN-Cookie=URLPrefix=<b64url>:Expires=<unixtime>:KeyName=<name>:Signature=<sig>;
  Domain=<CDN ホスト>; Path=/{env}/transcoded-video/; Max-Age=<TTL>;
  HttpOnly; Secure; SameSite=None; Partitioned
```

- **署名対象と Cookie 値で区切り文字が違う。** 署名は `&` 区切りの
  `URLPrefix=..&Expires=..&KeyName=..` を HMAC-SHA1 したもので、Cookie 値は同じ内容を `:` 区切りで表現する
- **スコープは `/{env}/transcoded-video/` 配下全体**であって、レコード単位ではない。
  master.m3u8・解像度別プレイリスト・セグメントを 1 枚の Cookie でカバーする
- `SameSite=None` はクロスサイト再生に必須で、`Secure` とセットでしか成立しない。
  `Partitioned` は Chrome のサードパーティ Cookie 分離（CHIPS）対応
- TTL は既定 600 秒。明示的な失効処理は行わず自然失効に任せる。
  クライアントは Cookie を更新するためにメディア一覧を取得し直す

## クライアント側の要件

- fetch / XHR は `credentials: 'include'` が必要
- 一覧のページネーションごとに新しい Cookie が発行される（想定挙動。古い Cookie は TTL で失効する）

## 環境変数

`api/src/core/config/env.ts` が正。`CDN_SIGNED_COOKIE_TTL_SECONDS` 以外はすべて必須で、
欠けると API は起動しない（CDN 無効時に署名付き URL へフォールバックする経路は無い）。

| 変数                                  | 用途                                       |
| ------------------------------------- | ------------------------------------------ |
| `CDN_HOST`                            | 動画・リサイズ画像の配信元ホスト           |
| `CDN_PUBLIC_HOST`                     | 認可不要な公開アセットの配信元ホスト       |
| `CDN_KEY_NAME` / `CDN_KEY_SECRET_B64` | Cloud CDN の署名鍵（名前と base64 秘密鍵） |
| `CDN_SIGNED_COOKIE_TTL_SECONDS`       | Cookie の TTL 秒。既定 600                 |

## CDN 側のセットアップ

```bash
# 1. 署名鍵を生成して Secret Manager へ
openssl rand -base64 32 > cdn-signing-key.txt
gcloud secrets create cdn-signing-key --data-file=cdn-signing-key.txt

# 2. backend service で署名付き URL / Cookie を有効化
gcloud compute backend-services update BACKEND_SERVICE --signed-url-cache-max-age=600s

# 3. 生成した鍵を CDN_KEY_NAME / CDN_KEY_SECRET_B64 として API へ渡す
```

## つまずいたとき

| 症状                             | 見るところ                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| レスポンスに Cookie が無い       | ログの `CdnConfigMissing`。対象 entry が `media_type=video` か                     |
| CDN が 403                       | Cookie の TTL 切れ、CDN 側の鍵不一致、Domain 不一致                                |
| クライアントが Cookie を送らない | `credentials: 'include'` の有無、Domain 不一致、`SameSite=None` 非対応クライアント |
