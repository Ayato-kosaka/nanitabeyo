# 鍵と設定値をどこへ置くか

**新しい API キーを手に入れた。どこへ登録すればいいか。** それだけを答えるための頁。

## 起きた事故（2026-09-04）

Maps Embed のキーを **GitHub の Environment シークレット（development）へ登録**したのに、
Cloud Run の API は 503 を返し続けた。設定ミスではない。**置き場が違った。**

置き場は 3 つあり、**互いに繋がっていない**。

```
        ┌──────────────────────────┐
        │  GitHub Environment      │   CI 自身の資格情報。
        │  Secrets / Variables     │   WIF・SA・migration 用 DB・テストユーザー。
        └───────────┬──────────────┘
                    │  api-deploy.yml が渡すのは
                    │  API_COMMIT_ID / API_NODE_ENV の 2 個だけ
                    ▼
        ┌──────────────────────────┐
        │  Cloud Run の環境変数     │ ★ API が起動時に読むのはここだけ
        │  （GCP コンソールで手入力） │   残り 43 個は人が手で入れる約束
        └──────────────────────────┘

        ┌──────────────────────────┐
        │  EAS / Expo (EXPO_PUBLIC_*)│  アプリ（app-expo）に焼き込まれる。
        └──────────────────────────┘   ⚠️ 端末から読めるのでシークレットを置かない
```

## 判断のしかた

| その値を読むのは誰か                              | 置き場                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **API の実行時**（`api/src/**` が `env.` で読む） | **Cloud Run の環境変数**。GCP コンソールで `api-development` / `api-production` に入れる |
| **workflow の中だけ**（`${{ secrets.X }}`）       | GitHub Environment シークレット                                                          |
| **アプリの画面**（`EXPO_PUBLIC_*`）               | EAS。**シークレットは置けない**（端末から読める）                                        |

⚠️ **GitHub へ入れれば Cloud Run に届く、ということはない。**
下の表で «置き場» が Cloud Run のものは、GitHub 側に何個登録しても API には届かない。

