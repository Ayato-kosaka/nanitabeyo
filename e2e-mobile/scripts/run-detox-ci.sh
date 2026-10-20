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
# 使い方: bash e2e-mobile/scripts/run-detox-ci.sh <pnpm スクリプト名> [jest へ渡す追加引数...]
#   例)    bash e2e-mobile/scripts/run-detox-ci.sh test:ci:android
#   例)    bash e2e-mobile/scripts/run-detox-ci.sh test:ci:ios --testPathPattern 'tests/smoke/'
set -uo pipefail

readonly SCRIPT_NAME="${1:?実行する pnpm スクリプト名を渡してください（例: test:ci:android）}"
shift || true
EXTRA_JEST_ARGS=("$@")
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ARTIFACTS_DIR="${REPO_ROOT}/e2e-mobile/artifacts"
# ⚠️ 実行中は artifacts/ の外へ書くこと。Detox は起動時に artifacts のルートを作り直すため、
# 先に置いたファイルは消える（run 30432596949 で detox-run.log が Artifact に含まれず実測）。
# 収集は Detox が終わってから artifacts/ へコピーする
readonly WORK_DIR="${REPO_ROOT}/e2e-mobile/.detox-ci-logs"

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"

# 🔬 spec の絞り込み（workflow_dispatch の test_filter → DETOX_TEST_FILTER）。
# 修正 1 件の検証やエビデンス撮影のために全 suite（iOS で 90 分超）を回すのは無駄なので、
# 対象 spec 名で絞れるようにする。空なら従来どおり全件。
#
# ⚠️ ここで jest へ引数（位置引数や --testPathPattern）として渡してはいけない。
# かつては位置引数で渡していたが、jest は位置引数と --testPathPattern を
# **1 つの OR リストへ合流させる**ため、tier スクリプトの `--testPathPattern 'tests/smoke/'`
# と併用すると「(tier) OR (filter)」になり絞れていなかった（run 32605810775 で実測）。
# 現在は jest.config.js が DETOX_TEST_FILTER（env はシェル再組み立てを経ないので
# `|` も安全）を読んで除外パターンで AND を組む。ここでは早期の入力検証だけを行う
if [[ -n "${DETOX_TEST_FILTER:-}" ]]; then
  if [[ ! "${DETOX_TEST_FILTER}" =~ ^[A-Za-z0-9._/|[:space:]-]+$ ]]; then
    echo "::error::test_filter に使えない文字が含まれています: ${DETOX_TEST_FILTER}（英数字と . _ / - のみ、区切りは | か空白）"
    exit 1
  fi
  echo "▶ spec を絞り込みます (jest.config.js が AND で適用): ${DETOX_TEST_FILTER}"
fi

# 🔀 追加の jest 引数（いまは workflow からは渡していない）。
#
# ⚠️ **`--shard=N/M` をここへ渡さないこと（#1579）。** 渡すと Detox の `--retries 1` が
# 呼び直す 2 巡目にも付き、**赤の約半分しか再実行されない**（jest の --shard は «渡された
# リストを M 等分» するので、失敗分だけに縮んだリストがもう一度割られる）。
# シャード分割は `DETOX_SHARD_FILES`（jest.config.js が読む env）で行う。
#
# ⚠️ **pnpm の `--` は 1 つだけ付ける。** 実測（pnpm 10）:
#   `pnpm run test:ci:ios -- --shard=1/2`
#     → `detox test --configuration ios.sim.release … -- --shard=1/2`
# となり、detox が `--` 以降をそのまま jest へ渡す（detox CLI の仕様）。2 つ付けると
# jest 側に裸の `--` が余分に届く。
#
# ⚠️ **スクリプト定義が既に `--` を持っている場合は、こちらで `--` を足してはいけない。**
# tier を絞るスクリプト（test:ci:smoke:ios 等）は `-- --testPathPattern …` を持っており、
# そこへ更に `--` を足すと jest の引数列の途中に裸の `--` が入る。その場合は区切り無しで
# 後ろへ並べる（同じ `--` 区間の続きになる）。
PASSTHROUGH=()
if [ ${#EXTRA_JEST_ARGS[@]} -gt 0 ]; then
	# package.json の定義を読むのは **写経しないため**（`--` を持つかどうかを目で判断しない）
	script_def="$(node -e 'const p=require(process.argv[1]);process.stdout.write(p.scripts[process.argv[2]] ?? "")' "${REPO_ROOT}/e2e-mobile/package.json" "${SCRIPT_NAME}")"
	case " ${script_def} " in
		*" -- "*) PASSTHROUGH=("${EXTRA_JEST_ARGS[@]}") ;;
		*)        PASSTHROUGH=("--" "${EXTRA_JEST_ARGS[@]}") ;;
	esac
	echo "▶ jest へ追加で渡す引数: ${EXTRA_JEST_ARGS[*]}"
