/**
 * #856 【責務】
 * 結果画面で候補1件の状態を示すカード。
 *
 * 投票結果、削除状態、店舗提案キャッシュ状態の3つをここで読み分ける。
 */
import { ThumbsDown, ThumbsUp, Trash2 } from "lucide-react-native";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { DishCategoryGroupVoteCandidate } from "@shared/api/v1/res";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";

type Props = {
	candidate: DishCategoryGroupVoteCandidate;
	isHost: boolean;
	hasVotes: boolean;
	isDishMediaLoading: boolean;
	onPressCandidate: (candidate: DishCategoryGroupVoteCandidate) => void;
	onPressDishMedia: (candidate: DishCategoryGroupVoteCandidate) => void;
	onDeleteCandidate: (candidate: DishCategoryGroupVoteCandidate) => void;
};

export function DishCategoryGroupVoteCandidateCard({
	candidate,
	isHost,
	hasVotes,
	isDishMediaLoading,
	onPressCandidate,
	onPressDishMedia,
	onDeleteCandidate,
}: Props) {
	// #1629 アイコンは style ではなく prop で色を受けるので、パレットを直接読む
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const hasEmptyDishMedia = candidate.dishMediaSearchStatus === "empty";

	return (
		<Pressable
			style={styles.card}
			onPress={() => onPressCandidate(candidate)}
			// #1122 E2E から「一覧カード導線」と「詳細モーダル導線」を撃ち分けるための識別子
			testID={`dish-category-group-vote-candidate-${candidate.id}`}>
			<Image source={{ uri: candidate.imageUrl }} style={styles.image} contentFit="cover" />
			<View style={styles.rankBadge}>
				{/* #941 【仕様】総投票数0はBEが全候補同率rank(=1)で返すため、UI側で「未投票」に統一する */}
				<Text style={styles.rankText} numberOfLines={1}>
					{hasVotes && candidate.rank
						? i18n.t("DishCategoryGroupVotes.rankLabel", { rank: candidate.rank })
						: i18n.t("DishCategoryGroupVotes.unvoted")}
				</Text>
			</View>
			<View style={styles.info}>
				<Text style={styles.title} numberOfLines={1}>
					{candidate.displayName}
				</Text>
				<View style={styles.voteSummaryRow}>
					<View style={styles.voteCount}>
						<ThumbsUp size={13} color={colors.textSecondary} strokeWidth={2.4} />
						<Text style={styles.voteSummary}>{candidate.likeCount}</Text>
					</View>
					<View style={styles.voteCount}>
						<ThumbsDown size={13} color={colors.textSecondary} strokeWidth={2.4} />
						<Text style={styles.voteSummary}>{candidate.dislikeCount}</Text>
					</View>
				</View>
				{hasEmptyDishMedia ? (
					<Text style={styles.emptyText}>{i18n.t("DishCategoryGroupVotes.noRestaurantsFound")}</Text>
				) : null}
			</View>
			<TouchableOpacity
				style={[styles.secondaryButton, hasEmptyDishMedia && styles.disabledButton]}
				disabled={hasEmptyDishMedia || isDishMediaLoading}
				onPress={(event) => {
					event.stopPropagation();
					onPressDishMedia(candidate);
				}}
				activeOpacity={0.85}
				testID={`dish-category-group-vote-candidate-dish-media-${candidate.id}`}>
				<Text style={[styles.secondaryButtonText, hasEmptyDishMedia && styles.disabledButtonText]} numberOfLines={1}>
					{isDishMediaLoading
						? i18n.t("DishCategoryGroupVotes.loadingRestaurants")
						: i18n.t("DishCategoryGroupVotes.viewRestaurants")}
				</Text>
			</TouchableOpacity>
			{isHost ? (
				<TouchableOpacity
					style={styles.deleteButton}
					onPress={(event) => {
						event.stopPropagation();
						onDeleteCandidate(candidate);
					}}
					activeOpacity={0.85}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("DishCategoryGroupVotes.deleteCandidate")}
					testID={`dish-category-group-vote-delete-candidate-${candidate.id}`}>
					<Trash2 size={17} color={colors.danger} />
				</TouchableOpacity>
			) : null}
		</Pressable>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		card: {
			flexDirection: "row",
			alignItems: "center",
			gap: 8,
			padding: 10,
			borderRadius: 12,
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderMuted,
		},
		image: {
			width: 56,
			height: 56,
			borderRadius: 10,
			backgroundColor: c.surfacePlaceholder,
		},
		rankBadge: {
			// #941 「未投票」など可変長ラベルが入るため固定 width から minWidth+padding に変更
			minWidth: 38,
			height: 38,
			borderRadius: 19,
			paddingHorizontal: 6,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.brand,
		},
		rankText: {
			fontSize: 12,
			fontWeight: "800",
			// ブランド色で塗った順位バッジの上の文字。地（c.brand）がライト / ダークで変わらないため文字も振らない
			color: FixedColors.onFilled,
		},
		info: {
			flex: 1,
			minWidth: 0,
		},
		title: {
			fontSize: 16,
			fontWeight: "800",
			color: c.textPrimaryAlt,
		},
		voteSummaryRow: {
			marginTop: 5,
			flexDirection: "row",
			alignItems: "center",
			gap: 10,
		},
		voteCount: {
			flexDirection: "row",
			alignItems: "center",
			gap: 4,
		},
		voteSummary: {
			fontSize: 12,
			lineHeight: 15,
			color: c.textSecondary,
			fontWeight: "800",
		},
		emptyText: {
			marginTop: 4,
			fontSize: 11,
			color: c.warningAction,
		},
		secondaryButton: {
			width: 72,
			minHeight: 34,
			borderRadius: 8,
			borderWidth: 1,
			borderColor: c.brand,
			alignItems: "center",
			justifyContent: "center",
			flexDirection: "row",
			gap: 4,
			paddingHorizontal: 6,
		},
		secondaryButtonText: {
			fontSize: 11,
			fontWeight: "700",
			color: c.brand,
		},
		disabledButton: {
			backgroundColor: c.surfaceSubtle,
			borderColor: c.borderMuted,
		},
		disabledButtonText: {
			color: c.textTertiary,
		},
		deleteButton: {
			width: 34,
			height: 34,
			borderRadius: 17,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.dangerTintSoft,
		},
	});
