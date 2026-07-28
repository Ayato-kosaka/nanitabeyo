# e2e-mobile — Detox E2E テスト

`app-expo` を `expo prebuild` + Gradle / xcodebuild でネイティブビルドし、Android エミュレータ / iOS シミュレータ上で、Cloud Run の `api-development` に接続して実環境相当の E2E テストを行うワークスペースです。方針は `e2e-web/`(Playwright)を踏襲しています。

> 現在の実装範囲: **Android / iOS 両対応。共通基盤(fixtures / Tier 機構 / 認証セッション注入)+ Tier 1〜2 のシナリオ**
> (smoke / navigation / search / profile / review)。認証済み(ログイン済み)シナリオと `@mutation` の拡充は後続。
> 設計と決定の経緯は #1027 とその Sub-issue(#1028 / #1029 / #1030 / #1031)を参照。

## 構成の全体像

```
[Detox (jest ランナー)]
      │ adb / simctl
      ▼
[Android エミュレータ / iOS シミュレータ]
      │  app-expo を expo prebuild + Gradle/xcodebuild した **release ビルド**
      │  ※ EXPO_PUBLIC_BACKEND_BASE_URL 等はビルド時に焼き込み(eas env:pull development)
      ▼
[https://api-development.nanitabeyo.net (Cloud Run)] + [Supabase (認証)]
```

- テスト対象は **本番と同一形態の成果物**(スタンドアロンの release ビルド)。dev client + Metro ではない
  - JS バンドルが APK / .app に埋め込まれるため、成果物 1 つでテストが完結する(CI のジョブ分割・artifact 化に向く)
  - `__DEV__` 分岐・LogBox のエラーオーバーレイが混入しないため、本番と同じコードパスを検証できる
- 認証は Supabase。アプリは起動時に**匿名サインインを自動実行**する
- ⚠️ **Supabase の匿名サインインには 30 回/時/IP のレート制限があり、dev/prod で同一プロジェクトを共有している**。
  そのため本ワークスペースは「Node 側で 1 回だけセッションを確立し、起動引数でアプリへ注入する」方式を採る(後述「匿名セッションの共有」)

## 前提条件

1. **Node 22 / pnpm**(リポジトリルートの README 参照)
2. **JDK 17**(Gradle / AGP 8.x の要求)+ **Android SDK / エミュレータ**(`adb` にパスが通っていること)
3. **`app-expo/.env` が dev 向けに設定済み**であること
   - `EXPO_PUBLIC_BACKEND_BASE_URL` / `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` 等
   - これらの値は **ネイティブビルド時に JS バンドルへ焼き込まれる**(ビルド後に変更しても反映されない)
   - `EXPO_PUBLIC_SUPABASE_*` は **テスト側(Node)からも参照する**(Supabase 接続情報の重複管理を避けるため、
     `e2e-mobile/.env` ではなく `app-expo/.env` を正とする。e2e-web と同じ方針)
4. **google_apis イメージの AVD**(アプリが Google Play services = Maps / AdMob / Firebase に依存するため)
5. (ログイン済みテストのみ)テストユーザーの設定(下記「認証」)

## セットアップ

```bash
# リポジトリルートで
pnpm install
pnpm -F shared run build

# development 環境変数を取得(EXPO_PUBLIC_* がビルドに焼き込まれ、テスト側の Supabase 接続にも使われる)
cd app-expo && pnpx eas-cli env:pull development --non-interactive --path .env && cd ..

# 環境変数ファイルを作成(ログイン済みテストを動かす場合や AVD 名を変える場合に値を設定)
cp e2e-mobile/.env.example e2e-mobile/.env
```

## 実行方法

### Android

```bash
# 1. ネイティブプロジェクト生成(E2E_DETOX=1 で Detox 用 config plugin を有効化)
cd app-expo && E2E_DETOX=1 pnpm exec expo prebuild --platform android --no-install && cd ..

# 2. release APK + androidTest APK をビルド(アプリ変更後は再実行が必要)
pnpm --filter e2e-mobile build:android

# 3. エミュレータのロケールを ja-JP に固定する(1 回だけ。ランタイム再起動を伴うため数十秒かかる)
adb shell setprop persist.sys.locale ja-JP && adb shell setprop ctl.restart zygote

# 4. テスト実行(AVD が起動していること。名前が e2e_avd 以外なら DETOX_AVD_NAME で指定)
pnpm test:e2e:mobile                          # ルートから(= pnpm --filter e2e-mobile test)

# e2e-mobile ディレクトリ内での実行バリエーション
pnpm test:android                             # Tier 1 + 2(tests/mutation/ は除外)
pnpm test:smoke:android                       # Tier 1(tests/smoke/)のみ
pnpm test:mutation:android                    # Tier 3(tests/mutation/)のみ ※ dev DB に書き込む
pnpm test:all:android                         # 全件(@mutation 含む)
```

