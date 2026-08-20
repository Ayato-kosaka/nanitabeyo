# RUNBOOK — 実行スクリプト

**このスキルを実行しているセッション自身の Bash で走らせる**（別セッションへ委譲しない。理由は [SKILL.md](./SKILL.md) 冒頭）。プロンプトは `/tmp/ec2_chrome_prompt.txt` に置き、スクリプトには埋め込まない（引用符やバッククォートで壊れるため）。

起動は必ず **Bash ツールの `run_in_background: true`** で行う。全体所要は 10〜20 分で、Bash ツールの上限（600秒）を超えるため、フォアグラウンドだとツールのタイムアウトでスクリプトごと切られる。`nohup ... &` を自分で書くのは classifier に止められることがあるので、ツールの機能を使うこと。

途中でどのステップが失敗しても、`trap cleanup EXIT INT TERM` により最後は必ず `stop-instances` が呼ばれる。個々の AWS 呼び出しに `timeout` を付けているのは、「ハングして trap が永久に発火しない」状態を作らないため（[SKILL.md](./SKILL.md) の「保証設計」参照）。

## 汎用実行スクリプト `ec2_exec.sh`

**このスクリプトは [`ec2_exec.sh`](./ec2_exec.sh) として実ファイルで置いてある。写経せず、そのまま実行すること。**

```
bash .claude/skills/ec2-chrome-operate/ec2_exec.sh <リモートスクリプト> 2400
```

権限クラシファイアの allow ルールがこの固定パスに紐づいているため、**スクラッチパッドにコピーして実行すると落ちる**（SKILL.md「権限クラシファイアの allow ルール」節）。以下は中身の参考掲載（**directory モード追加前の版。実ファイルが正**）。

> **2026-08-19 追記: directory モードを追加した。** 第1引数にファイルではなく**ディレクトリ**を渡すと、中の `*.sh` を昇順(ファイル名のアルファベット順)に、**1回の起動・停止の中で別々の SSM コマンドとして**順次実行する。個々のチャンクの1行目に `#TIMEOUT=<秒>` と書けばそのチャンクだけ実行時間上限を変えられる（省略時は第2引数 or デフォルト値を使う）。1チャンクが失敗しても後続は継続し、最後に `ok=N fail=M` を出す。**大量ページ収集など「同種の操作を数十〜数百回」行うタスクはこのモードを使う**こと（SKILL.md「大量ページ（数十〜数百件）を1つのタスクで収集するとき」節）。使い方は同じ固定パスのまま第1引数をディレクトリにするだけ:
>
> ```
> bash .claude/skills/ec2-chrome-operate/ec2_exec.sh .claude/skills/ec2-chrome-operate/chunks
> ```
>
> チャンクディレクトリ（例: `.claude/skills/ec2-chrome-operate/chunks/`）は `.gitignore` 済み。**実行中のチャンクディレクトリに新しいファイルを追加しない**（`ec2_exec.sh` は起動直後に `*.sh` の一覧を1回だけ確定させるため実害は無いはずだが、紛らわしいので別ディレクトリ/スクラッチパッドに退避してから追加するほうが安全）。

ブラウザ操作に限らず「インスタンス上で任意のシェルスクリプトを1回流して、必ず停止する」ための土台。下の本編スクリプトはこれの `claude --chrome` 特化版なので、**調査・切り分けにはこちらを使うほうが速い**（診断は1ブートに全部詰め込むこと）。

