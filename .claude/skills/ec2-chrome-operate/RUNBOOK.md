# RUNBOOK — 実行スクリプト

**このスキルを実行しているセッション自身の Bash で走らせる**（別セッションへ委譲しない。理由は [SKILL.md](./SKILL.md) 冒頭）。プロンプトは `/tmp/ec2_chrome_prompt.txt` に置き、スクリプトには埋め込まない（引用符やバッククォートで壊れるため）。

起動は必ず **Bash ツールの `run_in_background: true`** で行う。全体所要は 10〜20 分で、Bash ツールの上限（600秒）を超えるため、フォアグラウンドだとツールのタイムアウトでスクリプトごと切られる。`nohup ... &` を自分で書くのは classifier に止められることがあるので、ツールの機能を使うこと。

途中でどのステップが失敗しても、`trap cleanup EXIT INT TERM` により最後は必ず `stop-instances` が呼ばれる。個々の AWS 呼び出しに `timeout` を付けているのは、「ハングして trap が永久に発火しない」状態を作らないため（[SKILL.md](./SKILL.md) の「保証設計」参照）。

## 汎用実行スクリプト `ec2_exec.sh`

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

log "=== polling command status ==="
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

log "=== STDOUT ==="
timeout 30 $AWSP ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query 'StandardOutputContent' --output text 2>&1 | tee -a "$LOG"
log "=== STDERR ==="
timeout 30 $AWSP ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query 'StandardErrorContent' --output text 2>&1 | tee -a "$LOG"

log "=== done, cleanup (stop) will run now ==="
```

## リモート側スクリプト（Chrome 起動 → 接続待ち → 本命プロンプト）

`ec2_exec.sh` に渡すリモートスクリプトの本体。**`__B64__` は `base64 -w0 <プロンプトファイル>` の出力に置換して生成する**（呼び出し側で python 等を使って書き出すのが安全）。

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

echo "===== REAL RUN ====="
cat > /tmp/real.sh <<REOF
export DISPLAY=:20
timeout 780 "$CLAUDE_BIN" --chrome --dangerously-skip-permissions -p "\$(cat /tmp/prompt.txt)"
REOF
chmod 755 /tmp/real.sh
sudo -u ubuntu -i -- bash /tmp/real.sh
echo "===== real run exit: $? ====="
```

実測の所要（2026-08-14、GCP コンソールでクォータ画面を読み取らせた場合）: Chrome 起動60秒 → プローブ1回目で接続 → 本命 約9分。`ec2_exec.sh` には 1800 秒程度を渡しておけば足りる。

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
| `CLAUDE_TIMEOUT` | 900s | 1ページ開いて読むだけなら 150s で足りるが、コンソールの設定変更のような多段操作は 5〜10分かかる。短すぎると「途中で切られたのに Success 扱い」になり一番タチが悪い |
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
