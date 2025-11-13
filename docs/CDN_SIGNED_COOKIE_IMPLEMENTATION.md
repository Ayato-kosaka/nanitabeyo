# 動画メディア向けCDN署名付きURL実装

## 概要

この実装では、動画の再生にCDN署名付きURL（URLPrefix方式）による認証を追加した。動画はHLS（HTTP Live Streaming）で配信され、`master.m3u8` → セグメントプレイリスト → `.ts` セグメントと複数のファイルへアクセスする必要がある。URLPrefix方式の署名付きURLは特定のURLプレフィックス配下のファイルをまとめて保護でき、クライアント側でHLSの全リクエストに署名パラメータを付与することで動画再生を可能にする。

> **注**: 以前はCookie方式を使用していたが、Media CDNの仕様上、HLSのセグメントファイルアクセス時にCookieが適切に送信されない問題があったため、署名付きURL方式に移行した。

## アーキテクチャ

### 構成要素

1. **環境変数設定** (`api/src/core/config/env.ts`)
   - `CDN_HOST`: CDNドメイン（例: `cdn.example.com`）
   - `CDN_KEY_NAME`: 署名に使用するキー名
   - `CDN_KEY_SECRET_B64`: Base64エンコードした秘密鍵
   - `CDN_SIGNED_COOKIE_TTL_SECONDS`: CookieのTTL（デフォルト600秒/10分）

2. **署名付きURL生成** (`api/src/core/storage/storage.service.ts`)
   - `generateCdnSignedURL()`: Cloud CDNの署名付きURLを生成（URLPrefix方式）
   - HMAC-SHA1署名とBase64 URLセーフエンコードを使用
   - URLパラメータ形式: `?URLPrefix=<base64url>&Expires=<timestamp>&KeyName=<key>&Signature=<sig>`
   - URLPrefix方式により、プレフィックス配下の全ファイルに同じ署名パラメータでアクセス可能

3. **メディアURL生成** (`api/src/v1/dish-media/dish-media.assembler.ts`)
   - `getMediaUrl()`: 動画メディアを検出し、署名付きCDN URLを生成
   - 動画の場合: `https://{CDN_HOST}/{env}/transcoded/dish_media/media_path/{recordId}/master.m3u8?URLPrefix=...&Expires=...&KeyName=...&Signature=...`
   - 画像の場合: 従来通りGCSの署名付きURLを使用
   - 署名パラメータは`urlPrefix: true`オプションで生成（URLPrefix方式）

4. **クライアント側のHLS再生対応**
   - **Web** (`app-expo/components/VideoPlayer.web.tsx`):
     - hls.jsの`xhrSetup`コールバックで全HTTPリクエストに署名パラメータを付与
     - master.m3u8から署名パラメータ（URLPrefix, Expires, KeyName, Signature）を抽出
     - セグメントプレイリスト、TSセグメントファイルの全リクエストに署名パラメータを自動追加
     - Safari: ネイティブHLS再生でURLパラメータを自動伝播
   - **Native** (`app-expo/components/VideoPlayer.tsx`):
     - expo-videoのネイティブプレイヤーがURLパラメータを自動的に子リソースに伝播
     - 追加の実装不要

## 署名付きURLの形式

### URL構造

master.m3u8のURLに署名パラメータが付与される形式。

```
https://cdn.example.com/{env}/transcoded/dish_media/media_path/{recordId}/master.m3u8?URLPrefix=<base64url>&Expires=<timestamp>&KeyName=<key>&Signature=<sig>
```

### 署名パラメータ

- **URLPrefix**: Base64 URLエンコードされたプレフィックスパス（例: `https://cdn.example.com/prod/transcoded/dish_media/media_path/abc123/`）
- **Expires**: Unix タイムスタンプ（有効期限）
- **KeyName**: CDNに登録された署名鍵の名前
- **Signature**: HMAC-SHA1署名（Base64 URLセーフエンコード）

### 署名対象

URLPrefix方式では、以下の文字列（&区切り）を署名対象とする:

```
URLPrefix=<base64url>&Expires=<timestamp>&KeyName=<key>
```

### 例

```
https://cdn.example.com/prod/transcoded/dish_media/media_path/abc123/master.m3u8?URLPrefix=aHR0cHM6Ly9jZG4uZXhhbXBsZS5jb20vcHJvZC90cmFuc2NvZGVkL2Rpc2hfbWVkaWEvbWVkaWFfcGF0aC9hYmMxMjMv&Expires=1760483243&KeyName=my-key&Signature=BnNrXpMt4ul7kQciSaqt1dUOoG4
```

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

### 署名付きURLのスコープ

URLPrefix方式の署名により、以下のファイルへアクセスできる。

- `master.m3u8`
- すべての解像度プレイリスト（例: `720p.m3u8`）
- パス配下のすべての動画セグメント

