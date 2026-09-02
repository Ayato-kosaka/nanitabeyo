#!/usr/bin/env bash
# 📱 iOS シミュレータからソフトウェアキーボードを消す（#1027）
#
# ## なぜ必要か
# TextInput にフォーカスが入るとシミュレータのソフトウェアキーボードが画面下半分を占有し、
# その裏の要素が Detox の可視判定を通らなくなる。run 30477424944 の iOS では
# search-form の 2 テストがこれで失敗していた:
# - 画面下部固定の検索 FAB (`search-submit-button`) が 25 秒待っても可視にならない
# - スクロール可能領域が縮み、`search-advanced-toggle` まで "Unable to scroll down"
#
# e2e-mobile は文字入力に一貫して `replaceText` を使っており（Detox の typeText は
# Android で非 ASCII を扱えない。screens/SearchScreen.ts 参照）、**キーボードは 1 つも要らない**。
# Android 側で IME をまとめて無効化しているのと同じ対処を iOS でも行う
# （scripts/setup-android-locale.sh）。
#
# ## 仕組みと限界
# 「ハードウェアキーボードが接続されている」状態にすると、シミュレータはソフトウェアキーボードを出さない。
# この設定は Simulator.app が起動時に読むため、**Detox がシミュレータを起こす前**に実行すること。
#
# ⚠️ ただし **これ単体では足りない**。run 30522949349 では設定が入っている（ログに
# `ConnectHardwareKeyboard = 1`）にもかかわらずソフトウェアキーボードが出ていた
# （Detox の可視性デバッグ画像で確認）。simctl 起動のシミュレータには Simulator.app の
# 設定が効かないためと考えられる。
# **入力欄へフォーカスを与えたあとは spec 側でキーボードを閉じること**
# （screens/SearchScreen.ts の dismissKeyboard）。この設定はローカル実行での保険として残している。
set -euo pipefail

echo "▶ iOS シミュレータのソフトウェアキーボードを無効化します"
defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool true

# 念のため現在値を出しておく（設定が効かなくなったときに気付けるようにする）
echo "✅ ConnectHardwareKeyboard = $(defaults read com.apple.iphonesimulator ConnectHardwareKeyboard 2>/dev/null || echo '未設定')"
