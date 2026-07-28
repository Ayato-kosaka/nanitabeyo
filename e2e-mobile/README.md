# e2e-mobile — Detox E2E テスト

Expo アプリのネイティブビルド（Android エミュレータ / iOS シミュレータ）を対象に、Cloud Run 上の `api-development` へ接続して実環境相当の E2E テストを行うワークスペースです。方針は `e2e-web/`（Playwright）を踏襲しています。

> ⚠️ 現在はスパイク段階（Android の起動スモークのみ）。全体設計は Issue #1027 とその Sub-issue を参照。

## 構成の全体像

```
[Detox (jest)]
      │ adb / simctl
      ▼
[Android エミュレータ / iOS シミュレータ]
      │  app-expo を expo prebuild + Gradle/xcodebuild した release ビルド
      │  ※ EXPO_PUBLIC_BACKEND_BASE_URL 等はビルド時に焼き込み（eas env:pull development）
      ▼
[https://api-development.nanitabeyo.net (Cloud Run)] + [Supabase (認証)]
```

## ローカル実行手順（Android）

```bash
# リポジトリルートで
pnpm install
pnpm -F shared run build

# development 環境変数を取得（EXPO_PUBLIC_* がビルドに焼き込まれる）
cd app-expo && pnpx eas-cli env:pull development --non-interactive --path .env && cd ..

# ネイティブプロジェクト生成（E2E_DETOX=1 で Detox 用 config plugin を有効化）
cd app-expo && E2E_DETOX=1 pnpm exec expo prebuild --platform android --no-install && cd ..

# ビルド & テスト（AVD が必要。名前が e2e_avd 以外なら DETOX_AVD_NAME で指定）
pnpm --filter e2e-mobile build:android
DETOX_AVD_NAME=<あなたのAVD名> pnpm --filter e2e-mobile test:android
```

## CI（GitHub Actions）

`.github/workflows/e2e-mobile-test.yml` を参照。workflow_dispatch で実行できる。

## テスト追加ガイドライン

e2e-web/README.md のガイドライン（1 spec = 1 画面 or 1 機能、testID 優先セレクタ、@mutation の原則）に従う。詳細な規約は設計確定後にこの README へ追記する。
