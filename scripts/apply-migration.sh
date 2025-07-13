#!/bin/bash

set -a
source scripts/.env
set +a

if [ -z "$DB_SCHEMA" ]; then
  echo "❌ DB_SCHEMA is not set"
  exit 1
fi

MIGRATION_DIR=infra/supabase/migrations

# .sqlファイルをソートして取得
FILES=($(ls "$MIGRATION_DIR"/*.sql 2>/dev/null | sort))

if [ ${#FILES[@]} -eq 0 ]; then
  echo "❌ マイグレーションファイルが見つかりません ($MIGRATION_DIR/*.sql)"
  exit 1
fi

# 指定ファイルを取得（存在しない場合は空文字扱い）
TARGET_FILE="$1"
START_INDEX=0

if [ -n "$TARGET_FILE" ]; then
  TARGET_PATH="$MIGRATION_DIR/$TARGET_FILE"
  FOUND=0
  for i in "${!FILES[@]}"; do
    if [[ "${FILES[$i]}" == "$TARGET_PATH" ]]; then
      START_INDEX=$i
      FOUND=1
      break
    fi
  done

  if [ $FOUND -eq 0 ]; then
    echo "⚠️ 指定ファイルが見つかりませんでした: $TARGET_PATH"
    echo "👉 すべてのマイグレーションを適用します。"
    START_INDEX=0
  else
    echo "🔎 指定ファイルからマイグレーションを開始: $TARGET_FILE"
  fi
else
  echo "🔎 ファイルが指定されなかったため、すべてのマイグレーションを適用します。"
fi

# 適用開始
for ((i=START_INDEX; i<${#FILES[@]}; i++)); do
  FILE="${FILES[$i]}"
  echo "📄 Applying: $FILE (schema: $DB_SCHEMA)"

  psql "$DATABASE_URL" --set ON_ERROR_STOP=on <<EOF
SET search_path TO $DB_SCHEMA;
\i $FILE
EOF

  if [ $? -ne 0 ]; then
    echo "❌ マイグレーション中にエラーが発生しました（$FILE）。処理を中断します。"
    break
  fi
done
