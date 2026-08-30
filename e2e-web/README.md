# e2e-web — Playwright E2E テスト

Expo Web(静的エクスポート)を Firebase Hosting 相当のローカルサーバで配信し、Cloud Run 上の `api-development` に接続して実環境相当の E2E テストを行うワークスペースです。

## 構成の全体像

```
[Playwright (Chromium/WebKit)]
        │ http://localhost:4173
        ▼
[scripts/serve-dist.mjs]  ←  app-expo/dist/（expo export --platform web の成果物）
        │                     ※ EXPO_PUBLIC_BACKEND_BASE_URL はビルド時に焼き込み
        ▼
[https://api-development.nanitabeyo.net (Cloud Run)] + [Supabase (認証)]
```

- テスト対象は **本番と同一の静的成果物**(`app-expo/dist/`)。dev server(`expo start --web`)ではない
- 認証は Supabase。アプリが起動時に**匿名サインインを自動実行**するため、大半のテストはログイン不要
- ログイン済みテストは **セッション注入方式**(後述)で実現する
- ⚠️ **Supabase の匿名サインインには 30 回/時/IP のレート制限があり、dev/prod で同一プロジェクトを共有している**。匿名セッションもログイン済みセッションと同様に「1 回だけ確立して使い回す」方式にしてあるので、通常の実行では意識する必要はない(詳細は「匿名セッションの共有(レート制限対策)」を参照)

## 前提条件

1. **Node 22 / pnpm**(リポジトリルートの README 参照)
2. **`app-expo/.env` が dev 向けに設定済み**であること
   - `EXPO_PUBLIC_BACKEND_BASE_URL=https://api-development.nanitabeyo.net` 等
   - これらの値は `expo export` 時に **dist に焼き込まれる**(ビルド後に変更しても反映されない)
3. **api-development の CORS 設定**(下記「CORS 運用手順」)
4. (ログイン済みテストのみ)テストユーザーの設定(下記「認証」)

## セットアップ

```bash
# リポジトリルートで
pnpm install
pnpm --filter e2e-web exec playwright install --with-deps chromium webkit

# 環境変数ファイルを作成(ログイン済みテストを動かす場合は値を設定)
cp e2e-web/.env.example e2e-web/.env
```

## 実行方法

```bash
# 1. Web ビルド(テスト対象の生成。アプリ変更後は再実行が必要)
pnpm --filter app-expo build:web

# 2. テスト実行(ローカル静的サーバは自動起動される)
pnpm test:e2e                       # ルートから(= pnpm --filter e2e-web test)

# e2e-web ディレクトリ内での実行バリエーション
pnpm test                           # Tier 1 + 2(@mutation は除外)
pnpm test:smoke                     # Tier 1(@smoke)のみ
pnpm test:mutation                  # Tier 3(@mutation)のみ ※ dev DB に書き込む
pnpm test:all                       # 全件(@mutation 含む)
pnpm test:ui                        # UI モード(開発時のデバッグに最適)
pnpm report                         # 直近の HTML レポートを開く
pnpm test:catalog                   # UI カタログのスクリーンショット収集(後述)
pnpm catalog:doc                    # 画面一覧ドキュメントを生成(後述)
pnpm test:harness                   # ハーネス自己検証(後述)。ビルド不要・数秒で終わる
```

