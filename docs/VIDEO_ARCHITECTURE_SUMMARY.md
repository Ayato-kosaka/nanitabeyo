# 動画アップロードアーキテクチャ - クイックリファレンス

## 実装内容

このPRでは、課題「【課題】MVP の動画保存アーキテクチャ」で求められたMVPレベルの動画アップロード／トランスコード構成を実装した。

## 主な変更点

### 1. DTOの拡張

- **対象ファイル**: `shared/api/v1/dto/dish-media/create-dish-media.dto.ts`
- 任意の `thumbnailPath` フィールドを追加
- `MediaType` enum（VIDEO/IMAGE）をエクスポート

### 2. 動画トランスコードサービス

- **ディレクトリ**: `api/src/core/transcoder/`
- 1080p / 720p / 480p の3品質でHLSを出力
- Google Cloud Video Transcoder API を統合
- 出力パス: `gs://<bucket>/transcoded/dish_media/media_path/<recordId>/master.m3u8`

### 3. Cloud Tasks との連携

- **ファイル**: `api/src/core/cloud-tasks/cloud-tasks.service.ts`
- `enqueueTranscodeJob()` を追加
- キュー名: `transcode-queue`

### 4. ワーカーエンドポイント

- **ディレクトリ**: `api/src/internal/transcode/`
- エンドポイント: `POST /internal/transcode`
- Cloud Tasks 用のOIDCガードで保護

### 5. ビジネスロジックの更新

- **ファイル**: `api/src/v1/dish-media/dish-media.service.ts`
- 動画: `thumbnailPath` が必須、トランスコードをキューに投入
- 画像: `thumbnailPath` に `mediaPath` を流用

## 使用例

### フロントエンド - 動画アップロード

```typescript
// 1. 動画をアップロード
const videoPath = await uploadFile(videoFile, `${dishId}-media`);

// 2. サムネイルをアップロード
const thumbnailPath = await uploadFile(thumbnailFile, `${dishId}-thumbnail`);

// 3. dish media を作成
await createDishMedia({
        dishId,
        mediaType: "VIDEO",
        mediaPath: videoPath,
        thumbnailPath: thumbnailPath,
});
// バックエンドが自動でトランスコードをキューに投入
```

### フロントエンド - 画像アップロード

```typescript
// 1. 画像をアップロード
const imagePath = await uploadFile(imageFile, `${dishId}-media`);

// 2. dish media を作成（thumbnailPath も必須なので同じ値をセット）
await createDishMedia({
        dishId,
        mediaType: "IMAGE",
        mediaPath: imagePath,
        thumbnailPath: imagePath, // 必須: mediaPath と同じ値を設定
});
```

## インフラ設定

### Cloud Tasks キュー作成

```bash
gcloud tasks queues create transcode-queue \
  --location=us-central1 \
  --max-attempts=3 \
  --max-concurrent-dispatches=5
```

### 必要なAPIの有効化

```bash
gcloud services enable videotranscoder.googleapis.com
gcloud services enable cloudtasks.googleapis.com
```

## テスト

### ビルド / 型チェック（✅ 通過済み）

```bash
pnpm build      # すべてのパッケージがコンパイルに成功
pnpm typecheck  # 型エラーなし
pnpm format     # コードを整形
```

### 手動テスト

1. APIサーバーを起動: `cd api && pnpm dev`
2. 画像アップロードフローを確認（即時動作）
3. 動画アップロードフローを確認（GCSとTranscoder APIのアクセスが必要）

## アーキテクチャ図

### 動画アップロードフロー

