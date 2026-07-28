#!/usr/bin/env bash
set -euo pipefail

OUT="${CLAUDE_EXECUTION_OUTPUT:-/home/runner/work/_temp/claude-execution-output.json}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [[ ! -f "$OUT" ]]; then
  echo "::warning::実行結果ログ($OUT)が見つかりません。"
  exit 0
fi

TMP_EVENTS=$(mktemp)
TMP_DENIALS=$(mktemp)
trap 'rm -f "$TMP_EVENTS" "$TMP_DENIALS"' EXIT

# claude-code-actionは通常JSON配列を書き出すが、旧形式のJSONLも読めるよう
# jqのslurp結果をイベント配列へ正規化する。
if ! jq -s '
  if length == 1 and (.[0] | type) == "array" then
    .[0]
  else
    .
  end
' "$OUT" > "$TMP_EVENTS" 2>/dev/null; then
  echo "::warning::Claude Codeの実行結果をJSONとして解析できませんでした。"
  exit 0
fi

# 最後のresultイベントから、公開して問題ない集計値だけを取り出す。
SUBTYPE=$(jq -r '[.[] | select(.type == "result")] | last | .subtype // "unknown"' "$TMP_EVENTS")
IS_ERROR=$(jq -r '[.[] | select(.type == "result")] | last | .is_error // false' "$TMP_EVENTS")
NUM_TURNS=$(jq -r '[.[] | select(.type == "result")] | last | .num_turns // "?"' "$TMP_EVENTS")
COST=$(jq -r '[.[] | select(.type == "result")] | last | .total_cost_usd // "?"' "$TMP_EVENTS")
DENIALS=$(jq -r '[.[] | select(.type == "result")] | last | (.permission_denials // []) | length' "$TMP_EVENTS")

{
  echo "### Claude Code 実行結果"
  echo "- subtype: \`$SUBTYPE\` / is_error: \`$IS_ERROR\`"
  echo "- turns: $NUM_TURNS / cost: \$$COST / permission denials: $DENIALS"
} >> "$SUMMARY"

sanitize() {
  local value="$1"
  local max_length="$2"

  # permission情報にコマンド断片が含まれても、代表的な認証情報を公開しない。
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

if (( DENIALS > 0 )); then
  echo "::warning::permission_denials_count=$DENIALS。拒否されたツールと安全な概要をStep Summaryへ限定表示します。"

  # result.permission_denialsが権限拒否の一次情報。tool_resultのエラーが存在する場合だけ
  # tool_use_idで関連付けて理由を補い、なければ一般的な説明を表示する。
  jq -r '
    def content_text:
      if type == "string" then .
      elif type == "array" then
        map(if type == "object" then (.text // tostring) else tostring end) | join("\n")
      else tostring
      end;

    . as $events
    | ([
        $events[]
        | select(.type == "user")
        | (.message.content // [])[]?
        | select(.type == "tool_result" and (.is_error // false) == true and (.tool_use_id // "") != "")
        | . as $result
        | {key: $result.tool_use_id, value: (($result.content // "") | content_text)}
      ] | from_entries) as $errors
    | ([.[] | select(.type == "result")] | last | (.permission_denials // []))[:20][]
    | {
        tool: (.tool_name // "unknown"),
        tool_use_id: (.tool_use_id // ""),
        command: (if .tool_name == "Bash" then (.tool_input.command // "") else "" end),
        parameter_names: (if .tool_name == "Bash" then [] else ((.tool_input // {}) | keys) end),
        reason: ($errors[.tool_use_id] // "Claude Codeの権限設定により拒否されました。SDK resultには詳細理由が含まれていません。")
      }
    | @base64
  ' "$TMP_EVENTS" > "$TMP_DENIALS" 2>/dev/null || true

  {
    echo
    echo "### 権限拒否の詳細（機密情報をマスク済み）"

    if [[ ! -s "$TMP_DENIALS" ]]; then
      echo "permission_denialsの詳細を抽出できませんでした。Claude Codeの出力形式が想定と異なる可能性があります。"
    else
      INDEX=0
      while IFS= read -r denial_b64; do
        INDEX=$((INDEX + 1))
        DENIAL_JSON=$(printf '%s' "$denial_b64" | base64 --decode 2>/dev/null || echo '{}')
        TOOL=$(jq -r '.tool // "unknown"' <<< "$DENIAL_JSON" 2>/dev/null || echo unknown)
        TOOL_USE_ID=$(jq -r '.tool_use_id // ""' <<< "$DENIAL_JSON" 2>/dev/null || true)
        COMMAND=$(jq -r '.command // ""' <<< "$DENIAL_JSON" 2>/dev/null || true)
        PARAMETER_NAMES=$(jq -r '(.parameter_names // []) | join(", ")' <<< "$DENIAL_JSON" 2>/dev/null || true)
        REASON=$(jq -r '.reason // "詳細理由を取得できませんでした。"' <<< "$DENIAL_JSON" 2>/dev/null || echo "詳細理由を取得できませんでした。")

        TOOL=$(sanitize "$TOOL" 100)
        TOOL_USE_ID=$(sanitize "$TOOL_USE_ID" 100)
        COMMAND=$(sanitize "$COMMAND" 500)
        PARAMETER_NAMES=$(sanitize "$PARAMETER_NAMES" 300)
        REASON=$(sanitize "$REASON" 1000)

        echo "#### $INDEX. \`$TOOL\`"
        if [[ -n "$TOOL_USE_ID" ]]; then
          echo "- tool_use_id: \`$TOOL_USE_ID\`"
        fi
        if [[ -n "$COMMAND" ]]; then
          echo "- command（先頭500文字）:"
          echo "    $COMMAND"
        elif [[ -n "$PARAMETER_NAMES" ]]; then
          echo "- parameters（値は非表示）: \`$PARAMETER_NAMES\`"
        fi
        echo "- reason（先頭1000文字）:"
        echo "    $REASON"
      done < "$TMP_DENIALS"

      if (( DENIALS > 20 )); then
        echo
        echo "先頭20件のみ表示しています。残り$((DENIALS - 20))件は省略しました。"
      fi
    fi
  } >> "$SUMMARY"
fi

if [[ "$SUBTYPE" == "error_max_turns" ]]; then
  echo "::warning::max_turns($NUM_TURNS)に到達して打ち切られました。タスクを分割するか max_turns を増やして再実行してください。"
fi
