---
name: evidence-video
description: >-
  アプリの操作動画・スクリーンショットをチャットへ届けるエビデンス撮影。2 経路ある:
  (A) 即席 = ローカルで expo の web ビルドを立ち上げ、認証・API・Maps をモックした Playwright で
  録画（数分。Android 相当 / iOS 相当 = WebKit のデバイスプリセット付き）。
  (B) 実機 = e2e-mobile CI を record_videos 入力付きで dispatch し、Android エミュレータ /
  iOS シミュレータの本物の Detox 動画を Artifact から回収（ビルドキャッシュ命中時
  Android 約 6 分 / iOS 約 15 分）。
  「動画で見せて」「エビデンスください」「スクショで確認したい」「iOS/Android での見た目を確かめたい」
  「デザイン修正を目視確認して」のように、UI の見た目や挙動を人に見せる・自分で確かめる必要が
  あるとき必ず使う。
---

# エビデンス撮影

2 経路ある。目的で選ぶ:

| | A. 即席（このファイルの主題） | B. 実機（Detox / CI） |
| --- | --- | --- |
| 所要 | 数分 | APK/app キャッシュ命中時: Android 約 6 分 / iOS 約 15 分。ミス時 +11〜16 分 |
| 実体 | ローカル web ビルド + Playwright | Android エミュレータ / iOS シミュレータ + Detox |
| データ | 認証・API・Maps は**モック** | 実 dev 環境（実 API） |
| 映るもの | UI・デザイン・画面遷移 | 上に加えて OS 許可ダイアログ・ATT 等ネイティブ面 |
| デバイス | Chromium(素/Pixel 7 相当) + WebKit(iPhone 14 相当) | 本物の Android / iOS |

**A で足りるか**の判断基準: アプリは React Native で web も native も同じ JS が描画される。
デザイン・文言・レイアウト・フローの確認なら A でほぼ等価。OS ダイアログ・プッシュ通知・
共有インテント・ネイティブ遷移の滑らかさが論点なら B。**A の動画を「実機で確認した」と
提示してはいけない**（プリセットは «相当» であって実機ではない）。

## B. 実機動画（Detox / CI）の手順

⚠️ **`has-window-focus=false` で全滅したら、まず `beforeEachFailure.png` を見る。**

Detox が
`Waited for the root of the view hierarchy to have window focus and not request layout`
で落ちたときは、**アプリではなく Android のシステムダイアログがフォーカスを奪っている**
ことがある。run 32882521476 では «「Pixel Launcher」が繰り返し停止しています» の
ANR ダイアログが被さっていた（`beforeEachFailure.png` に写っている。アプリ自体は
その下で正常に描画されていた）。

見分け方:

- 失敗が **`beforeEach`（アプリ起動）で起きている**（`beforeEachFailure.png` が出る）
- 同じエラーが **無関係なテストにも一斉に**出る
- Detox の内部リトライで **失敗数が減る**（16 → 4 のように）。コードの欠陥なら減らない

この形はエミュレータ側の事象なので、コードを触らずに 1 度だけ再実行して確かめる。
**ただし «flake» で片付ける前に必ずスクリーンショットを見ること。** 要素が無いのか、
ダイアログに覆われているのかは、絵を見れば 1 秒で分かる。

⚠️ **dispatch しただけで «走る» と思ってはいけない。cancelled で消える。**

`e2e-mobile-test.yml` の concurrency は **ブランチ別ではなくグローバル**
（`group: e2e-mobile-test` / `cancel-in-progress: false`）。GitHub はこのグループに
«実行中 1 本 + 待機 1 本» しか保持しないので、自分の run が待機中に別ブランチから
dispatch が来ると、**自分の待機分が押し出されて cancelled になる**
（run 32874405962 で実測。検証したつもりで何も検証できていなかった）。

したがって dispatch のあとは必ず:

1. グループが空いているかを先に見る（他ブランチの run が in_progress / queued でないか）
2. dispatch 後、**conclusion が cancelled でないこと**を確認してから «実行中» と扱う
3. 結果を待つあいだも手を止めない。待機だけのターンを作らない

