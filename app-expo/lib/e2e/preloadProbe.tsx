import React, { useCallback, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";

import { Env } from "@/constants/Env";

/**
 * 🧪 E2E(Detox) 専用: 先読み画像（`PRELOAD_IMAGES`）が **実際に何枚ロードできたか** を
 * Detox から読める形で露出するプローブ（#1087 / 親 #1082）。
 *
 * ## なぜ必要か
 * 検索画面末尾の先読みブロック（app/[locale]/(tabs)/search/index.tsx）は、web では
 * `<img>` が DOM に出るため Resource Timing で観測でき、実際に取得が完了していることを
 * e2e-web の tests/search/onboarding-preload.spec.ts が保証している。
 * 一方 native には同等の観測手段が無く、**先読みブロックが 0×0 だったせいで
 * 導入時（#656）から一度もロードされていなかった**ことが数ヶ月見つからなかった
 * （expo-image の native 実装は bounds が 0 のときロード要求そのものを発行しない。
 * iOS: `getBestSource` が size<=0 で nil を返す / Android: `cleanIfNeeded` が width/height 0 で早期 return）。
 *
 * サイズは #1087 で 1×1 へ修正済みで、構造面の再発は
 * features/search/searchScreenPreload.test.tsx（jest）が守っている。
 * ただしそれは **「style が非ゼロか」しか見ない構造テスト**で、
 * expo-image 側の都合で実際にはロードされなくなった場合（1×1 では足りなくなる、
 * `opacity: 0` で早期 return されるようになる 等）を緑のまま見逃す。
 * **native で実際にロード要求が発行されていることを end-to-end で確かめる層**がこのプローブ。
 *
 * 各 `<Image>` の `onLoad` / `onError` を数え、`loaded=<n>/<total>` という文字列を持つ
 * `<Text testID="search-preload-probe">` を描画する。Detox は
 * `waitFor(element(by.id("search-preload-probe"))).toHaveText("loaded=10/10")` で待てる。
 *
 * ## 感度（何が赤くなり、何が緑になるか）
 * - 現状（先読みブロックが 1×1）… 全枚数とも `onLoad` が発火して `loaded=10/10` になる = **緑が正しい**
 * - サイズを 0×0 へ戻すと … ロード要求が飛ばないので `onLoad` が 1 度も発火せず `loaded=0/10` で赤くなる
 * - 先読みブロックごと消しても … 同じく `loaded=0/10` で赤くなる
 *
 * つまり **「先読みブロックを消しても緑」になる偽の緑ではない**（Screen Object の #1031 で
 * 「native からは観測不能」と判断していた点を、観測点をアプリ側に足すことで解消している）。
 *
 * ## 本番混入防止（#1027 / #1030 / #1031 と同一方式）
 * 1. metro.config.js の resolveRequest が、`EXPO_PUBLIC_E2E_TUTORIAL_HOOK=1` でビルドしない限り
 *    このファイルを preloadProbe.noop.tsx へ差し替える（= 本番バンドルに 1 行も含まれない）
 * 2. 本ファイルの `process.env.EXPO_PUBLIC_E2E_TUTORIAL_HOOK !== "1"` 二重ガード
 *    （Metro がビルド時にインライン化するため、未設定ビルドでは undefined に畳まれる）
 * 3. `Env.NODE_ENV === "production"` の追加ガード（#1030 m-3 と同じく主ガードではない）
 * さらに CI ゲート（scripts/assert-no-e2e-hook.mjs）が sentinel の不在を検査する。
 *
 * ⚠️ **新しい環境変数は増やさず、既存の `EXPO_PUBLIC_E2E_TUTORIAL_HOOK` に相乗りしている。**
 * 先読み対象の実体はオンボーディングの画像（`ONBOARDING_IMAGES`）であり、
 * このフラグが立つのは e2e-mobile-test.yml の Detox build ステップ（Android / iOS 両方）だけ。
 */

// #1087 【セキュリティ】本番バンドルへの混入を CI で機械検知するための番号札（このファイル固有の文字列であること）。
// noop 実装側にはこの文字列を置かない。scripts/assert-no-e2e-hook.mjs がこの文字列を検査する。
export const E2E_PRELOAD_PROBE_SENTINEL = "__E2E_PRELOAD_PROBE_HOOK__";

/** ロード枚数を載せる `<Text>` の testID（e2e-mobile/screens/SearchScreen.ts と対応させること） */
export const E2E_PRELOAD_PROBE_TEST_ID = "search-preload-probe";

/** 各 `<Image>` へ配る計測用の props（expo-image の onLoad / onError と互換のシグネチャ） */
export type E2EPreloadImageProps = {
	onLoad?: () => void;
	onError?: () => void;
};

export type E2EPreloadProbe = {
	/** i 番目の先読み画像へ渡す props。無効時は空オブジェクト（= 本番と完全に同じ `<Image>`） */
	imageProps: (index: number) => E2EPreloadImageProps;
	/** Detox から読むカウンタ要素。無効時は null */
	element: React.ReactElement | null;
};

/** 無効時に配る props。毎回同じ参照を返して不要な再描画を防ぐ */
const DISABLED_IMAGE_PROPS: E2EPreloadImageProps = {};

/**
 * プローブが有効かどうか。
 *
 * `process.env.EXPO_PUBLIC_E2E_TUTORIAL_HOOK` は Metro がビルド時にリテラルへ畳み込むため、
 * E2E ビルド以外ではこの定数ごと false に確定する。
 */
const PROBE_ENABLED =
	process.env.EXPO_PUBLIC_E2E_TUTORIAL_HOOK === "1" && Platform.OS !== "web" && Env.NODE_ENV !== "production";

/**
 * 先読み画像のロード枚数を数え、Detox から読める `<Text>` を返す。
 *
 * ⚠️ **フックは常に同じ順序で呼ぶこと**（`PROBE_ENABLED` による早期 return をしていないのはこのため）。
 * 無効時のコストは「使われない useState 2 つと Set 1 つ」だけで、描画物は一切増えない。
 *
 * @param total 先読み対象の枚数（`PRELOAD_IMAGES.length`）
 * @returns 各 `<Image>` へ配る props と、カウンタ要素
 * @失敗時 例外は投げない。プローブは観測のためだけの存在で、アプリの挙動を変えてはいけない
 */
export function useE2EPreloadProbe(total: number): E2EPreloadProbe {
	// #1087 バンドルに sentinel を確実に残すための参照（DCE で消えないようにする）
	void E2E_PRELOAD_PROBE_SENTINEL;

	const [loaded, setLoaded] = useState(0);
	const [failed, setFailed] = useState(0);
	// 同じ画像の onLoad は再描画やキャッシュヒットで複数回発火しうる。
	// 「何枚ロードできたか」を数えたいので、添字ごとに最初の 1 回だけを採用する
	const settled = useRef<Set<number>>(new Set());

	const report = useCallback((index: number, ok: boolean) => {
		if (settled.current.has(index)) return;
		settled.current.add(index);
		if (ok) setLoaded((count) => count + 1);
		else setFailed((count) => count + 1);
	}, []);

	const imageProps = useCallback(
		(index: number): E2EPreloadImageProps =>
			PROBE_ENABLED
				? {
						onLoad: () => report(index, true),
						onError: () => report(index, false),
					}
				: DISABLED_IMAGE_PROPS,
		[report],
	);

	if (!PROBE_ENABLED) return { imageProps, element: null };

	return {
		imageProps,
		element: (
			// 1×1 の絶対配置。**画面上の他の要素を 1px たりとも遮蔽しない**ことが要件で、
			// Detox(Android) の可視性判定は「他の View に覆われた面積」を見るため、
			// ここを大きくすると既存 spec の toBeVisible を巻き込んで壊しうる。
			// Detox の `toHaveText` は Espresso の withText で、可視性を要求しないので 1×1 で読める。
			// ⚠️ 検証対象である先読みブロック（search/index.tsx）のサイズ問題とは無関係。
			//    こちらは「テキストを持つ View」で、レイアウト幅に関係なく TextView へ文字列が入る
			<View style={{ position: "absolute", top: 0, left: 0, width: 1, height: 1, overflow: "hidden" }}>
				<Text testID={E2E_PRELOAD_PROBE_TEST_ID}>{`loaded=${loaded}/${total}`}</Text>
				{/* 失敗時の切り分け用（ロード 0 枚が「要求が飛んでいない」のか「取得に失敗した」のかを区別する） */}
				<Text testID={`${E2E_PRELOAD_PROBE_TEST_ID}-detail`}>{`loaded=${loaded} error=${failed} total=${total}`}</Text>
			</View>
		),
	};
}
