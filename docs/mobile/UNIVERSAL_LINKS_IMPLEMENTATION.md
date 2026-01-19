# Universal Links / App Links + Web Deep Linking 実装ガイド

このドキュメントは Issue #688 の実装内容をまとめたものです。

## 📋 実装概要

iOS Universal Links、Android App Links、および Web Deep Linking を統合し、共有URLからアプリへのシームレスな遷移を実現しました。

## 🎯 動作フロー

### アプリインストール済みの場合
1. ユーザーが `https://app.nanitabeyo.net/ja-JP/posts?ids=xxx` をタップ
2. OS が該当アプリを自動起動（Universal Links / App Links）
3. アプリ内で該当画面（posts）へ直接遷移

### アプリ未インストールの場合
1. ユーザーが同じ URL をタップ
2. Web ブラウザで表示
3. `OpenInAppBanner` コンポーネントが導線を提供：
   - 「アプリで開く」ボタン（モバイルのみ）→ Custom Scheme でアプリ起動試行
   - 「App Store」ボタン → iOS ストアへ遷移
   - 「Google Play」ボタン → Android ストアへ遷移

## 📁 実装ファイル

### 1. iOS Universal Links

#### app.config.ts
```typescript
ios: {
  associatedDomains: ["applinks:app.nanitabeyo.net"],
  entitlements: {
    "com.apple.developer.associated-domains": ["applinks:app.nanitabeyo.net"]
  }
}
```

#### AASA ファイル（Apple App Site Association）
- 配置場所1: `api/public/apple-app-site-association`
- 配置場所2: `api/public/.well-known/apple-app-site-association`
- アクセスURL: 
  - `https://app.nanitabeyo.net/apple-app-site-association`
  - `https://app.nanitabeyo.net/.well-known/apple-app-site-association`

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "YL4UZV4MMA.com.nanitabeyo",
        "paths": ["/*/posts", "/*/posts/*", "/*"]
      }
    ]
  }
}
```

### 2. Android App Links

#### app.config.ts（既存設定を維持）
```typescript
android: {
  intentFilters: [
    {
      action: "VIEW",
      autoVerify: true,
      data: [
        { scheme: "https", host: "app.nanitabeyo.net", pathPrefix: "/" }
      ],
      category: ["BROWSABLE", "DEFAULT"]
    }
  ]
}
```

#### assetlinks.json
- 配置場所: `api/public/.well-known/assetlinks.json`
- アクセスURL: `https://app.nanitabeyo.net/.well-known/assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.nanitabeyo",
      "sha256_cert_fingerprints": ["REPLACE_WITH_RELEASE_SHA256_FINGERPRINT"]
    }
  }
]
```

**⚠️ 重要**: `sha256_cert_fingerprints` を実際のリリース証明書のフィンガープリントに置き換えてください。

### 3. API サーバー静的ファイル配信

#### api/src/main.ts
```typescript
app.useStaticAssets(join(__dirname, '..', 'public'), {
  prefix: '/',
  setHeaders: (res, path) => {
    if (path.endsWith('apple-app-site-association')) {
      res.setHeader('Content-Type', 'application/json');
    }
    if (path.endsWith('assetlinks.json')) {
      res.setHeader('Content-Type', 'application/json');
    }
  },
});
```

### 4. Web Deep Linking コンポーネント

#### app-expo/components/deepLinking/OpenInAppBanner.tsx

主要機能：
- Platform.OS === "web" の場合のみ表示
- モバイルブラウザ判定（User Agent）
- Custom Scheme (`nanitabeyo://`) でアプリ起動試行
- タイムアウト後にストアへ誘導
- i18n 完全対応（8言語）

```typescript
// 使用例（posts.tsx）
<OpenInAppBanner 
  locale={locale} 
  path="posts" 
  params={{ ids }} 
/>
```

### 5. i18n 翻訳追加

全8言語に `DeepLinking` セクションを追加：
- `ar-SA.json` (アラビア語)
- `en-US.json` (英語)
- `es-ES.json` (スペイン語)
- `fr-FR.json` (フランス語)
- `hi-IN.json` (ヒンディー語)
- `ja-JP.json` (日本語)
- `ko-KR.json` (韓国語)
- `zh-CN.json` (中国語)

キー：
- `DeepLinking.openInApp`: 「アプリで開く」
- `DeepLinking.appStore`: 「App Store」
- `DeepLinking.playStore`: 「Google Play」
- `DeepLinking.viewInBrowser`: 「ブラウザで続ける」

## 🔧 デプロイ前の準備

### 1. Android 証明書フィンガープリント取得

#### リリースビルド用
```bash
# EAS Build の場合
eas credentials --platform android

# または keytool を使用
keytool -list -v -keystore /path/to/release.keystore -alias release-key
```

SHA256 フィンガープリントを `api/public/.well-known/assetlinks.json` に設定。

#### デバッグビルド用（開発時のみ）
```bash
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android
```

### 2. iOS Team ID 確認

Apple Developer アカウントの Team ID が `YL4UZV4MMA` であることを確認。

### 3. 環境変数設定

以下の環境変数が正しく設定されていることを確認：
- `EXPO_PUBLIC_APP_STORE_URL`: iOS App Store URL
- `EXPO_PUBLIC_PLAY_STORE_URL`: Google Play Store URL
- `EXPO_PUBLIC_WEB_BASE_URL`: `https://app.nanitabeyo.net`

## 🧪 検証方法

### iOS ユニバーサルリンク検証

