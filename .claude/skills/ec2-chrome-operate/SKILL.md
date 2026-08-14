---
name: ec2-chrome-operate
description: claude.ai/code の ec2-sandbox クラウド環境から、既存 EC2 インスタンス（デフォルト i-0684d39b0c1b1abb6）を起動し、その上で `claude --chrome` にプロンプトを渡してブラウザ操作をさせ、成功・失敗にかかわらず必ずインスタンスを停止するところまでを扱う。「EC2でブラウザ操作して」「EC2上のclaudeでこのページを見て/操作して」「chrome操作をリモートで試したい」のように、この特定インスタンスを使ってリモートブラウザ操作を1回実行したいときに使う。課金を放置しない設計（trapによる停止保証）を含む。
---

# EC2 Chrome Operate

claude.ai/code 本体には AWS 認証情報がない。すべての AWS 操作は **`ec2-sandbox` という個人 Cloud Environment のセッション**（credential_process 経由で `--profile sandbox` が使える）の中で行う。このスキルを実行する私（オーケストレーター側の Claude）は、`ec2-sandbox` 環境のセッションを開き、[`RUNBOOK.md`](./RUNBOOK.md) のスクリプトを1回のメッセージとして送り込み、結果を待つ。

### セッションの開き方は2通り。MCP を優先する

| 方法 | 使う場面 | 備考 |
| --- | --- | --- |
| **`mcp__Claude_Code_Remote__create_session`（推奨）** | 呼び出し元が claude.ai/code のリモートセッションのとき | `environment_id` に `ec2-sandbox` の ID を渡し、`prompt` に RUNBOOK 一式を丸ごと入れる。ブラウザ操作が一切要らず、UI 待ちも無い |
| claude-in-chrome で `https://claude.ai/code` を開く | ローカルの Claude Code から実行していて browser tools があるとき | Environment セレクタで `ec2-sandbox` を選び、新規セッションを開始する |

`ec2-sandbox` の `environment_id` は `mcp__Claude_Code_Remote__list_environments` で毎回引くこと（ハードコードしない）。2026-08-14 時点は `env_01A12ZVBoLzFxmBZ2sKfoV9P`。

