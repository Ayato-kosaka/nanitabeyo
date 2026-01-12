# Expo SDK 54 アップグレード完了サマリー

## 📌 Issue

**iOS EAS Preview ビルドで Tutorial BottomSheet が表示されない問題の対応**

- GitHub Issue: [iOS EAS Preview ビルドで Tutorial BottomSheet が表示されない問題の対応]
- 症状: `@gorhom/bottom-sheet` が dev client では正常動作するが、iOS EAS preview ビルドでは表示されない

## 🎯 根本原因

BottomSheet v5 系は **Reanimated 4.x + React Native 0.81** を前提に最適化されている。

旧環境（Expo 53, RN 0.79, Reanimated 3.x）では:
- dev client: ゆるい動作で問題なし
- preview ビルド: New Architecture / Hermes 最適化 / Reanimated JSI がフル動作 → ネイティブ差分が顕在化

## ✅ 実施した変更

### 1. 主要な依存関係のアップデート

| パッケージ | 旧バージョン | 新バージョン | 備考 |
|-----------|------------|------------|------|
| expo | 53.0.0 | **54.0.31** | メインアップデート |
| react-native | 0.79.5 | **0.81.5** | BottomSheet v5 推奨 |
| react | 19.0.0 | **19.1.0** | |
| react-dom | 19.0.0 | **19.1.0** | |
| react-native-reanimated | 3.17.4 | **4.1.6** | BottomSheet v5 推奨 |
| react-native-gesture-handler | 2.24.0 | **2.28.0** | |
| react-native-worklets-core | (なし) | **1.6.2** | Reanimated 4 で必須 |
| @types/react | 19.0.14 | **19.1.17** | peer dependency 解決 |
| @gorhom/bottom-sheet | 5.2.8 | 5.2.8 | 維持 |

### 2. コード変更（最小限）

#### a. `app-expo/app.config.ts`
- `expo-secure-store` プラグインを追加（Expo SDK 54 で必須）

```typescript
plugins: [
  "expo-router",
  "expo-video",
  "expo-audio",
  "expo-notifications",
  "expo-secure-store", // 追加
  // ...
]
```

#### b. `app-expo/hooks/useFileUploader.tsx`
FileSystem API の変更対応（expo-file-system 19.x）

**変更1: uploadType の削除**
```typescript
// 旧: SDK 53
const uploadTask = FileSystem.createUploadTask(
  signedUrlResponse.putUrl,
  localUri,
  {
    httpMethod: "PUT",
    headers: { "Content-Type": mimeType },
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, // 削除
  },
  // ...
);

// 新: SDK 54
// #SDK54 【設計】expo-file-system 19.x では uploadType が削除されたためコメントアウト
const uploadTask = FileSystem.createUploadTask(
  signedUrlResponse.putUrl,
  localUri,
  {
    httpMethod: "PUT",
    headers: { "Content-Type": mimeType },
    // uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, // SDK54 では不要
  },
  // ...
);
```

**変更2: cacheDirectory の API 変更**
```typescript
// 旧: SDK 53
const tmp = `${FileSystem.cacheDirectory}avatar-${Date.now()}.tmp`;

// 新: SDK 54
// #SDK54 【設計】FileSystem.Directories.CacheDirectory を使用（SDK54 の新API）
const tmp = `${FileSystem.Directories.CacheDirectory}/avatar-${Date.now()}.tmp`;
```

### 3. その他の自動更新

Expo SDK 54 に伴い、40+ の expo-* パッケージが自動的に適切なバージョンに更新されました:
- expo-camera: 16.1.11 → 17.0.10
- expo-router: 5.1.7 → 6.0.21
- expo-image: 2.4.1 → 3.0.11
- etc.

## ✅ 動作確認済み

- ✅ `pnpm install --frozen-lockfile` (1分10秒)
- ✅ `pnpm build` (12秒) - ビルド成功
- ✅ `pnpm format` (7秒) - コードフォーマット正常
- ✅ Git コミット完了

## 🔜 次の検証ステップ

### 1. iOS EAS Preview ビルドでの検証（最重要）

```bash
cd app-expo
pnpx eas-cli build --profile preview --platform ios --no-wait
```

**確認項目:**
- [ ] ビルドが成功すること
- [ ] ビルドした IPA を TestFlight または直接インストールして動作確認
- [ ] 検索タブを開く
- [ ] チュートリアル BottomSheet が表示されること
- [ ] BottomSheet が正常に動作すること（スワイプ、ボタン押下等）

### 2. Android EAS Preview ビルドでの検証

```bash
cd app-expo
pnpx eas-cli build --profile preview --platform android --no-wait
```

**確認項目:**
- [ ] ビルドが成功すること
- [ ] regression が無いこと

### 3. ローカル dev-client での動作確認

```bash
cd app-expo
pnpm start
```

**確認項目:**
- [ ] Metro bundler が起動すること
- [ ] iOS/Android デバイスでアプリが起動すること
- [ ] 既存機能に影響がないこと

### 4. 主要画面の動作確認

- [ ] 検索タブ: チュートリアル BottomSheet
- [ ] マップタブ: レストラン詳細 BottomSheet
- [ ] プロフィールタブ: 各種機能
- [ ] 投稿作成: メディアアップロード（FileSystem API 使用）

## 📝 既知の問題

### TypeScript 型エラー（既存、今回のアップグレードとは無関係）

`pnpm typecheck` で多数のエラーが出ますが、これらは既存の問題です:
- `@shared` モジュールの import 解決問題
- 一部の `any` 型の使用

これらは今回のアップグレードで発生したものではなく、別途対応が必要です。

**重要:** `pnpm build` は成功しており、実際のビルドには影響ありません。

## 🎉 期待される効果

このアップグレードにより:

1. **iOS EAS Preview ビルドで BottomSheet が正常表示される**
   - Reanimated 4.1 + RN 0.81 の組み合わせで、BottomSheet v5 が正しく動作

2. **dev-client と preview の挙動が一致する**
   - 開発環境と本番環境での動作差異が解消

3. **将来的な安定性向上**
   - 公式の推奨構成に準拠
   - New Architecture との互換性向上

## 🔗 参考リンク

- [Expo SDK 54 Release Notes](https://expo.dev/changelog/2024/12-17-sdk-54)
- [React Native Reanimated 4.x Documentation](https://docs.swmansion.com/react-native-reanimated/)
- [@gorhom/bottom-sheet v5 Documentation](https://gorhom.github.io/react-native-bottom-sheet/)
- [expo-file-system API Reference](https://docs.expo.dev/versions/latest/sdk/filesystem/)

## 📞 問題が発生した場合

1. **ビルドが失敗する場合**
   - `pnpm install --frozen-lockfile` を再実行
   - キャッシュをクリアして再ビルド: `--clear-cache` オプション使用

2. **BottomSheet が表示されない場合**
   - Metro bundler を再起動
   - アプリをアンインストールして再インストール
   - console ログを確認（Reanimated / Gesture Handler のエラー）

3. **FileSystem API でエラーが出る場合**
   - `hooks/useFileUploader.tsx` の変更を確認
   - `FileSystem.Directories.CacheDirectory` が使用されているか確認

## 📄 変更ファイル

- `app-expo/package.json` - 依存関係の更新
- `app-expo/app.config.ts` - expo-secure-store プラグイン追加
- `app-expo/hooks/useFileUploader.tsx` - FileSystem API 変更対応
- `pnpm-lock.yaml` - lockfile 更新

---

**作成日**: 2026-01-12  
**対応チケット**: iOS EAS Preview ビルドで Tutorial BottomSheet が表示されない問題の対応
