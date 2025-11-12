# 共有機能（ユニバーサルリンク / アプリリンク対応）

このドキュメントでは、nanitabeyo フードアプリの共有機能における iOS のユニバーサルリンクと Android のアプリリンク実装について説明する。

## 概要

共有機能は以下を満たすURLを生成する。

- Webブラウザで開いた場合はフォールバック表示
- 対応アプリがインストールされている端末ではアプリを起動（ユニバーサルリンク／アプリリンク）
- iOS、Android、Webの全プラットフォームをサポート

## 実装

### 1. 共有機能のコア処理

**ファイル**: `app-expo/lib/share.ts`

- `generateShareUrl(pathname)`: 現在のパスから共有URLを生成
- `handleShare(url, title, onSuccess, onError)`: プラットフォーム別の共有処理
  - **Web**: Web Share API を優先し、未対応ブラウザではクリップボードにコピー
  - **iOS/Android**: ネイティブ共有ダイアログを使用し、失敗時はクリップボードにコピー

### 2. 環境変数

デプロイ時に以下の環境変数を設定。

```bash
EXPO_PUBLIC_WEB_BASE_URL=https://your-domain.com
```

**更新したファイル:**

- `app-expo/app.config.ts`: `extra` セクションに環境変数を追加
- `app-expo/constants/Env.ts`: `WEB_BASE_URL` と `LINK_HOST` を追加

### 3. アプリ設定

**ファイル**: `app-expo/app.config.ts`

**変更点:**

- `scheme` を `"myapp"` から `"nanitabeyo"` に変更
- `ios.associatedDomains` にユニバーサルリンク設定を追加
- `android.intentFilters` にアプリリンク設定を追加

### 4. ユニバーサルリンク / アプリリンク用ファイル

**iOS（ユニバーサルリンク）:**

- **ファイル**: `app-expo/public/apple-app-site-association`
- **配置**: `https://your-domain.com/apple-app-site-association` で公開
- **Content-Type**: `application/json`
- **注意**: `TEAMID.com.nanitabeyo` を実際のチームID＋Bundle IDに置き換える

**Android（アプリリンク）:**

- **ファイル**: `app-expo/public/.well-known/assetlinks.json`
- **配置**: `https://your-domain.com/.well-known/assetlinks.json`
- **注意**: SHA256フィンガープリントを実アプリの証明書に置き換える

### 5. DishMediaContent への組み込み

**ファイル**: `app-expo/components/DishMediaContent.tsx`

**変更内容:**

- 共有機能のインポートを追加
- 共有ボタン用の `handleSharePress()` と詳細ログを追加
- Shareボタンから新しいハンドラーを呼び出すように更新
- `usePathname()` を用いてパスを取得

### 6. 翻訳

**ファイル**: `app-expo/locales/en-US.json`, `app-expo/locales/ja-JP.json`

`DishMediaContent.share.title` を追加（共有ダイアログのタイトルに使用）。

## セットアップ手順

### 1. 環境変数

環境ごとに以下を設定。

```bash
# 本番
EXPO_PUBLIC_WEB_BASE_URL=https://nanitabeyo.com

# ステージング
EXPO_PUBLIC_WEB_BASE_URL=https://staging.nanitabeyo.com
```

### 2. ユニバーサルリンク / アプリリンクファイルの配信

以下のファイルをWebサーバーに配置。

- `apple-app-site-association` → `https://your-domain.com/apple-app-site-association`
- `assetlinks.json` → `https://your-domain.com/.well-known/assetlinks.json`

**重要事項:**

- `apple-app-site-association` は `application/json` で配信
- AASAファイルに拡張子は不要
- Team IDやSHA256フィンガープリントを実際の値に置き換える

### 3. 証明書情報の更新

**iOS（AASAファイル）:**
`apple-app-site-association` 内の `TEAMID` を自社のApple Developer Team IDに置き換える。

**Android（assetlinks.json）:**
アプリの証明書フィンガープリントを設定。

```bash
# デバッグビルドのSHA256フィンガープリント取得
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android

# リリースビルドのSHA256フィンガープリント取得
keytool -list -v -keystore /path/to/your/release.keystore -alias your-alias
```

## 検証方法

### iOS ユニバーサルリンク

1. **AASAバリデータ**: Appleが提供するバリデータを使用
2. **実機テスト**:
   - 端末にアプリをインストール
   - Safariで `https://your-domain.com/en/spot/123` を開く
   - アプリバナーが表示されるか、直接アプリが起動することを確認

### Android アプリリンク

1. **Googleバリデータ**: [Digital Asset Links ツール](https://developers.google.com/digital-asset-links/tools/generator)
2. **adbテスト**:

   ```bash
   adb shell pm verify-app-links com.nanitabeyo
   ```

### Webテスト

1. **Chrome/Edge**: ネイティブの共有ダイアログが表示されることを確認
2. **Firefox/Safari**: 共有内容がクリップボードにコピーされ、通知が表示されることを確認

## トラブルシューティング

### ユニバーサルリンクが動作しない

1. **AASAファイルの問題**:
   - `Content-Type` が `application/json` になっているか
   - リダイレクトが挟まっていないか
   - Team ID / Bundle ID が正しいか

2. **キャッシュ**: Apple はAASAファイルを長期間キャッシュする
   - 反映まで数時間待つ
   - ドメインを変える、またはパスを変更する方法も検討

### アプリリンクが動作しない

1. **Digital Asset Links の問題**:
   - SHA256フィンガープリントが正しいか
   - パッケージ名が完全一致しているか
   - `assetlinks.json` のフォーマットが正しいか

2. **インテントフィルターの問題**:
   - `host` がドメインと一致しているか
   - `autoVerify` が true になっているか

### 共有機能の問題

1. **URL生成**:
   - 環境変数が正しく設定されているか
   - `pathname` が期待通りに取得できているか

2. **プラットフォーム別の注意点**:
   - iOS/Android: `expo-sharing` が正しくインストールされているか
   - Web: ブラウザが Web Share API に対応しているか

## サポートしているURLパターン

現状は以下のパターンに対応。

- `/[locale]/spot/[id]` — 個別スポットページ
- `/[locale]/restaurant/[id]` — レストランページ
- `/[locale]/profile/[id]` — ユーザープロフィール
- `/[locale]/topic/[id]` — トピックページ
- `/` — ルートページ

必要に応じてAASA／assetlinks.jsonにパターンを追加する。
