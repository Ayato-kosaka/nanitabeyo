import React from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { FixedColors } from "@/constants/Palette";

type DishSelectionExpandLoadingProps = {
	/** #1484 選択された料理カードの画像URL。店舗提案の取得完了までこの画像を画面に残す。 */
	imageUrl: string;
};

// #1484 【仕様】「この料理にする！」押下後、独立したローディング画面の代わりに選択した料理画像を
// フルスクリーン表示したまま店舗提案の取得を待つ。カードからここまで広がるアニメーション自体は
// 遷移前の DishCategories 画面（DishCategoryCardExpandTransition）が担当済みのため、ここでは広がり切った状態を
// そのまま静的に描画するだけでよい（ここで再度アニメーションさせると二重に動いて見える）。
export const DishSelectionExpandLoading = ({ imageUrl }: DishSelectionExpandLoadingProps) => (
	<View
		style={styles.container}
		accessibilityRole="progressbar"
		accessibilityLabel={i18n.t("Restaurant.Loading.title")}>
		<Image
			source={{ uri: imageUrl }}
			style={styles.image}
			contentFit="cover"
			cachePolicy="memory-disk"
			transition={0}
		/>
		<LinearGradient
			pointerEvents="none"
			colors={["rgba(0, 0, 0, 0.00)", "rgba(0, 0, 0, 0.18)", "rgba(0, 0, 0, 0.48)"]}
			locations={[0, 0.6, 1]}
			style={styles.bottomGradient}
		/>
		<View style={styles.spinnerContainer} pointerEvents="none">
			<LoadingIndicator size="large" />
		</View>
	</View>
);

const styles = StyleSheet.create({
	container: {
		...StyleSheet.absoluteFillObject,
		// #1629 全画面の料理写真の «余白» なので、テーマに依らず常に黒。
		// メディアビューア（DishMediaFeed）と同じ地であり、ここをライトで白くすると
		// 写真がフレームから浮いて見え、演出（写真がそのまま広がる）が崩れる。
		backgroundColor: FixedColors.mediaBackground,
	},
	image: {
		width: "100%",
		height: "100%",
	},
	bottomGradient: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
		height: "40%",
	},
	spinnerContainer: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		justifyContent: "center",
		alignItems: "center",
	},
});
