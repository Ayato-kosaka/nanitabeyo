#!/bin/bash
# =============================================================================
# migration ファイル名の順序ガード
#
# このリポジトリの migration は「ファイル名昇順 = 適用順」で成立している
# （scripts/apply-migration.sh が from_file 以降を名前順に流す。DB 側に台帳は無い）。
# したがって、既にある（= 適用済みかもしれない）ファイルより辞書順で前に
# 新しいファイルを差し込むと、適用順が壊れる。詳細は
# infra/supabase/migrations/README.md を読むこと。
#
# 検査内容（BASE コミットと HEAD を比較）:
#   1. 追加された *.sql は、BASE に存在する全 *.sql より辞書順で後ろであること
#   2. 追加された *.sql は YYYYMMDDTHHMM_説明.sql の形式であること
#
# 使い方: bash scripts/assert-migration-filename-order.sh <BASE_SHA>
# =============================================================================
set -euo pipefail

MIGRATION_DIR="infra/supabase/migrations"
BASE="${1:?BASE_SHA を渡すこと（例: PR の base ブランチの SHA）}"

# BASE 時点で存在する最大のファイル名（= 適用列の最後尾）
base_max=$(git ls-tree -r --name-only "$BASE" -- "$MIGRATION_DIR" \
  | grep '\.sql$' | sed "s|^$MIGRATION_DIR/||" | LC_ALL=C sort | tail -1 || true)

# この差分で追加されたファイル（rename の新名も含めるため diff-filter=AR）
added=$(git diff --name-only --diff-filter=AR "$BASE" HEAD -- "$MIGRATION_DIR/*.sql" \
  | sed "s|^$MIGRATION_DIR/||" || true)

if [ -z "$added" ]; then
  echo "✅ migration の追加なし"
  exit 0
fi

fail=0
for f in $added; do
  if ! echo "$f" | grep -Eq '^[0-9]{8}T[0-9]{4}_.+\.sql$'; then
    echo "::error::$f はファイル名形式 YYYYMMDDTHHMM_説明.sql に従っていません。"
    fail=1
    continue
  fi
  if [ -n "$base_max" ] && [ "$(printf '%s\n%s\n' "$base_max" "$f" | LC_ALL=C sort | tail -1)" != "$f" ]; then
    echo "::error::$f は base の最後尾 $base_max より辞書順で前です。"
    fail=1
  elif [ "$f" = "$base_max" ]; then
    echo "::error::$f は base に既に存在します（同名追加）。"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  cat <<'EOS'

── 直し方 ──────────────────────────────────────────────
migration のファイル名の日付は「書いた日」ではなく「適用列に並ぶ順序」です。
main の最後尾より後ろになる名前（例: 今日の日付 + 時刻）へ rename してください。

同じ内容のファイルが既に main に別名で存在する場合（先に migration だけ
main へマージされたケース）は、ブランチ側の古い方を削除してください。
運用の全体像: infra/supabase/migrations/README.md
────────────────────────────────────────────────────────
EOS
  exit 1
fi

echo "✅ 追加された migration ($(echo "$added" | wc -l) 件) はすべて base の最後尾より後ろです"
