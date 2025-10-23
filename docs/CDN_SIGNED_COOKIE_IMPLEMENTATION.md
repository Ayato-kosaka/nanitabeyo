# 動画メディア向けCDN署名付きCookie実装

## 概要

この実装では、動画の再生にCDN署名付きCookieによる認証を追加した。動画はHLS（HTTP Live Streaming）で配信され、`master.m3u8` → セグメントプレイリスト → `.ts` セグメントと複数のファイルへアクセスする必要がある。単一ファイルだけを保護する署名付きURLとは異なり、CDN署名付きCookieは特定のURLプレフィックス配下のファイルをまとめて保護できる。

## アーキテクチャ

### 構成要素

1. **環境変数設定** (`api/src/core/config/env.ts`)
   - `CDN_HOST`: CDNドメイン（例: `cdn.example.com`）
   - `CDN_KEY_NAME`: 署名に使用するキー名
   - `CDN_KEY_SECRET_B64`: Base64エンコードした秘密鍵
   - `CDN_SIGNED_COOKIE_TTL_SECONDS`: CookieのTTL（デフォルト600秒/10分）

2. **Cookie生成** (`api/src/core/storage/storage.service.ts`)
   - `generateCdnSignedCookies()`: Cloud CDNの署名付きCookieを生成
   - HMAC-SHA1署名とBase64 URLセーフエンコードを使用
   - Cookie値の形式: `URLPrefix=<url>&Expires=<timestamp>&KeyName=<key>&Signature=<sig>`
   - Cookie属性: `Domain`, `Path`, `Max-Age`, `HttpOnly`, `Secure`, `SameSite=None`

3. **メディアURL生成** (`api/src/v1/dish-media/dish-media.service.ts`)
   - `fetchDishMediaEntryItems()`: 動画メディアを検出し、CDNのURLを生成
   - 動画の場合: `https://{CDN_HOST}/{env}/transcoded/dish_media/media_path/{recordId}/master.m3u8`
   - 画像の場合: 従来通りGCSの署名付きURLを使用
   - データ本体に加えて必要に応じてCDN Cookieを返却

4. **コントローラーへの組み込み**
   - `UsersController`: 保存済み/いいね済みのディッシュメディアAPIでCookieを設定
   - `DishMediaController`: 検索およびID指定取得のエンドポイントでCookieを設定
   - `RestaurantsController`: 店舗のディッシュメディア取得でCookieを設定
  
   - NestJSの`@Res({ passthrough: true })`で`Set-Cookie`ヘッダーを付与

## Cookieの形式

### Cookie構造

Cookie名は`Cloud-CDN-Cookie`で、値はコロン区切りのフィールドで構成される。

```
Cloud-CDN-Cookie=URLPrefix=<url>:Expires=<timestamp>:KeyName=<key>:Signature=<sig>; Domain=<cdn-host>; Path=<path>; Max-Age=<ttl>; HttpOnly; Secure; SameSite=None
```

※署名は`URLPrefix=<url>&Expires=<timestamp>&KeyName=<key>`というアンパサンド区切りの文字列を対象に計算するが、Cookie値はコロン区切りで表現する。

### 例

```
Cloud-CDN-Cookie=URLPrefix=https://cdn.example.com/prod/transcoded/dish_media/media_path/abc123/:Expires=1760483243:KeyName=my-key:Signature=BnNrXpMt4ul7kQciSaqt1dUOoG4=; Domain=cdn.example.com; Path=/prod/transcoded/dish_media/media_path/abc123/; Max-Age=600; HttpOnly; Secure; SameSite=None
```

### Cookie属性

- **Domain**: `cdn.example.com`（CDNドメインに限定）
- **Path**: `/{env}/transcoded/dish_media/media_path/{recordId}/`（個別動画のディレクトリに限定）
- **Max-Age**: `600`（デフォルトTTLは10分）
- **HttpOnly**: JavaScriptからのアクセスを遮断
- **Secure**: HTTPS通信のみで送信
- **SameSite=None**: クロスサイト動画再生に必要

## URLパス構造

### 動画ファイル

```
https://cdn.example.com/{env}/transcoded/dish_media/media_path/{recordId}/
├── master.m3u8          # master.m3u8はAPIレスポンスのmediaUrlとして返却
├── 720p.m3u8            # 解像度別プレイリスト
├── 480p.m3u8            # 解像度別プレイリスト
└── segments/
    ├── 720p_00001.ts    # 動画セグメント
    ├── 720p_00002.ts
    └── ...
```

### Cookieのスコープ

`Path`属性をディレクトリパスに設定することで、以下のファイルへアクセスできる。

- `master.m3u8`
- すべての解像度プレイリスト（例: `720p.m3u8`）
- パス配下のすべての動画セグメント

## APIエンドポイント

### Cookieを設定するエンドポイント

