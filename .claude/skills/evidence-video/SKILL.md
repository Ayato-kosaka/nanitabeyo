---
name: evidence-video
description: >-
  web アプリの操作動画・スクリーンショットを CI を経由せず数分でチャットへ届ける即席エビデンス撮影。
  ローカルで expo の web ビルドを立ち上げ、Supabase 認証・backend API・Google Maps をモックした
  Playwright で画面フローを操作しながら録画する。「動画で見せて」「エビデンスください」「この画面
  どうなってるかスクショで確認したい」「デザイン修正を目視確認して」のように、UI の実際の見た目や
  挙動を人に見せる・自分で確かめる必要があるとき必ず使う。実 API・実データが必要な正式エビデンス
  （CI の e2e 動画 Artifact）とは別物で、こちらはモック前提の高速版。
---

# 即席エビデンス撮影（web）

ローカルビルド + Playwright 録画で、UI フローの動画 / スクショを数分で作る手順。
CI を待てないとき・チャットへ直接届けたいとき・デザイン修正を自分の目で確かめたいときに使う。

**認証・API・地図はすべてモック**なので、映るのは「画面と遷移」であって実データではない。
実 API での正式エビデンスが要るときは e2e-web-test.yml（Playwright は失敗時に動画を残す）や
e2e-mobile の Detox video artifact を使うこと。

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
- **iPhone 相当は viewport 390×844**（SE は 375×667）。これは「見た目が iPhone サイズ」な
  だけで iOS 実機ではない。エビデンスとして提示するとき、プラットフォームを偽らないこと
- ffmpeg はサンドボックスに無い。**webm のまま送る**（チャットで再生できる）

## してはいけないこと

- `.env`（ダミーでも）・`dist-local/`・app.config.ts の output 変更をコミットに混ぜる
- このモック環境で撮った動画を「実 API での動作確認」として提示する
- サーバの停止に `pkill -f` を使う（自分ごと死ぬ。CLAUDE.md のプロセス停止規則に従い
  PID を取ってから kill する — build-and-serve.sh stop がやっている）
