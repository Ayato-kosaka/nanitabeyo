# なに食べよ (英: Crave Catch)

"今日、なに食べよ？" — 食を起点とした体験発見アプリのモノレポリポジトリです。

モバイルアプリ（React Native / Expo）と API サーバー（NestJS / Prisma / PostgreSQL）、それらが共有する型・スキーマ・ユーティリティを 1 つの pnpm workspace で管理しています。

---

## 目次

- [プロジェクト構成](#プロジェクト構成)
- [技術スタック](#技術スタック)
- [前提環境](#前提環境)
- [初期セットアップ](#初期セットアップ)
- [開発の始め方](#開発の始め方)
- [よく使うコマンド](#よく使うコマンド)
- [環境変数](#環境変数)
- [ディレクトリ詳細](#ディレクトリ詳細)
- [デプロイ](#デプロイ)

---

## プロジェクト構成

```
nanitabeyo/
├── app-expo/        # モバイル / Web アプリ (Expo + React Native + expo-router)
├── api/             # バックエンド API (NestJS + Prisma)
├── shared/          # 共有モジュール (型, Zod スキーマ, Prisma schema, 変換ロジック等)
├── e2e-web/         # Web の E2E テスト (Playwright)
├── e2e-mobile/      # モバイルの E2E テスト (Detox)
├── catalog/         # 画面カタログの生成スクリプトと定義
├── infra/           # IaC / インフラ構成 (GCP, Supabase, Firebase, Transcoder 等)
├── scripts/         # DB マイグレーション・一回きりのバッチ作業
├── docs/            # 仕様サマリー・ランブック・意思決定記録 (docs/README.md 参照)
├── test-data/       # テスト用フィクスチャ
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

`pnpm-workspace.yaml` で `app-expo` / `api` / `shared` / `e2e-web` / `e2e-mobile` / `scripts/error-triage` の 6 つを workspace パッケージとして登録しており、Turborepo がタスクのオーケストレーションを行います。

変更を出すときの規約（コマンド、CI が回す検査、コメント、i18n、PR ルール）は [CONTRIBUTING.md](CONTRIBUTING.md) にまとめてあります。

---

## 技術スタック

### モノレポ基盤

- **pnpm 10.8** (Corepack 経由で固定)
- **Turborepo** — `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm lint` を各パッケージに伝搬
- **TypeScript 5** — `tsconfig.base.json` を各パッケージから extend

### app-expo (フロントエンド)

- **Expo SDK 54** / **React Native 0.81** / **React 19**
- **expo-router** によるファイルベースルーティング
- **React Navigation** (bottom-tabs / material-top-tabs / native)
- **Zustand** — 状態管理
- **Supabase JS** — 認証 / Storage クライアント
- **react-native-paper**, **lucide-react-native**, **Lottie**, **expo-image**, **expo-video**, **expo-camera**, **expo-location**
- **react-native-maps** / **@react-google-maps/api**
- **i18n-js** + `expo-localization` による多言語対応
- **EAS Build / Submit / Update** によるネイティブビルド配信

### api (バックエンド)

- **NestJS 11** (Express プラットフォーム)
- **Prisma 7** + **PostgreSQL** (`@prisma/adapter-pg`)
- **Zod** — リクエスト/レスポンスのスキーマ検証
- **Passport (JWT)** — 認証
- **nestjs-cls** — リクエストスコープのコンテキスト管理
- **OpenTelemetry** / **prom-client** — 計装
- **Swagger** — API ドキュメント自動生成
- **Google Cloud SDK** — Cloud Storage / Cloud Tasks / Vision / Video Transcoder / Places API
- **Sharp** / **Jimp** — 画像処理
- **expo-server-sdk** — プッシュ通知

### shared

- API 型定義 (v1 / v2)、Zod スキーマ、Prisma スキーマ、Supabase 型、Remote Config 定義、共通 utility / converter。
- API と app-expo の双方から `workspace:*` で参照。

### インフラ

- **Google Cloud Platform** — Cloud Run (API), Cloud Tasks, GCS, BigQuery, Video Transcoder, URL Map (CDN)
- **Supabase** — Auth / Database / Storage
- **Firebase Hosting** — Web 配信
- **GitHub Actions** — EAS Build/Submit/Update、API デプロイ、Firebase デプロイ、E2E テスト等を自動化

---

## 前提環境

| ツール                   | バージョン      | 備考                                                  |
| ------------------------ | --------------- | ----------------------------------------------------- |
| **Node.js**              | 22.x            | `Dockerfile` で `node:22-alpine` を使用               |
| **pnpm**                 | 10.8.0          | Corepack で固定 (`package.json` の `packageManager`)  |
| **Git**                  | 最新            |                                                       |
| **Xcode**                | 最新 (iOS のみ) | iOS シミュレータで動かす場合                          |
| **Android Studio**       | 最新            | Android エミュレータで動かす場合                      |
| **Expo Go / Dev Client** | —               | 実機で動かす場合 (`expo start --dev-client --tunnel`) |

> 💡 `pnpm` は npm や yarn で直接インストールせず、**必ず Corepack 経由**で有効化してください。プロジェクトの `packageManager` フィールドに記載されたバージョンに自動で揃います。

---

## 初期セットアップ

### 1. リポジトリを clone

```bash
git clone https://github.com/Ayato-kosaka/nanitabeyo.git
cd nanitabeyo
```

### 2. Corepack を有効化して pnpm をセットアップ

```bash
# Corepack を有効化 (Node.js に同梱されている pnpm/yarn のシム機構)
sudo corepack enable

# package.json の packageManager フィールド (pnpm@10.8.0) に従ってアクティベート
corepack prepare --activate
```

> macOS / Linux で `sudo` が不要な環境ではそのまま `corepack enable` で OK です。Windows (PowerShell) の場合は管理者権限で `corepack enable` を実行してください。

インストール後、バージョンを確認：

```bash
pnpm -v   # → 10.8.x 以上
node -v   # → v22.x
```

### 3. 依存関係をインストール

```bash
pnpm install
```

ルートで一度実行すれば、全 workspace パッケージの依存が一括で解決されます。`.npmrc` で `legacy-peer-deps=true` が設定されているため、React Native 周りの peer dependency 不整合は自動的に解決されます。

### 4. 環境変数を準備

各パッケージごとに `.env` が必要です。詳細は [環境変数](#環境変数) セクションを参照してください。

---

## 開発の始め方

### モバイル / Web アプリを起動 (app-expo)

```bash
# ルートディレクトリで
pnpm --filter app-expo dev
```

これは内部的に `app-expo` ワークスペースの `expo start --dev-client --tunnel` を実行します。tunnel を使わない場合は `pnpm --filter app-expo start`。起動後、ターミナルに表示される QR コードを：

- **iOS**: Camera アプリでスキャン → Expo Dev Client で開く
- **Android**: Expo Dev Client アプリでスキャン
- **Web**: 表示される URL をブラウザで開く、または `w` キーを押下

その他の起動方法：

```bash
pnpm --filter app-expo run ios       # iOS シミュレータ
pnpm --filter app-expo run android   # Android エミュレータ
pnpm --filter app-expo run web       # Web ブラウザ
```

### API サーバーを起動 (api)

```bash
pnpm run dev -F api
```

内部的には `nest start api --watch` と Prisma スキーマの dist へのコピーを並列実行します。デフォルトでは `http://localhost:3000` で起動し、`/api/docs` で Swagger UI が確認できます (環境により異なる場合があります)。

### 複数パッケージを同時に起動

```bash
# api と app-expo を同時に起動
pnpm dev
```

Turborepo によって、対象のワークスペースで `dev` スクリプトが定義されているものが並列で起動されます。

---

## よく使うコマンド

### ルートのスクリプト

| コマンド                  | 説明                                                     |
| ------------------------- | -------------------------------------------------------- |
| `pnpm dev`                | 全パッケージで `dev` を並列実行                          |
| `pnpm dev -F app-expo`    | app-expo のみ起動                                        |
| `pnpm dev -F api`         | api のみ起動                                             |
| `pnpm build`              | 全パッケージをビルド (Turborepo が依存順に実行)          |
| `pnpm lint`               | 全パッケージで lint                                      |
| `pnpm typecheck`          | 全パッケージで型チェック                                 |
| `pnpm format`             | Prettier でリポジトリ全体をフォーマット                  |
| `pnpm db:migration`       | DB マイグレーションを適用 (`scripts/apply-migration.sh`) |
| `pnpm db:pull`            | DB から Prisma スキーマを引き戻す (`scripts/db-pull.sh`) |
| `pnpm db:reset`           | DB スキーマをリセット (`scripts/reset-schema.sh`)        |
| `pnpm deploy:api`         | api を本番デプロイ (Cloud Run)                           |
| `pnpm deploy:storage`     | Firebase Storage のルールをデプロイ                      |
| `pnpm test:e2e`           | Web の E2E (Playwright)                                  |
| `pnpm test:e2e:mobile`    | モバイルの E2E (Detox)                                   |
| `pnpm catalog:doc`        | 画面カタログ `docs/ui-catalog.md` を生成                 |
| `pnpm catalog:doc:mobile` | 画面カタログ `docs/ui-catalog-mobile.md` を生成          |

### app-expo の主なスクリプト (`pnpm --filter app-expo run …`)

| スクリプト         | 説明                                                                |
| ------------------ | ------------------------------------------------------------------- |
| `dev`              | `expo start --dev-client --tunnel`                                  |
| `start`            | `expo start`                                                        |
| `ios` / `android`  | 各シミュレータ / エミュレータで起動                                 |
| `web`              | Web ターゲットで起動                                                |
| `build:web`        | Web 用に export                                                     |
| `lint`             | `expo lint`                                                         |
| `typecheck`        | `tsc -p tsconfig.dev.json --noEmit`                                 |
| `test`             | `jest`（監視は `test:watch`）                                       |
| `assert:*`         | Remote Config 既定値 / e2e hook / BlurModal 境界の検査（CI で実行） |
| `generate:sitemap` | Web 用サイトマップ生成                                              |

### api の主なスクリプト (`pnpm --filter api run …`)

| スクリプト           | 説明                                 |
| -------------------- | ------------------------------------ |
| `dev`                | NestJS watch + Prisma スキーマ同期   |
| `build`              | `nest build` + Prisma スキーマコピー |
| `start:prod`         | `node dist/main`                     |
| `test` / `test:e2e`  | Jest テスト                          |
| `lint` / `typecheck` | ESLint / `tsc --noEmit`              |

---

## 環境変数

機密情報は git にコミットされません (`.gitignore` で `.env*` を除外、`.env.example` のみ追跡)。

- **`api/.env`** — DB 接続文字列 (`DATABASE_URL`)、Supabase、Google Cloud 認証情報、CDN 署名鍵など。`prisma.config.ts` がこのファイルを読み込みます。
- **`app-expo/.env`** — Expo public 環境変数 (`EXPO_PUBLIC_*`)。Supabase URL/anon key、API base URL など。

API の必須環境変数は `api/src/core/config/env.ts` の zod スキーマが唯一の正です（1 つでも欠けると起動しません）。

---

## ディレクトリ詳細

### `app-expo/`

```
app-expo/
├── app/                # expo-router のルート (ファイルベースルーティング)
├── components/         # 再利用可能な UI コンポーネント
├── features/           # 機能単位の画面・ロジック
├── hooks/              # カスタム Hooks
├── stores/             # Zustand ストア
├── contexts/           # React Context
├── lib/                # API クライアント、Supabase クライアント等
├── locales/, languages/ # i18n リソース
├── assets/             # 画像・フォント・Lottie
├── app.config.ts       # Expo 設定 (動的)
├── eas.json            # EAS Build/Submit/Update プロファイル
└── metro.config.js     # Metro バンドラ設定 (monorepo 対応)
```

### `api/`

```
api/
├── src/
│   ├── v1/, v2/        # バージョニングされた REST エンドポイント
│   ├── core/           # 共通モジュール (認証, ロギング, エラーハンドリング)
│   ├── internal/       # 内部用エンドポイント (Cloud Tasks 等)
│   ├── tools/          # バッチ処理・ワンショットスクリプト
│   ├── health/         # ヘルスチェック
│   ├── prisma/         # Prisma 拡張
│   └── main.ts         # NestJS エントリポイント
├── prisma/             # Prisma クライアント生成設定
├── test/               # ユニット / E2E / 機能テスト
└── nest-cli.json
```

Prisma の **スキーマ本体は `shared/prisma/schema.prisma`** に置かれており、`prisma.config.ts` によってルートから参照されます。

### `shared/`

```
shared/
├── api/v1/, api/v2/    # API I/O 型・Zod スキーマ
├── prisma/             # Prisma schema 本体
├── converters/         # DB ↔ DTO 変換
├── supabase/           # Supabase 型定義
├── remoteConfig/       # Remote Config 用の型・定数
├── utils/              # 共通 utility
└── scripts/            # スキーマ生成等の補助スクリプト
```

### `infra/`

GCP / Supabase / Firebase / Cloud Run / Cloud Tasks / GCS / BigQuery / Transcoder / URL Map など、IaC 寄りの構成ファイル・スクリプトを格納しています。

### `docs/`

横断的な仕様サマリー (`specs/`)、運用ランブック (`runbooks/`)、意思決定記録 (`decisions/`) を置いています。
**設計判断は md ではなく該当コードの `【設計】` コメントに書く**方針です。何をどこへ書くかの規約は
[docs/README.md](docs/README.md) を参照してください。

---

## デプロイ

### API (Cloud Run)

```bash
pnpm run deploy:api
```

リポジトリルートの `Dockerfile` (Node 22 / distroless ベース) でマルチステージビルドし、Cloud Run にデプロイされます。CI からのデプロイは `.github/workflows/api-deploy.yml` を参照。

### モバイルアプリ (EAS)

GitHub Actions ワークフローで配信を自動化しています：

- `eas-build-develop.yml` — 開発用ビルド
- `eas-build-preview-prod.yml` — Preview / Production ビルド
- `eas-build-submit-prod.yml` — ストア提出
- `eas-update.yml` — OTA アップデート (EAS Update)

ローカルから手動で実行する場合は `pnpm --filter app-expo exec eas build` 等を利用してください。

### Web (Firebase Hosting)

`.github/workflows/firebase-hosting-deploy.yml` 経由で `app-expo` の Web export を Firebase Hosting にデプロイします。

---

## トラブルシューティング

- **`pnpm install` が peer dependency でエラー** → `.npmrc` の `legacy-peer-deps=true` が効いているか確認。
- **Expo Dev Client で接続できない** → `--tunnel` フラグが付いているか、社内ネットワーク経由でないかを確認。
- **Prisma の generate が失敗する** → `api/.env` に `DATABASE_URL` が設定されているか確認 (`prisma.config.ts` が読み込みます)。
- **iOS でネイティブモジュールエラー** → `app-expo` で `pnpm exec expo prebuild --clean` 後、Dev Client を再ビルド。

---

## ライセンス

本リポジトリは現時点では非公開ライセンスです (`UNLICENSED`)。詳細はリポジトリ所有者にお問い合わせください。
