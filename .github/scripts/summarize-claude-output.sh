#!/usr/bin/env bash
set -euo pipefail

OUT="${CLAUDE_EXECUTION_OUTPUT:-/home/runner/work/_temp/claude-execution-output.json}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [[ ! -f "$OUT" ]]; then
  echo "::warning::実行結果ログ($OUT)が見つかりません。"
  exit 0
fi

# Claude Codeの実行ファイルはJSONL（改行区切りJSON）。全体をslurpし、
# 最後のresultイベントから公開して問題ない集計値だけを取り出す。
SUBTYPE=$(jq -rs '[.[] | select(.type == "result")] | last | .subtype // "unknown"' "$OUT" 2>/dev/null || echo unknown)
IS_ERROR=$(jq -rs '[.[] | select(.type == "result")] | last | .is_error // false' "$OUT" 2>/dev/null || echo unknown)
NUM_TURNS=$(jq -rs '[.[] | select(.type == "result")] | last | .num_turns // "?"' "$OUT" 2>/dev/null || echo "?")
COST=$(jq -rs '[.[] | select(.type == "result")] | last | .total_cost_usd // "?"' "$OUT" 2>/dev/null || echo "?")
DENIALS=$(jq -rs '[.[] | select(.type == "result")] | last | .permission_denials_count // 0' "$OUT" 2>/dev/null || echo 0)

{
  echo "### Claude Code 実行結果"
  echo "- subtype: \`$SUBTYPE\` / is_error: \`$IS_ERROR\`"
  echo "- turns: $NUM_TURNS / cost: \$$COST / permission denials: $DENIALS"
} >> "$SUMMARY"

sanitize() {
  local value="$1"
  local max_length="$2"

  # permissionエラーにコマンド断片が含まれても、代表的な認証情報を公開しない。
  value=$(printf '%s' "$value" \
    | tr '\r\n' '  ' \
    | sed -E \
      -e 's/sk-ant-[A-Za-z0-9_-]+/[REDACTED_ANTHROPIC_KEY]/g' \
      -e 's/github_pat_[A-Za-z0-9_]+/[REDACTED_GITHUB_TOKEN]/g' \
      -e 's/gh[pousr]_[A-Za-z0-9_]+/[REDACTED_GITHUB_TOKEN]/g' \
      -e 's/(AKIA|ASIA)[A-Z0-9]{16}/[REDACTED_AWS_ACCESS_KEY]/g' \
      -e 's/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/[REDACTED_JWT]/g' \
      -e 's/Bearer[[:space:]]+[A-Za-z0-9._~+\/-]+/Bearer [REDACTED]/Ig' \
      -e 's#https://[^/@[:space:]]+:[^/@[:space:]]+@#https://[REDACTED]@#g' \
      -e 's/((TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTHORIZATION)[A-Za-z0-9_ -]*[=:][[:space:]]*)[^ ,;]+/\1[REDACTED]/Ig')

  if (( ${#value} > max_length )); then
    value="${value:0:max_length}…"
  fi
  printf '%s' "$value"
}

if [[ "$DENIALS" != "0" && "$DENIALS" != "null" ]]; then
  echo "::warning::permission_denials_count=$DENIALS。拒否されたツールと理由をStep Summaryへ限定表示します。"

  TMP_DENIALS=$(mktemp)
  trap 'rm -f "$TMP_DENIALS"' EXIT

  # assistant側のtool_useとuser側のtool_resultをtool_use_idで関連付ける。
  # 全ツール出力は公開せず、permission系かつis_error=trueの結果だけを最大20件抽出する。
  jq -rs -r '
    . as $events
    | [
      $events[]
      | select(.type == "assistant")
      | (.message.content // [])[]?
      | select(.type == "tool_use" and (.id // "") != "")
      | {key: .id, value: {tool: (.name // "unknown"), input: (.input // {})}}
    ]
    | from_entries as $uses
    | [
        $events[]
        | select(.type == "user")
        | (.message.content // [])[]?
        | select(.type == "tool_result" and (.is_error // false) == true)
        | . as $result
        | (
            ($result.content // "")
            | if type == "string" then .
              elif type == "array" then map(if type == "object" then (.text // tostring) else tostring end) | join("\n")
              else tostring
              end
          ) as $reason
        | select($reason | test("permission|denied|not allowed|not permitted|requires approval|approval required|blocked"; "i"))
        | ($uses[$result.tool_use_id] // {tool: "unknown", input: {}}) as $use
        | {
            tool: $use.tool,
            command: (if $use.tool == "Bash" then ($use.input.command // "") else "" end),
            reason: $reason
          }
      ]
    | .[:20][]
    | @base64
  ' "$OUT" > "$TMP_DENIALS" 2>/dev/null || true

  {
    echo
    echo "### 権限拒否の詳細（機密情報をマスク済み）"

    if [[ ! -s "$TMP_DENIALS" ]]; then
      echo "permission系のtool resultを抽出できませんでした。Claude Codeの出力形式が想定と異なる可能性があります。"
    else
      INDEX=0
      while IFS= read -r denial_b64; do
        INDEX=$((INDEX + 1))
        DENIAL_JSON=$(printf '%s' "$denial_b64" | base64 --decode 2>/dev/null || echo '{}')
        TOOL=$(jq -r '.tool // "unknown"' <<< "$DENIAL_JSON" 2>/dev/null || echo unknown)
        COMMAND=$(jq -r '.command // ""' <<< "$DENIAL_JSON" 2>/dev/null || true)
        REASON=$(jq -r '.reason // "decode error"' <<< "$DENIAL_JSON" 2>/dev/null || echo "decode error")

        TOOL=$(sanitize "$TOOL" 100)
        COMMAND=$(sanitize "$COMMAND" 500)
        REASON=$(sanitize "$REASON" 1000)

        echo "#### $INDEX. \`$TOOL\`"
        if [[ -n "$COMMAND" ]]; then
          echo "- command（先頭500文字）:"
          echo "    $COMMAND"
        fi
        echo "- reason（先頭1000文字）:"
        echo "    $REASON"
      done < "$TMP_DENIALS"
    fi
  } >> "$SUMMARY"
fi

if [[ "$SUBTYPE" == "error_max_turns" ]]; then
  echo "::warning::max_turns($NUM_TURNS)に到達して打ち切られました。タスクを分割するか max_turns を増やして再実行してください。"
fi
