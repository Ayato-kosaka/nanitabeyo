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

echo "▶ Android のシステムロケールを ${EXPECTED_LOCALE} へ設定します"

# adb root は adbd を再起動するため、直後の接続断を wait-for-device で吸収する
adb root
adb wait-for-device

adb shell setprop persist.sys.locale "${EXPECTED_LOCALE}"
adb shell setprop persist.sys.language ja
adb shell setprop persist.sys.country JP

# setprop しただけでは起動済みのアプリ/システム UI へ反映されない。
# zygote を再起動して、以降に起動するプロセスが新しいロケールを読むようにする
adb shell setprop ctl.restart zygote

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

actual_locale="$(adb shell getprop persist.sys.locale | tr -d '\r')"
echo "▶ system locale: ${actual_locale}"

# 反映に失敗したまま進むと「ja-JP 前提の spec が黙って無意味になる」ので、ここで落として原因を明示する
if [ "${actual_locale}" != "${EXPECTED_LOCALE}" ]; then
	echo "::error::システムロケールを ${EXPECTED_LOCALE} へ設定できませんでした（現在: ${actual_locale}）。"
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