1. `e2e-mobile-test.yml` を workflow_dispatch で起動する。入力:
   - `record_videos: true`（.detoxrc.js の video plugin が "all" になり全テストの動画が残る）
   - `test_filter` に撮りたいフローの spec 名（例: `onboarding`）。**scope は既定の
     `tier1-2` のまま**にする。filter は scope と AND で効くため、tier1(smoke) に
     smoke 外の spec 名を渡すと 0 件になる。platform で android / ios を絞れる
   - ビルドはバイナリ単位でキャッシュされる（app-expo / shared / lockfile が前回
     ビルド時と同一なら Gradle 11 分 / xcodebuild 16 分がスキップされる）。
     main で一度撮った後の再撮影・テストコードだけの修正は毎回キャッシュに乗る
2. 完了後、Artifact `detox-report-android` / `detox-report-ios` をダウンロードすると
   `artifacts/` 配下にテストごとの `test.mp4` が入っている。チャットへは必要な分だけ
   `SendUserFile` で転送する
3. CI の GitHub Actions を消費するだけで **EAS のビルド枠は消費しない**
   （CLAUDE.md の EAS Build 規則とは無関係に自由に実行してよい）

Android / iOS どちらも `test.mp4` が出る（#1484 の run 32589219056 で両 OS の
mp4 を確認）。スクショ（--take-screenshots all）は録画の有無によらず常時収集される。

⚠️ **CI の実機動画に紙吹雪など「モーション削減で消える演出」は映らない。**
CI エミュレータはテスト安定化のため `disable-animations: true` で走り、Android は
これをモーション削減としてアプリへ通知する。アプリ側（ConfettiBurst 等）が
reduced motion を正しく尊重して描画を抑制するので、映らないのが正しい挙動。
アニメを有効にすると無限ループ演出（紙吹雪・スピナー）が Detox の同期機構を
永久ビジーにして全テストがハングするため、CI では有効化しない。
演出そのもののエビデンスは A（即席 web 動画）か手元の実機で撮ること。

⚠️ **`DETOX_RECORD_VIDEOS` という env 名は Detox 自身が CLI オプションとして
解釈する**（collectCliConfig が argv と同格に読み、defaultsDeep で .detoxrc.js より
優先される）。record_videos 入力はこの仕組みを使って `all` を渡している。
値を none|failing|all 以外（"1" 等）にすると、エラーにならず .detoxrc.js の
video 設定を黙って上書きして動画が出なくなる（run 32603604105 / 32605810775 で
実測）。.detoxrc.js 側を process.env の三項演算で切り替える実装も同じ理由で
機能しないので、やらないこと。

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
- **アニメーションは実時間で待つ。** オンボーディングの課題文は表示と同時に
  下から上へフェードイン（約 0.4 秒）、解決フェーズは **矢印を押したとき** に
  アニメ 0.3 秒で出る（自動では切り替わらない）。押下のあと `waitForTimeout(1200)`
  程度置いてから次の操作へ進むと動画に全部映る
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

## ⚠️ フォントが無い環境では、撮っても読めないものが出来る

CI ランナー（GitHub Actions の ubuntu）には CJK フォントが入っていない。
`playwright install --with-deps chromium` が入れるのは Latin 系のフォントだけで、
**日本語・中国語・韓国語・アラビア語・ヒンディー語はすべて豆腐（□）になる。**

2026-08-23 にこれで 6 本の PR へ読めないエビデンスを配った。ローカルのサンドボックスには
IPAGothic が入っているため、手元で撮ったものは正常に見える。**手元で読めたことは、
CI で読めることを保証しない。**

- `scenarios/harness.mjs` の `record()` は撮る前に `fc-list :lang=<lang>` を見て、
  字が描けないなら例外で落ちる。`record({ langs: ["ja", "ar"] })` のように、
  その画面に出る言語を渡す（既定は `["ja"]`）
- `claude-worker.yml` は両ジョブで `fonts-noto-cjk` / `fonts-noto-core` /
  `fonts-noto-color-emoji` を入れ、ja/zh/ko/ar/hi のいずれかが 0 件なら run を落とす
- 自前の環境で撮るなら先に入れる:
  `sudo apt-get install -y fonts-noto-cjk fonts-noto-core && fc-cache -f`

**撮ったら必ず PNG を Read ツールで開いて目で見ること。** 「保存できた」「URL が 200」は
中身が読めることを何も保証しない。