クライアント側（hls.js等）が署名パラメータを子リソースのリクエストに付与することで、プレフィックス配下の全ファイルが同じ署名でアクセス可能。

## APIエンドポイント

### 署名付きURLを返すエンドポイント

動画を含むディッシュメディアを返すエンドポイントでは、署名付きURLを`mediaUrl`フィールドに含める。

1. **GET /v1/users/me/saved-dish-media**
   - 保存済みディッシュメディアを返却
   - 動画の`mediaUrl`に署名付きURLを設定

2. **GET /v1/users/me/liked-dish-media**
   - いいね済みディッシュメディアを返却
   - 動画の`mediaUrl`に署名付きURLを設定

3. **GET /v1/users/:id/dish-reviews**
   - ユーザーのレビューとメディアを返却
   - 動画の`mediaUrl`に署名付きURLを設定

4. **GET /v1/dish-media?ids=...**
   - ID指定でディッシュメディアを取得
   - 動画の`mediaUrl`に署名付きURLを設定

5. **GET /v1/dish-media/search**
   - ディッシュメディア検索結果を返却
   - 動画の`mediaUrl`に署名付きURLを設定

6. **GET /v1/restaurants/:id/dish-media**
   - 店舗のディッシュメディアを返却
   - 動画の`mediaUrl`に署名付きURLを設定

### レスポンスの挙動

- `mediaUrl`フィールドに署名付きURLを含む
- 署名パラメータはURL自体に含まれるため、追加のヘッダー不要
- CDN設定が存在する場合にのみ署名付きURLを生成
- CDNが未設定の場合はGCS署名付きURLにフォールバック

## セキュリティの考慮事項

### 署名の安全性

- HMAC-SHA1と秘密鍵を使用
- 署名対象: `URLPrefix + Expires + KeyName`（&区切り）
- Base64のURLセーフ変換（`+`→`-`、`/`→`_`、`=`を削除）
- 署名が不正な場合、CDNが403を返却

### TTL戦略

- デフォルトTTL: 24時間（86400秒）
- URLに有効期限が含まれるため、期限切れ後は自動的にアクセス不可
- クライアントはURL更新のためにメディア一覧を再取得する必要がある
- 自然失効により明示的な失効処理は不要

### URLの分離

- 署名はrecordId単位のURLプレフィックスに対して生成
- ユーザーは権限のある動画のURLのみを取得
- URLベースの制限により他レコードへのアクセスを防止
- URLが漏洩しても有効期限により被害を限定化

## 設定

### 開発環境

```
# api/ ディレクトリの .env
CDN_HOST=cdn.example.com
CDN_KEY_NAME=dev-signing-key
CDN_KEY_SECRET_B64=<base64-encoded-secret>
```

### 本番環境

デプロイ時の環境変数として設定する。

- Google Cloud Runのシークレット
- GitHub Actionsのワークフローバリアブル
- 環境（dev/staging/prod）ごとに設定

## クライアント統合

### Web（hls.js使用）

```typescript
// app-expo/components/VideoPlayer.web.tsx の実装
// master.m3u8のURLから署名パラメータを抽出
const extractSignatureParams = (url: string): URLSearchParams => {
	const u = new URL(url);
	const params = new URLSearchParams();
	const keys = ["URLPrefix", "Expires", "KeyName", "Signature"];
	keys.forEach((key) => {
		const val = u.searchParams.get(key);
		if (val) params.set(key, val);
	});
	return params;
};

const signatureParams = extractSignatureParams(uri);

// hls.jsの設定で全リクエストに署名パラメータを付与
const hls = new Hls({
	xhrSetup: (xhr, url) => {
		if (signatureParams.toString()) {
			const targetUrl = new URL(url);
			signatureParams.forEach((value, key) => {
				if (!targetUrl.searchParams.has(key)) {
					targetUrl.searchParams.set(key, value);
				}
			});
			// xhr.openをフックしてURLを置換
			const originalOpen = xhr.open;
			xhr.open = function (method: string, requestUrl: string | URL, ...args: any[]) {
				return originalOpen.call(this, method, targetUrl.toString(), ...args);
			};
		}
	},
});
```

### Web（Safari ネイティブHLS）

```typescript
// Safari ではネイティブ HLS サポートにより、video 要素に直接 src を設定
// ブラウザが自動的にセグメントリクエストにパラメータを伝播
<video src={signedUrl} controls autoPlay />
```

### モバイル（React Native + expo-video）

```typescript
// expo-video のネイティブプレイヤーがURLパラメータを自動的に伝播
// 追加の実装不要
import { useVideoPlayer, VideoView } from "expo-video";

const player = useVideoPlayer(signedUrl, (player) => {
	player.play();
});

<VideoView player={player} />;
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
2. `/v1/dish-media/search` などのエンドポイントを叩く
3. レスポンスの`mediaUrl`に署名パラメータが含まれることを確認
4. URLに`URLPrefix`, `Expires`, `KeyName`, `Signature`が含まれることを検証
5. `mediaUrl`へアクセスして動画が再生できることを確認
6. TTLを過ぎた後にアクセスし403になることを確認

### 署名検証スクリプト

署名付きURL生成を検証するスクリプト例:

```javascript
const crypto = require("crypto");

