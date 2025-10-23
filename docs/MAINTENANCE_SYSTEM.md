# メンテナンス / 強制アップデート制御システム

このドキュメントでは、GCSの設定ファイルを利用して nanitabeyo アプリ全体のメンテナンスモードおよびアプリの最低サポートバージョンを制御する仕組みを説明する。

## 概要

システムは以下の2要素で構成される。

1. **バックエンド**: メンテナンス状態とアプリバージョンを判定するグローバルガード
2. **フロントエンド**: ヘルスチェックとエラーハンドリングでメンテナンス/バージョン警告を表示

## バックエンド実装

### MaintenanceGuard

`api/src/core/guards/maintenance.guard.ts` に配置されたグローバルガードで、以下を行う。

- GCS設定から `is_maintenance` と `minimum_supported_version` を取得
- メンテナンス中はHTTP 503を返す
- 最低バージョン未満の場合はHTTP 426を返す
- `X-App-Version` ヘッダーがないリクエストは許可
- `/metrics` など重要なパスは除外
- GCS設定が取得できない場合はフェイルオープンで処理を継続

### ヘルスチェックエンドポイント

`/health` エンドポイントを新設。

- 軽量なヘルスチェックを提供
- MaintenanceGuard のチェック対象（例外ではない）
- 通常時は200を返す
- メンテナンス/バージョン条件で503/426を返す

### 設定キャッシュ

`RemoteConfigService` にキャッシュ機構を追加。

- TTLは5分
- GCS API呼び出しを削減
- 自動的にキャッシュを無効化

## フロントエンド実装

### ヘルスチェックフック

`app-expo/hooks/useHealthCheck.ts` が担当。

- アプリ起動時に非同期でヘルスチェック
- UI描画をブロックしない
- HTTP 503/426 を検出してダイアログを表示
- ダイアログ状態を適切に管理

### APIエラーハンドリング強化

`app-expo/hooks/useAPICall.ts` の機能。

- HTTP 503: メンテナンスダイアログを表示
- HTTP 426: 強制アップデートダイアログとストア遷移
- 既存の403エラーとの互換性を維持

### 統合ポイント

ヘルスチェックは `HealthCheckInitializer` コンポーネント経由でアプリ起動時に実行。

- プロバイダー初期化後に実行
- UIをブロックしない

## 設定

### GCS構成値

静的マスターデータから以下を読み取る。

```json
{
  "is_maintenance": "true" | "false",
  "minimum_supported_version": "1.0.0" // SemVer形式
}
```

### 環境変数

APIで必要な環境変数。

- `GCS_BUCKET_NAME`: 静的マスターファイルを格納するバケット
- `GCS_STATIC_MASTER_DIR_PATH`: バケット内のディレクトリパス

## テスト手順

### 1. メンテナンスモード

1. GCS設定の `is_maintenance` を `"true"` にする
2. `X-App-Version` ヘッダー付きでAPIを呼び出す
3. HTTP 503 が返ることを確認
4. フロントエンドでメンテナンスダイアログが表示されることを確認

### 2. バージョン制御

1. GCS設定の `minimum_supported_version` を `"2.0.0"` にする
2. `X-App-Version: "1.5.0"` でAPIを呼び出す
3. HTTP 426 が返ることを確認
4. フロントエンドでアップデートダイアログが表示され、ストアへ遷移できることを確認

### 3. ヘルスエンドポイント

```bash
# 通常
curl -H "X-App-Version: 2.0.0" http://localhost:3000/health
# 期待: 200 OK

# メンテナンス中（is_maintenance: "true"）
curl -H "X-App-Version: 2.0.0" http://localhost:3000/health
# 期待: 503 Service Unavailable

# 最低バージョン未満（minimum_supported_version > X-App-Version）
curl -H "X-App-Version: 1.0.0" http://localhost:3000/health
# 期待: 426 Upgrade Required

# バージョンヘッダーなし（許可される）
curl http://localhost:3000/health
# 期待: 200 OK
```

### 4. フェイルオープンの確認

1. GCSアクセスや設定フォーマットを意図的に壊す
2. APIが引き続き動作し、警告ログのみ出力されることを確認

## 監視と運用

### 除外パス

メンテナンス/バージョンチェックを除外するパス。

- `/metrics` — 監視用

### キャッシュ動作

- 設定は5分間キャッシュ
- キャッシュは自動で更新
- 設定取得に失敗した場合もフェイルオープン

### エラーレスポンス形式

すべてのエラーは標準APIレスポンス形式。

```typescript
{
  data: null,
  success: false,
  errorCode: 'SERVICE_MAINTENANCE' | 'UNSUPPORTED_VERSION',
  message: 'Human readable error message'
}
```

## ローカライゼーション

必要な文言は全サポート言語に翻訳済み。

- `Error.maintenanceMessage`: メンテナンス中のメッセージ
- `Error.unsupportedVersion`: アップデート要求メッセージ
- `Common.goStore`: ストア遷移ボタン
- `Common.ok`: ダイアログの確定ボタン

## 開発ガイドライン

### 除外パスの追加

メンテナンス/バージョンチェックから除外したいパスを追加する。

```typescript
// MaintenanceGuard 内
private readonly allowedPaths = ['/metrics', '/new-exempted-path'];
```

### キャッシュTTLの変更

キャッシュ期間を変更する。

```typescript
// RemoteConfigService 内
private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10分
```

### 新しい設定値の追加

1. `shared/remoteConfig/remoteConfig.schema.ts` を更新
2. GCS静的マスターを更新
3. `RemoteConfigService.getRemoteConfigValue()` から取得
