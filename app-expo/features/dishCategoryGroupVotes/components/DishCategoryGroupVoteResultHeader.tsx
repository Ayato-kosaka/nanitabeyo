/**
 * #856 【責務】
 * 結果画面の上部に、共有導線と参加状況をまとめて出す。
 *
 * ここは一覧や投票結果の本体ではなく、画面の入口と共有を担う。
 */
import { Share2, Users } from "lucide-react-native";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { DishCategoryGroupVoteDetailResponse } from "@shared/api/v1/res";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";

type Props = {
	session: DishCategoryGroupVoteDetailResponse["session"];
	participants: DishCategoryGroupVoteDetailResponse["participants"];
	onCopyShareLink: () => void;
};

export function DishCategoryGroupVoteResultHeader({ session, participants, onCopyShareLink }: Props) {
	// #1629 アイコンは style ではなく prop で色を受けるので、パレットを直接読む
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const participantNames = participants.map((participant) => participant.displayName).join("、");

	return (
		<View style={styles.container}>
			<View style={styles.participantRow}>
				<Users size={16} color={colors.textPrimaryDim} />
				<Text style={styles.participantCount}>{session.participantCount}</Text>
				<Text style={styles.participantsText} numberOfLines={2}>
					{participantNames
						? i18n.t("DishCategoryGroupVotes.participantsList", { names: participantNames })
						: i18n.t("DishCategoryGroupVotes.noParticipants")}
				</Text>
			</View>
			{/* #856 【設計】共有リンクはホスト専用にしない。
			    ゲストがさらに共有できる方が、リンク型投票の導線として自然。 */}
			<TouchableOpacity
				style={styles.shareButton}
				onPress={onCopyShareLink}
				activeOpacity={0.85}
				accessibilityRole="button"
				accessibilityLabel={i18n.t("DishCategoryGroupVotes.copyShareLink")}
				testID="dish-category-group-vote-copy-share-link">
				<Share2 size={18} color={colors.brand} />
				<Text style={styles.shareButtonText}>{i18n.t("DishCategoryGroupVotes.copyShareLink")}</Text>
			</TouchableOpacity>
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			paddingHorizontal: 20,
			paddingTop: 20,
			paddingBottom: 16,
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: c.borderMuted,
		},
		participantRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
		},
		participantCount: {
			fontSize: 14,
			fontWeight: "800",
			color: c.textPrimaryDim,
		},
		participantsText: {
			flex: 1,
			fontSize: 14,
			lineHeight: 20,
			color: c.textSecondaryAlt,
		},
		shareButton: {
			marginTop: 14,
			height: 44,
			borderRadius: 8,
			backgroundColor: c.surface,
			borderWidth: 1,
			borderColor: c.brand,
			alignItems: "center",
			justifyContent: "center",
			flexDirection: "row",
			gap: 8,
		},
		shareButtonText: {
			color: c.brand,
			fontSize: 15,
			fontWeight: "700",
		},
	});
