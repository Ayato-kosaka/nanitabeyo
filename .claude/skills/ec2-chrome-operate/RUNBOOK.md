# RUNBOOK — 実行スクリプト

`ec2-sandbox` 環境の新規セッションに、**このスクリプトを1通のメッセージとして丸ごと**送る。`__PROMPT__` は事前にユーザーの指示文へ置き換えること（プロンプト自体に `'` や改行が含まれても壊れないよう、下のスクリプトはヒアドキュメントで受け取る想定）。

途中でどのステップが失敗しても、`trap cleanup EXIT INT TERM` により最後は必ず `stop-instances` が呼ばれる。個々の AWS 呼び出しに `timeout` を付けているのは、「ハングして trap が永久に発火しない」状態を作らないため（[SKILL.md](./SKILL.md) の「保証設計」参照）。

```bash
cat <<'PROMPT_EOF' > /tmp/ec2_chrome_prompt.txt
__PROMPT__
PROMPT_EOF

set -uo pipefail

INSTANCE_ID="${EC2_CHROME_INSTANCE_ID:-i-0684d39b0c1b1abb6}"
REGION="${EC2_CHROME_REGION:-ap-northeast-1}"
AWSP="aws --profile sandbox --region $REGION"
LOG="/tmp/ec2_chrome_run.log"
: > "$LOG"
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }

STOP_DONE=0
cleanup() {
  local exit_code=$?
  if [ "$STOP_DONE" -eq 0 ]; then
    STOP_DONE=1
    log "cleanup: stopping $INSTANCE_ID (trigger: exit code $exit_code)"
    timeout 60 $AWSP ec2 stop-instances --instance-ids "$INSTANCE_ID" >>"$LOG" 2>&1
    timeout 180 $AWSP ec2 wait instance-stopped --instance-ids "$INSTANCE_ID" >>"$LOG" 2>&1
    final_state=$(timeout 30 $AWSP ec2 describe-instances --instance-ids "$INSTANCE_ID" \
      --query 'Reservations[0].Instances[0].State.Name' --output text 2>>"$LOG")
    log "final state: $final_state"
    if [ "$final_state" != "stopped" ]; then
      log "*** WARNING: 停止確認に失敗。AWSコンソールで手動確認・停止すること: $INSTANCE_ID ***"
    fi
  fi
  echo "----- $LOG -----"
  cat "$LOG"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

log "=== start-instances ==="
timeout 60 $AWSP ec2 start-instances --instance-ids "$INSTANCE_ID" >>"$LOG" 2>&1 || { log "start-instances failed"; exit 1; }

log "=== waiting for running ==="
timeout 180 $AWSP ec2 wait instance-running --instance-ids "$INSTANCE_ID" >>"$LOG" 2>&1 || { log "never reached running"; exit 1; }

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
log "SSM online after ~$((i*10))s"

log "=== sending prompt to claude --chrome via SSM ==="
PROMPT_B64=$(base64 -w0 /tmp/ec2_chrome_prompt.txt)

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
sudo -u ubuntu -i -- bash -lc "timeout 150 '$CLAUDE_BIN' --chrome --dangerously-skip-permissions -p \"\$(cat /tmp/prompt.txt)\""
REMOTE
REMOTE_SCRIPT="${REMOTE_SCRIPT_TMPL/__B64__/$PROMPT_B64}"

CMD_ID=$(timeout 30 $AWSP ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters "commands=[$(printf '%s' "$REMOTE_SCRIPT" | jq -Rs .)]" \
  --query 'Command.CommandId' --output text 2>>"$LOG")
log "command id: $CMD_ID"
if [ -z "$CMD_ID" ] || [ "$CMD_ID" = "None" ]; then
  log "send-command failed to return a command id"
  exit 1
fi

timeout 200 $AWSP ssm wait command-executed \
  --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" >>"$LOG" 2>&1
WAIT_RC=$?
[ "$WAIT_RC" -ne 0 ] && log "wait command-executed exited $WAIT_RC (下の invocation 結果を見て判断)"

log "=== command-invocation result ==="
timeout 30 $AWSP ssm get-command-invocation \
  --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" | tee -a "$LOG"

log "=== main flow done, cleanup (stop) will run now ==="
```

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
# ↑ 実際は send-command → wait → get-command-invocation の3手順が要る（本文中のパターンを流用）

# チャンクごとに base64 で取り出して結合し、最後に md5sum をリモート・ローカル双方で取って一致確認する。
# 大きいファイルは SSM の1回の出力上限（24000文字程度）に収まるようチャンク分割すること。
```

厳密な手順は SKILL.md の「既知の落とし穴・Tips」にある通り、**リモートの md5sum とローカルの md5sum を突き合わせる**のが要点。中身を見るだけで十分なら、`file` コマンドで寸法・種別だけ確認する軽量版でも足りる。
