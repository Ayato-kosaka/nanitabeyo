import React from "react";
import { View, StyleSheet } from "react-native";
import { FontAwesome } from "@expo/vector-icons";
import i18n from "@/lib/i18n";

interface StarsProps {
	rating: number; // 評価 (例: 4.5)
	maxStars?: number; // 最大星数 (デフォルト: 5)
	size?: number; // 星のサイズ (デフォルト: 24)
	color?: string; // 星の色 (デフォルト: gold)
}

const Stars: React.FC<StarsProps> = ({ rating, maxStars = 5, size = 12, color = "gold" }) => {
	const fullStars = Math.floor(rating);
	const halfStar = rating % 1 >= 0.5;
	const emptyStars = maxStars - fullStars - (halfStar ? 1 : 0);

	return (
		// #939 【修正】星アイコンの並びには名前が無く、スクリーンリーダーでは評価値を判別できなかった。
		// コンテナに評価値のラベルを付け、個々の星アイコン(装飾)は読み上げ対象から除外する
		// (#956 で追加していた Common.ratingLabel ベースのラベルは #939 のこの実装に統一)
		<View style={styles.container} accessible accessibilityLabel={i18n.t("Stars.accessibility.rating", { rating })}>
			{Array.from({ length: fullStars }).map((_, index) => (
				<FontAwesome
					key={`full-${index}`}
					name="star"
					size={size}
					color={color}
					importantForAccessibility="no"
					aria-hidden
				/>
			))}
			{halfStar && (
				<FontAwesome name="star-half" size={size} color={color} importantForAccessibility="no" aria-hidden />
			)}
			{Array.from({ length: emptyStars }).map((_, index) => (
				<FontAwesome
					key={`empty-${index}`}
					name="star-o"
					size={size}
					color={color}
					importantForAccessibility="no"
					aria-hidden
				/>
			))}
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		flexDirection: "row",
		marginRight: 8,
	},
});

export default Stars;
