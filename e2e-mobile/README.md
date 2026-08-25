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
pnpm test:all:android                         # 全件(@mutation 含む / @probe は含まない)
pnpm test:probe:android                       # @probe(tests/probe/)のみ ※ 既定スコープ外。現在は空。下記参照
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

### Screen Object を書くときの必須ルール(#1027 で実測した落とし穴)

| ルール                                                                                      | 理由                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **タップは `tapWhenVisible()` を使う**。`element(...).tap()` を直接呼ばない                 | iOS は同期機構を切っているため、描画完了前にタップが飛んで "No elements found" になる(run 30432596949 の `profile-settings-button`)。Android は同期機構が吸収するので**片方でしか出ない**                                                        |
| **`FlatList` の testID は `toExist` で見る**。`toBeVisible` を使わない                      | `toBeVisible` は「面積の 75% 以上が可視」を要求する。データ 0 件のリストは面積を持たず、**描画されていても不可視と判定される**(iOS の `save-post-tab-grid` / `review-tab-grid`)                                                                  |
| **「包むだけの View」を観測点にしない**。実体のあるボタン等を見る                           | `search-tutorial-overlay` は Android で常に 2 view に一致し(TrueSheet の二重マウント)、iOS では表示中でも `toBeVisible` が成立しなかった                                                                                                         |
| **複数一致しうる要素は index を明示する**。ただし `atIndex(0)` = 見えているものとは限らない | カルーセルは前後のカードも同時にマウントするため、添字 0 が画面外のカードになりうる(`dish-categories-choose-button`)。可視な添字を走査して選ぶこと                                                                                                        |
| **スクロールは `whileElement(...).scroll()`**。要素を掴んだ `swipe` に頼らない              | `swipe` は掴んだ要素の高さの範囲内でしか指を動かせず、小さなタイルを起点にすると何回スワイプしても画面下部へ届かない                                                                                                                             |
| **文字入力の後は端末のキーボードが邪魔をしうる**                                            | Android は IME をまとめて無効化(`scripts/setup-android-locale.sh`)、iOS はハードウェアキーボード接続扱いにしてソフトウェアキーボードを出さない(`scripts/setup-ios-simulator.sh`)。入力は一貫して `replaceText` なのでキーボードは 1 つも要らない |
| **入れ子の `<Text>` に付けた testID はネイティブでは消える**                                | React Native は入れ子 Text を親の TextView へ畳み込むため、対応するネイティブ View が存在しない(`login-privacy-link`)。web では span として実在するので e2e-web 側では使える                                                                     |

## テスト 3 層構造(CI との棲み分け)

| 層     | ディレクトリ                                                                                | 内容                                                          | 実行タイミング                                        |
| ------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| Tier 1 | `tests/smoke/`                                                                              | 起動・タブ導線の最小確認                                      | 夜間 CI + 手動実行。将来の PR ゲート候補              |
| Tier 2 | `tests/navigation/` `tests/search/` `tests/my-dishes/` `tests/dish-category-group-votes/` `tests/profile/` `tests/authenticated/` | 機能テスト全般(実 API 読み取り)                               | 夜間 CI                                               |
| Tier 3 | `tests/mutation/`                                                                           | dev DB への書き込み(いいね/保存・レビュー投稿)                | **既定では実行されない**。`RUN_MUTATION=1` で明示実行 |
| 番外   | `tests/probe/`                                                                              | 不具合の存在を数値で示すプローブ(`@probe`)。**現在は空**      | **既定では実行されない**。`RUN_PROBE=1` で明示実行    |
| 番外   | `tests/catalog/`                                                                            | UI カタログ(全画面のスクリーンショット収集。**検証ではない**) | **既定では実行されない**。`RUN_CATALOG=1` で明示実行  |

