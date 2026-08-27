/**
 * #856 【責務】
 * 結果画面のコメント一覧を描画する。
 *
 * コメントは参加者単位の1件なので、候補ごとのコメントとは分けて扱う。
 */
import { StyleSheet, Text, View } from "react-native";
import type { DishCategoryGroupVoteDetailResponse } from "@shared/api/v1/res";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";

type Props = {
	participants: DishCategoryGroupVoteDetailResponse["participants"];
};

export function DishCategoryGroupVoteComments({ participants }: Props) {
	const styles = useThemedStyles(createStyles);
	const commenters = participants.filter((participant) => participant.comment);
	if (commenters.length === 0) return null;

	return (
		<View style={styles.container}>
			<Text style={styles.sectionTitle}>{i18n.t("DishCategoryGroupVotes.commentsTitle")}</Text>
			{commenters.map((participant) => (
				<View key={participant.id} style={styles.commentRow}>
					<Text style={styles.name}>{participant.displayName}</Text>
					<Text style={styles.comment}>{participant.comment!}</Text>
				</View>
			))}
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			gap: 10,
			paddingHorizontal: 16,
			paddingVertical: 18,
		},
		sectionTitle: {
			fontSize: 16,
			fontWeight: "800",
			color: c.textPrimaryAlt,
		},
		commentRow: {
			padding: 12,
			borderRadius: 8,
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderMuted,
		},
		name: {
			fontSize: 13,
			fontWeight: "800",
			color: c.textPrimaryAlt,
		},
		comment: {
			marginTop: 4,
			fontSize: 14,
			lineHeight: 20,
			color: c.textSecondaryStrong,
		},
	});