fi

echo "▶ pnpm --filter e2e-mobile run ${SCRIPT_NAME} ${PASSTHROUGH[*]:-}"

# 🩺 ランナーが消滅する «直前» の空きメモリを残す（#1579）
#
# 2026-10-16〜10-19 の 4 夜、Android ジョブがテスト実行中に失敗し、`if: always()` を
# 付けたステップも post steps も **全部 skip** された（= ランナーが居なくなった）。
# 10-19 の注釈で GitHub 自身がこう言っている:
#
#   The hosted runner lost communication with the server. Anything in your workflow
#   that terminates the runner process, starves it for CPU/Memory, or blocks its
#   network access can cause this error.
#
# つまり «こちらの負荷で枯渇させた» 可能性がある。ところが消滅するとログも Artifact も
# 残らないので、**枯渇したのかどうかを確かめる材料が無い**。そこで `::notice` で
# 定期的に空きメモリを出しておく（注釈はランナーが死んでも GitHub 側に残り、
# `GET /repos/:owner/:repo/check-runs/:id/annotations` で全文取れる）。
#
# ⚠️ **プロセスのコマンド行を出してはいけない。** Detox は起動時の Intent extras へ
# refresh_token を載せるため、`ps` の cmd 列には秘密が入りうる（.detoxrc.js の
# `log: "none"` と同じ理由）。ここで出すのは **合計値だけ**にする。
# ⚠️ 注釈には件数の上限があるので（GitHub のドキュメント上は 1 ステップ 10 件。
# こちらで実測はしていない）**9 回で止める**。8 分間隔 × 9 = 72 分ぶんで、
# 実測の step 21 は 34〜63 分だったので足りる。
MEM_SAMPLER_PID=""
if command -v free >/dev/null 2>&1; then
	(
		for i in $(seq 1 9); do
			sleep 480
			# free の «available» が枯渇の指標。used/total も一緒に出して傾きを見る
			read -r _ total used avail <<< "$(free -m | awk '/^Mem:/ {print $1, $2, $3, $7}')"
			swap_used="$(free -m | awk '/^Swap:/ {print $3}')"
			echo "::notice title=android-mem::+$((i * 8))m total=${total}MB used=${used}MB available=${avail}MB swap_used=${swap_used}MB"
		done
	) &
	MEM_SAMPLER_PID=$!
fi

# tee でジョブログと収集用ファイルの両方へ出す。冒頭の `set -o pipefail` により
# tee ではなく pnpm 側の終了コードが $? に残る（`set -e` は付けない。後始末を必ず走らせるため）
#
# ⚠️ この行と `EXIT_CODE=$?` の間に **何も挟まないこと**（$? が上書きされる）。
# メモリ採取の開始は上で済ませてある
pnpm --filter e2e-mobile run "${SCRIPT_NAME}" ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"} 2>&1 | tee "${WORK_DIR}/detox-run.log"
readonly EXIT_CODE=$?

# ⚠️ `pkill -f` は自分のコマンド行にもパターンが当たって自滅するので PID で止める
if [ -n "${MEM_SAMPLER_PID}" ]; then
	kill "${MEM_SAMPLER_PID}" 2>/dev/null || true
	wait "${MEM_SAMPLER_PID}" 2>/dev/null || true
fi

