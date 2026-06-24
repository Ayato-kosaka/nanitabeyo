/**
 * #856 【責務】
 * 投票時の1枚カードと、同じ reaction に流れるスワイプ/ボタン操作をまとめる。
 *
 * 操作経路を分けず、最終的には同じ onVote に集約することで状態遷移を単純化する。
 */
import { useRef } from "react";
import { Animated, PanResponder, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import type { DishCategoryGroupVoteCandidate, DishCategoryGroupVoteReaction } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";

type Props = {
	candidate: DishCategoryGroupVoteCandidate;
	onVote: (reaction: DishCategoryGroupVoteReaction) => void;
};

export function DishCategoryGroupVoteVoteCard({ candidate, onVote }: Props) {
	const translateX = useRef(new Animated.Value(0)).current;

	const panResponder = useRef(
		PanResponder.create({
			onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
			onPanResponderMove: Animated.event([null, { dx: translateX }], { useNativeDriver: false }),
			onPanResponderRelease: (_, gesture) => {
				if (gesture.dx > 90) {
					onVote("like");
					translateX.setValue(0);
					return;
				}
				if (gesture.dx < -90) {
					onVote("dislike");
					translateX.setValue(0);
					return;
				}
				Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
			},
		}),
	).current;

	return (
		<View style={styles.container}>
			<Animated.View
				style={[
					styles.card,
					{
						transform: [
							{ translateX },
							{
								rotate: translateX.interpolate({
									inputRange: [-160, 0, 160],
									outputRange: ["-8deg", "0deg", "8deg"],
								}),
							},
						],
					},
				]}
				{...panResponder.panHandlers}>
				<Image source={{ uri: candidate.imageUrl }} style={styles.image} contentFit="cover" />
				<View style={styles.body}>
					<Text style={styles.title}>{candidate.displayName}</Text>
				</View>
			</Animated.View>
			{/* #856 【設計】スワイプだけに依存しない。
			    ボタン操作も同じ onVote に流すことで、操作経路による投票状態のズレを防ぐ。 */}
			<View style={styles.buttonRow}>
				<TouchableOpacity style={styles.dislikeButton} onPress={() => onVote("dislike")} activeOpacity={0.85}>
					<Text style={styles.buttonText}>👎←</Text>
					<Text style={styles.buttonLabel}>{i18n.t("DishCategoryGroupVotes.dislike")}</Text>
				</TouchableOpacity>
				<TouchableOpacity style={styles.likeButton} onPress={() => onVote("like")} activeOpacity={0.85}>
					<Text style={styles.buttonText}>→👍</Text>
					<Text style={styles.buttonLabel}>{i18n.t("DishCategoryGroupVotes.like")}</Text>
				</TouchableOpacity>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "center",
		gap: 22,
		padding: 20,
	},
	card: {
		aspectRatio: 0.78,
		borderRadius: 8,
		overflow: "hidden",
		backgroundColor: "#FFFFFF",
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "#E5E7EB",
	},
	image: {
		flex: 1,
		backgroundColor: "#E5E7EB",
	},
	body: {
		minHeight: 76,
		justifyContent: "center",
		paddingHorizontal: 18,
		backgroundColor: "#FFFFFF",
	},
	title: {
		fontSize: 24,
		fontWeight: "800",
		color: "#111827",
		textAlign: "center",
	},
	buttonRow: {
		flexDirection: "row",
		gap: 12,
	},
	dislikeButton: {
		flex: 1,
		height: 58,
		borderRadius: 8,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FEE2E2",
	},
	likeButton: {
		flex: 1,
		height: 58,
		borderRadius: 8,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#DCFCE7",
	},
	buttonText: {
		fontSize: 20,
		fontWeight: "800",
		color: "#111827",
	},
	buttonLabel: {
		marginTop: 2,
		fontSize: 12,
		fontWeight: "700",
		color: "#374151",
	},
});