```bash
#!/bin/bash
#   usage: ec2_exec.sh <remote-script-file> [exec-timeout-seconds]
set -uo pipefail

REMOTE_FILE="${1:?usage: ec2_exec.sh <remote-script-file> [timeout]}"
EXEC_TIMEOUT="${2:-900}"
INSTANCE_ID="${EC2_CHROME_INSTANCE_ID:-i-0684d39b0c1b1abb6}"
REGION="${EC2_CHROME_REGION:-ap-northeast-1}"
AWSP="aws --profile sandbox --region $REGION"
LOG="/tmp/ec2_exec.log"
PARAMS_FILE="/tmp/ec2_exec_params.json"
: > "$LOG"
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }

STOP_DONE=0
cleanup() {
  local exit_code=$?
  if [ "$STOP_DONE" -eq 0 ]; then
    STOP_DONE=1
    log "cleanup: stopping $INSTANCE_ID (trigger: exit code $exit_code)"
    timeout 60 $AWSP ec2 stop-instances --instance-ids "$INSTANCE_ID" >>"$LOG" 2>&1
    timeout 300 $AWSP ec2 wait instance-stopped --instance-ids "$INSTANCE_ID" >>"$LOG" 2>&1
    final_state=$(timeout 30 $AWSP ec2 describe-instances --instance-ids "$INSTANCE_ID" \
      --query 'Reservations[0].Instances[0].State.Name' --output text 2>>"$LOG")
    log "final state: $final_state"
    if [ "$final_state" != "stopped" ]; then
      log "*** WARNING: 停止確認に失敗。AWSコンソールで手動確認・停止すること: $INSTANCE_ID ***"
    fi
  fi
  log "=== RUN FINISHED (exit $exit_code) ==="
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

[ -s "$REMOTE_FILE" ] || { log "remote script $REMOTE_FILE is missing or empty"; exit 1; }

# 直前の回の stop がまだ進行中だと start-instances は IncorrectInstanceState で即死する。
# 起動可能な状態になるまで待ってから始める（最大5分）。
log "=== pre-flight: waiting for a startable state ==="
for i in $(seq 1 30); do
  CUR=$(timeout 30 $AWSP ec2 describe-instances --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].State.Name' --output text 2>>"$LOG")
  case "${CUR:-unknown}" in
    stopped | running) break ;;
    *) log "current state: $CUR -- waiting"; sleep 10 ;;
  esac
done
log "pre-flight state: $CUR"

log "=== start-instances ==="
timeout 60 $AWSP ec2 start-instances --instance-ids "$INSTANCE_ID" >>"$LOG" 2>&1 || { log "start failed"; exit 1; }
timeout 300 $AWSP ec2 wait instance-running --instance-ids "$INSTANCE_ID" >>"$LOG" 2>&1 || { log "never running"; exit 1; }

log "=== polling SSM Online (max 5min) ==="
ONLINE=0
for i in $(seq 1 30); do
  STATUS=$(timeout 20 $AWSP ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' --output text 2>>"$LOG")
  if [ "$STATUS" = "Online" ]; then ONLINE=1; break; fi
  sleep 10
done
[ "$ONLINE" -eq 1 ] || { log "SSM never came online"; exit 1; }
log "SSM online after ~$((i * 10))s"

# --parameters のショートハンド (commands=[...]) は JSON エスケープを壊すので必ず file:// で渡す。
# リモートは dash なので bashism を書かないこと。
jq -n --rawfile s "$REMOTE_FILE" --arg t "$((EXEC_TIMEOUT + 120))" \
  '{commands: [$s], executionTimeout: [$t]}' > "$PARAMS_FILE"

log "=== send-command ==="
CMD_ID=$(timeout 30 $AWSP ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --timeout-seconds 600 \
  --parameters "file://$PARAMS_FILE" \
  --query 'Command.CommandId' --output text 2>>"$LOG")
log "command id: $CMD_ID"
[ -n "$CMD_ID" ] && [ "$CMD_ID" != "None" ] || { log "send-command failed"; exit 1; }

log "=== polling command status (max ~50min) ==="
INV_STATUS="Pending"
for i in $(seq 1 300); do
  INV_STATUS=$(timeout 30 $AWSP ssm get-command-invocation \
    --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
    --query 'Status' --output text 2>/dev/null)
  case "${INV_STATUS:-Pending}" in
    Success | Failed | Cancelled | TimedOut) break ;;
    *) sleep 10 ;;
  esac
done
log "invocation status: $INV_STATUS after ~$((i * 10))s"

log "=== STDOUT ==="
timeout 30 $AWSP ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query 'StandardOutputContent' --output text 2>&1 | tee -a "$LOG"
log "=== STDERR ==="
timeout 30 $AWSP ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query 'StandardErrorContent' --output text 2>&1 | tee -a "$LOG"

log "=== done, cleanup (stop) will run now ==="
```

## リモート側スクリプト（Chrome 起動 → 接続待ち → 本命プロンプト）

`ec2_exec.sh` に渡すリモートスクリプトの本体。

