/**
 * #856 【責務】
 * 結果画面の候補一覧を描画する。
 *
 * 削除済み候補は API から受け取ってもこの一覧では落とし、説明画面に混ぜない。
 */
import { StyleSheet, Text, View } from "react-native";
import type { DishCategoryGroupVoteCandidate } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";
import { DishCategoryGroupVoteCandidateCard } from "./DishCategoryGroupVoteCandidateCard";

type Props = {
	candidates: DishCategoryGroupVoteCandidate[];
	isHost: boolean;
	loadingCandidateId: string | null;
	onPressDishMedia: (candidate: DishCategoryGroupVoteCandidate) => void;
	onDeleteCandidate: (candidate: DishCategoryGroupVoteCandidate) => void;
};

export function DishCategoryGroupVoteCandidateList({
	candidates,
	isHost,
	loadingCandidateId,
	onPressDishMedia,
	onDeleteCandidate,
}: Props) {
	// #856 【設計】削除済み候補は結果説明用に API からは返すが、通常UIでは見せない。
	// 店舗提案対象も未削除候補だけに揃える。
	const visibleCandidates = candidates.filter((candidate) => candidate.deletedAt === null);

	return (
		<View style={styles.container}>
			<Text style={styles.sectionTitle}>{i18n.t("DishCategoryGroupVotes.candidatesTitle")}</Text>
			{visibleCandidates.map((candidate) => (
				<DishCategoryGroupVoteCandidateCard
					key={candidate.id}
					candidate={candidate}
					isHost={isHost}
					isDishMediaLoading={loadingCandidateId === candidate.id}
					onPressDishMedia={onPressDishMedia}
					onDeleteCandidate={onDeleteCandidate}
				/>
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		gap: 10,
		paddingHorizontal: 16,
		paddingTop: 16,
	},
	sectionTitle: {
		fontSize: 16,
		fontWeight: "800",
		color: "#111827",
	},
});
