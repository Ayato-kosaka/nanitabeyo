/**
 * #856 【責務】
 * 結果画面の上部に、共有導線と参加状況をまとめて出す。
 *
 * ここは一覧や投票結果の本体ではなく、画面の入口と共有を担う。
 */
import { Share2, Users } from "lucide-react-native";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { DishCategoryGroupVoteDetailResponse } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";

type Props = {
	session: DishCategoryGroupVoteDetailResponse["session"];
	shareUrl: string;
	onCopyShareLink: () => void;
};

export function DishCategoryGroupVoteResultHeader({ session, shareUrl, onCopyShareLink }: Props) {
	return (
		<View style={styles.container}>
			<View style={styles.titleRow}>
				<Text style={styles.title}>{i18n.t("DishCategoryGroupVotes.resultTitle")}</Text>
				<View style={styles.participantBadge}>
					<Users size={16} color="#1F2937" />
					<Text style={styles.participantText}>{session.participantCount}</Text>
				</View>
			</View>
			<Text style={styles.subtitle}>
				{session.hasVoted
					? i18n.t("DishCategoryGroupVotes.resultSubtitleVoted")
					: i18n.t("DishCategoryGroupVotes.resultSubtitle")}
			</Text>
			{/* #856 【設計】共有リンクはホスト専用にしない。
			    ゲストがさらに共有できる方が、リンク型投票の導線として自然。 */}
			<TouchableOpacity style={styles.shareButton} onPress={onCopyShareLink} activeOpacity={0.85}>
				<Share2 size={18} color="#FFFFFF" />
				<Text style={styles.shareButtonText}>{i18n.t("DishCategoryGroupVotes.copyShareLink")}</Text>
			</TouchableOpacity>
			<Text numberOfLines={1} style={styles.shareUrl}>
				{shareUrl}
			</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		paddingHorizontal: 20,
		paddingTop: 20,
		paddingBottom: 16,
		backgroundColor: "#FFFFFF",
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: "#E5E7EB",
	},
	titleRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
	},
	title: {
		flex: 1,
		fontSize: 24,
		fontWeight: "700",
		color: "#111827",
	},
	participantBadge: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingHorizontal: 10,
		paddingVertical: 6,
		borderRadius: 999,
		backgroundColor: "#F3F4F6",
	},
	participantText: {
		fontSize: 14,
		fontWeight: "700",
		color: "#1F2937",
	},
	subtitle: {
		marginTop: 8,
		fontSize: 14,
		lineHeight: 20,
		color: "#4B5563",
	},
	shareButton: {
		marginTop: 14,
		height: 44,
		borderRadius: 8,
		backgroundColor: "#111827",
		alignItems: "center",
		justifyContent: "center",
		flexDirection: "row",
		gap: 8,
	},
	shareButtonText: {
		color: "#FFFFFF",
		fontSize: 15,
		fontWeight: "700",
	},
	shareUrl: {
		marginTop: 8,
		fontSize: 12,
		color: "#6B7280",
	},
});
