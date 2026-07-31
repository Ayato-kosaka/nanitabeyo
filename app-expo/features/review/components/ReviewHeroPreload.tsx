import React from "react";
import { View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { REVIEW_HERO_IMAGE, REVIEW_HERO_CONTENT_FIT, REVIEW_HERO_FLEX } from "../heroLayout";

/**
 * #1087 【設計】レビュータブのヒーロー画像を「レビュータブでの実表示サイズ」で先読みするための
 * 不可視ビュー。検索タブ（同じタブナビゲータの兄弟画面）から描画する前提。
 *
 * ■ なぜ 0×0 ではダメか
 *   expo-image(Android) の ExpoImageViewWrapper.cleanIfNeeded() は
 *   `width == 0 || height == 0` のときリクエストを投げずに掃除して終わる。
 *   従来の先読みブロックは親も <Image> も 0×0 だったため native では 1 枚もロードされていなかった
 *   （Detox プローブで loaded=0 error=0 total=8 を実測）。
 *
 * ■ なぜ「実表示サイズ」なのか
 *   Android(Glide) はデコード要求サイズを EngineKey に含める。先読みを 1×1 で行うと
 *   1×1 のエントリが出来るだけで、表示時（実サイズ）は別キー＝キャッシュミスになりうる。
 *   そこで表示側とまったく同じジオメトリを作って、同じ要求サイズを出させる。
 *
 *   なお expo-image 2.4.1 の SourceMap.createGlideOptions() は require() のローカルアセットに対し
 *   `.override(intrinsicWidth, intrinsicHeight)` を付けるため、**このアセットに限れば**
 *   要求サイズはビューサイズではなく原寸に固定される（= 先読みと表示のキーはビューサイズに関係なく一致する）。
 *   その挙動に依存せずに済むよう、ここではビューサイズも表示時と揃えておく。
 *
 * ■ 見た目・操作・支援技術への影響を出さないための約束
 *   - position:absolute（レイアウトを押し広げない）+ opacity:0（描画されない）
 *   - pointerEvents="none"（タッチを奪わない）
 *   - aria-hidden（#934 の axe image-alt 対策。中身を持たないデコード専用要素のため）
 *
 * ■ ジオメトリの合わせ方
 *   レビュータブのルートは「タブ画面の描画領域いっぱいの SafeAreaView(edges=[top,bottom])」で、
 *   その内側を flex 1:2:1 で分け合う。検索タブのルートも同じ描画領域を占めるので、
 *   検索側のルートを onLayout で測った値（width/height）と safe-area インセットを渡してもらえば
 *   同じ箱を再現できる。比率計算を JS で手計算せず flex をそのまま真似ているのは、
 *   Yoga のピクセルグリッド丸めまで含めて一致させるため（1px ズレでもキーは別物になる）。
 */
export type ReviewHeroPreloadProps = {
	/** レビュータブのルート（= 検索タブのルート）の幅 */
	width: number;
	/** レビュータブのルート（= 検索タブのルート）の高さ */
	height: number;
	/**
	 * 親のパディング分を打ち消して、レビュータブのルートと同じ絶対位置に置くためのオフセット。
	 * 検索タブのルートは SafeAreaView(edges=["top"]) で上インセット分の padding を持つため、
	 * 呼び出し側は `-insets.top` を渡す。
	 */
	offsetTop: number;
	/** レビュータブの SafeAreaView(edges=["top", ...]) が上に入れる padding */
	insetTop: number;
	/** レビュータブの SafeAreaView(edges=[..., "bottom"]) が下に入れる padding */
	insetBottom: number;
};

export function ReviewHeroPreload({ width, height, offsetTop, insetTop, insetBottom }: ReviewHeroPreloadProps) {
	// 測定前（0）に描画すると 0×0 になり、上記のとおり native ではロードされないまま終わる。
	// サイズが確定してから 1 度だけ出す。
	if (width <= 0 || height <= 0) {
		return null;
	}

	return (
		<View
			testID="review-hero-preload"
			aria-hidden
			pointerEvents="none"
			style={[styles.root, { width, height, top: offsetTop, paddingTop: insetTop, paddingBottom: insetBottom }]}>
			{/* review/index.tsx の titleSection / heroSection / ctaSection と同じ flex 配分を再現する。
			    中身（文言やボタン）は flexBasis:0 の箱のサイズに影響しないので置かない */}
			<View style={styles.titleSection} />
			<View style={styles.heroSection}>
				<View style={styles.heroImagePlaceholder}>
					<Image source={REVIEW_HERO_IMAGE} style={styles.heroImage} contentFit={REVIEW_HERO_CONTENT_FIT} />
				</View>
			</View>
			<View style={styles.ctaSection} />
		</View>
	);
}

const styles = StyleSheet.create({
	root: {
		position: "absolute",
		left: 0,
		opacity: 0,
	},
	titleSection: {
		flex: REVIEW_HERO_FLEX.title,
	},
	heroSection: {
		flex: REVIEW_HERO_FLEX.hero,
		justifyContent: "center",
		alignItems: "center",
	},
	heroImagePlaceholder: {
		flex: 1,
		width: "100%",
		justifyContent: "center",
		alignItems: "center",
	},
	heroImage: {
		width: "100%",
		height: "100%",
	},
	ctaSection: {
		flex: REVIEW_HERO_FLEX.cta,
	},
});