#### 1. AASA バリデータ
- [Branch.io AASA Validator](https://branch.io/resources/aasa-validator/)
- URL: `https://app.nanitabeyo.net/apple-app-site-association`

#### 2. 実機テスト
```
1. EAS Production ビルドを iPhone にインストール
2. Safari で https://app.nanitabeyo.net/ja-JP/posts?ids=xxx を開く
3. アプリが自動起動して posts 画面が表示されることを確認
```

### Android アプリリンク検証

#### 1. Digital Asset Links Tester
- [Google Digital Asset Links API](https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.nanitabeyo.net&relation=delegate_permission/common.handle_all_urls)

#### 2. adb テスト
```bash
# インストール後
adb shell pm verify-app-links com.nanitabeyo

# テスト
adb shell am start -W -a android.intent.action.VIEW \
  -d "https://app.nanitabeyo.net/ja-JP/posts?ids=xxx" \
  com.nanitabeyo
```

### Web バナー検証

#### モバイルブラウザ
```
1. スマートフォンのブラウザで https://app.nanitabeyo.net/ja-JP/posts?ids=xxx を開く
2. OpenInAppBanner が表示されることを確認
3. 「アプリで開く」ボタンをタップ
4. アプリがインストール済みなら起動、未インストールならストアへ遷移
```

#### PC ブラウザ
```
1. PC のブラウザで同じ URL を開く
2. OpenInAppBanner にストア導線のみ表示されることを確認
3. 「アプリで開く」ボタンは非表示
```

#### LINE ブラウザなど
```
1. LINE アプリ内で URL をタップ
2. Universal Links は機能しないため Web 表示
3. OpenInAppBanner から導線を提供
```

## 📊 テストマトリクス

| ケース | プラットフォーム | アプリ状態 | 期待結果 |
|--------|----------------|----------|---------|
| 1 | iOS Safari | インストール済み | アプリで posts 画面を開く |
| 2 | iOS Safari | 未インストール | Web 表示 + バナー |
| 3 | Android Chrome | インストール済み | アプリで posts 画面を開く |
| 4 | Android Chrome | 未インストール | Web 表示 + バナー |
| 5 | LINE ブラウザ | インストール済み | Web 表示 + バナー（Universal Links 無効） |
| 6 | LINE ブラウザ | 未インストール | Web 表示 + バナー |
| 7 | PC Chrome | - | Web 表示 + ストア導線のみ |
| 8 | PC Safari | - | Web 表示 + ストア導線のみ |

## 🚀 今後の拡張

### 他画面への適用

posts 画面以外でも同様の導線が必要な場合：

```typescript
import { OpenInAppBanner } from "@/components/deepLinking/OpenInAppBanner";
import { useLocale } from "@/hooks/useLocale";

// 使用例
const locale = useLocale();
<OpenInAppBanner 
  locale={locale} 
  path="restaurant/123" 
  params={{ utm_source: "share" }} 
/>
```

### AASA / assetlinks.json への追加パス

新しいパスを追加する場合：

#### iOS (apple-app-site-association)
```json
"paths": [
  "/*/posts",
  "/*/restaurant/*",
  "/*/profile/*"
]
```

#### Android (intentFilters は既に `pathPrefix: "/"` で全パスをカバー)
特に変更不要

## 🔍 トラブルシューティング

### Universal Links が動作しない

1. **AASA ファイルの確認**
   ```bash
   curl -I https://app.nanitabeyo.net/apple-app-site-association
   # Content-Type: application/json を確認
   ```

2. **キャッシュクリア**
   - iOS はAASAファイルを長時間キャッシュ
   - デバイスを再起動するか、数時間待つ

3. **Team ID / Bundle ID の確認**
   - Xcode で確認
   - EAS credentials で確認

### App Links が動作しない

1. **assetlinks.json の確認**
   ```bash
   curl https://app.nanitabeyo.net/.well-known/assetlinks.json
   ```

2. **SHA256 フィンガープリントの確認**
   ```bash
   # アプリの実際のフィンガープリントと一致しているか確認
   adb shell pm dump com.nanitabeyo | grep "android:sha256"
   ```

3. **autoVerify の確認**
   - app.config.ts で `autoVerify: true` が設定されているか

### Web バナーが表示されない

1. **Platform.OS の確認**
   - Web ビルドで正しく動作しているか
   
2. **環境変数の確認**
   - `EXPO_PUBLIC_APP_STORE_URL` と `EXPO_PUBLIC_PLAY_STORE_URL` が設定されているか

3. **ブラウザコンソール**
   - エラーがないか確認

## 📚 参考リンク

- [Apple Universal Links ドキュメント](https://developer.apple.com/ios/universal-links/)
- [Android App Links ドキュメント](https://developer.android.com/training/app-links)
- [Expo Linking ドキュメント](https://docs.expo.dev/guides/linking/)
- [EAS Build ドキュメント](https://docs.expo.dev/build/introduction/)

## ✅ チェックリスト（デプロイ前）

- [ ] Android SHA256 フィンガープリントを実際の値に更新
- [ ] iOS Team ID が正しいことを確認
- [ ] 環境変数（APP_STORE_URL, PLAY_STORE_URL）が設定済み
- [ ] AASA ファイルが `https://app.nanitabeyo.net/apple-app-site-association` でアクセス可能
- [ ] assetlinks.json が `https://app.nanitabeyo.net/.well-known/assetlinks.json` でアクセス可能
- [ ] EAS Production ビルドで実機テスト完了
- [ ] Web バナーの表示確認完了
- [ ] 各言語での表示確認完了
