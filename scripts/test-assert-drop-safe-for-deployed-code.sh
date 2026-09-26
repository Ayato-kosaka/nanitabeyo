#!/bin/bash
# =============================================================================
# `assert-drop-safe-for-deployed-code.mjs` の自己テスト
#
# ## なぜ要るか
#
# 2026-09-24、`20260924T0100_drop_google_derived_columns.sql` を dev へ当てた 33 秒後から
# **dev の API が全件 500 になり、14 時間直らなかった**（約 15 万件 / #2052）。
# expand → **コードを出す** → contract の **真ん中が抜けていた**。
#
# ⚠️ だからここでは 2 つを別々に縛る。**抜けたのは B のほうである。**
#   A. スクリプトの論理（落とす DDL を拾えるか / 拾い過ぎないか）
#   B. **配線**（適用より «前» に走るか / 判定に使っている job 名が生きているか）
#
# 依存ゼロ・ネットワークゼロ（デプロイ済みの schema は `--deployed-prisma-file` で渡す）。
#
# 使い方: bash scripts/test-assert-drop-safe-for-deployed-code.sh
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/scripts/assert-drop-safe-for-deployed-code.mjs"
MIGRATE_WF="$ROOT/.github/workflows/db-migrate.yml"
API_WF="$ROOT/.github/workflows/api-deploy.yml"
pass=0
fail=0

check() { # check <説明> <期待(ok|ng)> <実際の終了コード>
  local label="$1" want="$2" code="$3"
  local got="ok"; [ "$code" -ne 0 ] && got="ng"
  if [ "$got" = "$want" ]; then
    echo "  ✅ $label"
    pass=$((pass + 1))
  else
    echo "  ❌ $label（期待 $want / 実際 $got）"
    fail=$((fail + 1))
  fi
}

sandbox=$(mktemp -d)
trap 'rm -rf "$sandbox"' EXIT

# ── デプロイ済みコードの schema（落とす列を «まだ持っている» 版）────────────────
cat > "$sandbox/prisma_old.prisma" <<'PRISMA'
model restaurants {
  id                 String  @id
  name               String
  name_language_code String
  address_components Json
  plus_code          Json?
}

model dishes {
  id   String @id
  name String
}

model legacy_thing {
  id String @id
}
PRISMA

# ── デプロイ済みコードの schema（もう持っていない版 = コードが先に出ている）──────
cat > "$sandbox/prisma_new.prisma" <<'PRISMA'
model restaurants {
  id                 String  @id
  name               String
  name_language_code String
}

model dishes {
  id String @id
}
PRISMA

run_guard() { # run_guard <prismaファイル|--no-deploy> <追加引数...>
  local prisma="$1"; shift
  if [ "$prisma" = "--no-deploy" ]; then
    # GITHUB_TOKEN を空にすると «いま載っている版が分からない» 経路へ入る
    (cd "$ROOT" && env -u GITHUB_TOKEN node "$GUARD" --target-schema dev "$@")
  else
    (cd "$ROOT" && node "$GUARD" --target-schema dev --deployed-sha testsha \
      --deployed-prisma-file "$prisma" "$@")
  fi
}

echo "A. スクリプトの論理"

# A-1 落とす DDL が無い migration は通る（ほとんどの migration がここ）
cat > "$sandbox/add_only.sql" <<'SQL'
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS memo text;
SQL
run_guard "$sandbox/prisma_old.prisma" "$sandbox/add_only.sql" >/dev/null 2>&1
check "落とす DDL が無い migration は通る" ok $?

# A-2 ⭐ **#2052 の再現**: 落とす列を、いま載っているコードがまだ持っている
cat > "$sandbox/drop_live.sql" <<'SQL'
ALTER TABLE restaurants DROP COLUMN IF EXISTS address_components;
SQL
run_guard "$sandbox/prisma_old.prisma" "$sandbox/drop_live.sql" >/dev/null 2>&1
check "いま載っているコードが読んでいる列を落とすと落ちる（#2052 の形）" ng $?

# A-3 コードが先に出ている（列がもう無い）なら通る
run_guard "$sandbox/prisma_new.prisma" "$sandbox/drop_live.sql" >/dev/null 2>&1
check "コードが先に出ていれば通る" ok $?

