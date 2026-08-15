#!/bin/bash
# ec2-chrome-operate の実行土台。
#   usage: .claude/skills/ec2-chrome-operate/ec2_exec.sh <remote-script-file> [exec-timeout-seconds]
#
# **スクラッチパッドに毎回コピーを作らず、必ずこの固定パスから実行すること。**
# 権限クラシファイアは「その場で生成した名前の無いスクリプト」を繰り返しブロックする。
# .claude/settings.json の allow ルールはこのパスに対して書いてあるので、
# ここから実行するかぎり `aws ssm` 込みで通る（詳細は SKILL.md「権限クラシファイア」節）。
#
# 引数の <remote-script-file> は EC2 上で実行される内容であって、ローカルでは実行しない。
# 生成先はスクラッチパッドで構わない（実行するのは常にこのファイル）。
set -uo pipefail

REMOTE_FILE="${1:?usage: ec2_exec.sh <remote-script-file> [timeout]}"
EXEC_TIMEOUT="${2:-900}"
INSTANCE_ID="${EC2_CHROME_INSTANCE_ID:-i-0684d39b0c1b1abb6}"
REGION="${EC2_CHROME_REGION:-ap-northeast-1}"
AWSP="aws --profile sandbox --region $REGION"
LOG="${EC2_CHROME_LOG:-/tmp/ec2_exec.log}"
PARAMS_FILE="${EC2_CHROME_PARAMS:-/tmp/ec2_exec_params.json}"
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
[ "$ONLINE" -eq 1 ] || { log "SSM never came online -- ec2-ssm-role が外れていないか確認"; exit 1; }
log "SSM online after ~$((i * 10))s"

# --parameters のショートハンド (commands=[...]) は JSON エスケープを壊すので必ず file:// で渡す。
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

log "=== polling command status (max ~60min) ==="
INV_STATUS="Pending"
for i in $(seq 1 360); do
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
