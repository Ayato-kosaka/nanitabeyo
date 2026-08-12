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
# ⚠️ 実行中は artifacts/ の外へ書くこと。Detox は起動時に artifacts のルートを作り直すため、
# 先に置いたファイルは消える（run 30432596949 で detox-run.log が Artifact に含まれず実測）。
# 収集は Detox が終わってから artifacts/ へコピーする
readonly WORK_DIR="${REPO_ROOT}/e2e-mobile/.detox-ci-logs"

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"

# 🔬 spec の絞り込み（workflow_dispatch の test_filter）。
# 修正 1 件の検証のために全 suite（iOS で 90 分超）を回すのは無駄なので、
# jest の --testPathPattern をそのまま渡せるようにする。空なら従来どおり全件。
# ⚠️ pnpm は最初の `--` を自分で消費するため、detox へ `--`（jest への区切り）を
# 届けるには二重に書く必要がある（pnpm run script -- -- --testPathPattern ...）
EXTRA_ARGS=()
if [[ -n "${DETOX_TEST_FILTER:-}" ]]; then
  EXTRA_ARGS=(-- -- --testPathPattern "${DETOX_TEST_FILTER}")
  echo "▶ spec を絞り込みます: --testPathPattern ${DETOX_TEST_FILTER}"
fi

echo "▶ pnpm --filter e2e-mobile run ${SCRIPT_NAME}"

# tee でジョブログと収集用ファイルの両方へ出す。冒頭の `set -o pipefail` により
# tee ではなく pnpm 側の終了コードが $? に残る（`set -e` は付けない。後始末を必ず走らせるため）
pnpm --filter e2e-mobile run "${SCRIPT_NAME}" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} 2>&1 | tee "${WORK_DIR}/detox-run.log"
readonly EXIT_CODE=$?

# ⚠️ 収集物のコピーは **後始末より先に**行う。後続がハングしても実行ログだけは必ず Artifact に残す
mkdir -p "${ARTIFACTS_DIR}"
cp "${WORK_DIR}"/*.log "${ARTIFACTS_DIR}/" 2>/dev/null || true

# 失敗時のみクラッシュログを回収する（成功時に置くとノイズにしかならない）。
#
# ⚠️ #1027 【バグ】判定を `command -v adb` にしてはいけない。
# **GitHub の macOS ランナーにも Android SDK（= adb）が入っている**ため iOS ジョブでも真になり、
# 端末が 1 台も繋がっていない状態で `adb logcat` を呼ぶと **接続待ちで永久にブロックする**。
# run 30445542854 の iOS はテスト自体は 31 秒で失敗していたのに、ここで 2.5 時間ハングして
# ジョブのタイムアウトで打ち切られ、Artifact のアップロードにも到達しなかった。
# 判定は「Android のスクリプトを実行したか」＋「実際に端末が見えているか」の 2 段にする。
if [ "${EXIT_CODE}" -ne 0 ] && [[ "${SCRIPT_NAME}" == *android* ]] && command -v adb >/dev/null 2>&1; then
	if adb devices | grep -qE '^\S+[[:space:]]+device$'; then
		echo "▶ クラッシュログ（logcat の crash バッファ）を回収します"
		adb logcat -b crash -d > "${ARTIFACTS_DIR}/logcat-crash.log" 2>&1 || true
	else
		echo "▶ 接続中の Android 端末が無いため、クラッシュログの回収をスキップします"
	fi
fi

exit "${EXIT_CODE}"
