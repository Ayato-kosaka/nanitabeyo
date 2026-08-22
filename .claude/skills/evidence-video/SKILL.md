---
name: evidence-video
description: >-
  アプリの操作動画・スクリーンショットをチャットへ届けるエビデンス撮影。2 経路ある:
  (A) 即席 = ローカルで expo の web ビルドを立ち上げ、認証・API・Maps をモックした Playwright で
  録画（数分。Android 相当 / iOS 相当 = WebKit のデバイスプリセット付き）。
  (B) 実機 = e2e-mobile CI を record_videos 入力付きで dispatch し、Android エミュレータ /
  iOS シミュレータの本物の Detox 動画を Artifact から回収（約 30 分〜）。
  「動画で見せて」「エビデンスください」「スクショで確認したい」「iOS/Android での見た目を確かめたい」
  「デザイン修正を目視確認して」のように、UI の見た目や挙動を人に見せる・自分で確かめる必要が
  あるとき必ず使う。
---

# エビデンス撮影

2 経路ある。目的で選ぶ:

| | A. 即席（このファイルの主題） | B. 実機（Detox / CI） |
| --- | --- | --- |
| 所要 | 数分 | 約 30 分〜（iOS は更に長い） |
| 実体 | ローカル web ビルド + Playwright | Android エミュレータ / iOS シミュレータ + Detox |
| データ | 認証・API・Maps は**モック** | 実 dev 環境（実 API） |
| 映るもの | UI・デザイン・画面遷移 | 上に加えて OS 許可ダイアログ・ATT 等ネイティブ面 |
| デバイス | Chromium(素/Pixel 7 相当) + WebKit(iPhone 14 相当) | 本物の Android / iOS |

**A で足りるか**の判断基準: アプリは React Native で web も native も同じ JS が描画される。
デザイン・文言・レイアウト・フローの確認なら A でほぼ等価。OS ダイアログ・プッシュ通知・
共有インテント・ネイティブ遷移の滑らかさが論点なら B。**A の動画を「実機で確認した」と
提示してはいけない**（プリセットは «相当» であって実機ではない）。

## B. 実機動画（Detox / CI）の手順

1. `e2e-mobile-test.yml` を workflow_dispatch で起動する。入力:
   - `record_videos: true`（.detoxrc.js の video plugin が "all" になり全テストの動画が残る）
   - `test_filter` に撮りたいフローの spec 名を入れると短縮できる（例: `onboarding`）。
     platform で android / ios を絞れる
2. 完了後、Artifact `detox-report-android` / `detox-report-ios` をダウンロードすると
   `artifacts/` 配下にテストごとの `test.mp4` が入っている。チャットへは必要な分だけ
   `SendUserFile` で転送する
3. CI の GitHub Actions を消費するだけで **EAS のビルド枠は消費しない**
   （CLAUDE.md の EAS Build 規則とは無関係に自由に実行してよい）

⚠️ **動画が実際に出るのは現状 iOS のみ**（run 32589219056 で mp4 を確認）。
Android は video: "all" でも mp4 が生成されない（headless エミュレータ +
adb screenrecord の制約。ハードコード時代の run でも同様で、この入力の配管の
問題ではない — run 32603604105 で `DETOX_RECORD_VIDEOS=1` が Detox まで
届いていることをログで確認済み）。Android の動きのエビデンスが要るときは
A の `android` プリセット（Pixel 7 相当）か、スクショ（--take-screenshots all が
常時有効）で代替する。Android 側を直す場合は Detox の screenrecord 失敗を
掘るところから（テスト時間が伸びる副作用も考慮すること）。

以下は A（即席）の手順。**認証・API・地図はすべてモック**なので、映るのは
「画面と遷移」であって実データではないことを常にキャプションで明示する。

## 全体像

```
1. scripts/build-and-serve.sh   … ダミー .env 生成 → SPA モードで expo export → :8788 で配信
2. scripts/record.mjs           … モック入り Playwright でフローを操作しながら録画（webm）
3. SendUserFile                 … webm をチャットへ送る（キャプションに「何が映っているか」を書く）
4. scripts/build-and-serve.sh stop … 片付け（サーバ停止・dist-local / .env 削除）
```

所要はビルド約 2 分 + 録画約 1 分。録画スクリプトは **e2e-web/ ディレクトリから**
`env -u PLAYWRIGHT_BROWSERS_PATH node <script>` で実行する（後述の理由を参照）。

## 手順

### 1. ビルドと配信

```bash
bash .claude/skills/evidence-video/scripts/build-and-serve.sh start
# → http://localhost:8788 で配信される。終わったら必ず:
bash .claude/skills/evidence-video/scripts/build-and-serve.sh stop
```

このスクリプトがやっていること（なぜそうするかまで理解しておくこと）:

- **ダミー値の `.env` を app-expo/ に生成する。** Env.ts の必須項目（SUPABASE_URL 等）を
  埋めないとバンドルが組めない。値はどうせモックに差し替わるので localhost のダミーでよい。
  **`.env` は絶対にコミットしない**（スクリプトが終了時に消す）
- **app.config.ts の `web.output` を一時的に `"static"` → `"single"`（SPA）へ切り替える。**
  static のままだと export 中の静的レンダリング（Node 側）で `Constants.expoConfig.extra` が
  空になり「supabaseUrl is required.」で落ちる（CI は実環境変数で通るがローカルのダミーでは
  再現不能）。SPA なら静的レンダリングが走らないので回避できる。
  **切り替えは trap で必ず元へ戻す**（コミットへの混入事故防止）
