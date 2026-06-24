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
import i18n from "@/lib/i18n";

type Props = {
	candidate: DishCategoryGroupVoteCandidate;
	isHost: boolean;
	isDishMediaLoading: boolean;
	onPressCandidate: (candidate: DishCategoryGroupVoteCandidate) => void;
	onPressDishMedia: (candidate: DishCategoryGroupVoteCandidate) => void;
	onDeleteCandidate: (candidate: DishCategoryGroupVoteCandidate) => void;
};

export function DishCategoryGroupVoteCandidateCard({
	candidate,
	isHost,
	isDishMediaLoading,
	onPressCandidate,
	onPressDishMedia,
	onDeleteCandidate,
}: Props) {
	const hasEmptyDishMedia = candidate.dishMediaSearchStatus === "empty";

	return (
		<Pressable style={styles.card} onPress={() => onPressCandidate(candidate)}>
			<Image source={{ uri: candidate.imageUrl }} style={styles.image} contentFit="cover" />
			<View style={styles.rankBadge}>
				<Text style={styles.rankText}>{candidate.rank ? `${candidate.rank}位` : "-"}</Text>
			</View>
			<View style={styles.info}>
				<Text style={styles.title} numberOfLines={1}>
					{candidate.displayName}
				</Text>
				<View style={styles.voteSummaryRow}>
					<View style={styles.voteCount}>
						<ThumbsUp size={13} color="#6B7280" strokeWidth={2.4} />
						<Text style={styles.voteSummary}>{candidate.likeCount}</Text>
					</View>
					<View style={styles.voteCount}>
						<ThumbsDown size={13} color="#6B7280" strokeWidth={2.4} />
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
				activeOpacity={0.85}>
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
					accessibilityLabel={i18n.t("DishCategoryGroupVotes.deleteCandidate")}>
					<Trash2 size={17} color="#DC2626" />
				</TouchableOpacity>
			) : null}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	card: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		padding: 10,
		borderRadius: 12,
		backgroundColor: "#FFFFFF",
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "#E5E7EB",
	},
	image: {
		width: 56,
		height: 56,
		borderRadius: 10,
		backgroundColor: "#E5E7EB",
	},
	rankBadge: {
		width: 38,
		height: 38,
		borderRadius: 19,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#F05537",
	},
	rankText: {
		fontSize: 12,
		fontWeight: "800",
		color: "#FFFFFF",
	},
	info: {
		flex: 1,
		minWidth: 0,
	},
	title: {
		fontSize: 16,
		fontWeight: "800",
		color: "#111827",
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
		color: "#6B7280",
		fontWeight: "800",
	},
	emptyText: {
		marginTop: 4,
		fontSize: 11,
		color: "#B45309",
	},
	secondaryButton: {
		width: 72,
		minHeight: 34,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: "#F05537",
		alignItems: "center",
		justifyContent: "center",
		flexDirection: "row",
		gap: 4,
		paddingHorizontal: 6,
	},
	secondaryButtonText: {
		fontSize: 11,
		fontWeight: "700",
		color: "#F05537",
	},
	disabledButton: {
		backgroundColor: "#F3F4F6",
		borderColor: "#E5E7EB",
	},
	disabledButtonText: {
		color: "#9CA3AF",
	},
	deleteButton: {
		width: 34,
		height: 34,
		borderRadius: 17,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FEF2F2",
	},
});