### iOS

```bash
# 1. ネイティブプロジェクト生成 + Pod install
cd app-expo && E2E_DETOX=1 pnpm exec expo prebuild --platform ios --no-install && cd ios && pod install && cd ../..

# 2. シミュレータ用 Release ビルド(署名不要)
pnpm --filter e2e-mobile build:ios

# 3. テスト実行(機種は既定 iPhone 16。変更する場合は DETOX_IOS_DEVICE で指定)
pnpm --filter e2e-mobile test:ios             # Android と同じく :smoke / :mutation / :all もある
```

- 事前に `brew tap wix/brew && brew trust wix/brew && brew install applesimutils` が必要(Detox 公式手順)
- **CocoaPods は 1.15.2 を使うこと**。runner 既定の 1.17.0 は pnpm monorepo で `pathname contains null byte` が断続発生する(CocoaPods#12798 / #12866)
- iOS はロケール・権限を `launchApp` 側で固定するため、手動設定は不要

### 共通の注意

- prebuild と native ビルドは `detox test` に**含めていない**(毎回のリビルドを避けるため)。アプリを変更したらビルド手順をやり直すこと
- 失敗時のスクリーンショットは `e2e-mobile/artifacts/` に出力される
- **iOS は Detox の同期機構を無効化している**(`fixtures/e2e.ts` の `platformLaunchOptions`)。メインキューに常駐する作業があり同期が永遠にアイドルにならないため、待機は `waitFor` のポーリングに委ねている(恒久対応は #1040)

## テスト 3 層構造(CI との棲み分け)

| 層     | ディレクトリ                                                                                | 内容                                       | 実行タイミング                                        |
| ------ | ------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| Tier 1 | `tests/smoke/`                                                                              | 起動・タブ導線の最小確認                   | 夜間 CI + 手動実行。将来の PR ゲート候補              |
| Tier 2 | `tests/navigation/` `tests/search/` `tests/review/` `tests/profile/` `tests/authenticated/` | 機能テスト全般(実 API 読み取り)            | 夜間 CI                                               |
| Tier 3 | `tests/mutation/`                                                                           | dev DB への書き込み(いいね/保存・レビュー) | **既定では実行されない**。`RUN_MUTATION=1` で明示実行 |

**ディレクトリ = Tier を正とする。** `@smoke` / `@mutation` はレポート上の可読性のため `describe` 名にも併記するが、フィルタの正には使わない(タグ文字列とディレクトリの二重管理を避けるため)。

Tier 3 の安全弁は **2 段構え**(#1028 §6-3 / #1030 レビュー M-3):

1. **設定段(主防御)**: `jest.config.js` の `testPathIgnorePatterns` が `tests/mutation/` を探索から外す
   → `RUN_MUTATION=1` が無い限り**ファイルがロードされない**(テスト名フィルタと違い fail-open しない)
2. **コード段(二重ガード)**: mutation spec は `describeMutation`(`fixtures/e2e`)を使う
   → `--testPathPattern` などで設定をバイパスされても skip される

## CI(GitHub Actions)

| ワークフロー           | トリガー                          | 内容                                                                                                                                 |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `e2e-mobile-test.yml`  | 毎晩 JST 4:00 + workflow_dispatch | Android(ubuntu + KVM)と iOS(macos-15 / Xcode 26.2)を独立ジョブで実行。prebuild → ネイティブビルド → Detox 実行 → artifact 保存(7 日) |
| `evidence-collect.yml` | workflow_dispatch                 | 指定 run の artifact をエビデンスブランチへ回収する補助ワークフロー(Artifact へ直接アクセスできない環境向け)                         |

`workflow_dispatch` の入力:

- `platform`: `all`(既定)/ `android` / `ios`
- `scope`: `tier1-2`(既定)/ `tier1`(smoke のみ)/ `mutation`(**dev DB へ書き込む**)

夜間 cron は入力が空になるため `platform=all` / `scope=tier1-2` へフォールバックする。

必要な GitHub Secrets(リポジトリレベル。**e2e-web と共用で、新規 secret は追加しない**):

- `EXPO_TOKEN` — 既存(`eas env:pull` 用)
- `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` — E2E テストユーザー(未設定でも `describeAuthenticated` 配下がスキップされるだけで他は動く)

CI 側の要件(#1029 の受け入れ条件):

- **AVD 名の一致**: `.detoxrc.js` の既定値 `e2e_avd` と CI が作る AVD 名を合わせる(または `DETOX_AVD_NAME` を明示的に渡す)
- **artifact は allowlist**: device log は既定で無効(理由は下記「認証」)。screenshot / video / jest レポートのみを上げ、retention は短め(7 日)にする
- **cron 時刻を e2e-web と分離**: テストユーザーを共用しているため、同時実行すると `@mutation` の状態とセッションが衝突する

## 認証(ログイン済みテスト / セッション注入)

このアプリのログイン UI は Google/Apple OAuth のみで、外部 IdP は自動化できない。そこで **「Node 側で取得したセッションを起動引数(launchArgs)でアプリへ渡す」** 方式を採る(#1030 確定設計 A' 案)。e2e-web が storageState を注入しているのと同じ思想。

### 仕組み

```
[fixtures/globalSetup.ts]  ← run ごとに 1 回
   Node 側 supabase client (persistSession:false / autoRefreshToken:false)
     ├─ signInAnonymously()   → 匿名クォータ消費 1
     └─ signInWithPassword()  → creds 未設定なら skip / 設定済みで失敗なら hard fail
   ↓ process.env 経由でテストワーカーへ受け渡し(**トークンはディスクへ書かない**)
[各 spec]
   launchAppWithSession({ as: "anon" | "authenticated" })
     → device.launchApp({ launchArgs: { e2eAccessToken, e2eRefreshToken, e2eSessionOwner } })
     → アプリ側フックが setSession() する(app-expo 側。**別 PR で実装中**)
[fixtures/globalTeardown.ts]
   signOut({ scope: "global" }) で発行したセッションを revoke
```

- **パスワードは端末に一切渡らない**。Node プロセス内だけが知っており、端末へ渡るのはトークンのみ
- **`e2eSessionOwner` を渡すのが要点**(#1030 B-1)。アプリ側は「セッションの有無」ではなく
  **「期待ユーザーと現在ユーザーの一致」**で再注入を判断する。
  「匿名セッションが残っているせいで注入がスキップされ、認証済みのつもりのテストが匿名のまま緑になる」事故を防ぐため
- **アプリ側フックが未実装の間**、launchArgs は単に無視される(アプリは通常どおり自前で匿名サインインする)。
  渡す側の契約は確定済みなので、アプリ側 PR の合流で自動的に有効になる
- **fail-loud**: 期待するセッションが用意できていない状態で `launchAppWithSession()` を呼ぶと例外になる。
  黙って通常起動へフォールバックしない(テストが緑のまま検証内容だけ嘘になるのを防ぐ)

### セキュリティ上の必須事項(#1030 レビュー B-2)

`refresh_token` は **長期資格情報**で、access_token の 1 時間とは無関係に交換可能なまま残る。
このリポジトリは public で Actions の Artifact は実質誰でも取得できるため、次を **MUST** としている:

- **`globalTeardown` で `signOut({ scope: "global" })`**(globalSetup が途中で失敗した場合も、確立済みのセッションを revoke してから中断する)
- **Detox の device log artifact は既定で無効**(`.detoxrc.js` の `artifacts.plugins.log: "none"`)。
  logcat / Detox の debug log には launchArgs が載りうるため。収集したい場合は **launchArgs を渡さない run に限る**こと
- **トークンをディスクへ書かない**(`process.env` のみ)。ログにも出さない

### テストユーザーの準備(1 回だけ)

e2e-web と同じユーザーを共用する(`e2e-web/README.md`「テストユーザーの準備」と同一)。

1. Supabase ダッシュボード → Authentication → Users → **Add user** で email+password ユーザーを作成
2. Authentication → Providers → **Email を ON**(OFF だと `Email logins are disabled` で失敗する)
3. `e2e-mobile/.env` に認証情報を設定する(**コミット禁止**):
   ```
   TEST_USER_EMAIL=e2e+ci@nanitabeyo.test
   TEST_USER_PASSWORD=********
   ```

未設定の場合、`describeAuthenticated(...)` で書かれた spec は自動的にスキップされる。
**設定済みなのにログインに失敗した場合は hard fail** させる(skip にすると認証済みテストが黙って消え、「実行されていないのに緑」になるため)。

## 匿名セッションの共有(レート制限対策)

Supabase の匿名サインインは **30 回/時/IP**、しかも **カスタマイズ不可**で、dev/prod で同一プロジェクトを共有している。
アプリはセッションが無ければ起動時に必ず `signInAnonymously()` するため、素朴に「テストごとにデータを消して起動」すると 1 スイートで上限に達する。

対策は上記のセッション注入方式そのもの。**「状態は好きなだけ捨ててよい、セッションはコストゼロで復元できる」**状態を作ることで、
「テスト間の状態汚染を避けたい」と「レート制限を超えたくない」の二律背反を解消している。

### 消費見積(1 run / 1 プラットフォームあたり)

| 項目                                                                      | 消費         |
| ------------------------------------------------------------------------- | ------------ |
| `globalSetup` の `signInAnonymously`                                      | 1            |
| `tests/smoke/boot.test.ts`(**launchArgs なし起動**の唯一の例外)           | 1            |
| ログアウト導線のテスト(`SIGNED_OUT` でアプリが自動的に匿名サインインする) | テスト本数分 |

### 運用ルール

- **`launchAppWithoutSession()` は `tests/smoke/boot.test.ts` 以外で使わない**。
  「匿名サインインの自動確立そのもの」を検証する spec だけの例外(e2e-web の `boot.spec.ts` が共有 storageState を使わないのと同じ)
- **ログアウト導線のテストはプラットフォームごとに 1 本まで**。増やす場合はこの見積表を更新すること
- **429 になったらリトライしない**。窓が 1 時間・上限変更不可のため、リトライは run を長引かせるだけ。
  `globalSetup` は日本語の対処案内を出して即座に中断する(fail-fast)
- **`maxWorkers: 1` が前提**。並列化すると同一 refresh token を複数プロセスが同時に使い、
  Supabase の reuse 検知でセッションファミリごと失効しうる

## ロケール(ja-JP)の担保

アプリは `expo-localization` の結果でロケールを解決してリダイレクトし、検索チュートリアルは `isJapanese` で表示が分岐する。
**デバイスのロケールが ja-JP でないとシナリオが再現しない**(「たまたま通る」状態になる)ため、`utils/locale.ts` に手段を集約している(#1031 確定 B4)。

| プラットフォーム | 方法                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| iOS              | `device.launchApp({ languageAndLocale })`(Detox 公式 API。**iOS 専用**)。fixtures が自動で付与する             |
| Android          | **エミュレータのシステムロケール**を ja-JP にする。fixtures は不一致なら警告を出す(設定自体は CI / AVD の責務) |

```bash
# Android: エミュレータ起動後に 1 回だけ実行する(ランタイム再起動を伴うため数十秒かかる)
adb shell setprop persist.sys.locale ja-JP && adb shell setprop ctl.restart zygote
```

ロケール依存の画面へ入る場合は、システムロケールに頼らず `localeDeepLink("search/topics")`(= `nanitabeyo:///ja-JP/search/topics`)で
**locale セグメントを直接指定**する方が決定論的。

## ディレクトリ構成

```
e2e-mobile/
├── .detoxrc.js            # 設定の中核(configurations / artifacts / behavior)
├── jest.config.js         # テスト探索と Tier の安全弁
├── .env.example
├── fixtures/
│   ├── e2e.ts             # 共通基盤(全 spec / Screen Object はここから import すること)
│   ├── globalSetup.ts     # Detox 公式 globalSetup のラッパー + セッション事前確立
│   └── globalTeardown.ts  # Detox 公式 globalTeardown のラッパー + セッション revoke
├── utils/                 # 画面に紐づかない横断ヘルパ
│   ├── locale.ts          # ロケール固定(iOS の launchArgs / Android の adb)
│   ├── waits.ts           # 待機プリミティブとタイムアウト定数
│   ├── sessionEnv.ts      # globalSetup ↔ ワーカー間のセッション受け渡し規約
│   └── revokeSessions.ts  # signOut({ scope: "global" }) による後始末
├── screens/               # Screen Object Model(1 画面 = 1 クラス)※ シナリオ実装 PR で追加
└── tests/
    ├── smoke/             # Tier 1
    ├── navigation/ search/ review/ profile/ authenticated/   # Tier 2 ※ シナリオ実装 PR で追加
    └── mutation/          # Tier 3(既定で除外)
```

**責務の境界**

| ディレクトリ | 責務                                                                        | 禁止事項                                                         |
| ------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `fixtures/`  | 全 spec が共有する前提づくり(起動・セッション注入・ロケール・Tier の安全弁) | 画面固有のセレクタを持たない                                     |
| `screens/`   | 1 画面のセレクタ定義と、その画面固有の操作 / 検証。testID を外へ漏らさない  | テストの意図を書かない。`device.launchApp` を直接呼ばない        |
| `utils/`     | 画面に紐づかない横断ヘルパ(Supabase 直叩き・adb 操作・待機)                 | `screens/` を import しない(依存方向は screens → utils の一方向) |
| `tests/`     | ユーザー視点の 1 シナリオ = 1 `it()`                                        | `by.id(...)` の直書き(必ず Screen Object 経由)                   |

## テスト追加ガイドライン

- **粒度**: 1 spec ファイル = 1 画面 or 1 機能。1 `it()` = ユーザー視点の 1 シナリオ。細かい UI 検証はシナリオ内の複数 expect に集約する
- **import 規約**: spec / Screen Object は必ず `fixtures/e2e` から import する(**`detox` の直 import 禁止**)。
  起動手順(セッション注入・ロケール・権限)と Tier の安全弁が効かなくなるため
- **起動規約**:
  - 通常の spec は `beforeAll` で `launchAppWithSession({ as: "anon" })`(ログイン必須なら `"authenticated"`)
  - `launchAppWithoutSession()` は `tests/smoke/boot.test.ts` の専用(匿名クォータを消費するため)
  - `device.reloadReactNative()` は使わない(RN 0.82 でのクラッシュ報告があるため、`launchApp({ newInstance: true })` で統一)
- **セレクタ優先順位**: `by.id`(testID) > `by.text` の ja-JP 文字列
  - `testID` が無ければ app-expo 側に追加してよい(挙動に影響しない)。追加箇所は #1031 のカタログを参照
  - i18n 文字列セレクタは翻訳変更で壊れるため、コメントで参照元(`ja-JP.json` のキー)を明記する
- **ログイン必須の spec**: `describeAuthenticated(...)` で囲む(creds 未設定の環境では自動 skip)
- **書き込みの原則**(e2e-web のポリシーを踏襲):
  - `tests/mutation/` 配下に置き、`describeMutation(...)` で囲む
  - **必ず認証済みユーザーで実行する**(共有匿名ユーザーでは書き込まない)
  - いいね/保存 ⇄ 解除はハッピーパスでは解除まで書くが、**保証されたロールバックではない**
    (途中の expect が失敗するとその時点で終了し、以降の解除処理は走らない。`try/finally` は意図的に入れない)
  - 削除 UI が無いレビュー投稿は本文冒頭に **`[E2E]` プレフィックス**を付ける
  - フィードバック送信(GitHub issue が作られる)は**送信操作まで到達させない**
  - **課金・外部連携の禁止**: AdMob 広告の実クリック、プッシュ通知の実登録、ストアレビュー要求は行わない
- **フレーク対策**: 待機は `utils/waits.ts` のヘルパ経由にする。Detox にはネットワーク傍受 API が無いため、
  「API 応答を待つ」目的の待機は**画面上の観測点**(要素の出現/消失)で表現する

## 補足

### `@types/jest` を採用している理由(#1028 m1)

Detox 公式の TypeScript ガイドは「Jest の `expect` と Detox の `expect` の型が衝突する」既知問題を挙げ、
**(a) `@jest/globals` からの明示 import** と **(b) `@types/jest` + `detox` からの `expect` import** の 2 案を示している。
本ワークスペースは **(b)** を採用した。スパイク(#1027)で (b) が型衝突なく動作することを実測できたためで、
`describe` / `it` / `beforeAll` をグローバルのまま使える分、spec の記述量が少なくなる。

あわせて `.detoxrc.js` で `behavior.init.exposeGlobals: false` を指定している。
これを有効(既定)のままにすると、**グローバルの `expect` は「型は Jest・実体は Detox」**という食い違いが起き、
値のアサーションが静かに壊れる。グローバルを注入しないことで、この不整合を構造的に防いでいる。
要素のアサーションは `fixtures/e2e` から import した `expect`(= Detox のマッチャ)を使うこと。

### `detox` のバージョンを完全固定している理由(#1028 M2)

`detox` の npm パッケージは Android の maven リポジトリ(`detox/Detox-android`)を同梱しており、
Gradle 側は `com.wix:detox:+` でそのローカル maven から解決する。つまり **npm のバージョンが上がると native の aar も暗黙に上がる**。
E2E 基盤のフレーク源を減らすため、`^` を付けず意図的な更新のみに限定している(`^` を使う他ワークスペースとはここだけ流儀が異なる)。

### turbo との関係

- `turbo run test` を使う場合は `--filter=!e2e-web --filter=!e2e-mobile` で除外すること
  (E2E は実デバイス + 共有 dev 環境依存でキャッシュに不適なため、turbo タスクには組み込んでいない)
- `pnpm typecheck`(ルート)では e2e-mobile の型チェックも turbo 経由で実行される