> **`@probe`(tests/probe/)は「落ちるのが正しい」spec を置く場所。現在は意図的に空**(#1087)
> アプリ側の不具合を **客観的な数値** で示すための spec 置き場で、そこに置かれた spec は
> **修正が入るまで赤いまま維持される**。夜間 CI の既定スコープ(tier1-2)へ混ぜると常時赤くなり
> 本物の回帰が埋もれるため、Tier 3 と同じ二重ガードで既定の探索から外している
> (`jest.config.js` の `testPathIgnorePatterns` + `fixtures/e2e.ts` の `describeProbe`)。
> `test:all:*` にも含まれない。
>
> **現在この層に spec は無い。** 唯一の住人だった先読み画像プローブ(#1087)は、修正が main へ入り
> 実機で解消を確認できた時点で `tests/search/preload-images.test.ts` の恒久的な回帰テストへ
> **昇格**した(通るのが正しいテストになった)。仕組み(`RUN_PROBE` / `describeProbe` /
> `test:probe:*` / ワークフローの `scope=probe`)は次のプローブのために残してある。
>
> **どういうときに使うか**: 「native では動いていないはずだ」という疑いはあるが、既存のテストでは
> 緑にしかならないとき。アプリ側に E2E ビルド限定の観測点を足して数値を露出させ、その数値を待つ
> spec をここへ置く。修正が入ったら **tier1-2 へ昇格させてこのディレクトリを空に戻す**。
> 手順の詳細と前例は [`tests/probe/README.md`](tests/probe/README.md) を参照。

> **先読み画像は「枚数を数える」プローブで検証する**(#1087 / #1083)
> 検索画面末尾の先読みブロックは 0×0 で描かれていたため、expo-image の native 実装が
> **ロード要求そのものを発行せず、導入時(#656)から一度も効いていなかった**。
> web は size に関係なく `<img src>` を DOM へ出すため e2e-web では検知できず、
> app-expo の jest(`features/search/searchScreenPreload.test.tsx`)は
> **style が非ゼロかという構造しか見ない**ので、expo-image 側の振る舞いが変わった場合を見逃す。
>
> - 観測点: `app-expo/lib/e2e/preloadProbe.tsx`。先読みの各 `<Image>` の `onLoad` / `onError` を数え、
>   `loaded=<n>/<total>` を持つ `search-preload-probe` を描画する
> - 検証: `screens/SearchScreen.ts` の `expectPreloadImagesLoaded()` /
>   spec は `tests/search/preload-images.test.ts`(Tier 2 = 夜間 CI の既定スコープ)
> - 有効化: ビルド時に `EXPO_PUBLIC_E2E_TUTORIAL_HOOK=1`(先読み対象がチュートリアル画像のため
>   **新しい環境変数は増やさず**このフラグに相乗りしている)。本番混入ガードは他フックと同一方式
>
> **プローブが「画面に存在しません」というメッセージで失敗する場合は、
> ビルド時の `EXPO_PUBLIC_E2E_TUTORIAL_HOOK` を疑うこと。**

> **レビュー投稿テストと OS フォトピッカー**(#1031 B6)
> `ReviewForm` は画面に入った直後に OS のフォトピッカー(`selectMedia`)を開く。フォトピッカーは
> **アプリ外プロセス**で動くため Detox からは操作できず、当初は投稿フローの自動化を見送っていた。
> 現在は **E2E ビルドに限りメディア選択を固定画像へ差し替えるフック**を用意して解決している:
>
> - 実装: `app-expo/lib/e2e/selectMediaStub.ts` / 差し替え先: `selectMediaStub.noop.ts`
> - 有効化: ビルド時に `EXPO_PUBLIC_E2E_MEDIA_HOOK=1`(e2e-mobile-test.yml の Detox build ステップ)
> - 本番混入ガードはセッション注入フック(#1030)と同一方式の二重構え:
>   1. `metro.config.js` の `resolveRequest` が **解決後の実ファイルパス**で判定して noop へ差し替える
>   2. `scripts/assert-no-e2e-hook.mjs` が本番相当バンドルに sentinel が無いことを検査する
>   3. 加えて EAS 経路(`EAS_BUILD`)でフラグが立っていたら metro が hard fail する
>
> **フォームの本文入力欄が出てこない場合は、まずビルド時の `EXPO_PUBLIC_E2E_MEDIA_HOOK` を疑うこと。**

> **検索チュートリアルは「閉じる」ではなく「シードする」**(#1027)
> ja-JP の初回起動では検索チュートリアル(`TutorialBottomSheet`)が自動的に開く。実体は TrueSheet で、
> Android では **別ウィンドウの Dialog** として最前面に出るため、開いている間は背後のタップがシートに吸われる。
>
> 当初は各 spec の前処理で「出ていたら閉じる」で吸収していたが、これは原理的に競合が残る:
>
> - シートが開くのは AsyncStorage の読み込み完了後で、**タブバーが見えた数百 ms 後に遅れて被さる**
> - Android の Espresso は「別ウィンドウに覆われている」ことを可視性判定へ反映しない。
>   つまりシートが開いていてもタブバーは `toBeVisible()` を満たし、**起動完了と誤判定する**
>
> 結果「起動完了を待ち切ったのに直後のタップだけが落ちる」が消せず、run 30429560108 では 12 suite 中 10 suite が
> この経路で失敗した。現在は **e2e-web と同じシード方式**へ揃えている:
>
> - 実装: `app-expo/lib/e2e/tutorialSeed.ts` / 差し替え先: `tutorialSeed.noop.ts`
> - 有効化: ビルド時に `EXPO_PUBLIC_E2E_TUTORIAL_HOOK=1`。本番混入ガードは上記 3 点と同一方式
> - 使い方: `launchAppWithSession({ as, tutorialSeen })`
>   - `true`(既定) … 視聴済み扱い = チュートリアルは開かない
>   - `false` … 未視聴扱い = 初回起動の自動表示を再現する(`tests/search/search-tutorial.test.ts`)
>   - `"device"` … 起動引数を渡さず AsyncStorage の実データを読む。**永続化そのものを検証する再起動で使う**
>     (ここで既定値のままにすると、シードした値を読み返すだけの偽の緑になる)
> - 実際に渡す値は `"seen"` / `"unseen"`。**`"1"` や `"true"` を使ってはいけない**
>   (react-native-launch-arguments は受け取った文字列を 1 つずつ `JSON.parse` にかけ、成功したら型変換する。
>   `"1"` は数値 1 になり、文字列比較が静かに外れる)
>
> **起動待ちが「チュートリアルが表示されています」というメッセージで失敗する場合は、
> ビルド時の `EXPO_PUBLIC_E2E_TUTORIAL_HOOK` を疑うこと。**

**ディレクトリ = Tier を正とする。** `@smoke` / `@mutation` はレポート上の可読性のため `describe` 名にも併記するが、フィルタの正には使わない(タグ文字列とディレクトリの二重管理を避けるため)。

### リトライ方針

CI のスクリプト(`test:ci:*`)だけ `detox test --retries 1` を付けている。ローカルは付けない(fail fast)。

- **なぜ必要か**: 実 API 依存の spec(トピック提案フロー等)は、AI が選ぶ料理・店舗によっては
  dev 環境側のデータ不備(画像未処理等)で結果フィード取得が 500 になることが実測されている。
  アプリ側の既知の不安定要素で、このテストの実装不備ではない。e2e-web も同じ理由で
  `dish-categories-flow` / `reactions` に `retries: 2` を設定している
- **なぜ spec 単位ではなく全体なのか**: e2e-web(Playwright)は spec 単位でリトライ数を設定できるが、
  **Detox のリトライは失敗した spec ファイルを丸ごと再実行する粒度**しか無い。
  `jest.retryTimes()` で spec 単位にすると `beforeAll` が再実行されないため、
  「検索を beforeAll で 1 回だけ行う」構成の spec では再試行の意味が無くなる
- **@mutation には付けない**: 再試行すると dev DB への書き込みが二重に走りうるため。
  Tier 3 は手動実行なので、落ちたら中身を見て判断する

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
- `scope`: `tier1-2`(既定)/ `tier1`(smoke のみ)/ `mutation`(**dev DB へ書き込む**)/ `probe` /
  `catalog`(UI カタログ収集)/ `catalog-with-review-flow`(UI カタログ + レビュー投稿フロー。**dev DB へ書き込む**)

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
     → device.launchApp({ launchArgs: {
          e2eAccessToken, e2eRefreshToken, e2eSessionOwner, e2eExpectedUserId, e2eTutorialSeen } })
     → アプリ側フック(app-expo/lib/e2e/injectTestSession.ts)が setSession() する
[fixtures/globalTeardown.ts]
   signOut({ scope: "global" }) で発行したセッションを revoke
```

- **パスワードは端末に一切渡らない**。Node プロセス内だけが知っており、端末へ渡るのはトークンのみ
- **`e2eSessionOwner` を渡すのが要点**(#1030 B-1)。アプリ側は「セッションの有無」ではなく
  **「期待ユーザーと現在ユーザーの一致」**で再注入を判断する。
  「匿名セッションが残っているせいで注入がスキップされ、認証済みのつもりのテストが匿名のまま緑になる」事故を防ぐため
- **`e2eExpectedUserId` は必須**。アプリ側フックは一致判定ができない状態を契約違反として **起動時に fail-loud** させる。
  トークンだけ渡しても起動できないので、`utils/sessionEnv.ts` は 3 つ揃っていなければ `null` を返す
- **フックはビルド時に決まる**。`EXPO_PUBLIC_E2E_AUTH_HOOK=1` を付けずにビルドすると metro が noop 実装を焼き込み、
  launchArgs は **黙って無視される**(= 認証済みテストが匿名のまま緑になる)。CI では Detox build ステップで設定している
- **fail-loud**: 期待するセッションが用意できていない状態で `launchAppWithSession()` を呼ぶと例外になる。
  黙って通常起動へフォールバックしない(テストが緑のまま検証内容だけ嘘になるのを防ぐ)

### セキュリティ上の必須事項(#1030 レビュー B-2)

`refresh_token` は **長期資格情報**で、access_token の 1 時間とは無関係に交換可能なまま残る。
このリポジトリは public で Actions の Artifact は実質誰でも取得できるため、次を **MUST** としている:

- **`globalTeardown` で `signOut({ scope: "global" })`**(globalSetup が途中で失敗した場合も、確立済みのセッションを revoke してから中断する)
- **Detox の device log artifact は既定で無効**(`.detoxrc.js` の `artifacts.plugins.log: "none"`)。
  logcat / Detox の debug log には launchArgs が載りうるため。収集したい場合は **launchArgs を渡さない run に限る**こと。
  CI が代わりに集めているのは次の 2 つで、いずれもトークンを含まない:
  - `artifacts/detox-run.log` … Detox/Jest の標準出力。GitHub Actions のジョブログは API から末尾しか取れず、
    アプリが落ちると "Detox can't seem to connect to the test app(s)!" が数千行積もって肝心の失敗理由を押し出すため、
    `scripts/run-detox-ci.sh` が全文を Artifact 側にも残している
  - `artifacts/logcat-crash.log` … 失敗時のみ `adb logcat -b crash`。crash バッファはスタックトレース専用で
    Intent extras(= launchArgs)を含まない。
    ⚠️ 収集の判定に `command -v adb` を使ってはいけない。**GitHub の macOS ランナーにも Android SDK が入っている**ため
    iOS ジョブでも真になり、端末が 1 台も繋がっていない状態の `adb logcat` は接続待ちで永久にブロックする
    (run 30445542854 の iOS は、テスト自体は 31 秒で失敗していたのにここで 2.5 時間ハングし、
    ジョブのタイムアウトで Artifact のアップロードにも到達しなかった)
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
| Detox の自動起動(`behavior.launchApp: "auto"`。後述)                      | 1            |
| `tests/smoke/boot.test.ts`(**launchArgs なし起動**の唯一の例外)           | 1            |
| ログアウト導線のテスト(`SIGNED_OUT` でアプリが自動的に匿名サインインする) | テスト本数分 |

> **なぜ `behavior.launchApp: "manual"` にしないのか**
> 「fixtures 側だけが起動を制御すれば自動起動の 1 消費を省ける」と考えて `manual` を試したが、
> Detox の `manual` は「自動起動をスキップする」設定ではなく **「利用者が Xcode / Android Studio から自分で起動する」** モードで、
> Detox は起動引数を stdout へ出力したうえで `Press any key to continue...` と入力待ちに入る。
> CI(非 TTY)では `TypeError: process.stdin.setRawMode is not a function` で全 spec が即死し、
> さらに **launchArgs の refresh_token が公開ログへ平文出力される**(run 30386865911 で実測)。
> Android では自動インストールも行われず `No instrumentation runner found` になる。
> よって `manual` は使用禁止。自動起動による 1 消費は、セッションが AsyncStorage に永続化され
> spec 間で引き継がれるため **run あたり 1 回で頭打ち**になり、上表のとおり許容する。

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

ロケール依存の画面へ入る場合は、システムロケールに頼らず `localeDeepLink("search/dish-categories")`(= `nanitabeyo:///ja-JP/search/dish-categories`)で
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

## UI カタログ(全画面のスクリーンショット収集)

「今どんな画面が存在するのか」を、端末サイズのスクリーンショット + 画面名 / ルート / 遷移関係の一覧として
書き出す仕組み。**画面定義はリポジトリルートの [`catalog/`](../catalog/README.md) に置き、e2e-web と共有している**
(画面名・URL・説明の二重管理を防ぐため)。

**これはテストではない**(アプリの正しさは検証しない)。到達できない画面があってもジョブは赤くせず、
「未取得」として一覧に残す。

| 要素                               | 役割                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| `../catalog/screens.json`          | **画面定義の唯一の情報源**(Web / モバイル共通)                       |
| `tests/catalog/ui-catalog.test.ts` | 巡回・撮影(`@catalog`。匿名 / ログイン済み / レビュー投稿フロー)     |
| `utils/catalog.ts`                 | 撮影と結果記録のヘルパ(`captureScreen` / `captureScreenIfReachable`) |

```bash
# 収集(screenshots/<画面 ID>-<android|ios>.png が出来る)
pnpm test:catalog:android
pnpm test:catalog:ios

# 一覧生成(screenshots/UI_CATALOG.md) ※リポジトリルートで実行する
pnpm catalog:doc:mobile
```

- `jest.config.js` が `tests/catalog/` を既定の探索から外しているため、`RUN_CATALOG=1` のときだけ読み込まれる
  (`@mutation` / `@probe` と同じ方式)
- **ファイル名は `<画面 ID>-<android|ios>.png`**。同じ画面でも OS で見た目が変わるため OS 名を付ける。
  公開 URL だけを見て画面が分かるよう、ID は ASCII の英小文字・数字・ハイフンで付けること
- 直リンクは `localeDeepLink()` で `nanitabeyo:///ja-JP/...` を組み立てる。タブバーを持たない画面
  (運営ツール等)は `waitForReady: false` で起動し、描画が落ち着くのを時間で待ってから撮る
- レビュー投稿フロー(店舗詳細 / 投稿フォーム / レビュー詳細)は実際に投稿しないと到達できないため
  `describeMutation` 配下に置いている。`RUN_MUTATION=1`(= `scope: catalog-with-review-flow`)のときだけ走る

CI では `E2E Mobile Test` を `scope = catalog` で手動実行すると Artifact
`ui-catalog-screenshots-android` / `-ios` が保存される。その run を `Evidence Collect` に渡すと
GCS へ公開され、写真付きの一覧ページ(`index.html`)と公開 URL が手に入る。

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
