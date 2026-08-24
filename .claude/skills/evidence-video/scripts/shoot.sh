#!/usr/bin/env bash
# 使い方:
#   EVIDENCE_SCRATCH=/tmp/... EVIDENCE_HOME_BRANCH=<戻り先> \
#     shoot.sh <撮影対象branch> <出力ディレクトリ名> <シナリオ.mjs> [KEY=VAL ...]
#
# 撮影対象のブランチを checkout してビルドし直すので、PR ごとのエビデンスが撮れる。
# 終わったら必ずサーバを止め、dist-local を消し、元のブランチへ戻る。
# ブランチを checkout → web ビルドを立ち上げ → シナリオを撮る → 片付けまでを1コマンドにする。
set -euo pipefail
REPO=/home/user/nanitabeyo
SCRATCH="${EVIDENCE_SCRATCH:?出力先を EVIDENCE_SCRATCH で渡すこと（リポジトリ外のパス）}"
BRANCH="$1"; OUTNAME="$2"; SCEN="$3"; shift 3

cd "$REPO"
bash .claude/skills/evidence-video/scripts/build-and-serve.sh stop >/dev/null 2>&1 || true
git checkout -q "$BRANCH"
echo "== $(git rev-parse --abbrev-ref HEAD) @ $(git log --oneline -1)"

nohup bash .claude/skills/evidence-video/scripts/build-and-serve.sh start > "$SCRATCH/serve-$OUTNAME.log" 2>&1 &
for i in $(seq 1 120); do
  curl -s -o /dev/null --noproxy '*' http://localhost:8788/ja-JP/search && break
  sleep 5
done
if ! curl -s -o /dev/null --noproxy '*' http://localhost:8788/ja-JP/search; then
  echo "!! サーバが立たなかった。ログ:"; tail -20 "$SCRATCH/serve-$OUTNAME.log"; exit 1
fi
echo "== server ready"

export EVIDENCE_OUT="$SCRATCH/ev/$OUTNAME"
export EVIDENCE_REPO="$REPO"
mkdir -p "$EVIDENCE_OUT"
env "$@" node "$REPO/.claude/skills/evidence-video/scenarios/$SCEN"

echo "== files"; ls "$EVIDENCE_OUT"
bash .claude/skills/evidence-video/scripts/build-and-serve.sh stop >/dev/null 2>&1 || true
cd "$REPO" && git checkout -q "${EVIDENCE_HOME_BRANCH:-main}"
echo "== done, git status:"; git status --short
