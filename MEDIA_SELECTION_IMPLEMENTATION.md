# レビュー投稿：メディア選択＆ReviewForm 連携 実装ドキュメント

## 概要

本実装では、レビュー投稿フローに画像・動画選択機能を追加し、選択したメディアを9:16のアスペクト比でレビューフォーム上部に表示する機能を実装しました。

## 実装した機能

### 1. メディア選択機能

- **画像/動画の選択**: `expo-image-picker`を使用して、デバイスから画像または動画を1件選択
- **プラットフォーム対応**: Web、iOS、Android全てに対応
- **権限管理**: iOS/Androidでギャラリーアクセス権限を適切に要求

### 2. 動画制約

- **2分制限**: 120秒を超える動画は選択不可
- **エラーメッセージ**: 制限を超えた場合、ユーザーに分かりやすいエラーメッセージを表示

### 3. サムネイル生成

- **画像**: 選択した画像をそのまま使用
- **動画**: 
  - 0.1秒の位置からサムネイルを生成（黒フレーム回避）
  - ネイティブ: `expo-video-thumbnails`を使用
  - Web: HTMLVideoElement + Canvas で生成

### 4. メディア表示（InitialMediaPreview コンポーネント）

- **9:16 アスペクト比**: `aspectRatio: 9/16` を使用し、自動的に高さを算出
- **横センター配置**: `resizeMode: 'cover'` で画像/動画を中央配置
- **再生機能**:
  - 動画選択時: サムネイル中央に再生アイコンをオーバーレイ
  - タップでフルスクリーン再生モーダルを表示
  - ミュート/ミュート解除の切り替え可能
  - ネイティブ: `expo-av` の `<Video>` コンポーネント使用
  - Web: `<video>` タグを使用

### 5. エラーハンドリング

- **権限拒否**: 設定画面への誘導メッセージ
- **動画時間超過**: 2分以内の動画を選択するよう案内
- **サムネイル生成失敗**: 別のファイルを試すよう案内
- **ユーザーキャンセル**: エラー表示なし（静かに終了）

### 6. 国際化対応

8つの言語で完全な翻訳を提供:
- 日本語 (ja-JP)
- 英語 (en-US)
- 韓国語 (ko-KR)
- 中国語 (zh-CN)
- スペイン語 (es-ES)
- フランス語 (fr-FR)
- ヒンディー語 (hi-IN)
- アラビア語 (ar-SA)

### 7. アクセシビリティ

- 画像/サムネイルに適切な `accessibilityLabel` を付与
- 再生ボタンに `accessibilityRole="button"` とラベルを設定

## ファイル構成

### 新規作成ファイル

1. **`app-expo/features/map/components/InitialMediaPreview.tsx`**
   - メディアプレビュー表示コンポーネント
   - 9:16アスペクト比での表示
   - 動画再生モーダル機能

2. **`app-expo/features/map/utils/mediaSelection.ts`**
   - メディア選択ロジック
   - プラットフォーム別サムネイル生成
   - 動画時間検証
   - 権限管理

### 変更ファイル

1. **`app-expo/features/map/components/SelectedRestaurantDetails.tsx`**
   - レビュー投稿ボタンのハンドラー変更
   - メディア選択→レビューフォーム表示のフロー実装
   - エラーハンドリング追加

2. **`app-expo/features/map/components/ReviewForm.tsx`**
   - `initialMedia` プロパティ追加
   - フォーム上部にメディアプレビュー表示

3. **`app-expo/locales/*.json`** (全8ファイル)
   - メディア関連のエラーメッセージ追加
   - `Map.media.*` キー追加

4. **`app-expo/package.json`**
   - `expo-av` ^16.0.7 追加
   - `expo-video-thumbnails` ^10.0.7 追加

## 技術的詳細

### メディアデータ型定義

```typescript
interface MediaData {
  type: "image" | "video";
  uri: string;
  width?: number;
  height?: number;
  durationSec?: number;      // 動画のみ
  thumbnailUri?: string;     // 動画のみ
  mimeType?: string;
}
```

### 9:16 アスペクト比の実装