> **2026-08-15 更新: base64 での埋め込みはやめること。** `base64 -w0` してスクリプトを組み立てる生成ステップ自体が権限クラシファイアに難読化と判定されて拒否される。`ec2_exec.sh` は `jq -n --rawfile` でスクリプト全体を JSON 文字列として送るので改行も引用符も壊れない。**プロンプトはクォート付きヒアドキュメント（`cat > /tmp/prompt.txt <<'EOF' … EOF`）で素のまま書けばよい。** 以下の `__B64__` 方式は歴史的記述。

Chrome を起動しただけでは拡張がブリッジに繋がっていないので、**繋がるまでプローブしてから本命を流す**。ここを固定 sleep にすると、繋がる前に本命が走って丸ごと無駄になる（[SKILL.md](./SKILL.md) の「最重要」節）。

```sh
set -u
CLAUDE_BIN=$(ls -d /home/ubuntu/.nvm/versions/node/*/bin/claude 2>/dev/null | head -1)
[ -n "$CLAUDE_BIN" ] || { echo "claude CLI not found"; exit 1; }

echo "__B64__" | base64 -d > /tmp/prompt.txt
chmod 644 /tmp/prompt.txt

# Chrome は claude.ai を開いた状態で起動する。拡張は claude.ai のセッションを使って
# wss://bridge.claudeusercontent.com へ繋ぎに行くため、このタブが無いと接続しない。
sudo -u ubuntu -i -- bash -lc 'export DISPLAY=:20; nohup google-chrome --no-first-run --no-default-browser-check https://claude.ai/ >/tmp/chrome.log 2>&1 & sleep 60; echo launched'

# 多行を bash -lc "..." に直接埋めると改行が失われるので、必ずファイルに書いてから実行する。
cat > /tmp/probe.sh <<PEOF
export DISPLAY=:20
"$CLAUDE_BIN" --chrome --debug --debug-file /tmp/probe.log --dangerously-skip-permissions -p 'list_connected_browsers を呼び結果だけ出力' >/dev/null 2>&1
PEOF
chmod 755 /tmp/probe.sh

CONNECTED=0
i=1
while [ $i -le 5 ]; do
  rm -f /tmp/probe.log
  timeout 150 sudo -u ubuntu -i -- bash /tmp/probe.sh
  if grep -q '"extensions":\[{' /tmp/probe.log 2>/dev/null; then
    CONNECTED=1; echo "probe $i: extension CONNECTED"
    grep -o '"extensions_list".*' /tmp/probe.log | head -1
    break
  fi
  echo "probe $i: extensions still empty"
  sleep 20
  i=$((i + 1))
done

if [ "$CONNECTED" -ne 1 ]; then
  echo "=== EXTENSION NEVER CONNECTED — aborting before the real run ==="
  tail -15 /tmp/probe.log 2>/dev/null
  exit 1
fi

# 本命は stream-json でファイルに落とす。-p のテキスト出力は最後にまとめて出るため、
# timeout に殺されると出力がゼロになる（実際に25分の回を丸ごと取り逃した）。
echo "===== REAL RUN ====="
date -u
cat > /tmp/real.sh <<REOF
export DISPLAY=:20
timeout 1200 "$CLAUDE_BIN" --chrome --dangerously-skip-permissions \
  --verbose --output-format stream-json \
  --debug-file /tmp/real_debug.log \
  -p "\$(cat /tmp/prompt.txt)" > /tmp/real_stream.jsonl 2>/tmp/real_stderr.log
echo "claude exit: \$?"
REOF
chmod 755 /tmp/real.sh
sudo -u ubuntu -i -- bash /tmp/real.sh
echo "===== real run wrapper exit: $? ====="
date -u
# /tmp は再起動で消えるので、次のブートでも読めるように退避しておく
cp -f /tmp/real_stream.jsonl /home/ubuntu/last_stream.jsonl 2>/dev/null

echo "===== TRACE: tool calls in order ====="
python3 - <<'PYEOF'
import json, re
lines = open('/tmp/real_stream.jsonl', errors='replace').read().splitlines()
print("stream lines:", len(lines))
out = []
for ln in lines:
    try:
        ev = json.loads(ln)
    except Exception:
        continue
    msg = ev.get('message')
    # content は list とは限らない。ここで守らないと整形ごと落ちて報告が消える。
    content = msg.get('content') if isinstance(msg, dict) else None
    if not isinstance(content, list):
        content = []
    for c in content:
        if not isinstance(c, dict):
            continue
        if c.get('type') == 'text' and c.get('text', '').strip():
            out.append('TEXT: ' + c['text'].strip()[:2500])
        elif c.get('type') == 'tool_use':
            out.append('TOOL: %s %s' % (c.get('name'), json.dumps(c.get('input', {}), ensure_ascii=False)[:220]))
        elif c.get('type') == 'tool_result':
            body = c.get('content')
            if isinstance(body, list):
                body = ' '.join(x.get('text', '') for x in body if isinstance(x, dict))
            out.append('RES : ' + re.sub(r'\s+', ' ', str(body))[:200])
for t in out[-70:]:
    print(t)
PYEOF

echo "===== STDERR (tail) ====="
tail -c 1200 /tmp/real_stderr.log 2>/dev/null
```