動画を含むディッシュメディアを返すエンドポイントでは、署名付きCookieをレスポンスに含める。

1. **GET /v1/users/me/saved-dish-media**
   - 保存済みディッシュメディアを返却
   - レスポンスの動画ごとにCookieを設定

2. **GET /v1/users/me/liked-dish-media**
   - いいね済みディッシュメディアを返却
   - レスポンスの動画ごとにCookieを設定

3. **GET /v1/users/:id/dish-reviews**
   - ユーザーのレビューとメディアを返却
   - レスポンスの動画ごとにCookieを設定

4. **GET /v1/dish-media?ids=...**
   - ID指定でディッシュメディアを取得
   - レスポンスの動画ごとにCookieを設定

5. **GET /v1/dish-media/search**
   - ディッシュメディア検索結果を返却
   - レスポンスの動画ごとにCookieを設定

6. **GET /v1/restaurants/:id/dish-media**
   - 店舗のディッシュメディアを返却
   - レスポンスの動画ごとにCookieを設定

### レスポンスの挙動

- `Set-Cookie`ヘッダーを複数返却（1動画につき1Cookie）
- CDN設定が存在する場合にのみCookieを設定
- CDNが未設定の場合はGCS署名付きURLにフォールバック
- DTOには`mediaUrl`（CDN URL）のみを含め、Cookieはヘッダーで提供

## セキュリティの考慮事項

### Cookie属性

- **HttpOnly**: XSS対策のためJavaScriptからアクセス不可
- **Secure**: HTTPS通信でのみ送信
- **SameSite=None**: クロスオリジン再生に必要。設定時は`Secure`が必須

### TTL戦略

- デフォルトTTL: 10分（600秒）
- 短時間TTLで漏えいリスクを最小化
- クライアントはCookie更新のためにメディア一覧を再取得する必要がある
- 自然失効により明示的な失効処理は不要

### 署名の安全性

- HMAC-SHA1と秘密鍵を使用
- 署名対象: `URLPrefix + Expires + KeyName`
- Base64のURLセーフ変換（`+`/`=`→`-`/`_`）
- 署名が不正な場合、CDNが403を返却

### パスの分離

- Cookieは各`recordId`のパス単位でスコープを設定
- ユーザーは権限のある動画にのみアクセス可能
- パスベースの制限により他レコードへのアクセスを防止

## 設定

### 開発環境

```
# api/ ディレクトリの .env
CDN_HOST=cdn.example.com
CDN_KEY_NAME=dev-signing-key
CDN_KEY_SECRET_B64=<base64-encoded-secret>
CDN_SIGNED_COOKIE_TTL_SECONDS=600
```

### 本番環境

デプロイ時の環境変数として設定する。

- Google Cloud Runのシークレット
- GitHub Actionsのワークフローバリアブル
- 環境（dev/staging/prod）ごとに設定

## クライアント統合

### Web（React / Next.js）

```typescript
// Cookieを受け取るためにcredentialsをinclude
const response = await fetch("/v1/users/me/saved-dish-media", {
        credentials: "include",
});

const data = await response.json();

// HLSプレイヤーでmediaUrlをそのまま利用
data.items.forEach((item) => {
        if (item.dish_media.media_type === "video") {
                // ブラウザがHLSリクエスト時にCookieを自動送信
                player.src = item.dish_media.mediaUrl;
        }
});
```

### モバイル（React Native + expo-av）

```typescript
// Cookieを受け取るためにcredentialsをinclude
const response = await fetch('/v1/users/me/saved-dish-media', {
  credentials: 'include'
});

const data = await response.json();

// expo-avのVideoコンポーネントで再生
data.items.forEach(item => {
  if (item.dish_media.media_type === 'video') {
    // expo-avが自動的にCookieを送信
    <Video source={{ uri: item.dish_media.mediaUrl }} />
  }
});
```

## CDNの設定

### Cloud CDNの準備

1. 署名鍵の生成:

```bash
# 秘密鍵を生成
openssl rand -base64 32 > cdn-signing-key.txt

# Secret Managerに保存
gcloud secrets create cdn-signing-key \
  --data-file=cdn-signing-key.txt
```

2. Cloud CDNを署名付きURL/Cookie対応で設定:

```bash
# 署名付きURL/署名付きCookieを有効化
gcloud compute backend-services update BACKEND_SERVICE \
  --signed-url-cache-max-age=600s
```

3. 環境変数へ登録:

```bash
# 環境変数を設定
export CDN_HOST=cdn.example.com
export CDN_KEY_NAME=primary-key
export CDN_KEY_SECRET_B64=$(cat cdn-signing-key.txt)
```

## テスト

### 手動テスト

