/**
 * #856 【責務】
 * 結果画面の候補一覧を描画する。
 *
 * 削除済み候補は API から受け取ってもこの一覧では落とし、説明画面に混ぜない。
 */
import { StyleSheet, View } from "react-native";
import type { DishCategoryGroupVoteCandidate } from "@shared/api/v1/res";
import { DishCategoryGroupVoteCandidateCard } from "./DishCategoryGroupVoteCandidateCard";

type Props = {
	candidates: DishCategoryGroupVoteCandidate[];
	isHost: boolean;
	loadingCandidateId: string | null;
	onPressCandidate: (candidate: DishCategoryGroupVoteCandidate) => void;
	onPressDishMedia: (candidate: DishCategoryGroupVoteCandidate) => void;
	onDeleteCandidate: (candidate: DishCategoryGroupVoteCandidate) => void;
};

export function DishCategoryGroupVoteCandidateList({
	candidates,
	isHost,
	loadingCandidateId,
	onPressCandidate,
	onPressDishMedia,
	onDeleteCandidate,
}: Props) {
	// 結果一覧は「投票対象として残っている候補」の順位だけを見せる。
	// rank が返らない古いレスポンスでも displayOrder で表示順を安定させる。
	const visibleCandidates = candidates
		.filter((candidate) => candidate.deletedAt === null)
		.sort((a, b) => {
			const rankA = a.rank ?? Number.MAX_SAFE_INTEGER;
			const rankB = b.rank ?? Number.MAX_SAFE_INTEGER;
			if (rankA !== rankB) return rankA - rankB;
			return a.displayOrder - b.displayOrder;
		});

	return (
		<View style={styles.container}>
			{visibleCandidates.map((candidate) => (
				<DishCategoryGroupVoteCandidateCard
					key={candidate.id}
					candidate={candidate}
					isHost={isHost}
					isDishMediaLoading={loadingCandidateId === candidate.id}
					onPressCandidate={onPressCandidate}
					onPressDishMedia={onPressDishMedia}
					onDeleteCandidate={onDeleteCandidate}
				/>
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		gap: 8,
		paddingHorizontal: 16,
		paddingTop: 16,
	},
});
