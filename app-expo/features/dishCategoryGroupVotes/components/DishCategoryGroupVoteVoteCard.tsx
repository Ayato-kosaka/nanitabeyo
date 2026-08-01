/**
 * #856 【責務】
 * 投票時の1枚カードと、同じ reaction に流れるスワイプ/ボタン操作をまとめる。
 *
 * 操作経路を分けず、最終的には同じ onVote に集約することで状態遷移を単純化する。
 */
import { useEffect, useRef } from "react";
import { Animated, PanResponder, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ThumbsDown, ThumbsUp } from "lucide-react-native";
import type { DishCategoryGroupVoteCandidate, DishCategoryGroupVoteReaction } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";
import { height as SCREEN_HEIGHT } from "@/features/topics/constants";
import { useTopicCardSize } from "@/features/topics/hooks/useTopicCardSize";
import { TopicVisualCard } from "@/features/topics/components/TopicVisualCard";
import { useReducedMotion } from "@/hooks/useReducedMotion";

type Props = {
	candidate: DishCategoryGroupVoteCandidate;
	onVote: (reaction: DishCategoryGroupVoteReaction) => void;
};

export function DishCategoryGroupVoteVoteCard({ candidate, onVote }: Props) {
	const translateX = useRef(new Animated.Value(0)).current;
	const onVoteRef = useRef(onVote);
	const { cardWidth, cardMaxHeight } = useTopicCardSize();
	const cardHeight = Math.max(360, Math.min(cardMaxHeight, SCREEN_HEIGHT - 280));

	useEffect(() => {
		onVoteRef.current = onVote;
	}, [onVote]);

	// #959【アクセシビリティ】PanResponder は useRef(...).current で 1 度だけ生成されるクロージャのため、
	// onVoteRef と同じ理由で reducedMotion も ref 経由で参照する(直接参照すると初回値に固定されてしまう)
	const reducedMotion = useReducedMotion();
	const reducedMotionRef = useRef(reducedMotion);

	useEffect(() => {
		reducedMotionRef.current = reducedMotion;
	}, [reducedMotion]);

	const panResponder = useRef(
		PanResponder.create({
			onMoveShouldSetPanResponder: (_, gesture) =>
				Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
			onPanResponderMove: Animated.event([null, { dx: translateX }], { useNativeDriver: false }),
			onPanResponderRelease: (_, gesture) => {
				if (gesture.dx > 90) {
					onVoteRef.current("like");
					translateX.setValue(0);
					return;
				}
				if (gesture.dx < -90) {
					onVoteRef.current("dislike");
					translateX.setValue(0);
					return;
				}
				// #959【アクセシビリティ】reduced motion 時は中央へのバウンド演出(spring)を省略し即座に戻す
				if (reducedMotionRef.current) {
					translateX.setValue(0);
				} else {
					Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
				}
			},
		}),
	).current;

	return (
		<View style={styles.container}>
			<Animated.View style={[styles.cardMotion, getCardMotionStyle(translateX)]} {...panResponder.panHandlers}>
				<TopicVisualCard
					title={candidate.displayName}
					tagline={candidate.tagline}
					imageSource={{ uri: candidate.imageUrl }}
					cardWidth={cardWidth}
					cardHeight={cardHeight}
					recyclingKey={candidate.id}
				/>
			</Animated.View>
			{/* #856 【設計】スワイプだけに依存しない。
			    ボタン操作も同じ onVote に流すことで、操作経路による投票状態のズレを防ぐ。 */}
			<View style={styles.buttonRow}>
				<TouchableOpacity
					style={styles.dislikeButton}
					onPress={() => onVote("dislike")}
					activeOpacity={0.85}
					testID="dish-category-group-vote-dislike-button"
					accessibilityRole="button"
					accessibilityLabel={i18n.t("DishCategoryGroupVotes.dislikeButtonLabel", { title: candidate.displayName })}>
					<ThumbsDown size={24} color="#F05537" strokeWidth={2.4} />
					<Text style={styles.buttonLabel}>{i18n.t("DishCategoryGroupVotes.dislike")}</Text>
				</TouchableOpacity>
				<TouchableOpacity
					style={styles.likeButton}
					onPress={() => onVote("like")}
					activeOpacity={0.85}
					testID="dish-category-group-vote-like-button"
					accessibilityRole="button"
					accessibilityLabel={i18n.t("DishCategoryGroupVotes.likeButtonLabel", { title: candidate.displayName })}>
					<ThumbsUp size={24} color="#FFFFFF" strokeWidth={2.4} />
					<Text style={[styles.buttonLabel, styles.likeButtonLabel]}>{i18n.t("DishCategoryGroupVotes.like")}</Text>
				</TouchableOpacity>
			</View>
		</View>
	);
}

function getCardMotionStyle(translateX: Animated.Value) {
	return {
		transform: [
			{ translateX },
			{
				rotate: translateX.interpolate({
					inputRange: [-160, 0, 160],
					outputRange: ["-8deg", "0deg", "8deg"],
				}),
			},
		],
	};
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		gap: 20,
		paddingHorizontal: 16,
		paddingBottom: 22,
	},
	cardMotion: {
		alignItems: "center",
	},
	buttonRow: {
		flexDirection: "row",
		gap: 16,
	},
	dislikeButton: {
		width: 116,
		height: 58,
		borderRadius: 29,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FFFFFF",
		borderWidth: 1,
		borderColor: "#F05537",
	},
	likeButton: {
		width: 116,
		height: 58,
		borderRadius: 29,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#F05537",
	},
	buttonLabel: {
		marginTop: 3,
		fontSize: 12,
		fontWeight: "800",
		color: "#6B7280",
	},
	likeButtonLabel: {
		color: "#FFFFFF",
	},
});
