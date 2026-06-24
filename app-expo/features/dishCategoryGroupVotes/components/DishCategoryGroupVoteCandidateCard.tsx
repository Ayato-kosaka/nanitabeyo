/**
 * #856 【責務】
 * 結果画面で候補1件の状態を示すカード。
 *
 * 投票結果、削除状態、店舗提案キャッシュ状態の3つをここで読み分ける。
 */
import { Eye, Trash2 } from "lucide-react-native";
import { Image } from "expo-image";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { DishCategoryGroupVoteCandidate } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";

type Props = {
	candidate: DishCategoryGroupVoteCandidate;
	isHost: boolean;
	isDishMediaLoading: boolean;
	onPressDishMedia: (candidate: DishCategoryGroupVoteCandidate) => void;
	onDeleteCandidate: (candidate: DishCategoryGroupVoteCandidate) => void;
};

export function DishCategoryGroupVoteCandidateCard({
	candidate,
	isHost,
	isDishMediaLoading,
	onPressDishMedia,
	onDeleteCandidate,
}: Props) {
	const hasEmptyDishMedia = candidate.dishMediaSearchStatus === "empty";

	return (
		<View style={styles.card}>
			<Image source={{ uri: candidate.imageUrl }} style={styles.image} contentFit="cover" />
			<View style={styles.body}>
				<View style={styles.titleRow}>
					<Text style={styles.title} numberOfLines={1}>
						{candidate.displayName}
					</Text>
					{candidate.rank ? <Text style={styles.rank}>#{candidate.rank}</Text> : null}
				</View>
				<View style={styles.countRow}>
					<Text style={styles.countText}>👍 {candidate.likeCount}</Text>
					<Text style={styles.countText}>👎 {candidate.dislikeCount}</Text>
				</View>
				<View style={styles.voterRow}>
					{candidate.votes.slice(0, 8).map((vote) => (
						<Text key={vote.participantId} style={styles.voter}>
							{vote.displayName}
							{vote.reaction === "like" ? "👍" : "👎"}
						</Text>
					))}
				</View>
				{hasEmptyDishMedia ? (
					<Text style={styles.emptyText}>{i18n.t("DishCategoryGroupVotes.noRestaurantsFound")}</Text>
				) : null}
				<View style={styles.actionRow}>
					<TouchableOpacity
						style={[styles.secondaryButton, hasEmptyDishMedia && styles.disabledButton]}
						disabled={hasEmptyDishMedia || isDishMediaLoading}
						onPress={() => onPressDishMedia(candidate)}
						activeOpacity={0.85}>
						<Eye size={16} color={hasEmptyDishMedia ? "#9CA3AF" : "#111827"} />
						<Text style={[styles.secondaryButtonText, hasEmptyDishMedia && styles.disabledButtonText]}>
							{isDishMediaLoading
								? i18n.t("DishCategoryGroupVotes.loadingRestaurants")
								: i18n.t("DishCategoryGroupVotes.viewRestaurants")}
						</Text>
					</TouchableOpacity>
					{isHost ? (
						<TouchableOpacity
							style={styles.deleteButton}
							onPress={() => onDeleteCandidate(candidate)}
							activeOpacity={0.85}
							accessibilityLabel={i18n.t("DishCategoryGroupVotes.deleteCandidate")}>
							<Trash2 size={16} color="#B91C1C" />
						</TouchableOpacity>
					) : null}
				</View>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	card: {
		flexDirection: "row",
		gap: 12,
		padding: 12,
		borderRadius: 8,
		backgroundColor: "#FFFFFF",
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "#E5E7EB",
	},
	image: {
		width: 88,
		height: 88,
		borderRadius: 8,
		backgroundColor: "#E5E7EB",
	},
	body: {
		flex: 1,
		minWidth: 0,
	},
	titleRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	title: {
		flex: 1,
		fontSize: 17,
		fontWeight: "700",
		color: "#111827",
	},
	rank: {
		fontSize: 13,
		fontWeight: "800",
		color: "#EA580C",
	},
	countRow: {
		marginTop: 6,
		flexDirection: "row",
		gap: 12,
	},
	countText: {
		fontSize: 13,
		color: "#374151",
		fontWeight: "600",
	},
	voterRow: {
		marginTop: 6,
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 6,
	},
	voter: {
		fontSize: 12,
		color: "#6B7280",
	},
	emptyText: {
		marginTop: 6,
		fontSize: 12,
		color: "#B45309",
	},
	actionRow: {
		marginTop: 10,
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	secondaryButton: {
		flex: 1,
		height: 36,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: "#D1D5DB",
		alignItems: "center",
		justifyContent: "center",
		flexDirection: "row",
		gap: 6,
	},
	secondaryButtonText: {
		fontSize: 13,
		fontWeight: "700",
		color: "#111827",
	},
	disabledButton: {
		backgroundColor: "#F3F4F6",
		borderColor: "#E5E7EB",
	},
	disabledButtonText: {
		color: "#9CA3AF",
	},
	deleteButton: {
		width: 36,
		height: 36,
		borderRadius: 8,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FEF2F2",
	},
});