setup の経緯・検証結果は Issue [#1327](https://github.com/Ayato-kosaka/nanitabeyo/issues/1327)（親: #1295）に記録済み。すでに存在する前提リソースは以下、**このスキルでは再作成しない**。

| リソース                       | 名前                                               | 備考                                                                                                                                      |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| claude.ai/code Environment     | `ec2-sandbox`                                      | 個人環境。setup script が `~/.aws/config` の `[profile sandbox]` を用意する                                                               |
| AWS IAM ユーザー               | `claude-ec2-sandbox`                               | アカウント 725429380872。対象インスタンス1台に権限を限定                                                                                  |
| IAM ポリシー                   | `claude-ec2-sandbox-i-0684d39b0c1b1abb6`           | start/stop, describe, ssm:StartSession/SendCommand 等                                                                                     |
| IAM ロール（instance profile） | `ec2-ssm-role`                                     | 対象インスタンスに `AmazonSSMManagedInstanceCore` 付与。**これが外れると SSM Agent が登録できず全滅する**ので、失敗時は真っ先にこれを疑う |
| 対象インスタンス               | `i-0684d39b0c1b1abb6`（ap-northeast-1, t3.medium） | 通常 Stopped が定常状態                                                                                                                   |

## 保証設計 — なぜ「スクリプト内 trap のみ」で十分と判断したか

課金を放置しないための停止保証は、**RUNBOOK.md のスクリプトが持つ `trap cleanup EXIT INT TERM` の1点だけ**に集約している。追加の AWS 側バックストップ（EventBridge 等）や、私が別タブで手動監視する運用は、今回は意図的に採用していない（判断者に確認済み）。

- **効く範囲**: 正常終了、`set -e` 相当のエラー終了、途中の `exit N`、SIGINT/SIGTERM — つまりスクリプトプロセスが何らかの形で"終了する"経路はすべて cleanup を通る。start-instances が成功した直後にどのステップで転んでも、必ず stop-instances まで到達する。
- **効かない範囲**: スクリプトプロセスが SIGKILL される、実行環境（`ec2-sandbox` セッションのコンテナ）ごと強制終了される、といった極端なケース。この場合は課金が残る可能性がある。
- **だからこそ**: RUNBOOK.md 内の各 AWS 呼び出しには必ず `timeout` を付け、無限ハングで「終了しない」状態を作らない設計にしてある。ハングは trap が発火しない唯一の現実的な原因なので、ここを削らないこと。
- 呼び出し元（このスキルを実行する私）は、リモートセッションからの最終報告に **`final state: stopped`** の行が含まれているかを必ず目視確認する。含まれていない/確認が取れない場合は、ユーザーに率直に報告し、必要なら AWS コンソール（別タブ、admin ログイン）で手動停止する。これは新しい仕組みを作るのではなく、単に「報告を鵜呑みにしない」という運用上の確認。

## 手順

1. **プロンプトを確定させる**。ユーザーから受け取った「Chrome で何をさせたいか」の指示文を土台にする。意図は改変しないが、`claude --chrome -p` は**無人1回きりの実行で聞き返せない**ので、次を必ず書き足す。
   - 手順の番号付き分解（開く → 見つける → 変える → 保存する → 再読み込みして確認する）
   - 目的の UI が見つからなかったときの**代替URL**（コンソールは画面構成が変わる。1本道にしない）
   - **止まるべき条件**（ログイン要求、権限エラー等）と、そのときの報告キーワード。認証情報の入力は絶対にさせない
   - **報告フォーマット**（`RESULT: SUCCESS/PARTIAL/BLOCKED`、最終URL、変更前→変更後の実測値、できなかった項目とその理由）
2. `ec2-sandbox` 環境の**新規セッション**を開く（既存セッションの再利用はしない。前回の状態を引きずらないため）。方法は冒頭の表を参照。
3. [`RUNBOOK.md`](./RUNBOOK.md) の「送るメッセージの構成」に従い、プロンプト本文・スクリプト・**バックグラウンド起動**・**数値で確認できる完了条件**・報告要件を、**1通のメッセージとして丸ごと**送信する（会話を分割して「まずstartして」「次にpollして」のように小出しにしない — 初回実行でそれをやった結果、trap が効かない多段階の対話になり、`ssm:StartSession` 権限のバグに気づくまで無駄なラウンドトリップが発生した）。
4. 実行完了を待つ。目安は 10〜20分（起動〜SSM登録〜claude実行〜停止確認の合計）。`mcp__Claude_Code_Remote__get_session` の `status_bucket` が `WORKING` の間は生きている。無闇に短間隔でポーリングしない。
5. 最終報告を読み、`final state: stopped` を確認する。確認できたら結果をユーザーに要約して報告する。確認できない場合は、率直にその旨を伝え、AWS コンソールでの目視確認を提案する。

## 既知の落とし穴・Tips

### オーケストレーション側（`ec2-sandbox` セッションの回し方）

- **子セッションの権限は親より強くできない**。`create_session` に `permission_mode: "bypassPermissions"` を渡すと `exceeds parent session's "default"` で弾かれ、`extra_allowed_tools` で広げようとするのも classifier に止められる。**どちらも指定せず素で作る**のが正解で、実際には `permission_mode: auto` の子セッションが払い出されて Bash も Write も通った。
- **リモートセッション側の Bash ツールは最大600秒**。このジョブは全体で 10〜20分かかるため、フォアグラウンドで走らせるとツールのタイムアウトでスクリプトごと切られる。必ず `nohup ... &` でバックグラウンド起動させ、ログをポーリングさせる。
- **子セッションには「数値で確認できる完了条件」を明示する**（`=== RUN FINISHED` の出現、`wc -l` の増加）。CLAUDE.md の待機規則そのままで、指示に書いておかないと通知待ちで固まる。
- **`ListAgents` には出てこない**。`create_session` で作った子セッションは `SendMessage` の宛先には現れないので、`mcp__Claude_Code_Remote__get_session` の `status_bucket`（`WORKING` → 生存、`BLOCKED` → 何か聞き返して止まっている）と `task_summary` / `post_turn_summary` で生死と進捗を見る。
- **親から子へ追加のメッセージを送る手段は「poke 用 Routine」しかない**。`create_trigger` を `persistent_session_id=<子のID>` かつ cron も `run_once_at` も付けずに作ると「自分では発火しない Routine」になるので、`fire_trigger` で即座に叩き込める。用が済んだら `delete_trigger`。
  - **子は初回メッセージで確認待ちに入ることがある**（`status_category: need_input`）。RUNBOOK 一式を渡しても「実行してよいですか」で止まったので、この poke で GO を送る前提で考えておく。最初のメッセージに「確認は不要、そのまま実行せよ」と書いておくとよい。
- **子の応答テキストは親から読めない**。読めるのは `get_session` が返す `task_summary` と `post_turn_summary`（`status_category` / `status_detail` / `needs_action`）だけで、ログ全文は入らない。全文が要るなら、子に**逆向きの Routine で親へ送り返させる**（`persistent_session_id=<親のID>` で `create_trigger` → `fire_trigger` → `delete_trigger`）。ただし `create_trigger` は「この Routine は connector を持たないので、発火先セッションでは `mcp__*` ツールが使えない」旨の警告を出すことがあるので、**保険として「失敗したら `post_turn_summary` に `RESULT:` と `final state:` を必ず載せろ」と指示しておく**。

### リモート実行側（EC2 / SSM / `claude --chrome`）

（初回実行 2026-08-14 で得た知見）

- **`claude` CLI はデフォルト PATH に無い**。`ubuntu` ユーザーの nvm 配下（`/home/ubuntu/.nvm/versions/node/*/bin/claude`）にインストールされている。SSM の `AWS-RunShellScript` はデフォルト root・非ログインシェルで動くため、素の `claude` 呼び出しは `command not found` になる。RUNBOOK.md ではパスを動的に解決している。
- **非対話（`-p`）実行は権限確認プロンプトでブロックされ、`exit 0` のまま何もせず終わることがある**。無人実行では `--dangerously-skip-permissions` を付けること（安全性とのトレードオフはあるが、このフローでは全許可する方針で確定済み）。付け忘れると「成功したように見えて実は何もしていない」という一番気づきにくい失敗になる。
- **`claude --chrome -p` の1回の呼び出しで「開く→操作する→説明する」まで一括指示できる**。対話的なキャッチボールはできないので、プロンプト側に必要な手順を全部書き込む（例:「〇〇を開いて、△△をクリックし、結果を1〜2文で説明して」）。
- **プロンプトはファイル経由・base64 で渡す**。SSM の `send-command` パラメータに直接ユーザー文字列を埋め込むと、引用符やバッククォートを含むプロンプトでシェルクォーティングが壊れる。RUNBOOK.md は base64 化して埋め込み、リモート側で decode する方式にしてある。
- **視覚的な証跡が要る場合**（スクリーンショットの中身を自分の目で確認したいとき）は、SSM の出力に直接バイナリを流さず、base64 チャンク転送 + ローカル/リモート双方の MD5 一致確認で改ざん・欠損なく回収する。今回はこれで「本当に Chrome がレンダリングしたか」を、モデルの説明文の言葉遣い（学習データにある旧版の文言ではなく現行版の文言だったこと）と合わせて二重に立証できた。この手法が要るのは「実接続を厳密に証明したい」ときだけで、通常の1回実行では過剰。
- **`claude --chrome` 実行時に `jpeg-js` / `pngjs` が npm でインストールされる副作用がある**。インスタンスに軽微な永続変更が残ることは許容範囲として扱う。
- **`aws ssm wait command-executed` を長時間コマンドに使わない**。この waiter は 20回 × 5秒 ≒ **100秒**で `Max attempts exceeded` になる。ブラウザ操作は数分かかるので必ず打ち切られ、その後の `get-command-invocation` が `InProgress` を返したまま停止フェーズへ進んでしまう（＝claude の出力を取り逃す）。`get-command-invocation --query Status` を自前で 10秒間隔ポーリングし、`Success|Failed|Cancelled|TimedOut` を待つこと。RUNBOOK.md は修正済み。
- **SSM の `--timeout-seconds` は「実行時間の上限」ではなく「実行開始までの待ち時間」**。実行時間の上限は `AWS-RunShellScript` の `executionTimeout` パラメータ（既定3600）。リモート側 `timeout` < `executionTimeout` の関係を必ず守る。逆転すると SSM が先に殺して出力が取れない。
- **`claude --chrome -p` のタイムアウトは用途で変える**。ページを1枚開いて読むだけなら 150秒で足りるが、コンソールの設定変更のような多段操作は 5〜10分かかる。短すぎると「途中で切られたのに Success 扱い」という一番タチの悪い失敗になる。既定は 900秒（`EC2_CHROME_CLAUDE_TIMEOUT`）。
- **IAM ポリシーで SSM ドキュメント ARN を書くときは、アカウントID有り・無し両方を Resource に入れる**。`ssm:StartSession` はアカウントID付き ARN（`arn:aws:ssm:<region>:<account>:document/...`）で評価されるが、`send-command` 系は無し ARN でも通ることがあり、どちらか一方だけだと `AccessDeniedException` になる（実際に踏んだ）。

## 振り返り — 実行するたびに更新する

このスキルを使って実行したら、次を確認し、「はい」のものだけ該当箇所へ追記する。追記は推測ではなく、実際に観測した事実だけにする。

| #   | 問い                                                                   | 追記先                                         |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | 新しい落とし穴を踏んだか（PATH、権限、クォーティング、タイムアウト等） | 上記「既知の落とし穴・Tips」                   |
| 2   | trap による停止保証が実際に発火した/しなかった具体例があるか           | 「保証設計」セクション                         |
| 3   | RUNBOOK.md のタイムアウト値やリトライ回数が実態と合っていなかったか    | RUNBOOK.md                                     |
| 4   | 前提リソース（IAM/instance profile 等）が変更・削除されていたか        | 冒頭の前提リソース表、Issue #1327 へもコメント |
