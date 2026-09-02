import React from "react";
import { Platform, Text, View } from "react-native";

import { Env } from "@/constants/Env";

/**
 * 🧪 E2E(Detox) 専用: マイページ着地時に expo-router から **実際にどんな検索パラメータが
 * 届いているか** を Detox から読める形で露出するプローブ（#1272）。
 *
 * ## なぜ必要か
 * iOS では `?tab=saved-dish-categories` 付きの直リンクで起動しても先頭タブのまま着地する（#1272）。
 * これまでに 3 つの仮説（jumpToTab の ref タイミング / tabRoutes の検証漏れ /
 * useGlobalSearchParams の併用）を **すべてコード修正で試して外した**。
 * 外れ続けた根本原因は「パラメータがどの段で消えているのか観測できていない」ことにある。
 *
 * このプローブは切り分けの分岐点そのものを数値で出す:
 * - `local` / `global` が空 … expo-router がクエリを **そもそも届けていない**
 *   （起動 URL の処理経路の問題。ProfileTabsLayout をいくら直しても直らない）
 * - `local` / `global` に値があるのに先頭タブ … 届いているのに **jumpToTab / initialTabName が
 *   効いていない**（react-native-collapsible-tab-view 側の問題）
 * - `jump` が `gaveup` … ref が 2 秒以内に生えず **リトライが尽きている**
 *   （auth 解決がリトライ上限より遅い。効かないのではなく「間に合っていない」）
 *
 * ## 本番混入防止（#1027 / #1030 / #1087 と同一方式）
 * 1. metro.config.js の resolveRequest が、`EXPO_PUBLIC_E2E_TUTORIAL_HOOK=1` でビルドしない限り
 *    このファイルを routeParamsProbe.noop.tsx へ差し替える（= 本番バンドルに 1 行も含まれない）
 * 2. 本ファイルの `process.env.EXPO_PUBLIC_E2E_TUTORIAL_HOOK !== "1"` 二重ガード
 * 3. `Env.NODE_ENV === "production"` の追加ガード（主ガードではない）
 * さらに CI ゲート（scripts/assert-no-e2e-hook.mjs）が sentinel の不在を検査する。
 *
 * ⚠️ **新しい環境変数は増やさず、既存の `EXPO_PUBLIC_E2E_TUTORIAL_HOOK` に相乗りしている**
 * （#1087 の preloadProbe と同じ判断。フラグが立つのは e2e-mobile-test.yml の Detox build だけ）。
 */

// 【セキュリティ】本番バンドルへの混入を CI で機械検知するための番号札（このファイル固有の文字列であること）。
// noop 実装側にはこの文字列を置かない。scripts/assert-no-e2e-hook.mjs がこの文字列を検査する
export const E2E_ROUTE_PARAMS_PROBE_SENTINEL = "__E2E_ROUTE_PARAMS_PROBE_HOOK__";

/** パラメータを載せる `<Text>` の testID（e2e-mobile/tests/probe/ の spec と対応させること） */
/**
 * ⚠️ #1402 現在、このプローブを **描画している画面は 1 つも無い**。
 *
 * 唯一の設置場所だったマイページ（features/profile/containers/ProfileTabsLayout.tsx）は
 * 4 グリッドタブごと廃止され、それを読んでいた e2e-mobile の
 * tests/profile/profile-tab-deep-link.test.ts も一緒に落とした（`?tab=` という仕組みが消えたため）。
 *
 * 実装を残しているのは «機構» が有効だからである。#1272 で分かったのは
 * 「クエリが届いたか」と「画面が反応したか」は別の層の事実で、見た目だけを見ると
 * どの層が壊れたのか分からなくなる、ということだった。ルートパラメータ由来の不具合を
 * また踏んだときは、ここへ 1 行足して観測点を復活させること（metro の差し替えと
 * scripts/assert-no-e2e-hook.mjs の検査はそのまま生きている）。
 */
export const E2E_ROUTE_PARAMS_PROBE_TEST_ID = "profile-route-params-probe";

/**
 * プローブが有効かどうか。
 * `process.env.EXPO_PUBLIC_E2E_TUTORIAL_HOOK` は Metro がビルド時にリテラルへ畳み込むため、
 * E2E ビルド以外ではこの定数ごと false に確定する。
 */
const PROBE_ENABLED =
	process.env.EXPO_PUBLIC_E2E_TUTORIAL_HOOK === "1" && Platform.OS !== "web" && Env.NODE_ENV !== "production";

/** 露出する値。undefined は "-" として描画する（「無い」ことも観測対象なので落とさない） */
export type E2ERouteParamsProbeEntries = Record<string, string | undefined>;

/**
 * パラメータの実測値を持つ非表示の `<Text>` を返す。無効時は null（= 本番と完全に同じツリー）。
 *
 * 描画例: `local=- global=saved-dish-categories requested=saved-dish-categories auth=1 jump=gaveup`
 * Detox は `getAttributes()` か `toHaveText` で読む。
 *
 * ⚠️ フックを使わない純関数にしてある（呼び出し側の描画分岐（早期 return 等）の
 * どこに置いてもフック順序を壊さないため）。
 */
export function e2eRouteParamsProbeElement(entries: E2ERouteParamsProbeEntries): React.ReactElement | null {
	if (!PROBE_ENABLED) return null;

	const text = Object.entries(entries)
		.map(([key, value]) => `${key}=${value ?? "-"}`)
		.join(" ");

	return (
		// #1087 preloadProbe と同じ隠し方: レイアウトに影響させず、Detox からは testID で到達できる
		<View
			style={{ width: 1, height: 1, position: "absolute", overflow: "hidden", opacity: 0 }}
			pointerEvents="none"
			aria-hidden
			importantForAccessibility="no-hide-descendants">
			<Text testID={E2E_ROUTE_PARAMS_PROBE_TEST_ID}>{text}</Text>
		</View>
	);
}