実測の所要（2026-08-14）: Chrome 起動60秒 → プローブ1回目で接続 → 本命は内容次第で 2〜10分。`ec2_exec.sh` には 1600〜1900 秒を渡す。

**1回の実行は3〜4手順まで。** 5手順（プロジェクト作成→課金→API有効化→キー作成→別サイトの環境変数更新）を1本に詰めた回は 25 分でも終わらなかった。分割し、各手順を「完了済みならスキップ」と書いて冪等にすると、途中で切れても次の回が続きから進む。

証跡スクショを撮らせる回では、`apt-get install -y xdotool imagemagick xclip` を**リモートスクリプトの先頭で1回流しておく**（素の instance には入っていない。入れれば以後は残る）。保存先は `/tmp` ではなく `/home/ubuntu/evidence/`。

### 複数手順を1ブートで回す（所要を縮める本命）

**これが既定の形。手順ごとにブートし直してはいけない。** Chrome 起動 + プローブの約2.5分と起動・停止の約2分は、1ブートなら最初と最後の1回で済む。手順は分けたいがブート数は増やしたくないので、**プロンプトを複数用意して `claude -p` を順番に呼ぶ**。1つの巨大プロンプトにするのと違い、各手順の報告が独立して残り、コンテキストも毎回リセットされる。

**証跡スクショは各プロンプトの末尾に入れる**（別の回にしない）。変更した直後の画面にそのままいるので、撮り直しのためのナビゲートが要らない。Drive へのアップロードだけは全ファイルが揃ってからなので、**最後のプロンプト**に置く。

```sh
# プロンプトは呼び出し側で /tmp/prompt1.txt, /tmp/prompt2.txt ... として base64 で送り込む
n=1
for P in /tmp/prompt1.txt /tmp/prompt2.txt /tmp/prompt3.txt; do
  [ -s "$P" ] || continue
  echo "===== STEP $n: $P ====="
  date -u
  cat > /tmp/real_$n.sh <<REOF
export DISPLAY=:20
timeout 900 "$CLAUDE_BIN" --chrome --dangerously-skip-permissions \
  --verbose --output-format stream-json -p "\$(cat $P)" > /tmp/real_stream_$n.jsonl 2>&1
echo "claude exit: \$?"
REOF
  chmod 755 /tmp/real_$n.sh
  sudo -u ubuntu -i -- bash /tmp/real_$n.sh
  cp -f /tmp/real_stream_$n.jsonl /home/ubuntu/last_stream_$n.jsonl 2>/dev/null
  n=$((n + 1))
done
# 整形は各 /tmp/real_stream_$n.jsonl に対して同じ python を回す
```

`ec2_exec.sh` に渡す timeout は「全ステップ合計 + 起動待ち」で見積もること（例: 900s × 3 + 300s ≒ 3000s）。SSM の `executionTimeout` はそれより長くなる（`ec2_exec.sh` が +120 する）。

## 参考: 旧・本編スクリプト（Chrome 起動を含まない版）

以下は Chrome 起動と接続待ちが無いため、**単体では必ず「ブラウザ0件」で終わる**。SSM 呼び出しの骨組みとしてのみ参照すること。