const env = {
	CDN_HOST: "cdn.example.com",
	CDN_KEY_NAME: "test-key",
	CDN_KEY_SECRET_B64: Buffer.from("test-secret").toString("base64"),
};

function generateCdnSignedURL(url, ttlSeconds = 86400) {
	const keySecret = Buffer.from(env.CDN_KEY_SECRET_B64, "base64");
	const expires = Math.floor(Date.now() / 1000) + ttlSeconds;

	// URLプレフィックスを正規化
	const u = new URL(url);
	const parts = u.pathname.split("/");
	if (parts.length && parts[parts.length - 1] !== "") {
		parts.pop(); // ファイル名を削除
	}
	u.pathname = parts.join("/") + "/";
	u.search = "";
	u.hash = "";
	const prefix = u.toString();

	// Base64 URLエンコード
	const urlPrefixB64url = Buffer.from(prefix, "utf8")
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	// 署名対象文字列（&区切り）
	const policy = `URLPrefix=${urlPrefixB64url}&Expires=${expires}&KeyName=${env.CDN_KEY_NAME}`;

	// HMAC-SHA1署名
	const signature = crypto
		.createHmac("sha1", keySecret)
		.update(policy)
		.digest("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	// 元のURLにパラメータ追加
	const originalUrl = new URL(url);
	return `${originalUrl.toString()}${originalUrl.search ? "&" : "?"}${policy}&Signature=${signature}`;
}

// テスト実行
const testUrl = "https://cdn.example.com/prod/transcoded/dish_media/media_path/abc123/master.m3u8";
const signedUrl = generateCdnSignedURL(testUrl);
console.log(signedUrl);
```

## 監視

### 重要なメトリクス

- 署名付きURL生成の成功/失敗率
- CDNから返却される403（署名エラー）
- TTLの有効期限パターン
- 動画再生の成功率

### ログ

すべての署名付きURL関連処理は`AppLoggerService`で記録される。

- `CdnSignedURLGenerated`: 生成に成功
- `CdnConfigMissing`: CDN設定が不足している
- 署名エラーはCDN側で発生し、クライアントに403として返却

### ログ例

```json
{
	"event": "CdnSignedURLGenerated",
	"context": "generateCdnSignedURL",
	"data": {
		"mode": "URLPrefix",
		"prefix": "https://cdn.example.com/prod/transcoded/dish_media/media_path/abc123/",
		"expires": "2025-10-14T23:17:23.000Z",
		"preview": "https://cdn.example.com/prod/transcoded/dish_media/media_path/abc123/master.m3u8?URLPrefix=..."
	}
}
```

## トラブルシューティング

### 課題: mediaUrlに署名パラメータが含まれない

- CDN関連の環境変数が設定されているか確認
- ログに`CdnConfigMissing`が出力されていないか確認
- レスポンスのメディアが`media_type=video`になっているか確認

### 課題: CDNから403が返る

- URLの署名が正しいか検証
- URLのTTLが切れていないか確認
- CDNに正しい署名鍵が設定されているか確認
- URLのプレフィックスがCDNドメインと一致しているか確認

### 課題: HLSセグメントファイルで403が返る

- クライアント側（hls.js）が署名パラメータを付与しているか確認
- ブラウザの開発者ツールでネットワークタブを確認し、セグメントリクエストに署名パラメータが含まれているか検証
- Safari の場合、ネイティブHLSが署名パラメータを自動伝播しているか確認

### 課題: 動画が再生されない

- `VideoPlayer.web.tsx`の`xhrSetup`が正しく実装されているか確認
- master.m3u8から署名パラメータが正しく抽出されているか確認
- コンソールログで署名パラメータの内容を確認

## 今後の拡張

1. **URLの事前更新**: 有効期限前にクライアント側で更新する仕組み
2. **署名キャッシュ**: 同じプレフィックスに対する署名の再利用
3. **分析基盤**: URL利用状況や期限切れを可視化
4. **レート制限**: ユーザー/IPごとのURL生成回数を制限
5. **モニタリングダッシュボード**: メトリクスの可視化

## 参考資料

- [Cloud CDN Signed URLs Documentation](https://cloud.google.com/cdn/docs/using-signed-urls)
- [URLPrefix方式の署名](https://cloud.google.com/cdn/docs/using-signed-urls#url-prefix)
- [HLS.js Documentation](https://github.com/video-dev/hls.js/)
- [expo-video Documentation](https://docs.expo.dev/versions/latest/sdk/video/)
