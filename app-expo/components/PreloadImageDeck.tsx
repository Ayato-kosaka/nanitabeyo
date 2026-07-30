import React from "react";
import { StyleSheet, View } from "react-native";

import { PreloadedImage } from "@/components/PreloadedImage";
import { PRELOAD_ASSET_KEYS } from "@/constants/preloadAssets";

/**
 * 先読み用 `<Image>` の一辺(px)。
 *
 * ⚠️ **0 にしてはいけない。** 0×0 だと native が画像のロード要求を発行しない:
 * - iOS: `ImageUtils.swift` の `getBestSource` が `size.width <= 0 || size.height <= 0` で
 *   無条件に nil を返し、`ImageView.reload()` が `guard let source = bestSource` で抜ける
 * - Android: `ExpoImageViewWrapper.kt` の `cleanIfNeeded` が `width == 0 || height == 0` で
 *   Glide リクエストを発行せず return する
 *
 * web の `<img>` は size に関係なく fetch するため、この不具合は native 固有で、
 * web の Resource Timing を見る `tutorial-preload.spec.ts` では検出できなかった(#1087)。
 *
 * この値は `PreloadImageDeck.test.tsx` が「非ゼロであること」で監視している。
 */
export const PRELOAD_IMAGE_SIZE = 1;

/**
 * #642 / #1087 【設計】オフスクリーンで先読み対象アセットを一度描画して decode させるブロック
 *
 * ## なぜ `Image.prefetch()` ではないのか
 * native の `Image.prefetch()` は `require()` の module id を受け付けず(JS 側で `resolveSource`
 * を通さない)、Android は `GlideUrl` 固定でローカル埋め込みアセットに効かない。
 * したがって `<Image>` を実際に描画して decode させる以外に手が無い(#1087)。
 *
 * ## 置き場所
 * 検索画面は `initialRouteName="search"` で最初にマウントされ、以後 unmount されない。
 * expo-image のメモリキャッシュはプロセス全体のシングルトン(iOS: `SDImageCache.shared` /
 * Android: Glide の `LruResourceCache`)が持ち、view の unmount では消えないため、
 * 検索画面に置く設計で問題ない。
 *
 * ## 見えないようにする方法
 * - `position: "absolute"` + `overflow: "hidden"` でレイアウトに影響させない
 * - `opacity: 0` / `pointerEvents="none"` で視認・タップ不能にする
 * - `aria-hidden` は #934 の axe `image-alt` 対策として**必ず維持**する
 *   (decode 専用で内容を持たないため支援技術から隠す)
 */
export function PreloadImageDeck() {
	return (
		<View style={styles.container} pointerEvents="none" aria-hidden>
			{PRELOAD_ASSET_KEYS.map((key) => (
				<PreloadedImage key={key} asset={key} style={styles.image} />
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		position: "absolute",
		width: PRELOAD_IMAGE_SIZE,
		height: PRELOAD_IMAGE_SIZE,
		overflow: "hidden",
		opacity: 0,
	},
	image: {
		width: PRELOAD_IMAGE_SIZE,
		height: PRELOAD_IMAGE_SIZE,
	},
});
