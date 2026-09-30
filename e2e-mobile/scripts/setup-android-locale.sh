#!/usr/bin/env bash
# 🌏 Android エミュレータのシステムロケールを ja-JP へ固定する（#1031 確定判断 B4）
#
# ## なぜスクリプトファイルに切り出しているか
# `reactivecircus/android-emulator-runner` の `script:` は **1 行ずつ別プロセスで実行**される
# （run 30401214828 で `if ...; then` の途中で `Syntax error: end of file unexpected` になり実測）。
# そのため複数行の制御構文も、行をまたぐ変数の引き継ぎも成立しない。
# ワークフロー側からはこのファイルを 1 行で呼ぶだけにする。
#
# ## なぜ adb root が必要か
# Android には Detox の `languageAndLocale`（iOS 専用）に相当する起動オプションが無いため、
# 端末側の `persist.sys.locale` を書き換えるしかない。これは protected property なので
# 通常の `adb shell setprop` では "Failed to set property" になる。
# `google_apis` イメージは `adb root` で root 化できる（`google_apis_playstore` では不可）。
#
# ## なぜ emulator-options の -prop では駄目だったか
# `-prop persist.sys.locale=ja-JP` をブート時に渡しても実行中は en-US のままだった
# （run 30394200940 で実測）。ブートプロパティは設定プロバイダの初期化に間に合わない。
set -euo pipefail

readonly EXPECTED_LOCALE="ja-JP"
# `am get-config` の表記は `-ja-rJP-` なので、言語 / 国を別々に持つ
readonly EXPECTED_LANGUAGE="ja"
readonly EXPECTED_COUNTRY="JP"

echo "▶ Android のシステムロケールを ${EXPECTED_LOCALE} へ設定します"

# ⚠️ **adbd の再起動をまたぐ adb を «1 回で成功する» 前提で書かないこと（2026-09-27 に実測）。**
#
# エミュレータは snapshot から起き上がった直後、adbd が数秒のあいだ上がったり落ちたりする。
# 2026-09-27 の夜間は runner の boot 判定でも `adb: device offline` が 1 回出ており、
# その 3 秒後に走ったこの `adb root` が `adb: unable to connect for root: closed` で
# 非ゼロになり、`set -e` が **テストを 1 本も走らせないまま Android ジョブを落とした**
# （run 36352812664 / 21:47 に着火。前夜 36273907923 の同じ行は `restarting adbd as root`
# で通っており、**コードの変化ではなく adbd の立ち上がりの速さの差**である）。
#
# だから ①`adb root` の **前にも** `wait-for-device` を入れ、②接続断で落ちうる adb は
# 数回試す。⚠️ 再試行の告知は **stderr** へ出すこと（`$( … )` で値を受ける呼び出しがあり、
# stdout へ混ぜると取り出した値が壊れる）。
adb_retry() { # adb_retry <試行回数> <adb の引数...>
	local attempts="$1"
	shift
	local i=1
	until adb "$@"; do
		if [ "${i}" -ge "${attempts}" ]; then
			echo "::error::adb $* が ${attempts} 回とも失敗しました（adbd へ接続できません）。" >&2
			return 1
		fi
		echo "▶ adb $* に失敗しました。adbd の再接続を待って再試行します（${i}/${attempts}）" >&2
		adb wait-for-device || true
		sleep 2
		i=$((i + 1))
	done
}

# ⚠️ **ここの wait は «root の後» ではなく «root の前» にも要る。** 後ろだけでは
#    root そのものが接続断に当たったときに吸収できない（上の実測がそれ）。
adb wait-for-device
# adb root は adbd を再起動するため、直後の接続断を wait-for-device で吸収する
adb_retry 5 root
adb wait-for-device

adb_retry 5 shell setprop persist.sys.locale "${EXPECTED_LOCALE}"
adb_retry 5 shell setprop persist.sys.language "${EXPECTED_LANGUAGE}"
adb_retry 5 shell setprop persist.sys.country "${EXPECTED_COUNTRY}"

# setprop しただけでは起動済みのアプリ/システム UI へ反映されない。
# zygote を再起動して、以降に起動するプロセスが新しいロケールを読むようにする
adb_retry 5 shell setprop ctl.restart zygote

# zygote 再起動でシステムサーバが一度落ちる。落ちる前に boot_completed を読むと
# 「まだ 1 のまま」を掴んでしまうため、先に少し待ってからポーリングする
sleep 10
adb wait-for-device

echo "▶ システムサーバの再起動完了を待ちます"
deadline=$((SECONDS + 180))
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
	if [ "${SECONDS}" -ge "${deadline}" ]; then
		echo "::error::zygote 再起動後に sys.boot_completed が 1 になりませんでした。"
		exit 1
	fi
	sleep 2
done