```bash
#!/bin/bash
set -uo pipefail

INSTANCE_ID="${EC2_CHROME_INSTANCE_ID:-i-0684d39b0c1b1abb6}"
REGION="${EC2_CHROME_REGION:-ap-northeast-1}"
AWSP="aws --profile sandbox --region $REGION"
LOG="/tmp/ec2_chrome_run.log"
PROMPT_FILE="/tmp/ec2_chrome_prompt.txt"
CLAUDE_TIMEOUT="${EC2_CHROME_CLAUDE_TIMEOUT:-900}"
: > "$LOG"
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }

STOP_DONE=0
cleanup() {
  local exit_code=$?
  if [ "$STOP_DONE" -eq 0 ]; then
    STOP_DONE=1
    log "cleanup: stopping $INSTANCE_ID (trigger: exit code $exit_code)"
    timeout 60 $AWSP ec2 stop-instances --instance-ids "$INSTANCE_ID" >>"$LOG" 2>&1
    timeout 300 $AWSP ec2 wait instance-stopped --instance-ids "$INSTANCE_ID" >>"$LOG" 2>&1
    final_state=$(timeout 30 $AWSP ec2 describe-instances --instance-ids "$INSTANCE_ID" \
      --query 'Reservations[0].Instances[0].State.Name' --output text 2>>"$LOG")
    log "final state: $final_state"
    if [ "$final_state" != "stopped" ]; then
      log "*** WARNING: 停止確認に失敗。AWSコンソールで手動確認・停止すること: $INSTANCE_ID ***"
    fi
  fi
  log "=== RUN FINISHED (exit $exit_code) ==="
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

[ -s "$PROMPT_FILE" ] || { log "prompt file $PROMPT_FILE is missing or empty"; exit 1; }

log "=== start-instances ==="
timeout 60 $AWSP ec2 start-instances --instance-ids "$INSTANCE_ID" >>"$LOG" 2>&1 || { log "start-instances failed"; exit 1; }

log "=== waiting for running ==="
timeout 300 $AWSP ec2 wait instance-running --instance-ids "$INSTANCE_ID" >>"$LOG" 2>&1 || { log "never reached running"; exit 1; }

log "=== polling SSM Online (max 5min) ==="
ONLINE=0
for i in $(seq 1 30); do
  STATUS=$(timeout 20 $AWSP ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' --output text 2>>"$LOG")
  if [ "$STATUS" = "Online" ]; then ONLINE=1; break; fi
  sleep 10
done
if [ "$ONLINE" -ne 1 ]; then
  log "SSM agent never came online -- ec2-ssm-role が外れていないか確認 (SKILL.md 前提リソース表)"
  exit 1
fi
log "SSM online after ~$((i * 10))s"

log "=== sending prompt to claude --chrome via SSM (claude timeout ${CLAUDE_TIMEOUT}s) ==="
PROMPT_B64=$(base64 -w0 "$PROMPT_FILE")

read -r -d '' REMOTE_SCRIPT_TMPL <<'REMOTE'
set -uo pipefail
echo "__B64__" | base64 -d > /tmp/prompt.txt
CLAUDE_BIN=$(ls -d /home/ubuntu/.nvm/versions/node/*/bin/claude 2>/dev/null | head -1)
if [ -z "$CLAUDE_BIN" ]; then
  CLAUDE_BIN=$(sudo -u ubuntu bash -lc 'command -v claude' 2>/dev/null)
fi
if [ -z "$CLAUDE_BIN" ]; then
  echo "claude CLI not found on instance"; exit 1
fi
sudo -u ubuntu -i -- bash -lc "timeout __CTIMEOUT__ '$CLAUDE_BIN' --chrome --dangerously-skip-permissions -p \"\$(cat /tmp/prompt.txt)\""
REMOTE
REMOTE_SCRIPT="${REMOTE_SCRIPT_TMPL/__B64__/$PROMPT_B64}"
REMOTE_SCRIPT="${REMOTE_SCRIPT/__CTIMEOUT__/$CLAUDE_TIMEOUT}"

CMD_ID=$(timeout 30 $AWSP ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --timeout-seconds 600 \
  --parameters "commands=[$(printf '%s' "$REMOTE_SCRIPT" | jq -Rs .)],executionTimeout=[\"$((CLAUDE_TIMEOUT + 300))\"]" \
  --query 'Command.CommandId' --output text 2>>"$LOG")
log "command id: $CMD_ID"
if [ -z "$CMD_ID" ] || [ "$CMD_ID" = "None" ]; then
  log "send-command failed to return a command id"
  exit 1
fi

# `ssm wait command-executed` は 20回 x 5秒 ≒ 100秒で諦めるため、長いブラウザ操作には使えない。
# （旧版はここで必ず打ち切られ、InProgress のまま停止フェーズへ進んでいた。）自前でポーリングする。
log "=== polling command status (max ~20min) ==="
INV_STATUS="Pending"
for i in $(seq 1 120); do
  INV_STATUS=$(timeout 30 $AWSP ssm get-command-invocation \
    --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
    --query 'Status' --output text 2>/dev/null)
  case "${INV_STATUS:-Pending}" in
    Success | Failed | Cancelled | TimedOut) break ;;
    *) sleep 10 ;;
  esac
done
log "invocation status: $INV_STATUS after ~$((i * 10))s"

log "=== command-invocation result ==="
timeout 30 $AWSP ssm get-command-invocation \
  --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" 2>&1 | tee -a "$LOG"

log "=== main flow done, cleanup (stop) will run now ==="
```