```typescript
const styles = StyleSheet.create({
  mediaWrapper: {
    width: "100%",
    aspectRatio: 9 / 16,
    overflow: "hidden",
    borderRadius: 12,
    backgroundColor: "#F8F9FA",
  },
  media: {
    width: "100%",
    height: "100%",
  },
});
```

### プラットフォーム別サムネイル生成

**ネイティブ (iOS/Android):**
```typescript
const { uri: thumbnailUri } = await VideoThumbnails.getThumbnailAsync(uri, {
  time: 100, // 100ms = 0.1秒
});
```

**Web:**
```typescript
const video = document.createElement("video");
video.src = uri;
video.currentTime = 0.1;
// loadeddata イベントでcanvasに描画
```

## 使用フロー

1. ユーザーが「レビュー投稿」ボタンをタップ
2. デバイスのメディアピッカーが起動（画像/動画選択可能）
3. ユーザーがメディアを選択
4. システムが動画の場合、時間をチェック（120秒以内）
5. 動画の場合、サムネイルを生成
6. レビューフォームが開き、選択したメディアが上部に表示
7. ユーザーがレビューを入力・投稿

## エラーケース対応

| エラー | 対応 |
|--------|------|
| 権限拒否 | `Map.media.permissionDenied` メッセージを表示 |
| 動画2分超過 | `Map.media.videoTooLong` メッセージを表示 |
| サムネイル生成失敗 | `Map.media.thumbnailFailed` メッセージを表示 |
| ユーザーキャンセル | 何も表示せず元の画面に戻る |
| その他のエラー | 一般エラーメッセージを表示 |

## パフォーマンス考慮事項

1. **メモリ管理**: 
   - Web版のサムネイルはdataURL（メモリ保持）
   - 画面離脱時に自動解放

2. **サムネイル生成**:
   - 0.1秒位置で生成（黒フレーム回避）
   - 非同期処理でUIブロックを回避

3. **画像表示**:
   - `expo-image` を使用（最適化された画像表示）
   - `resizeMode: 'cover'` で表示時に自動調整

## テスト推奨事項

### 機能テスト
- [ ] iOS/Android/Webで画像選択が正常動作
- [ ] iOS/Android/Webで動画選択が正常動作
- [ ] 119秒、120秒、121秒の動画で境界値テスト
- [ ] 縦長/横長/正方形の画像で表示確認
- [ ] HEIC/HEIF/JPEG/PNG形式の画像対応確認
- [ ] MP4/MOV形式の動画対応確認

### UIテスト
- [ ] 9:16アスペクト比が正しく表示される
- [ ] 画像の中央揃えが正しい
- [ ] 動画再生アイコンが中央に表示される
- [ ] 再生モーダルが正常動作
- [ ] ミュート/ミュート解除が動作

### エラーハンドリングテスト
- [ ] 権限拒否時のメッセージ表示
- [ ] 2分超動画選択時のメッセージ表示
- [ ] キャンセル時の適切な処理

### アクセシビリティテスト
- [ ] VoiceOverでラベルが読み上げられる
- [ ] TalkBackでラベルが読み上げられる
- [ ] キーボードナビゲーションが機能

## 将来の改善案

1. **複数メディア対応**: 現在は1件のみだが、複数選択に対応
2. **メディア編集**: トリミング、フィルター適用など
3. **ドラッグ&ドロップ**: Web版でのドラッグ&ドロップサポート
4. **プレビュー強化**: 動画のシークバー追加
5. **圧縮機能**: アップロード前のメディア圧縮

## 依存パッケージ

- `expo-image-picker`: ^16.1.4 (既存)
- `expo-av`: ^16.0.7 (新規追加)
- `expo-video-thumbnails`: ^10.0.7 (新規追加)

## 参考リンク

- [Expo Image Picker](https://docs.expo.dev/versions/latest/sdk/imagepicker/)
- [Expo AV](https://docs.expo.dev/versions/latest/sdk/av/)
- [Expo Video Thumbnails](https://docs.expo.dev/versions/latest/sdk/video-thumbnails/)
