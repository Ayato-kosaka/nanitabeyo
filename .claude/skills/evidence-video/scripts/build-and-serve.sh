#!/bin/bash
# 即席エビデンス撮影用: web ビルドの生成と配信（SKILL.md の手順 1 / 4）
#
#   start … ダミー .env 生成 → SPA モードで expo export → :8788 で配信
#   stop  … サーバ停止・dist-local / .env 削除・app.config.ts の復元確認
#
# app.config.ts の output 切り替えは trap で必ず戻す（コミット混入事故の防止）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
APP_DIR="$REPO_ROOT/app-expo"
SERVE_JS="$(cd "$(dirname "$0")" && pwd)/serve-spa.mjs"
PORT=8788

restore_config() {
	# SPA へ切り替えたまま死んでもリポジトリを汚さない
	sed -i 's/\t\toutput: "single",/\t\toutput: "static",/' "$APP_DIR/app.config.ts" || true
}

stop_server() {
	# ⚠️ pkill -f は自分ごと殺すので使わない（CLAUDE.md のプロセス停止規則）
	local pid
	# ⚠️ **`| head` をパイプの下流に置かないこと（#2075）。** このファイルは `set -euo pipefail`。
	#    `head` は 1 行読んだら閉じるので上流が SIGPIPE で殺され、`pipefail` がその **141 を
	#    パイプライン全体の終了コードにする**。代入の右辺が非ゼロになると `set -e` が
	#    **この行でスクリプトを殺す**（値そのものは取れているのに死ぬ）。一度変数へ受ける。
	ps_lines="$(ps -eo pid,cmd)"
	#    ⚠️ **`head -1` を `read -r` へ置き換えるだけでは直らない**（1 行で閉じるのは同じなので
	#    上流はやはり SIGPIPE で死ぬ。実測で 3 回とも 141 だった）。**上流を先に変数へ受け切る**。
	serve_pids="$(grep "[s]erve-spa.mjs" <<< "$ps_lines" | awk '{print $1}' || true)"
	pid="$(head -1 <<< "$serve_pids")"
	[ -n "${pid:-}" ] && kill "$pid" && echo "server (pid $pid) stopped" || echo "server not running"
}

case "${1:-start}" in
start)
	# Env.ts の必須項目を埋めるだけのダミー値。モックに差し替わるので値自体に意味は無い
	cat > "$APP_DIR/.env" << 'EOF'
EXPO_PUBLIC_NODE_ENV=development
EXPO_PUBLIC_COMMIT_ID=localdev
EXPO_PUBLIC_APP_STORE_URL=https://example.com/appstore
EXPO_PUBLIC_PLAY_STORE_URL=https://example.com/playstore
EXPO_PUBLIC_BACKEND_BASE_URL=http://localhost:9999
EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY=dummy-maps-key
EXPO_PUBLIC_SUPABASE_URL=http://localhost:9998
EXPO_PUBLIC_SUPABASE_ANON_KEY=dummy-anon-key
EXPO_PUBLIC_DB_SCHEMA=public
EXPO_PUBLIC_CDN_PUBLIC_HOST=localhost
EXPO_PUBLIC_GCS_STATIC_MASTER_DIR_PATH=static
EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID=dummy
EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID=dummy
EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID=dummy
EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID=dummy
EXPO_PUBLIC_WEB_BASE_URL=http://localhost:8788
EXPO_PUBLIC_FACEBOOK_APP_ID=0
EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN=0
EOF

	# static のままだと SSR パスで supabaseUrl is required になる（SKILL.md 参照）
	trap restore_config EXIT
	sed -i 's/\t\toutput: "static",/\t\toutput: "single",/' "$APP_DIR/app.config.ts"

	echo "building (about 2 min)..."
	(cd "$APP_DIR" && npx expo export --platform web --output-dir dist-local > /tmp/evidence-video-build.log 2>&1) \
		|| { echo "BUILD FAILED — see /tmp/evidence-video-build.log"; exit 1; }

	restore_config
	trap - EXIT
	rm -f "$APP_DIR/.env"

	stop_server > /dev/null 2>&1 || true
	EVIDENCE_DIST="$APP_DIR/dist-local" nohup node "$SERVE_JS" > /tmp/evidence-video-serve.log 2>&1 &
	sleep 1
	code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/ja-JP/search")
	echo "serving dist-local on http://localhost:$PORT (probe: $code)"
	;;
stop)
	stop_server
	restore_config
	rm -rf "$APP_DIR/dist-local"
	rm -f "$APP_DIR/.env"
	echo "cleaned. git status:"
	# ⚠️ #2075 `| head -5` は上流の git を SIGPIPE で殺し、`pipefail` の 141 で
	#    `set -e` がここで死ぬ（変更が 6 件以上あると起きる）。一度変数へ受ける。
	git_status="$(git -C "$REPO_ROOT" status --short)"
	head -5 <<< "$git_status"
	;;
*)
	echo "usage: build-and-serve.sh [start|stop]"; exit 1 ;;
esac