# ⚠️ 収集物のコピーは **後始末より先に**行う。後続がハングしても実行ログだけは必ず Artifact に残す
mkdir -p "${ARTIFACTS_DIR}"
cp "${WORK_DIR}"/*.log "${ARTIFACTS_DIR}/" 2>/dev/null || true

# ⚠️ #1579 【バグ】**待ち時間に上限を付けること。**
#
# #1027 は «端末が居るか» を条件に足してこのハングを塞いだつもりだったが、塞げていなかった。
# run 34437874049（Android）は **テスト自体は 4.4 分で終わっている**のに、下の
# `adb logcat -b crash -d` で **64.9 分**固まり、90 分のジョブ上限で打ち切られた
# （ログの最後の行が «クラッシュログ…を回収します» のまま止まっている）。
#
# `-d` は «ダンプして終了» なので原理上ハングしないはずだが、テスト後の
# エミュレータが応答しない状態だと adb 側で待ち続ける。**«端末が見えている» は
# «端末が応答する» ではない。** 条件ではなく時間で切る。
#
# ⚠️ 後始末でジョブ時間を溶かすと、夜間は **残りの suite が走れなくなる**。
# 収集は «取れたら嬉しい» ものであって、テストを走らせる時間を奪ってよいものではない。
run_bounded() {
	local seconds="$1"
	shift
	if command -v timeout >/dev/null 2>&1; then
		timeout --signal=KILL "${seconds}" "$@"
	else
		# timeout が無い環境（macOS ランナー等）では従来どおり。ここは Android 分岐なので
		# 実際には ubuntu ランナーしか通らないが、fail-open で壊さない
		"$@"
	fi
}

# 失敗時のみクラッシュログを回収する（成功時に置くとノイズにしかならない）。
#
# ⚠️ #1027 【バグ】判定を `command -v adb` にしてはいけない。
# **GitHub の macOS ランナーにも Android SDK（= adb）が入っている**ため iOS ジョブでも真になり、
# 端末が 1 台も繋がっていない状態で `adb logcat` を呼ぶと **接続待ちで永久にブロックする**。
# run 30445542854 の iOS はテスト自体は 31 秒で失敗していたのに、ここで 2.5 時間ハングして
# ジョブのタイムアウトで打ち切られ、Artifact のアップロードにも到達しなかった。
# 判定は「Android のスクリプトを実行したか」＋「実際に端末が見えているか」の 2 段にする。
if [ "${EXIT_CODE}" -ne 0 ] && [[ "${SCRIPT_NAME}" == *android* ]] && command -v adb >/dev/null 2>&1; then
	# ⚠️ #2075 `… | grep -q` にしない（pipefail が SIGPIPE の 141 を拾い、«端末が見えている
	#    のに見えていない» と読む）。ここは #1579 で意図して fail-open にした経路なので、
	#    **その fail-open は保ったまま**（`|| true`）判定だけを正しくする。
	adb_devices="$(run_bounded 30 adb devices || true)"
	if grep -qE '^\S+[[:space:]]+device$' <<< "$adb_devices"; then
		echo "▶ クラッシュログ（logcat の crash バッファ）を回収します"
		run_bounded 60 adb logcat -b crash -d > "${ARTIFACTS_DIR}/logcat-crash.log" 2>&1 || true

		# #1375 【重要】**crash バッファだけでは «落ちた理由» が分からないことがある。**
		# run 32860661371（Android・案 A の埋め込み）で、アプリがランチャーへ戻る＝確実に
		# 落ちているのに `logcat -b crash` が **0 バイト**だった。crash バッファへ入るのは
		# Java の未捕捉例外と tombstone を伴うネイティブ abort だけで、
		#
		#   - lowmemorykiller / ActivityManager によるプロセス kill（`am_kill`）
		#   - WebView のレンダラプロセス消滅（`RenderProcessGone` / `DEAD_OBJECT`）
		#   - GPU の描画面確保失敗
		#
		# はいずれも **main バッファにしか出ない**。原因を «見えるように» するため
		# main バッファも一緒に残す。全文だと数十 MB になり得るので末尾だけにする。
		run_bounded 60 adb logcat -b main -d 2>/dev/null | tail -n 5000 > "${ARTIFACTS_DIR}/logcat-main-tail.log" || true
	else
		echo "▶ 接続中の Android 端末が無いため、クラッシュログの回収をスキップします"
	fi
fi

exit "${EXIT_CODE}"
