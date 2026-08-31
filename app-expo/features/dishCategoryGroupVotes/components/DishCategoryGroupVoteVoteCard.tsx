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
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";
import { height as SCREEN_HEIGHT } from "@/features/dishCategories/constants";
import { useDishCategoryCardSize } from "@/features/dishCategories/hooks/useDishCategoryCardSize";
import { DishCategoryVisualCard } from "@/features/dishCategories/components/DishCategoryVisualCard";
import { type DishCategoryImageResourceState } from "@/features/dishCategories/hooks/useDishCategoryImageResources";
import { useReducedMotion } from "@/hooks/useReducedMotion";

type Props = {
	candidate: DishCategoryGroupVoteCandidate;
	onVote: (reaction: DishCategoryGroupVoteReaction) => void;
	// #1213 【設計】画面側(useDishCategoryImageResources)で先読みした結果をここへ渡す。
	// 渡さないと DishCategoryVisualCard は生の uri をその場で読み込むため、候補が切り替わるたびに
	// ネットワーク取得が発生し、カード背景色(#EEE)が一瞬見えてしまう。
	imageState?: DishCategoryImageResourceState;
};

export function DishCategoryGroupVoteVoteCard({ candidate, onVote, imageState }: Props) {
	// #1629 アイコンは style ではなく prop で色を受けるので、パレットを直接読む
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const translateX = useRef(new Animated.Value(0)).current;
	const onVoteRef = useRef(onVote);
	const { cardWidth, cardMaxHeight } = useDishCategoryCardSize();
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
				<DishCategoryVisualCard
					title={candidate.displayName}
					tagline={candidate.tagline}
					imageSource={{ uri: candidate.imageUrl }}
					cardWidth={cardWidth}
					cardHeight={cardHeight}
					imageState={imageState}
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
					<ThumbsDown size={24} color={colors.brand} strokeWidth={2.4} />
					<Text style={styles.buttonLabel}>{i18n.t("DishCategoryGroupVotes.dislike")}</Text>
				</TouchableOpacity>
				<TouchableOpacity
					style={styles.likeButton}
					onPress={() => onVote("like")}
					activeOpacity={0.85}
					testID="dish-category-group-vote-like-button"
					accessibilityRole="button"
					accessibilityLabel={i18n.t("DishCategoryGroupVotes.likeButtonLabel", { title: candidate.displayName })}>
					{/* ブランド色で塗ったボタンの上のアイコン。地（c.brand）がライト / ダークで変わらないため振らない */}
					<ThumbsUp size={24} color={FixedColors.onFilled} strokeWidth={2.4} />
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

const createStyles = (c: Palette) =>
	StyleSheet.create({
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
			backgroundColor: c.surface,
			borderWidth: 1,
			borderColor: c.brand,
		},
		likeButton: {
			width: 116,
			height: 58,
			borderRadius: 29,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.brand,
		},
		buttonLabel: {
			marginTop: 3,
			fontSize: 12,
			fontWeight: "800",
			color: c.textSecondary,
		},
		likeButtonLabel: {
			// ブランド色で塗ったボタンの上の文字。地（c.brand）がライト / ダークで変わらないため振らない
			color: FixedColors.onFilled,
		},
	});
