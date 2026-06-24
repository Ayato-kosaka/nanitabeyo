/**
 * #856 【責務】
 * 結果画面のコメント一覧を描画する。
 *
 * コメントは参加者単位の1件なので、候補ごとのコメントとは分けて扱う。
 */
import { StyleSheet, Text, View } from "react-native";
import type { DishCategoryGroupVoteComment } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";

type Props = {
	comments: DishCategoryGroupVoteComment[];
};

export function DishCategoryGroupVoteComments({ comments }: Props) {
	if (comments.length === 0) return null;

	return (
		<View style={styles.container}>
			<Text style={styles.sectionTitle}>{i18n.t("DishCategoryGroupVotes.commentsTitle")}</Text>
			{comments.map((comment) => (
				<View key={comment.participantId} style={styles.commentRow}>
					<Text style={styles.name}>{comment.displayName}</Text>
					<Text style={styles.comment}>{comment.comment}</Text>
				</View>
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		gap: 10,
		paddingHorizontal: 16,
		paddingVertical: 18,
	},
	sectionTitle: {
		fontSize: 16,
		fontWeight: "800",
		color: "#111827",
	},
	commentRow: {
		padding: 12,
		borderRadius: 8,
		backgroundColor: "#FFFFFF",
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "#E5E7EB",
	},
	name: {
		fontSize: 13,
		fontWeight: "800",
		color: "#111827",
	},
	comment: {
		marginTop: 4,
		fontSize: 14,
		lineHeight: 20,
		color: "#374151",
	},
});
