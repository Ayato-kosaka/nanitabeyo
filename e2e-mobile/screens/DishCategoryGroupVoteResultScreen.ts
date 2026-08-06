import { by, tapWhenVisible, waitUntilGone, waitUntilVisible } from "../fixtures/e2e";

/**
 * 🗳 友達投票の結果画面の Screen Object
 *
 * 対応画面: app-expo/features/dishCategoryGroupVotes/components/DishCategoryGroupVoteResultScreen.tsx
 * 対応する e2e-web の spec: e2e-web/tests/search/dish-category-group-vote-navigation.spec.ts
 *
 * ## 観測点
 * - 候補カード: `dish-category-group-vote-candidate-<candidateId>`（押すと詳細モーダルが開く）
 * - カード内「店を見る」: `dish-category-group-vote-candidate-dish-media-<candidateId>`（モーダルを介さない導線）
 * - 詳細モーダル本体: `dish-category-group-vote-candidate-detail`
 * - モーダル内「店を見る」: `dish-category-group-vote-detail-dish-media`
 *
 * 詳細モーダルは `useBlurModal`（react-native-paper の Portal）で描かれるため、
 * **モーダル本体の testID が消えたこと = Portal がアンマウントされたこと**になる。
 * #1122 の「閉じてから遷移する」はこの観測点で検証する。
 */
export class DishCategoryGroupVoteResultScreen {
	/** 候補カード（押下で詳細モーダルを開く） */
	candidateCard(candidateId: string) {
		return by.id(`dish-category-group-vote-candidate-${candidateId}`);
	}

	/** 一覧カード内の「店を見る」（詳細モーダルを介さない導線） */
	candidateDishMediaButton(candidateId: string) {
		return by.id(`dish-category-group-vote-candidate-dish-media-${candidateId}`);
	}

	/** 候補詳細モーダル本体 */
	readonly detailModal = by.id("dish-category-group-vote-candidate-detail");

	/** 詳細モーダル内の「店を見る」 */
	readonly detailDishMediaButton = by.id("dish-category-group-vote-detail-dish-media");

	/** 候補一覧が表示されるまで待つ */
	async expectLoaded(candidateId: string, timeout?: number): Promise<void> {
		await waitUntilVisible(this.candidateCard(candidateId), timeout);
	}

	/** 候補カードを押して詳細モーダルを開く */
	async openCandidateDetail(candidateId: string): Promise<void> {
		await tapWhenVisible(this.candidateCard(candidateId));
		await waitUntilVisible(this.detailModal);
	}

	/** 詳細モーダル内の「店を見る」を押す */
	async pressDetailDishMedia(): Promise<void> {
		await tapWhenVisible(this.detailDishMediaButton);
	}

	/** 詳細モーダルが閉じ切る（Portal がアンマウントされる）まで待つ */
	async expectDetailClosed(): Promise<void> {
		await waitUntilGone(this.detailModal);
	}
}
