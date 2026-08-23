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

## 再利用できるシナリオ（`scenarios/`）

`record.mjs` は 1 本ものの雛形だが、**同じ画面を何度も撮る**なら `scenarios/` を使う。
モック・ブラウザ起動・保存先の作法が `harness.mjs` に閉じているので、シナリオ側は
「どこへ行って何を押すか」だけを書けばよい。

```bash
# 設定画面（SET-* 系・バージョン表示など「設定に行が増える」課題はこれ 1 本で足りる）
EVIDENCE_NAME=set01-haptics \
EVIDENCE_TARGET_TESTID=settings-haptics-toggle \
EVIDENCE_TOGGLE=1 \
node .claude/skills/evidence-video/scenarios/settings.mjs

# 料理提案のカルーセル
EVIDENCE_NAME=issue1212 node .claude/skills/evidence-video/scenarios/topics.mjs

# 取得失敗 → その場再試行 → 回復（REL-03 の検証）
EVIDENCE_NAME=rel03 EVIDENCE_FAIL_TIMES=2 node .claude/skills/evidence-video/scenarios/topics.mjs
```

いずれも **`e2e-web/` から実行する**（`@playwright/test` をそこから借りるため）。
出力先は `EVIDENCE_OUT`（既定 `/tmp/claude-artifacts/evidence`）。
**この既定値は Claude Worker の Artifact 収集先と同じ**なので、ワーカー内で走らせれば
そのまま `evidence-collect.yml` で公開できる。

### 見つからなかったことも成果物として残す

`settings.mjs` は対象の `testID` が見つからなくても例外にせず、`<name>.md` へ
「⚠️ 対象が見つからなかった」と書いて終わる。**黙って成功したように見えるのが一番危ない**
（ビルドしたブランチを間違えていても、それらしい動画は撮れてしまう）。

## 踏んだ落とし穴（追記）

- **backend のレスポンスは `{ success: boolean, data: R }` の封筒である。**
  素の配列を返すと `useAPICall` が `invalid_response` /「Malformed response for ...」で弾き、
  画面はエラー表示になる。**空で握りつぶすときも封筒に入れる**。
  1 周これで無駄にした（カードが出ずエラー画面が撮れた）
- **Chromium のバージョンがリポジトリの `@playwright/test` と合わないことがある。**
  実測: playwright 1.61.1 が `chromium_headless_shell-1228` を要求するのに、
  サンドボックスに在るのは 1194。`npx playwright install` は別バージョンの CLI を
  引くので解決しない。**既に在る実体を `executablePath` で直接指す**のが確実
  （`harness.mjs` の `resolveExecutablePath()` がやっている）
- **料理提案（Topics）画面は 2 つ揃えないと到達できない。**
  (1) `searchParams`(JSON) をクエリで渡す、(2) `v1/dish-categories/recommendations` を
  封筒つきで返す。`topics.mjs` に両方入れてあるので組み直さないこと
- **Topics には検索チュートリアルとは別のチュートリアルがある。**
  `search_tutorial_seen_v1` を立てても出る。`harness.mjs` の `dismissTutorial()` で閉じる

## PR 本文から見えるようにする（ここまでやって完了）

チャットへ送るだけでは、**PR を見た人には何も見えない**。人へ渡す証跡は
`evidence-collect.yml` で公開し、PR 本文へ Markdown 画像として埋め込むところまでやる。

```bash
# 1. ワーカー内で撮る（出力は /tmp/claude-artifacts/evidence）
#    → Artifact 名は claude-<task_key>-<run_id>-<run_attempt>
# 2. 公開する
gh workflow run evidence-collect.yml --ref main \
  -f run_id=<撮ったワーカーの run id> \
  -f artifact_name=claude-<task_key>-<run_id>-1 \
  -f source_sha=<撮影対象の commit SHA>
# 3. manifest.json の images[].url / videos[].url を PR 本文へ貼る
```

⚠️ **貼る作業をリーダー自身がやると失敗することがある。** エージェント環境によっては
外向きの本文の画像参照が中和され、`![alt](url)` がコードスパンになる。記法を変えても
回避できない（Markdown 画像・HTML img・生 URL の 3 方式すべてで実測）。
**その場合はワーカー（`access=observe` + `mcp__github__add_issue_comment`）へ投稿を任せ、
投稿後に本文を再取得して `<img>` の数が期待枚数と一致することまで確認する。**
詳しくは `parallel-development` スキルの「投稿した画像が実際に表示されているか検証する」節。
