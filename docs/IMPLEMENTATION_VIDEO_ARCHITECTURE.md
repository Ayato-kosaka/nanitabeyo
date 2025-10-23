# MVP動画ストレージアーキテクチャ - 実装サマリー

## 概要

課題で提示されたシーケンス図に従い、nanitabeyo アプリに動画アップロードとトランスコード機能を追加した実装内容をまとめる。

## バックエンドの変更点

### 1. DTOの更新 (`shared/api/v1/dto/dish-media/create-dish-media.dto.ts`)

- `CreateDishMediaDto` に任意の `thumbnailPath` フィールドを追加
- アプリ全体で利用できるように `MediaType` enum（VIDEO/IMAGE）をエクスポート

### 2. トランスコーダーサービス (`api/src/core/transcoder/`)

- Google Cloud Video Transcoder API を利用する `TranscoderService` を新規追加
- HLS の可変ビットレート出力を生成
  - 1080p @ 8000 kbps
  - 720p @ 5000 kbps
  - 480p @ 2500 kbps
  - 音声: AAC @ 128 kbps
- 出力先: `gs://<bucket>/transcoded/dish_media/media_path/<recordId>/master.m3u8`

### 3. Cloud Tasks 連携 (`api/src/core/cloud-tasks/cloud-tasks.service.ts`)

- `enqueueTranscodeJob()` を追加し、`transcode-queue` へジョブを送信

### 4. 内部ワーカーエンドポイント (`api/src/internal/transcode/`)

- Cloud Tasks から呼び出される `/internal/transcode` エンドポイントを追加
- OIDCガードで保護
- 受け取ったペイロードを TranscoderService へ渡してジョブを作成

### 5. DishMediaService の更新 (`api/src/v1/dish-media/dish-media.service.ts`)

- `createDishMedia()` の動画/画像処理を分岐
  - **VIDEO**: `thumbnailPath` が必須、Cloud Tasks へトランスコードジョブを投入
  - **IMAGE**: `thumbnailPath` が指定されていなければ `mediaPath` を流用
- ジョブ投入状況をログ出力

## フロントエンド互換性

### FileUploader コンポーネント (`app-expo/features/uploads/components/FileUploader.tsx`)

**変更なし**。既存機能で以下のフローを実現できる。

1. 署名付きURLを取得し、1ファイルずつアップロード
2. `onUploadComplete` コールバックで `objectPath` を受け取る
3. 動画フローでは以下のように利用可能
   - 1回目: `baseFileName: "${dishId}-media"` で動画をアップロード
   - 2回目: `baseFileName: "${dishId}-thumbnail"` でサムネイルをアップロード
   - 最後に `POST /v1/dish-media` で両方のパスを送信

## 動画アップロードの全体像

### 動画メディアの場合

```
1. UI → Backend: POST /v1/user-uploads/signed-url { baseFileName: "${dishId}-media", mimeType: "video/mp4" }
2. Backend → UI: { putUrl, objectPath: mediaPath }
3. UI → GCS: PUT (動画バイナリ)
4. UI → Backend: POST /v1/user-uploads/signed-url { baseFileName: "${dishId}-thumbnail", mimeType: "image/jpeg" }
5. Backend → UI: { putUrl, objectPath: thumbnailPath }
6. UI → GCS: PUT (サムネイルバイナリ)
7. UI → Backend: POST /v1/dish-media { dishId, mediaType: "VIDEO", mediaPath, thumbnailPath }
8. Backend: dish_media レコードを作成
9. Backend → Cloud Tasks: トランスコードジョブをキューに投入
10. Cloud Tasks → Backend: POST /internal/transcode { inputUri, outputUri, recordId }
11. Backend → Transcoder API: HLS トランスコードジョブを作成
12. Transcoder API: 非同期でHLSファイルを生成
```

### 画像メディアの場合

```
1. UI → Backend: POST /v1/user-uploads/signed-url { baseFileName: "${dishId}-media", mimeType: "image/jpeg" }
2. Backend → UI: { putUrl, objectPath: mediaPath }
3. UI → GCS: PUT (画像バイナリ)
4. UI → Backend: POST /v1/dish-media { dishId, mediaType: "IMAGE", mediaPath, thumbnailPath: mediaPath }
   (画像の場合は thumbnailPath も必須だが mediaPath と同じ値を設定)
5. Backend: dish_media レコードを作成（thumbnailPath=mediaPath）
```

## 環境変数

新たな環境変数は不要。既存の以下を利用。

- `GCP_PROJECT`: Google Cloud プロジェクトID
- `TASKS_LOCATION`: Cloud Tasks のリージョン（例: us-central1）
- `GCS_BUCKET_NAME`: ストレージバケット名
- `CLOUD_RUN_URL`: Cloud Tasks コールバック先のAPI URL

## Cloud Tasks キュー

`transcode-queue` を新規作成する。

```bash
gcloud tasks queues create transcode-queue \
  --location=us-central1 \
  --max-attempts=3 \
  --max-concurrent-dispatches=5
```

## データベーススキーマ

新たなスキーマ変更は不要。既存の `dish_media` テーブルを利用。

- `media_path`: 元動画または画像のURI
- `thumbnail_path`: サムネイル画像のURI
- `media_type`: 'IMAGE' または 'VIDEO'

将来的な拡張案としては以下が考えられる。

- `transcode_status`: PENDING / PROCESSING / READY / FAILED
- `hls_master_path`: `master.m3u8` のパス

## テスト

### 手動テスト手順

1. **準備**

   ```bash
   cd api
   # 必要な環境変数を含む .env を作成
   pnpm dev
   ```

2. **画像アップロードの確認**
   - FileUploader で画像をアップロード
   - `mediaType: IMAGE` で `POST /v1/dish-media`
   - thumbnailPath が mediaPath と同じ値で保存されることを確認

3. **動画アップロードの確認**（GCSとTranscoder APIのアクセスが必要）
   - FileUploader で動画をアップロード
   - FileUploader でサムネイルをアップロード
   - `mediaType: VIDEO` と両方のパスで `POST /v1/dish-media`
   - レコードが作成されることを確認
   - Cloud Tasks コンソールでジョブ投入を確認
   - Transcoder API コンソールでジョブ実行を確認

### ビルド確認

```bash
pnpm build      # ✅ 成功
pnpm typecheck  # ✅ 成功
```

## 今後の拡張

1. **Pub/Sub を用いたステータス更新**
   - Transcoder の完了通知を購読
   - dish_media.transcode_status を更新

2. **CDN統合**
   - HLS再生用の署名付きURL生成
   - Cloud CDN 統合によるパフォーマンス向上

3. **進捗トラッキング**
   - トランスコードの進捗をリアルタイムでUIに表示
   - Transcoder通知のWebhookエンドポイントを追加

4. **エラーハンドリング強化**
   - 失敗したジョブのリトライ
   - 失敗時のユーザー通知

## 参考資料

- 課題: 【課題】MVP の動画保存アーキテクチャ
- Google Cloud Video Transcoder API: https://cloud.google.com/transcoder/docs
- HLS 仕様: https://datatracker.ietf.org/doc/html/rfc8216
