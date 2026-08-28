import React from "react";
import { Platform, Text, View } from "react-native";

import { Env } from "@/constants/Env";

/**
 * 🧪 E2E(Detox) 専用: 友達投票の投票画面で、候補画像の先読みが **実際に何件 ready に
 * なっているか** を Detox から読める形で露出するプローブ（#1213）。
 *
 * ## なぜ必要か
 * 投票画面は候補カードを 1 枚ずつしか描かない。候補を送るたびに生の uri を
 * `DishCategoryVisualCard` へ渡していたため、既に見えているはずの画像でも取得がその場から始まり、
 * カード背景色（#EEE）のグレーが一瞬見えていた（#1213）。修正は
 * `useDishCategoryImageResources` へ候補全件を渡して **画面マウント時に先読みする**というもの。
 *
 * web ではこれを Resource Timing で直接観測できる
 *（e2e-web/tests/dish-category-group-votes/vote-candidate-image-preload.spec.ts）。
 * native には同等の観測手段が無い。`Image.loadAsync` はネットワーク層で完結し、
 * 画面に出るのは «今表示している 1 枚» だけなので、Detox からは
 * **「先読みできている」と「たまたま速かった」を区別できない**。
 * #1087 の先読み画像が「0×0 のせいで一度もロードされていなかった」のに数ヶ月気付けなかったのは
 * まさにこの観測不能が原因だった。同じ穴を開けないために観測点をアプリ側へ足す。
 *
 * `ready=<n>/<total>` という文字列を持つ `<Text testID="dish-category-group-vote-image-preload-probe">`
 * を描画する。Detox は
 * `waitFor(element(by.id(...))).toHaveText("ready=4/4")` で待てる。
 *
 * ## 感度（何が赤くなり、何が緑になるか）
 * - 修正後 … 画面マウント時に全件先読みするので `ready=4/4` になる = **緑が正しい**
 * - 修正前（プリロード契約に未参加）… `getImageState` が常に idle なので `ready=0/4` で赤くなる
 * - 先読みを «表示中の 1 枚だけ» に縮めた回帰 … `ready=1/4` で赤くなる
 *
 * つまり「先読みを外しても緑」になる偽の緑ではない。
 *
 * ## 本番混入防止（#1027 / #1030 / #1087 / #1272 と同一方式）
 * 1. metro.config.js の resolveRequest が、`EXPO_PUBLIC_E2E_TUTORIAL_HOOK=1` でビルドしない限り
 *    このファイルを voteImagePreloadProbe.noop.tsx へ差し替える（= 本番バンドルに 1 行も含まれない）
 * 2. 本ファイルの `process.env.EXPO_PUBLIC_E2E_TUTORIAL_HOOK !== "1"` 二重ガード
 * 3. `Env.NODE_ENV === "production"` の追加ガード（主ガードではない）
 * さらに CI ゲート（scripts/assert-no-e2e-hook.mjs）が sentinel の不在を検査する。
 *
 * ⚠️ **新しい環境変数は増やさず、既存の `EXPO_PUBLIC_E2E_TUTORIAL_HOOK` に相乗りしている**
 * （#1087 / #1272 と同じ判断。フラグが立つのは e2e-mobile-test.yml の Detox build だけ）。
 */

// #1213 【セキュリティ】本番バンドルへの混入を CI で機械検知するための番号札（このファイル固有の文字列であること）。
// noop 実装側にはこの文字列を置かない。scripts/assert-no-e2e-hook.mjs がこの文字列を検査する
export const E2E_VOTE_IMAGE_PRELOAD_PROBE_SENTINEL = "__E2E_VOTE_IMAGE_PRELOAD_PROBE_HOOK__";

/** 先読み件数を載せる `<Text>` の testID（e2e-mobile/screens/DishCategoryGroupVoteScreen.ts と対応させること） */
export const E2E_VOTE_IMAGE_PRELOAD_PROBE_TEST_ID = "dish-category-group-vote-image-preload-probe";

/**
 * プローブが有効かどうか。
 * `process.env.EXPO_PUBLIC_E2E_TUTORIAL_HOOK` は Metro がビルド時にリテラルへ畳み込むため、
 * E2E ビルド以外ではこの定数ごと false に確定する。
 */
const PROBE_ENABLED =
	process.env.EXPO_PUBLIC_E2E_TUTORIAL_HOOK === "1" && Platform.OS !== "web" && Env.NODE_ENV !== "production";

/** 露出する実測値 */
export type E2EVoteImagePreloadCounts = {
	/** 先読みが完了した（imageState が ready の）候補数 */
	ready: number;
	/** 先読みに失敗した（error の）候補数。0 枚が「未着手」か「失敗」かを切り分けるために出す */
	failed: number;
	/** 投票対象の候補総数 */
	total: number;
};

/**
 * 先読み件数を持つ非表示の `<Text>` を返す。無効時は null（= 本番と完全に同じツリー）。
 *
 * 描画例: `ready=4/4`
 *
 * ⚠️ フックを使わない純関数にしてある（#1272 と同じ理由。呼び出し側の描画分岐
 * （早期 return 等）のどこに置いてもフック順序を壊さないため）。
 */
export function e2eVoteImagePreloadProbeElement({
	ready,
	failed,
	total,
}: E2EVoteImagePreloadCounts): React.ReactElement | null {
	if (!PROBE_ENABLED) return null;

	return (
		// #1087 preloadProbe と同じ隠し方: 1×1 の絶対配置で、画面上の他の要素を 1px たりとも遮蔽しない。
		// Detox(Android) の可視性判定は「他の View に覆われた面積」を見るため、ここを大きくすると
		// 既存 spec の toBeVisible を巻き込んで壊しうる。
		// Detox の toHaveText は Espresso の withText で、可視性を要求しないので 1×1 で読める
		<View
			style={{ position: "absolute", top: 0, left: 0, width: 1, height: 1, overflow: "hidden", opacity: 0 }}
			pointerEvents="none"
			aria-hidden
			importantForAccessibility="no-hide-descendants">
			<Text testID={E2E_VOTE_IMAGE_PRELOAD_PROBE_TEST_ID}>{`ready=${ready}/${total}`}</Text>
			{/* 失敗時の切り分け用（ready 0 件が「先読みしていない」のか「取得に失敗した」のかを区別する） */}
			<Text
				testID={`${E2E_VOTE_IMAGE_PRELOAD_PROBE_TEST_ID}-detail`}>{`ready=${ready} error=${failed} total=${total}`}</Text>
		</View>
	);
}