# 以降のテストは非 root で動かしたいので戻す（unroot も adbd を再起動する）
adb unroot || true
adb wait-for-device

# ⚠️ #1579 【修正】**落とす基準は «アプリから見えるロケール» の側へ置く。**
#
# ここは長いあいだ重みが逆だった。
#
# | 読んでいた値 | それは何か | 旧: 一致しなかったら |
# | --- | --- | --- |
# | `getprop persist.sys.locale` | **自分がさっき書いた property**（«設定した記録»） | **exit 1** |
# | `am get-config` の `-ja-rJP-` | **アプリが実際に使う LocaleList**（«いま効いている値»） | `::warning::` だけ |
#
# property が空へ戻っていてもアプリは日本語で描かれていた（run 34453015222）。
# つまり **弱い証拠で落として、強い証拠では落としていなかった**。入れ替える。
#
# 落とす側へ回す代わり、観測は数回試す。1 回の adb の不通で落とすと
# «テストを 1 本も走らせないまま Android ジョブが落ちる» が戻ってくる（run 36352812664）。
# ⚠️ **`| head` をパイプの下流に置かないこと（#2075）。** このファイルは `set -euo pipefail` で、
#    `head` が閉じた瞬間に上流が SIGPIPE で殺され、141 が代入の終了コードになって `set -e` が死ぬ。
#    一度変数へ受けてから `<<<` で渡す。
echo "▶ アプリから見えるロケール（実行時 configuration）を観測します"
runtime_config=""
for attempt in 1 2 3 4 5; do
	am_get_config="$(adb shell am get-config 2>/dev/null || true)"
	am_get_config="${am_get_config//$'\r'/}"
	# ⚠️ 1 行目に決め打ちせず **出力全体**から探す（`config:` が先頭に来ない実装差に耐える）
	if [[ "${am_get_config}" == *"-${EXPECTED_LANGUAGE}-r${EXPECTED_COUNTRY}-"* ]]; then
		runtime_config="$(head -n 1 <<< "${am_get_config}")"
		break
	fi
	echo "▶ 実行時 configuration に ${EXPECTED_LANGUAGE}-r${EXPECTED_COUNTRY} が見えません。adbd の再接続を待って再試行します（${attempt}/5）"
	adb wait-for-device || true
	sleep 2
done

# ⚠️ 以下 2 つは **診断表示専用**。判定へ使わない（上の表のとおり «記録» であって «効いている値» ではない）
persist_locale="$(adb shell getprop persist.sys.locale 2>/dev/null || true)"
persist_locale="${persist_locale//$'\r'/}"
system_locales="$(adb shell settings get system system_locales 2>/dev/null || true)"
system_locales="${system_locales//$'\r'/}"
echo "▶ 実行時 configuration: ${runtime_config:-(ja-rJP を観測できず)}"
echo "▶ 診断: persist.sys.locale=${persist_locale:-(空)} / settings system_locales=${system_locales:-(空)}"

if [ -z "${runtime_config}" ]; then
	echo "::error::アプリから見えるロケールが ${EXPECTED_LOCALE} になりませんでした（am get-config に -${EXPECTED_LANGUAGE}-r${EXPECTED_COUNTRY}- が 5 回とも現れず）。"
	echo "::error::ja-JP 前提の spec が英語の画面に対して走るため、ここで止めます（#1579）。診断値は上の行。"
	exit 1
fi

echo "✅ システムロケールを ${EXPECTED_LOCALE} に固定しました"

# ── ソフトキーボード(IME)の無効化 ──────────────────────────────────────────────
# #1027 【バグ】ロケールを ja-JP にすると、テキスト入力へフォーカスした瞬間に
# 日本語 IME の初回セットアップ（「入力レイアウトの選択」ダイアログ）が画面下半分を覆い、
# その裏の検索サジェストを Detox が可視判定できなくなる（run 30432596949 の
# location-autocomplete がこれで失敗した）。
#
# e2e-mobile は文字入力に一貫して `replaceText` を使っており（Android の Detox は Espresso の
# typeTextIntoFocusedView 経由なので非 ASCII を typeText できない。screens/SearchScreen.ts 参照）、
# **IME は 1 つも要らない**。まとめて無効化して、キーボードとそのウィザードが出る余地を消す。
echo "▶ ソフトキーボード(IME)を無効化します"
for ime in $(adb shell ime list -s 2>/dev/null | tr -d '\r'); do
	# 無効化できない IME があっても失敗させない（機種イメージによって構成が違うため）
	adb shell ime disable "${ime}" || true
done
adb shell settings put secure show_ime_with_hard_keyboard 0 || true
echo "✅ IME を無効化しました（残: $(adb shell ime list -s 2>/dev/null | tr -d '\r' | tr '\n' ' ')）"