- **SPA フォールバック付きの静的サーバで配信する。** `python -m http.server` は
  `/ja-JP/search` のような深い URL で 404 になるため、無ければ index.html を返す
  自前サーバ（serve-spa.mjs）を使う

### 2. 録画

```bash
env -u PLAYWRIGHT_BROWSERS_PATH node .claude/skills/evidence-video/scripts/record.mjs
```

- `@playwright/test` は e2e-web の node_modules から `createRequire` で借りている
  （スクリプト冒頭）。e2e-web で `pnpm install` 済みであることが前提
- **`PLAYWRIGHT_BROWSERS_PATH` を外す**のは、サンドボックスの既定値（/opt/pw-browsers）の
  Chromium がリポジトリの Playwright バージョンと合わないことがあるため。合わないときは
  `env -u PLAYWRIGHT_BROWSERS_PATH npx playwright install chromium-headless-shell` で
  既定キャッシュへ入れる
- record.mjs は**そのまま使うテンプレートではなく、撮りたいフローに合わせて書き換える**。
  モック部分（`installMocks` / `MAPS_STUB`）は共通なので触らず、後半の操作シナリオだけ
  変える。スクショだけ欲しいときは `recordVideo` を外して `page.screenshot()` にする

### 3. チャットへ送る

`SendUserFile` で webm を送る。キャプションには「どの commit のビルドか」「何の検証が
映っているか（画面順）」を書く。見る側はキャプションだけで判断するので手を抜かない。

### 4. 片付け

`build-and-serve.sh stop` を必ず実行する。git status がクリーンであることを確認して終わる
（app.config.ts の差分が残っていたら revert 漏れなので `git checkout -- app-expo/app.config.ts`）。

## モックの中身と、その理由（scripts/record.mjs 冒頭に実装がある）

| 対象 | モック | なぜ必要か |
| --- | --- | --- |
| Supabase 認証 | `/auth/v1/**` へ偽 JWT 入りセッション JSON を返す | 認証が確立しないと auth-error-fallback で画面が丸ごと出ない |
| backend API | `{"data": []}` を返す | 500/接続失敗の連打とリトライを避ける。画面の器だけ映ればよい |
| Google Maps | `window.google.maps` の最小スタブ + `window.initMap()` 呼び出し | `@react-google-maps/api` の LoadScript は **`initMap` コールバックが呼ばれるまで children の代わりに "Loading..." を出し続ける**。スタブが initMap を呼ばないとアプリ全体が Loading で止まる |
| その他外部 | すべて `{"data": []}` で握りつぶす | サンドボックスは外部到達不可のため。ただし **JS として実行されるリソースに JSON を返すと SyntaxError で壊れる**ので、script 系 URL には contentType を合わせること |

## ハマりどころ（実際に踏んだものだけ）

- **SPA モードでは "/" からの初期タブが狂うことがある。** `/ja-JP/search` など
  目的のルートへ**直接** goto する
- **オンボーディングの表示状態**は localStorage `search_tutorial_seen_v1` で制御する。
  未読状態を撮るならシード無し（既定）、既読状態は `"true"` を addInitScript で仕込む
- **位置情報・通知の許可画面は、ヘッドレスでは映らない。** headless Chromium は要求へ
  ダイアログ無しで即答拒否し、アプリ側はそれを「回答済み」として画面ごとスキップする設計
  （OnboardingPermissionScreen の INSTANT_SETTLE_GRACE_MS）。撮りたいときは
  `navigator.geolocation.getCurrentPosition = () => {}`（永遠に応答しない）を
  addInitScript して「プロンプトが出たまま」を再現する。許可済みは context の
  `permissions: ["geolocation"]` + `geolocation: {...}` で作る
- **アニメーションは実時間で待つ。** オンボーディングの課題→解決は表示から約 1.5 秒 +
  アニメ 0.3 秒。`waitForTimeout(2600)` 程度置いてから次へ進むと動画に全部映る
- **デバイスは record.mjs の PRESETS で選ぶ**: `default`（素の iPhone サイズ Chromium・最速）/
  `android`（Pixel 7 相当）/ `ios`（iPhone 14 + WebKit）。後者 2 つは e2e-web CI の
  mobile-chrome / mobile-safari と同じ descriptor。`ios` は WebKit バイナリと OS ライブラリが
  要るため、初回に e2e-web で次の 2 つを実行する（数分。2 回目以降は不要）:
  `env -u PLAYWRIGHT_BROWSERS_PATH ./node_modules/.bin/playwright install webkit` と
  `env -u PLAYWRIGHT_BROWSERS_PATH ./node_modules/.bin/playwright install-deps webkit`。
  いずれも実機ではないので、エビデンスとして提示するときプラットフォームを偽らないこと
- ffmpeg はサンドボックスに無い。**webm のまま送る**（チャットで再生できる）

## してはいけないこと

- `.env`（ダミーでも）・`dist-local/`・app.config.ts の output 変更をコミットに混ぜる
- このモック環境で撮った動画を「実 API での動作確認」として提示する
- サーバの停止に `pkill -f` を使う（自分ごと死ぬ。CLAUDE.md のプロセス停止規則に従い
  PID を取ってから kill する — build-and-serve.sh stop がやっている）