1. CDN設定を有効にした状態でAPIサーバーを起動
2. `/v1/users/me/saved-dish-media` などのエンドポイントを叩く
3. レスポンスヘッダーに動画用`Set-Cookie`が含まれることを確認
4. Domain / Path / HttpOnly / Secure / SameSiteなどの属性を検証
5. `mediaUrl`へアクセスして動画が再生できることを確認
6. TTLを過ぎた後にアクセスし403になることを確認

### Cookie検証スクリプト

Cookie生成を検証するスクリプト例:

```javascript
const crypto = require("crypto");

const env = {
        CDN_HOST: "cdn.example.com",
        CDN_KEY_NAME: "test-key",
        CDN_KEY_SECRET_B64: Buffer.from("test-secret").toString("base64"),
        CDN_SIGNED_COOKIE_TTL_SECONDS: 600,
};

function generateCdnSignedCookies(urlPrefix, recordId) {
        const keySecret = Buffer.from(env.CDN_KEY_SECRET_B64, "base64");
        const expires = Math.floor(Date.now() / 1000) + env.CDN_SIGNED_COOKIE_TTL_SECONDS;

        // 署名は&区切りの文字列に対して生成
        const toSign = `URLPrefix=${urlPrefix}&Expires=${expires}&KeyName=${env.CDN_KEY_NAME}`;
        const signature = crypto
                .createHmac("sha1", keySecret)
                .update(toSign)
                .digest("base64")
                .replace(/\+/g, "-")
                .replace(/\//g, "_");

        const urlObj = new URL(urlPrefix);
        const cookiePath = urlObj.pathname;

        // Cookie値は:区切りで表現
        return [
                `Cloud-CDN-Cookie=URLPrefix=${urlPrefix}:Expires=${expires}:KeyName=${env.CDN_KEY_NAME}:Signature=${signature}; Domain=${env.CDN_HOST}; Path=${cookiePath}; Max-Age=${env.CDN_SIGNED_COOKIE_TTL_SECONDS}; HttpOnly; Secure; SameSite=None`,
        ];
}

// テスト実行
const testRecordId = "123e4567-e89b-12d3-a456-426614174000";
const testUrl = `https://cdn.example.com/prod/transcoded/dish_media/media_path/${testRecordId}/`;
const cookies = generateCdnSignedCookies(testUrl, testRecordId);
console.log(cookies);
```

## 監視

### 重要なメトリクス

- Cookie生成の成功/失敗率
- CDNから返却される403（署名エラー）
- TTLの有効期限パターン
- 1リクエストあたりのCookie発行数

### ログ

すべてのCookie関連処理は`AppLoggerService`で記録される。

- `CdnSignedCookiesGenerated`: 生成に成功
- `CdnConfigMissing`: CDN設定が不足している
- `CdnSignedCookieError`: 生成中にエラー発生

### ログ例

```json
{
        "event": "CdnSignedCookiesGenerated",
        "context": "generateCdnSignedCookies",
        "data": {
                "urlPrefix": "https://cdn.example.com/prod/transcoded/dish_media/media_path/abc123/",
                "recordId": "abc123",
                "expires": "2025-10-14T23:17:23.000Z",
                "cookieCount": 1
        }
}
```

## トラブルシューティング

### 課題: レスポンスにCookieが含まれない

- CDN関連の環境変数が設定されているか確認
- ログに`CdnConfigMissing`が出力されていないか確認
- レスポンスのメディアが`media_type=video`になっているか確認

### 課題: CDNから403が返る

- Cookieの署名が正しいか検証
- CookieのTTLが切れていないか確認
- CDNに正しい署名鍵が設定されているか確認
- CookieのDomainがCDNドメインと一致しているか確認

### 課題: クライアントがCookieを送信しない

- fetch時に`credentials: 'include'`が指定されているか確認
- Cookieの属性（特にSecure）が要件を満たしているか確認
- CookieのDomainがリクエストドメインと一致しているか確認
- SameSite=Noneをサポートしていないクライアントでないか確認

### 課題: 同じrecordIdでCookieが複数発行される

- ページネーション時は想定される挙動
- リスト取得ごとに新しいCookieが生成される
- 古いCookieはTTLで自然に失効
- 必要であれば`Max-Age=0`のCookieで明示的に削除

## 今後の拡張

1. **Cookieの事前更新**: 有効期限前にクライアント側で更新する仕組み
2. **バッチ最適化**: Cookie数を減らすためのパス共有
3. **分析基盤**: Cookie利用状況や期限切れを可視化
4. **レート制限**: ユーザー/IPごとのCookie発行回数を制限
5. **モニタリングダッシュボード**: メトリクスの可視化

## 参考資料

- [Cloud CDN Signed Cookies Documentation](https://cloud.google.com/cdn/docs/using-signed-cookies)
- [HTTP Cookie Specification (RFC 6265)](https://tools.ietf.org/html/rfc6265)
- [SameSite Cookie Attribute](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite)