- デプロイ済み環境に対して実行する場合: `PLAYWRIGHT_BASE_URL=https://... pnpm test`(ローカルサーバとビルドが不要になる)
- サーバだけ手動起動したい場合: `pnpm serve:dist`(→ http://localhost:4173)

## テスト 3 層構造(CI との棲み分け)

| 層     | タグ        | 内容                                                     | 実行タイミング                                            |
| ------ | ----------- | -------------------------------------------------------- | --------------------------------------------------------- |
| Tier 1 | `@smoke`    | 起動・直リンク・タブ導線の最小確認                       | 全ブラウザ + デプロイ後検証(下記 CI 参照)                 |
| Tier 2 | 無タグ      | 機能テスト全般(フォーム・モーダル・SEO・実 API 読み取り) | desktop-chrome。夜間 CI で毎日実行                        |
| Tier 3 | `@mutation` | dev DB への書き込み(いいね/保存・レビュー投稿)           | **既定では実行されない**。`RUN_MUTATION=1` で明示実行のみ |

将来 PR ゲートを追加する場合は `test:smoke`(約5分)をそのまま使える構成。

## console error / pageerror の既定ゲート(REL-08 / #1500)

`fixtures/test.ts` の auto フィクスチャ `consoleErrors` は、収集した console error /
pageerror が 1 件でもあれば **spec が何もアサートしていなくても** teardown でテストを失敗させる。
つまり「画面は出ているがコンソールが真っ赤」という状態は、専用の spec を書かなくても検知される。

- 既知の無害なノイズは `fixtures/test.ts` の `KNOWN_CONSOLE_NOISE` に**理由コメント付きで**追加する。
  ここに一致するメッセージは収集されない
- 失敗したときは、レポートに添付される `console-errors.txt` に全文が入っている
- `page` を使わない spec(`@playwright/test` を直 import している `tests/config/` など)は
  このフィクスチャを経由しないため対象外

### ゲート自体のテスト(`tests/harness/`)

ゲートは「全 spec の既定の失敗条件」なので、**壊れても個々の spec は緑のまま**になり、
気付かないうちに無効化されうる。これを防ぐため、ゲート自身を検証する spec を置いている。

| ファイル                                           | 内容                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `tests/harness/console-error-gate.spec.ts`         | 収集される/されないの境界(未知の error・pageerror・既知ノイズ・warn/log)                                        |
| `tests/harness/console-error-gate-failure.spec.ts` | `test.fail()` で「ゲートが実際にテストを落とすこと」を固定。壊れると "Expected to fail, but passed." で赤くなる |

- 実行対象はダミーページ(`utils/consoleHarness.ts` の `page.setContent()`)だけで、
  アプリのビルド・API・認証に一切依存しない。専用プロジェクト `harness` で数秒で回る
- `HARNESS_GATE_RAW=1 pnpm test:harness` を付けると `test.fail()` が無効になり、
  ゲートが出す実際の失敗メッセージごと赤くなる(文言の確認・エビデンス撮影用)

## CI(GitHub Actions)

| ワークフロー                  | トリガー                          | 内容                                                                                                                                                                                                           |
| ----------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e-web-test.yml`            | 毎晩 JST 3:00 + workflow_dispatch | EAS の development 環境変数でビルド → Tier 1+2 を全ブラウザ実行(ubuntu-latest は WebKit も動作)。HTML レポートを artifact として 14 日保存。手動実行時は `capture_ui_catalog` で UI カタログも収集できる(後述) |
| `firebase-hosting-deploy.yml` | (既存のデプロイ時)                | **デプロイ前**: firebase.json の rewrite 先が dist に実在するかの静的ゲート(`--project=config`)。**デプロイ後**: デプロイされた URL への @smoke(本番 404 の即日検知)                                           |

必要な GitHub Secrets(リポジトリレベル):

- `EXPO_TOKEN` — 既存(EAS env:pull 用)
- `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` — E2E テストユーザー(未設定でも authenticated 系がスキップされるだけで他は動く)

CI の並列度は `playwright.config.ts` が `CI=true` のとき workers=2 に自動調整する。匿名サインインの消費は共有セッション方式(前述)により 1 回のフル実行で数回程度に抑えられており、レート制限(30 回/時/IP)には十分収まる。

## 認証(ログイン済みテスト)

このアプリのログイン UI は Google/Apple OAuth のみで、外部 IdP は Playwright で自動化できない。そのため **Supabase のテストユーザーでセッションを取得し localStorage に注入する方式**(Playwright 公式推奨の auth setup パターン)を採用している。

### 仕組み

1. `tests/setup/auth.setup.ts` が `signInWithPassword` でセッション取得
2. `sb-<projectRef>-auth-token` キーにセッションを格納した storageState を `.auth/user.json` に保存
3. `desktop-chrome-authenticated` プロジェクト(`tests/authenticated/` 配下)が storageState を再利用

### テストユーザーの準備(1 回だけ)

1. Supabase dev プロジェクトのダッシュボード → Authentication → Users → **Add user** で email+password ユーザーを作成(例: `e2e+ci@nanitabeyo.test`)
2. Authentication → Providers → **Email を ON** にする(OFF だと `Email logins are disabled` で signInWithPassword が失敗する)
   - あわせて **「Allow new users to sign up」を OFF** にすれば、パスワードログインは事前作成ユーザーのみ有効になり、アプリ側の露出は増えない
3. `e2e-web/.env` に認証情報を設定する(**コミット禁止**):
   ```
   TEST_USER_EMAIL=e2e+ci@nanitabeyo.test
   TEST_USER_PASSWORD=********
   ```

未設定の場合、`tests/authenticated/` 配下は自動的にスキップされる。

### ⚠️ ログアウトを実行するテストは共有 storageState を使わない

アプリの `handleLogout` は `logout({ scope: "local" })` を呼ぶが、これは localStorage を消すだけでなく
`POST /auth/v1/logout?scope=local` で **そのセッションをサーバ側でも失効させる**。共有 storageState
(`.auth/user.json`) のセッションでログアウトすると、並列実行中/後続の authenticated テストが
「ログイン済みのはずなのに 403 でゲスト扱い」になって軒並み落ちる(実測済み)。

そのため `tests/authenticated/logout.spec.ts` は共有 storageState を捨て、
`utils/testUserSession.ts` の `signInTestUser()` で **そのテスト専用のセッション** を発行して注入している。
ログアウト(あるいはセッションを失効させる操作)を伴うテストを追加する場合は必ずこの方式に従うこと。

## 匿名セッションの共有(レート制限対策)

Supabase の匿名サインインは **30 回/時/IP** のレート制限があり、しかも dev/prod で同一 Supabase プロジェクト(`dish-scroll-prod`)を共有している。アプリは `AuthProvider` が起動時にセッションが無ければ自動で匿名サインインするため、テストごとに新規ブラウザコンテキストで起動する = テストごとに新規匿名ユーザーを作成する実装のままだと、E2E スイートを 1 回フルで回すだけで上限に達してしまう(429 でテストが不安定になる)。

これを避けるため、ログイン済みユーザーと同じ考え方で匿名セッションも「1 回だけ確立して使い回す」方式にしている:

1. `tests/setup/anon.setup.ts` が匿名サインインを 1 回行い、storageState を `.auth/anon.json` に保存
2. `desktop-chrome` / `mobile-chrome` / `mobile-safari` の各プロジェクトがこの storageState を共有・再利用(`dependencies: ["anon-setup"]`)
3. 匿名サインインの自動確立**そのもの**を検証する `tests/smoke/boot.spec.ts` だけは、ファイル冒頭で `test.use({ storageState: { cookies: [], origins: [] } })` して意図的にフレッシュな状態に戻している

この結果、E2E スイート全体(3 デバイスプロジェクト分)を通しても匿名サインインの消費は実質 1 回(+ boot.spec.ts のフレッシュ分 + logout.spec.ts の再確立分)まで削減される。**新しいテストファイルを追加する際も、匿名ユーザーで十分な内容であれば `appPage` フィクスチャをそのまま使えばよい**(共有 storageState は自動的に効く)。匿名サインイン自体の挙動を検証したい場合のみ、boot.spec.ts のように明示的に `storageState` を上書きすること。

なお `tests/authenticated/logout.spec.ts` は「ログアウト後に匿名セッションが再確立されること」自体が検証対象のため、
共有セッションでは代替できず **実際に 1 回消費する**。だからこそ 3 つの観点(ホームへ戻る / 固まらない / API が成功する)を
1 テストにまとめてあり、ここをテスト分割すると消費が人数分増える点に注意すること。

## UI カタログ(全画面のスクリーンショット収集)

「今どんな画面が存在するのか」を、スクリーンショット + 画面名 / URL / 遷移関係の一覧として書き出す仕組み。
Claude Design などへ渡して UI カタログ・画面遷移図を作る用途を想定している。

**これはテストではない**(アプリの正しさは検証しない)。実データに依存して到達できない画面があっても
ジョブは赤くせず、「未取得」として一覧に残す。

**画面定義はリポジトリルートの `catalog/` に置き、e2e-mobile(Detox)と共有している**
(仕組み全体の説明は [`catalog/README.md`](../catalog/README.md))。

| 要素                                             | 役割                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `../catalog/screens.json`                        | **画面定義の唯一の情報源**(Web / モバイル共通)                         |
| `../catalog/generate-catalog.mjs`                | 定義 × 撮影結果 → `UI_CATALOG.md` / `ui-catalog.json` を生成(依存ゼロ) |
| `tests/catalog/ui-catalog.spec.ts`               | 匿名ユーザーで到達できる画面の巡回・撮影(`@catalog`)                   |
| `tests/catalog/ui-catalog-authenticated.spec.ts` | ログイン済みでのみ到達できる画面の巡回・撮影(`@catalog`)               |
| `tests/catalog/ui-catalog-mutation.spec.ts`      | レビュー投稿フロー(`@catalog @mutation`。dev DB へ書き込む)            |
| `utils/catalog.ts`                               | 撮影と結果記録のヘルパ(`captureScreen` / `captureScreenIfReachable`)   |

```bash
# 1. 通常の E2E と同じ前提(dist のビルド + api-development への到達)が必要
pnpm --filter app-expo build:web

# 2. 収集(screenshots/<画面 ID>.png と screenshots/.results/<ファイル名>.json が出来る)
pnpm test:catalog          # レビュー投稿フローを除く
pnpm test:catalog:all      # レビュー投稿フローも撮る(dev DB へ書き込む)

# 3. 一覧生成(screenshots/UI_CATALOG.md) ※リポジトリルートで実行する
pnpm catalog:doc
```

- `@catalog` タグにより **既定の `pnpm test` からは除外**される(実行時間と目的が違うため)。
  `RUN_CATALOG=1` を付けた `test:catalog` からのみ実行される
- **ファイル名は必ず `<画面 ID>.png`**。GCS へ公開したときに URL だけを見て画面が分かるよう、
  ID は ASCII の英小文字・数字・ハイフンで付けること(`evidence-collect.yml` が
  `[A-Za-z0-9._-]` 以外を `_` に潰すため、日本語名は公開 URL では読めなくなる)
- 画面を追加・変更したら **`catalog/screens.json` を更新**する。spec は定義済み ID しか撮れず、
  未定義 ID を渡すとその場で失敗する(名前・URL・説明の二重管理を防ぐため)
- リポジトリにコミットしている一覧は `docs/ui-catalog.md`(スクリーンショット本体はコミットしない)

### CI での収集と公開

1. `E2E Web Test` を **`capture_ui_catalog = true`** で手動実行する
   - スクリーンショットだけ欲しい場合は `run_e2e_tests = false` にすると Tier 1+2 をスキップできる
   - レビュー投稿フローまで撮る場合は `capture_review_flow = true`(**dev DB へ書き込む**)
2. Artifact `ui-catalog-screenshots`(PNG 一式 + `UI_CATALOG.md` + `ui-catalog.json`)がダウンロードできる。
   一覧は Job Summary にも出力される
3. その run を `Evidence Collect` に渡す(`run_id` / `artifact_name: ui-catalog-screenshots` / `source_sha`)と
   `nanitabeyo-public` へ公開され、**写真付きの一覧ページ(`index.html`)と公開 URL** が手に入る
4. 公開 URL 付きの一覧を作り直す場合は、manifest を落として
   `node ./catalog/generate-catalog.mjs --screenshots e2e-web/screenshots --manifest <manifest.json>` を実行する

## CORS 運用手順

Web 版は `fetchWithAuth` が `Authorization` ヘッダ + `credentials: "include"` で API を呼ぶため、**テストオリジン(`http://localhost:4173`)が api-development の `CORS_ORIGIN` に含まれている必要がある**。

`api` はカンマ区切りで複数オリジンを受け付ける(`api/src/core/config/env.ts`)。`CORS_ORIGIN` は `api-deploy.yml` では設定されない(サービス側管理)ため、以下の 1 回の更新がデプロイを跨いで維持される:

```bash
# 現在値の確認
gcloud run services describe api-development --project food-scroll --region asia-northeast1 \
  --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep CORS

# 既存オリジンを必ず含めてカンマ区切りで更新(^@^ はカンマを値に含めるためのデリミタ指定)
gcloud run services update api-development --project food-scroll --region asia-northeast1 \
  --update-env-vars '^@^CORS_ORIGIN=<既存のオリジン>,http://localhost:4173,http://127.0.0.1:4173'
```

ローカル起動の API(`pnpm dev -F api`)に対してテストする場合は、`api/.env` の `CORS_ORIGIN` に `,http://localhost:4173` を追記する。

## ディレクトリ構成

```
e2e-web/
├── playwright.config.ts   # 設定の中核(プロジェクト定義・3 層構造の安全弁など)
├── scripts/serve-dist.mjs # Firebase Hosting の rewrite を模した静的サーバ(依存ゼロ)
├── fixtures/
│   ├── test.ts            # カスタムフィクスチャ(全 spec はここから import すること)
│   └── assets/            # テスト用アセット(投稿テスト用画像など)
├── utils/                 # 認証待ち・localStorage シード等のヘルパ
├── pages/                 # Page Object Model(1 画面 = 1 クラス)
└── tests/
    ├── setup/             # 認証セットアップ(auth.setup.ts: ログイン済み / anon.setup.ts: 匿名共有セッション)
    ├── config/            # 設定整合性チェック(firebase.json rewrite × dist。ブラウザ不要・デプロイ前ゲート)
    ├── catalog/           # UI カタログ用のスクリーンショット収集(@catalog。既定の test からは除外)
    │                      #   画面定義と一覧生成はリポジトリルートの ../catalog/ にある
    ├── harness/           # E2E ハーネス自身の自己検証(console error ゲート。ビルド・API 不要)
    ├── smoke/             # Tier 1: @smoke(boot.spec.ts のみフレッシュな匿名状態で実行)
    ├── navigation/ search/ review/ profile/ seo/   # Tier 2
    └── authenticated/     # ログイン済みプロジェクト専用(Tier 2 + @mutation)
```

## テスト追加ガイドライン

- **粒度**: 1 spec ファイル = 1 画面 or 1 機能。1 `test()` = ユーザー視点の 1 シナリオ。細かい UI 検証はシナリオ内の複数 expect に集約し、テスト数の爆発を防ぐ
- **セレクタ優先順位**: `getByTestId` > `getByRole` > ja-JP 文字列の `getByText`
  - React Native の `testID` prop は Web では `data-testid` に変換される。必要なら app-expo 側に testID を追加してよい(挙動に影響しない)
  - i18n 文字列セレクタは翻訳変更で壊れるため、コメントで参照元(ja-JP.json のキー)を明記する
- **書き込みの原則**: 共有 dev 環境への書き込みは `@mutation` タグ + テスト専用ユーザーのみ。
  - いいね/保存 ⇄ 解除は、ハッピーパスでは解除まで実行して元に戻すよう書く。ただし
    **これは保証されたロールバックではない**: テスト途中の expect() が失敗すると、
    その時点で test は終了し、以降の解除処理は実行されない(try/finally 等の後始末は
    意図的に未実装)。**アサーション失敗時は dev DB に状態が残る(不可逆になりうる)ことを
    許容している**(詳細は `tests/authenticated/reactions.spec.ts` のコメント参照)
  - 不可逆なレビュー投稿はコメントに **`[E2E]` プレフィックス**を付けて識別可能にする(削除 UI がないため dev DB に蓄積する。承認済み)
  - フィードバック送信(GitHub issue が作られる)は**送信しない**
- **フレーク対策**:
  - API を叩くテストは `appPage` フィクスチャを使う(匿名セッション確立を待ってから操作する)
  - 検索チュートリアルは fixtures が自動抑止する。チュートリアル自体のテストのみ `test.use({ seedTutorialSeen: false })`
- **import 規約**: spec は必ず `fixtures/test` から `test` / `expect` を import する(`@playwright/test` 直 import 禁止)

## 補足

- 認証フローの「どこが自動テストで守られていて、どこが守られていないか」の一覧は
  [`docs/specs/auth-e2e-coverage.md`](../docs/specs/auth-e2e-coverage.md) にまとめてある。認証まわりのテストを増減させたら合わせて更新すること
- `turbo run test` を使う場合は `--filter=!e2e-web` で除外すること(E2E は実ブラウザ + 共有 dev 環境依存でキャッシュに不適なため、turbo タスクには組み込んでいない)
- `pnpm typecheck`(ルート)で e2e-web の型チェックも turbo 経由で実行される