# A-4 ⚠️ コメントの中の DROP COLUMN を拾わない
#     （素朴な grep にすると日本語コメントで正しい migration が流せなくなる）
cat > "$sandbox/comment_only.sql" <<'SQL'
-- 将来 ALTER TABLE restaurants DROP COLUMN address_components; を入れる予定
/* ALTER TABLE dishes DROP COLUMN name; */
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS memo text;
SQL
run_guard "$sandbox/prisma_old.prisma" "$sandbox/comment_only.sql" >/dev/null 2>&1
check "コメントの中の DROP COLUMN は拾わない" ok $?

# A-5 ⚠️ 列を消さない DROP を拾わない。拾うと **既存の migration 全部が流せなくなる**
cat > "$sandbox/not_column_drops.sql" <<'SQL'
ALTER TABLE restaurants ALTER COLUMN name DROP NOT NULL;
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_pkey;
ALTER TABLE restaurants ALTER COLUMN plus_code DROP DEFAULT;
DROP INDEX IF EXISTS idx_restaurants_name;
DROP TRIGGER IF EXISTS set_updated_at ON restaurants;
SQL
# ⚠️ **終了コードで見てはいけない。** `DROP NOT NULL` を拾ってしまっても «`NOT` という列» に
#    なるだけで、prisma にそんな列は無いので **通ってしまう**（最初そう書いて、除外を
#    外す対照実験が «緑» になった）。拾った件数を直接見る。
(cd "$ROOT" && node --input-type=module -e '
import { findDestructiveChanges } from "./scripts/assert-drop-safe-for-deployed-code.mjs";
import { readFileSync } from "node:fs";
const found = findDestructiveChanges(readFileSync(process.argv[1], "utf8"));
if (found.length !== 0) {
  console.error("拾ってはいけないものを拾った:", JSON.stringify(found));
  process.exit(1);
}
' "$sandbox/not_column_drops.sql") >/dev/null 2>&1
check "DROP NOT NULL / CONSTRAINT / DEFAULT / INDEX / TRIGGER を 1 件も拾わない" ok $?

# A-6 1 つの ALTER TABLE に DROP が並ぶ形を全部拾う
cat > "$sandbox/multi_drop.sql" <<'SQL'
ALTER TABLE restaurants
  DROP COLUMN IF EXISTS memo,
  DROP COLUMN IF EXISTS plus_code;
SQL
run_guard "$sandbox/prisma_old.prisma" "$sandbox/multi_drop.sql" >/dev/null 2>&1
check "1 文に並んだ DROP COLUMN を全部拾う（2 つ目だけ生きている）" ng $?

# A-7 改名は «落として足す» と同じ。古い名前で読んでいるコードは落ちる
cat > "$sandbox/rename.sql" <<'SQL'
ALTER TABLE dishes RENAME COLUMN name TO display_name;
SQL
run_guard "$sandbox/prisma_old.prisma" "$sandbox/rename.sql" >/dev/null 2>&1
check "RENAME COLUMN も «落とす» として扱う" ng $?

# A-8 テーブルごと落とす
cat > "$sandbox/drop_table.sql" <<'SQL'
DROP TABLE IF EXISTS dev.legacy_thing;
SQL
run_guard "$sandbox/prisma_old.prisma" "$sandbox/drop_table.sql" >/dev/null 2>&1
check "DROP TABLE も拾う（model が残っていれば落ちる）" ng $?
run_guard "$sandbox/prisma_new.prisma" "$sandbox/drop_table.sql" >/dev/null 2>&1
check "DROP TABLE で model が無ければ通る" ok $?

# A-9 ⚠️ 似た名前の列に当たらないこと。当たると «まだある» と誤判定して永久に流せない
cat > "$sandbox/drop_similar.sql" <<'SQL'
ALTER TABLE restaurants DROP COLUMN IF EXISTS name_lang;
SQL
run_guard "$sandbox/prisma_new.prisma" "$sandbox/drop_similar.sql" >/dev/null 2>&1
check "name_lang が name_language_code に当たらない" ok $?

# ⚠️ **列は «行頭のフィールド宣言» でしか数えない。** 落とした列名が `@@index` や
#    `@relation` の中に残っているのはよくある（生成物なので手で消えない）。
#    単語境界だけで探すとここに当たり、**列を落としたあとも永久に «まだある» と言い続ける**。
cat > "$sandbox/prisma_attr_only.prisma" <<'PRISMA'
model restaurants {
  id     String  @id
  dishes dishes[]

  @@index([plus_code], map: "idx_restaurants_plus_code")
}

model dishes {
  id          String      @id
  restaurants restaurants @relation(fields: [plus_code], references: [id])
}
PRISMA
cat > "$sandbox/drop_plus_code.sql" <<'SQL'
ALTER TABLE restaurants DROP COLUMN IF EXISTS plus_code;
SQL
run_guard "$sandbox/prisma_attr_only.prisma" "$sandbox/drop_plus_code.sql" >/dev/null 2>&1
check "@@index / @relation の中の名前を «列がまだある» と読まない" ok $?

# A-10 ⚠️ いま載っている版が分からないとき。**落とす DDL があるなら落ちる**
run_guard --no-deploy "$sandbox/drop_live.sql" >/dev/null 2>&1
check "載っている版が分からず、落とす DDL があるなら落ちる" ng $?
run_guard --no-deploy --allow-unknown-deployment "$sandbox/drop_live.sql" >/dev/null 2>&1
check "明示的に降りれば（--allow-unknown-deployment）通る" ok $?
run_guard --no-deploy "$sandbox/add_only.sql" >/dev/null 2>&1
check "載っている版が分からなくても、落とす DDL が無ければ通る" ok $?

# --- B. 配線（実際に抜けたのはここ） -----------------------------------------
echo "B. 配線"

# ⚠️ **`… | grep -q` にしないこと（#2075）。** このファイルは `set -o pipefail` で走る。
#    `grep -q` は最初の一致で即座に終わるので上流が SIGPIPE で殺され、pipefail が
#    その **141 をパイプライン全体の終了コードにする**。つまり «一致しているのに ng» になる。
#    小さいファイルでは上流が書き終わるほうが速いので普通は通り、**CI でだけ稀に赤くなる**
#    （実測: 2026-09-26 の main https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36206053417
#    で «actions: read がある» だけが ng。同じ commit をローカルで回すと 18/18 緑だった。
#    400,000 行のファイルで再現すると 5 回とも 141 を返し、変数に受ける形は 5 回とも 0 だった）。
#    だから **一度変数へ受けてから** `grep` する。
wf_code() { grep -v '^[[:space:]]*#' "$1"; }

MIGRATE_WF_CODE="$(wf_code "$MIGRATE_WF")"
API_WF_CODE="$(wf_code "$API_WF")"

grep -q 'assert-drop-safe-for-deployed-code\.mjs' <<< "$MIGRATE_WF_CODE"
check "db-migrate.yml がこの門番を呼んでいる" ok $?

# ⚠️ **適用より «前» に走ること。** 後ろだと落ちても列は戻らない（既存の shared 検算がそれ）
guard_line=$(grep -n 'assert-drop-safe-for-deployed-code\.mjs' "$MIGRATE_WF" | head -1 | cut -d: -f1)
apply_line=$(grep -n 'bash scripts/apply-migration\.sh' "$MIGRATE_WF" | head -1 | cut -d: -f1)
[ -n "$guard_line" ] && [ -n "$apply_line" ] && [ "$guard_line" -lt "$apply_line" ]
check "門番が migration の適用より前に走る" ok $?

# 判定には api-deploy の run を読む必要がある
grep -q 'actions: read' <<< "$MIGRATE_WF_CODE"
check "db-migrate.yml の job に actions: read がある" ok $?

# ⚠️ 判定は api-deploy.yml の **job 名**に依存している。名前を変えるとここが黙って効かなくなる
grep -qF 'name: Deploy (${{ github.event.inputs.target }})' <<< "$API_WF_CODE"
check "api-deploy.yml の job 名が Deploy (<target>) のまま（判定の根拠）" ok $?

# ⚠️ #2075 この形へ戻さないための自己検査。コメント行は除いて数える
#    （この注意書き自身を «違反» と読まないため）。
PIPED_GREP_Q=$(grep -vE '^[[:space:]]*#' "$0" | grep -cE '\|[[:space:]]*grep[[:space:]]+-q' || true)
[ "$PIPED_GREP_Q" -eq 0 ]
check "パイプの下流で grep -q を使っていない（pipefail で 141 になる）" ok $?

echo ""
echo "pass $pass / fail $fail"
[ "$fail" -eq 0 ]