⚠️ **シークレットの値を workflow の入力欄へ打たない。** dispatch の inputs は
マスクされず run 履歴に平文で残る（[#1764](https://github.com/Ayato-kosaka/nanitabeyo/issues/1764) の判断）。

## 入れたあと、効いているかを確かめる

**「設定した」で終わらせない。** Cloud Run の env はリビジョン単位なので、
入れただけでは既に動いているリビジョンには反映されない（新リビジョンが要る）。

| 確かめたいもの         | 手段                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------- |
| API 全体が起動するか   | `api-deploy.yml` のスモーク（`/livez` `/health` `/`）が緑か                             |
| その機能が実際に動くか | その機能を叩く e2e（例: Maps Embed → `e2e-web/tests/authenticated/maps-embed.spec.ts`） |

## 同じ資格情報が 2 つの置き場にある

`DATABASE_URL` は **3 つ**の名前で存在する。片方だけ回すと気づかないまま食い違う。

| どこ      | 名前                    | 何に使うか                                                                                                      |
| --------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Cloud Run | `DATABASE_URL`          | API の実行時接続                                                                                                |
| GitHub    | `POSTGRES_DATABASE_URL` | migration・db-script・エビデンス収集（実際に繋ぐ）                                                              |
| GitHub    | `PRISMA_DATABASE_URL`   | `api-deploy.yml` の `prisma generate` 用。**DB へは繋がない**（`prisma.config.ts` の `env()` を満たすためだけ） |

<!-- BEGIN generated: assert-env-store-map -->

> 🤖 この節は `node ./scripts/assert-env-store-map.mjs --write` が生成する。**手で編集しない**（CI が落ちる）。

## ① API が起動時に読む 45 個（`api/src/core/config/env.ts`）

GitHub 側に登録しても、下の «置き場» が Cloud Run のものは **届かない**。
`api-deploy.yml` が橋渡ししているのは 2 個だけである。

| 名前                             | 種別            | 置き場（誰が入れるか）                  | 未設定だと                   |
| -------------------------------- | --------------- | --------------------------------------- | ---------------------------- |
| `API_COMMIT_ID`                  | 設定値          | api-deploy.yml が自動で入れる           | **API が起動しない**         |
| `API_NODE_ENV`                   | 設定値          | api-deploy.yml が自動で入れる           | **API が起動しない**         |
| `CORS_ORIGIN`                    | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `DATABASE_URL`                   | 🔑 シークレット | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `DB_SCHEMA`                      | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `DB_POOL_MAX`                    | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `DB_POOL_CONNECTION_TIMEOUT_MS`  | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `DB_POOL_IDLE_TIMEOUT_MS`        | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `DB_POOL_MAX_LIFETIME_SECONDS`   | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `SUPABASE_JWT_SECRET`            | 🔑 シークレット | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `GOOGLE_PLACE_API_KEY`           | 🔑 シークレット | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `GCS_BUCKET_NAME`                | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `GCS_BUCKET_PUBLIC_NAME`         | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `GCS_STATIC_MASTER_DIR_PATH`     | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `CLAUDE_API_KEY`                 | 🔑 シークレット | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `GOOGLE_API_KEY`                 | 🔑 シークレット | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `GOOGLE_SEARCH_ENGINE_ID`        | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `GCP_PROJECT`                    | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `TASKS_LOCATION`                 | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `TRANSCODER_LOCATION`            | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `TRANSCODER_PUBSUB_TOPIC`        | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `CLOUD_RUN_URL`                  | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `TASKS_INVOKER_SA`               | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `PUBSUB_PUSH_SA`                 | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `GCS_DEV_SERVICE_ACCOUNT_BASE64` | 🔑 シークレット | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `LOG_BATCH_MAX`                  | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `LOG_SPILL_THRESHOLD`            | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `PRISMA_OPEN_BASE_MS`            | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `PRISMA_OPEN_CAP_MS`             | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `PRISMA_MAX_RETRIES`             | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `PRISMA_TX_MAX_WAIT`             | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `PRISMA_TX_TIMEOUT`              | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `GITHUB_TOKEN`                   | 🔑 シークレット | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `GITHUB_REPO_OWNER`              | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `GITHUB_REPO_NAME`               | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `DEV_AUTH_IS_ANONYMOUS`          | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `CDN_HOST`                       | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `CDN_KEY_NAME`                   | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `CDN_KEY_SECRET_B64`             | 🔑 シークレット | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `CDN_SIGNED_COOKIE_TTL_SECONDS`  | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `CDN_PUBLIC_HOST`                | 設定値          | **Cloud Run（GCP コンソールで手入力）** | **API が起動しない**         |
| `WEB_BASE_URL`                   | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `SUPABASE_URL`                   | 設定値          | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `SUPABASE_SERVICE_ROLE_KEY`      | 🔑 シークレット | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |
| `GOOGLE_MAPS_EMBED_API_KEY`      | 🔑 シークレット | **Cloud Run（GCP コンソールで手入力）** | 起動する（その機能だけ縮退） |

## ② GitHub Actions だけが使う 16 個（API は読まない）

CI 自身の資格情報である。**ここへ API の鍵を足しても、API には何も起きない。**

| 名前                                     | 使っている workflow                                                                                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMOB_APP_ADS_TXT`                      | firebase-hosting-deploy.yml                                                                                                                                                                                    |
| `CLAUDE_CODE_OAUTH_TOKEN`                | claude-worker.yml                                                                                                                                                                                              |
| `EXPO_TOKEN`                             | claude-worker.yml, e2e-mobile-test.yml, e2e-web-test.yml, eas-build-develop.yml, eas-build-preview-prod.yml, eas-build-submit-prod.yml, eas-update.yml, firebase-hosting-deploy.yml, verify-share-link-seo.yml |
| `FIREBASE_PROJECT_ID_PROD`               | firebase-hosting-deploy.yml                                                                                                                                                                                    |
| `GCP_FEATURE_CORRECTION_SERVICE_ACCOUNT` | db-script-run.yml                                                                                                                                                                                              |
| `GCP_PROJECT_ID`                         | api-deploy.yml, error-triage.yml                                                                                                                                                                               |
| `GCP_SA_KEY`                             | db-script-run.yml, evidence-collect.yml, firebase-hosting-deploy.yml, pg-table-export.yml, pg-table-import.yml                                                                                                 |
| `GCP_SERVICE_ACCOUNT`                    | api-deploy.yml                                                                                                                                                                                                 |
| `GCP_TRIAGE_SERVICE_ACCOUNT`             | error-triage.yml                                                                                                                                                                                               |
| `GCP_WIF_PROVIDER`                       | api-deploy.yml, db-script-run.yml, error-triage.yml                                                                                                                                                            |
| `GCS_BUCKET_NAME_PROD`                   | pg-table-export.yml, pg-table-import.yml                                                                                                                                                                       |
| `PLACES_TEXT_SEARCH_API_KEY`             | db-script-run.yml                                                                                                                                                                                              |
| `POSTGRES_DATABASE_URL`                  | db-migrate.yml, db-script-run.yml, pg-table-export.yml, pg-table-import.yml, verify-share-link-seo.yml                                                                                                         |
| `PRISMA_DATABASE_URL`                    | api-deploy.yml                                                                                                                                                                                                 |
| `TEST_USER_EMAIL`                        | claude-worker.yml, e2e-mobile-test.yml, e2e-web-test.yml                                                                                                                                                       |
| `TEST_USER_PASSWORD`                     | claude-worker.yml, e2e-mobile-test.yml, e2e-web-test.yml                                                                                                                                                       |

<!-- END generated: assert-env-store-map -->
