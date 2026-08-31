#!/bin/bash

set -e

set -a
source api/.env
set +a

# --- safer: read only the variables we need from api/.env ---
DB_SCHEMA=$(grep -E '^DB_SCHEMA=' api/.env | cut -d'=' -f2-)
export DB_SCHEMA

# If you rely on other variables from api/.env, list them explicitly here:
# EXAMPLE_VAR=$(grep -E '^EXAMPLE_VAR=' api/.env | cut -d'=' -f2-)
# export EXAMPLE_VAR

if [ -z "$DB_SCHEMA" ]; then
  echo "❌ DB_SCHEMA is not set in api/.env"
  exit 1
fi

TEMPLATE="api/prisma/schema.template.prisma"
TARGET="api/prisma/schema.prisma"

if [ ! -f "$TEMPLATE" ]; then
  echo "❌ Template not found: $TEMPLATE"
  exit 1
fi

echo "📄 Generating schema.prisma with schema: $DB_SCHEMA"
sed "s/__SCHEMA__/${DB_SCHEMA}/g" "$TEMPLATE" > "$TARGET"

echo "🔄 Running prisma db pull"
pnpm -C api exec prisma db pull \
  --schema "prisma/schema.prisma" \
  --config "../prisma.config.ts"

echo "🧬 Running prisma generate"
pnpm -C api exec prisma generate \
  --schema "prisma/schema.prisma" \
  --config "../prisma.config.ts"

# もしスキーマが "public" の場合はここで終了
if [ "$DB_SCHEMA" = "public" ]; then
  echo "✅ Done for public schema (skipping Supabase types and converters)"
  exit 0
fi


EXPO_ENV="app-expo/.env"

# EXPO_PUBLIC_SUPABASE_URL を読み込んでプロジェクトID抽出
EXPO_PUBLIC_SUPABASE_URL=$(grep '^EXPO_PUBLIC_SUPABASE_URL=' "$EXPO_ENV" | cut -d '=' -f2-)

if [ -z "$EXPO_PUBLIC_SUPABASE_URL" ]; then
  echo "❌ EXPO_PUBLIC_SUPABASE_URL is not set in expo/.env"
  exit 0
fi

PROJECT_ID=$(echo "$EXPO_PUBLIC_SUPABASE_URL" | sed -E 's|https?://([a-z0-9]+)\.supabase\.co.*|\1|')

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Could not extract PROJECT_ID from EXPO_PUBLIC_SUPABASE_URL"
  exit 1
fi

echo "📦 Extracted Supabase Project ID: $PROJECT_ID"
echo "🧬 Generating Supabase types..."
# CLI のバージョンは db-migrate.yml と揃えること。ずれると生成物の差分になる（#1575）
npx --yes "supabase@${SUPABASE_CLI_VERSION:-2.115.0}" gen types typescript \
  --project-id "$PROJECT_ID" --schema "$DB_SCHEMA" > /tmp/database.types.ts

if ! grep -q "^export type Database = {" /tmp/database.types.ts; then
  echo "❌ supabase gen types の出力が想定の形ではありません。database.types.ts は更新しません"
  exit 1
fi
mv /tmp/database.types.ts shared/supabase/database.types.ts

echo "✅ Supabase types generated at shared/supabase/database.types.ts"

# converters は手書きである（shared/converters/README.md）。
# 2026-08-21 に廃止したスプレッドシート生成器をここで呼んでいたため、
# このスクリプトを実行すると手書きの converters が上書きされていた（#1575 §1-6）。
echo "ℹ️  shared/converters/ は手書きです。列の増減があれば手で追従させ、"
echo "    pnpm -F shared build が通ることを確認してください。"

echo "✅ All done!"