```
┌─────────┐                  ┌─────────┐                  ┌──────────┐
│   UI    │                  │ Backend │                  │   GCS    │
└────┬────┘                  └────┬────┘                  └────┬─────┘
     │                            │                            │
     │ 1. Get signed URL (video)  │                            │
     ├───────────────────────────>│                            │
     │ 2. Return signed URL        │                            │
     │<───────────────────────────┤                            │
     │ 3. Upload video binary      │                            │
     ├─────────────────────────────────────────────────────────>│
     │                            │                            │
     │ 4. Get signed URL (thumb)  │                            │
     ├──────────────────────────>│                            │
     │ 5. Return signed URL        │                            │
     │<───────────────────────────┤                            │
     │ 6. Upload thumbnail binary  │                            │
     ├─────────────────────────────────────────────────────────>│
     │                            │                            │
     │ 7. POST /v1/dish-media     │                            │
     ├───────────────────────────>│                            │
     │                            │ 8. Create DB record        │
     │                            ├────┐                       │
     │                            │    │                       │
     │                            │<───┘                       │
     │                            │ 9. Enqueue transcode job   │
     │                            ├────────────────┐           │
     │                            │   Cloud Tasks  │           │
     │                            │<───────────────┘           │
     │<───────────────────────────┤                            │
     │                            │                            │

     後続（非同期）:

     ┌─────────────┐              ┌────────────┐
     │ Cloud Tasks │              │ Transcoder │
     └──────┬──────┘              └─────┬──────┘
            │                           │
            │ POST /internal/transcode  │
            ├──────────────>│           │
            │               │ Create    │
            │               │ HLS Job   │
            │               ├──────────>│
            │               │           │ (Generates HLS files)
            │               │           ├────────────────────>│
```

### 画像アップロードフロー

```
┌─────────┐                  ┌─────────┐                  ┌──────────┐
│   UI    │                  │ Backend │                  │   GCS    │
└────┬────┘                  └────┬────┘                  └────┬─────┘
     │                            │                            │
     │ 1. Get signed URL (image)  │                            │
     ├───────────────────────────>│                            │
     │ 2. Return signed URL        │                            │
     │<───────────────────────────┤                            │
     │ 3. Upload image binary      │                            │
     ├─────────────────────────────────────────────────────────>│
     │                            │                            │
     │ 4. POST /v1/dish-media     │                            │
     ├───────────────────────────>│                            │
     │                            │ 5. Create DB record        │
     │                            │    (thumbnail=media)       │
     │                            ├────┐                       │
     │                            │    │                       │
     │                            │<───┘                       │
     │ 6. Success response        │                            │
     │<───────────────────────────┤                            │
```

## 変更ファイル

### 新規ファイル

- `api/src/core/transcoder/transcoder.service.ts` — Transcoder API クライアント
- `api/src/core/transcoder/transcoder.module.ts` — モジュール定義
- `api/src/internal/transcode/transcode.controller.ts` — ワーカーエンドポイント
- `api/src/internal/transcode/transcode.service.ts` — トランスコードロジック
- `api/src/internal/transcode/transcode.module.ts` — モジュール定義
- `api/src/internal/transcode/transcode.dto.ts` — ワーカー用DTO
- `api/src/internal/transcode/transcode-job.interface.ts` — ジョブのペイロード定義
- `IMPLEMENTATION_VIDEO_ARCHITECTURE.md` — 詳細ドキュメント

### 変更した既存ファイル

- `shared/api/v1/dto/dish-media/create-dish-media.dto.ts` — `thumbnailPath` を追加
- `shared/api/v1/dto/index.ts` — `MediaType` enum をエクスポート
- `api/src/v1/dish-media/dish-media.service.ts` — 動画/画像ロジックを更新
- `api/src/v1/dish-media/dish-media.module.ts` — 依存モジュールを追加
- `api/src/core/cloud-tasks/cloud-tasks.service.ts` — トランスコードキューを追加
- `api/src/core/core.module.ts` — TranscoderModule を追加
- `api/src/internal/internal.module.ts` — TranscodeModule を追加
- `api/package.json` — `@google-cloud/video-transcoder` を追加

## 次のステップ

1. **デプロイ**: 本番環境へ反映し、Cloud Tasks キューを作成
2. **監視**: トランスコードジョブのログ／アラートを設定
3. **最適化**: ステータス更新にPub/Sub利用を検討
4. **拡張**: リトライやエラー通知を追加

## 疑問点がある場合

詳細な情報は `IMPLEMENTATION_VIDEO_ARCHITECTURE.md` を参照。

- API仕様
- 環境変数
- テスト戦略
- 将来の拡張案