## タイムアウトの目安

| 値 | 既定 | 根拠 |
| --- | --- | --- |
| `CLAUDE_TIMEOUT` | 1200s | 1ページ開いて読むだけなら 150s で足りるが、コンソールの設定変更のような多段操作は 5〜10分かかる。短すぎると「途中で切られたのに Success 扱い」になり一番タチが悪い。**延ばすより手順を分ける**ほうが確実（25分でも足りなかった実績あり） |
| 状態ポーリング回数 | 300回 × 10s | 120回（20分）だと本命が終わる前に打ち切られる |
| pre-flight 待ち | 30回 × 10s | 直前の回が `stopping` のうちは `start-instances` が失敗するため |
| SSM `executionTimeout` | `CLAUDE_TIMEOUT + 300` | claude 側の `timeout` より必ず長くする。逆転すると SSM が先に殺して出力が取れない |
| SSM `--timeout-seconds` | 600 | これは「実行開始までの待ち時間」であって実行時間ではない。混同しないこと |
| 状態ポーリング | 10s × 120回 | `ssm wait` は使わない（上記コメント参照） |
| `ec2 wait instance-stopped` | 300s | 180s だと停止確認前に打ち切られることがある |

## スクリーンショット等の成果物を目視回収したいとき（任意）

`claude --chrome` に「〇〇を `/tmp/xxx.png` に保存して」と指示した場合、上のスクリプトの `main flow done` の直前に以下を挟むと、改ざん・欠損なく手元へ回収できる（2026-08-14 の実接続検証で使用した方式）。

```bash
REMOTE_FILE=/tmp/xxx.png     # claude --chrome に指定させたパスに合わせる
LOCAL_DIR=/tmp/claude-0/$(whoami)/scratchpad   # 呼び出し元の scratchpad に合わせて調整
mkdir -p "$LOCAL_DIR"
LOCAL_FILE="$LOCAL_DIR/xxx.png"

SIZE=$(timeout 20 $AWSP ssm send-command --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters "commands=[\"wc -c < $REMOTE_FILE\"]" --query 'Command.CommandId' --output text)
# ↑ 実際は send-command → ポーリング → get-command-invocation の3手順が要る（本文中のパターンを流用）

# チャンクごとに base64 で取り出して結合し、最後に md5sum をリモート・ローカル双方で取って一致確認する。
# 大きいファイルは SSM の1回の出力上限（24000文字程度）に収まるようチャンク分割すること。
```

厳密な手順は SKILL.md の「既知の落とし穴・Tips」にある通り、**リモートの md5sum とローカルの md5sum を突き合わせる**のが要点。中身を見るだけで十分なら、`file` コマンドで寸法・種別だけ確認する軽量版でも足りる。コンソール画面のスクショは数百KB になりチャンク数が嵩むので、「実接続を厳密に証明したい」とき以外は、プロンプト側で**画面上の文字列を読み上げさせる**ほうが安上がりで済む。
