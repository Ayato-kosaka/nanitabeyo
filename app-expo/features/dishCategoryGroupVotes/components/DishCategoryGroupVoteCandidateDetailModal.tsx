/**
 * #856 【責務】
 * 結果一覧で圧縮した候補情報を、画像・投票内訳・行動導線込みで詳しく見せる。
 *
 * 一覧は比較密度を優先し、参加者名などの読み物はこの詳細面へ逃がす。
 */
import { Image } from "expo-image";
import { Eye, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react-native";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { DishCategoryGroupVoteCandidate } from "@shared/api/v1/res";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";

type Props = {
	candidate: DishCategoryGroupVoteCandidate;
	isHost: boolean;
	hasVotes: boolean;
	isDishMediaLoading: boolean;
	onPressDishMedia: (candidate: DishCategoryGroupVoteCandidate) => void;
	onDeleteCandidate: (candidate: DishCategoryGroupVoteCandidate) => void;
};

export function DishCategoryGroupVoteCandidateDetailModal({
	candidate,
	isHost,
	hasVotes,
	isDishMediaLoading,
	onPressDishMedia,
	onDeleteCandidate,
}: Props) {
	const likeVotes = candidate.votes.filter((vote) => vote.reaction === "like");
	const dislikeVotes = candidate.votes.filter((vote) => vote.reaction === "dislike");
	const hasEmptyDishMedia = candidate.dishMediaSearchStatus === "empty";

	return (
		<View style={styles.modal}>
			<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
				<View style={styles.hero}>
					<Image source={{ uri: candidate.imageUrl }} style={styles.image} contentFit="cover" />
					<View style={styles.rankBadge}>
						{/* #941 【仕様】総投票数0はBEが全候補同率rank(=1)で返すため、UI側で「未投票」に統一する */}
						<Text style={styles.rankText}>
							{hasVotes && candidate.rank
								? i18n.t("DishCategoryGroupVotes.rankLabel", { rank: candidate.rank })
								: i18n.t("DishCategoryGroupVotes.unvoted")}
						</Text>
					</View>
				</View>
				<Text style={styles.title}>{candidate.displayName}</Text>
				<Text style={styles.tagline}>{candidate.tagline}</Text>

				<View style={styles.breakdown}>
					<VoteBreakdownRow icon="like" count={candidate.likeCount} names={likeVotes.map((vote) => vote.displayName)} />
					<View style={styles.divider} />
					<VoteBreakdownRow
						icon="dislike"
						count={candidate.dislikeCount}
						names={dislikeVotes.map((vote) => vote.displayName)}
					/>
				</View>

				<PrimaryButton
					label={
						isDishMediaLoading
							? i18n.t("DishCategoryGroupVotes.loadingRestaurants")
							: i18n.t("DishCategoryGroupVotes.viewRestaurants")
					}
					icon={<Eye size={18} color="#FFFFFF" />}
					loading={isDishMediaLoading}
					disabled={hasEmptyDishMedia || isDishMediaLoading}
					onPress={() => onPressDishMedia(candidate)}
					style={styles.viewRestaurantsButton}
				/>
				{hasEmptyDishMedia ? (
					<Text style={styles.emptyText}>{i18n.t("DishCategoryGroupVotes.noRestaurantsFound")}</Text>
				) : null}

				{isHost ? (
					<TouchableOpacity
						style={styles.deleteButton}
						onPress={() => onDeleteCandidate(candidate)}
						activeOpacity={0.85}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("DishCategoryGroupVotes.deleteCandidate")}
						testID={`dish-category-group-vote-detail-delete-candidate-${candidate.id}`}>
						<Trash2 size={16} color="#DC2626" />
						<Text style={styles.deleteButtonText}>{i18n.t("DishCategoryGroupVotes.deleteCandidate")}</Text>
					</TouchableOpacity>
				) : null}
			</ScrollView>
		</View>
	);
}

function VoteBreakdownRow({ icon, count, names }: { icon: "like" | "dislike"; count: number; names: string[] }) {
	const Icon = icon === "like" ? ThumbsUp : ThumbsDown;
	const label = icon === "like" ? i18n.t("DishCategoryGroupVotes.like") : i18n.t("DishCategoryGroupVotes.dislike");

	return (
		<View style={styles.voteRow}>
			<View style={styles.voteHeader}>
				<Icon size={17} color="#6B7280" strokeWidth={2.4} />
				<Text style={styles.voteTitle}>
					{label} {count}
				</Text>
			</View>
			<Text style={styles.voteNames}>
				{names.length > 0 ? names.join("、") : i18n.t("DishCategoryGroupVotes.noVotes")}
			</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	modal: {
		width: "100%",
		maxWidth: 430,
		borderRadius: 24,
		backgroundColor: "#FFFFFF",
		overflow: "hidden",
	},
	content: {
		paddingBottom: 18,
	},
	hero: {
		position: "relative",
	},
	image: {
		width: "100%",
		aspectRatio: 1.25,
		backgroundColor: "#E5E7EB",
	},
	rankBadge: {
		position: "absolute",
		left: 16,
		bottom: 16,
		minWidth: 54,
		height: 54,
		borderRadius: 27,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#F05537",
		paddingHorizontal: 10,
	},
	rankText: {
		fontSize: 15,
		fontWeight: "900",
		color: "#FFFFFF",
	},
	title: {
		marginTop: 18,
		paddingHorizontal: 18,
		fontSize: 24,
		lineHeight: 31,
		fontWeight: "900",
		color: "#111827",
	},
	tagline: {
		marginTop: 8,
		paddingHorizontal: 18,
		fontSize: 14,
		lineHeight: 22,
		fontWeight: "600",
		color: "#6B7280",
	},
	breakdown: {
		marginTop: 18,
		marginHorizontal: 18,
		borderRadius: 16,
		backgroundColor: "#F9FAFB",
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "#E5E7EB",
		overflow: "hidden",
	},
	voteRow: {
		padding: 14,
		gap: 8,
	},
	voteHeader: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	voteTitle: {
		fontSize: 14,
		fontWeight: "900",
		color: "#374151",
	},
	voteNames: {
		fontSize: 13,
		lineHeight: 20,
		fontWeight: "600",
		color: "#6B7280",
	},
	divider: {
		height: StyleSheet.hairlineWidth,
		backgroundColor: "#E5E7EB",
	},
	viewRestaurantsButton: {
		marginTop: 18,
		marginHorizontal: 18,
	},
	emptyText: {
		marginTop: 8,
		paddingHorizontal: 18,
		fontSize: 12,
		color: "#B45309",
	},
	deleteButton: {
		marginTop: 14,
		marginHorizontal: 18,
		height: 42,
		borderRadius: 12,
		alignItems: "center",
		justifyContent: "center",
		flexDirection: "row",
		gap: 8,
		backgroundColor: "#FEF2F2",
	},
	deleteButtonText: {
		fontSize: 13,
		fontWeight: "800",
		color: "#DC2626",
	},
});
