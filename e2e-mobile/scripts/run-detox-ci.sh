#!/usr/bin/env bash
# 🧪 CI で Detox を実行し、**あとから読める形で証跡を残す**ラッパー（#1027）
#
# ## なぜ必要か
# GitHub Actions のジョブログは API 経由だと末尾しか取得できず（本文は Azure blob への
# リダイレクト。ネットワーク制限のある環境からは取得できない）、アプリが落ちて Detox が
# "Detox can't seem to connect to the test app(s)!" を数千行吐くと、**肝心の失敗理由が
# 取得可能な末尾から押し出されて読めなくなる**（run 30429560108 で実測）。
# 実行ログを artifacts/ へ置いておけば、Artifact 経由で必ず全文を回収できる。
#
# ## セキュリティ（#1030 レビュー B-2）
# public リポジトリの Artifact は実質誰でも取得できる。したがって:
# - Detox の device log（logcat 全文）は **収集しない**（.detoxrc.js の `log: "none"`）。
#   起動時の Intent extras に refresh_token が載るため
# - ここで追加収集するのは **crash バッファのみ**（`adb logcat -b crash`）。
#   クラッシュのスタックトレースだけが入るバッファで、Intent extras は含まれない
#
# 使い方: bash e2e-mobile/scripts/run-detox-ci.sh <pnpm スクリプト名>
#   例)    bash e2e-mobile/scripts/run-detox-ci.sh test:ci:android
set -uo pipefail

readonly SCRIPT_NAME="${1:?実行する pnpm スクリプト名を渡してください（例: test:ci:android）}"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ARTIFACTS_DIR="${REPO_ROOT}/e2e-mobile/artifacts"

mkdir -p "${ARTIFACTS_DIR}"

echo "▶ pnpm --filter e2e-mobile run ${SCRIPT_NAME}"

# tee でジョブログと Artifact の両方へ出す。冒頭の `set -o pipefail` により
# tee ではなく pnpm 側の終了コードが $? に残る（`set -e` は付けない。後始末を必ず走らせるため）
pnpm --filter e2e-mobile run "${SCRIPT_NAME}" 2>&1 | tee "${ARTIFACTS_DIR}/detox-run.log"
readonly EXIT_CODE=$?

# 失敗時のみクラッシュログを回収する（成功時に置くとノイズにしかならない）。
# adb が無い環境（iOS ジョブ）では単に何もしない
if [ "${EXIT_CODE}" -ne 0 ] && command -v adb >/dev/null 2>&1; then
	echo "▶ クラッシュログ（logcat の crash バッファ）を回収します"
	adb logcat -b crash -d > "${ARTIFACTS_DIR}/logcat-crash.log" 2>&1 || true
fi

exit "${EXIT_CODE}"
