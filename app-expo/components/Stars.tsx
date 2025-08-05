import React from "react";
import { View, StyleSheet } from "react-native";
import { FontAwesome } from "@expo/vector-icons";

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
		<View style={styles.container}>
			{Array.from({ length: fullStars }).map((_, index) => (
				<FontAwesome key={`full-${index}`} name="star" size={size} color={color} />
			))}
			{halfStar && <FontAwesome name="star-half" size={size} color={color} />}
			{Array.from({ length: emptyStars }).map((_, index) => (
				<FontAwesome key={`empty-${index}`} name="star-o" size={size} color={color} />
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
