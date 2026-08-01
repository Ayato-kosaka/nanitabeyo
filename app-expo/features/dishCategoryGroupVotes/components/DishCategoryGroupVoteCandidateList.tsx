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
	hasVotes: boolean;
	loadingCandidateId: string | null;
	onPressCandidate: (candidate: DishCategoryGroupVoteCandidate) => void;
	onPressDishMedia: (candidate: DishCategoryGroupVoteCandidate) => void;
	onDeleteCandidate: (candidate: DishCategoryGroupVoteCandidate) => void;
};

export function DishCategoryGroupVoteCandidateList({
	candidates,
	isHost,
	hasVotes,
	loadingCandidateId,
	onPressCandidate,
	onPressDishMedia,
	onDeleteCandidate,
}: Props) {
	// #856 【仕様】結果一覧は rank 昇順(=likeCount DESC 由来)で表示し、同順位内と
	// rank が返らない古いレスポンスは displayOrder で表示順を安定させる。
	// #941 【修正】「全員未投票で全候補1位」対応の際に誤って displayOrder 固定へ変更して
	// しまっていたため、レビュー指摘を受け #856 の rank 昇順ソートへ復旧した
	// (未投票時は全候補 rank=1 のため自然に displayOrder 順となり、未投票バッジ表示と両立する)。
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
					hasVotes={hasVotes}
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
