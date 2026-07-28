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

if (( DENIALS > 0 )); then
  echo "::warning::permission_denials_count=$DENIALS。拒否されたツールの安全なメタデータだけをStep Summaryへ表示します。"

  # result.permission_denialsから、値を含まないメタデータだけを最大20件抽出する。
  # tool_inputの値・Bashコマンド・tool_result本文は、未知の機密情報を含み得るため公開しない。
  jq -r '
    ([.[] | select(.type == "result")] | last | (.permission_denials // []))[:20][]
    | {
        tool: (.tool_name // "unknown"),
        tool_use_id: (.tool_use_id // ""),
        parameter_names: ((.tool_input // {}) | keys)
      }
    | @base64
  ' "$TMP_EVENTS" > "$TMP_DENIALS" 2>/dev/null || true

  {
    echo
    echo "### 権限拒否の詳細（引数値は非表示）"

    if [[ ! -s "$TMP_DENIALS" ]]; then
      echo "permission_denialsの詳細を抽出できませんでした。Claude Codeの出力形式が想定と異なる可能性があります。"
    else
      INDEX=0
      while IFS= read -r denial_b64; do
        INDEX=$((INDEX + 1))
        DENIAL_JSON=$(printf '%s' "$denial_b64" | base64 --decode 2>/dev/null || echo '{}')
        TOOL=$(jq -r '.tool // "unknown"' <<< "$DENIAL_JSON" 2>/dev/null || echo unknown)
        TOOL_USE_ID=$(jq -r '.tool_use_id // ""' <<< "$DENIAL_JSON" 2>/dev/null || true)
        PARAMETER_NAMES=$(jq -r '(.parameter_names // []) | join(", ")' <<< "$DENIAL_JSON" 2>/dev/null || true)

        echo "#### $INDEX. \`$TOOL\`"
        if [[ -n "$TOOL_USE_ID" ]]; then
          echo "- tool_use_id: \`$TOOL_USE_ID\`"
        fi
        if [[ -n "$PARAMETER_NAMES" ]]; then
          echo "- parameters（値は非表示）: \`$PARAMETER_NAMES\`"
        else
          echo "- parameters: なし"
        fi
        echo "- 詳細理由・コマンド・引数値は、機密情報保護のため公開しません。"
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
