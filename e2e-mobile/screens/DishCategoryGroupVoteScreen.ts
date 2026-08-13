import { by, waitUntilGone, waitUntilVisible } from "../fixtures/e2e";

/**
 * 🗳 友達投票（dish category group vote）画面の Screen Object
 *
 * 対応画面:
 * - app-expo/features/dishCategoryGroupVotes/components/DishCategoryGroupVoteVoteScreen.tsx
 * - app-expo/features/dishCategoryGroupVotes/components/DishCategoryGroupVoteCompletionModal.tsx
 *
 * 対応する e2e-web のユーティリティ: e2e-web/utils/dishCategoryGroupVote.ts
 * （web 側は Page Object ではなく「API モック + 直接 getByTestId」で構成している。
 *   モックの組み立てが本体で、画面要素は数個しか触らないため）
 */
export class DishCategoryGroupVoteScreen {
	/** 投票カードの「良い」ボタン */
	readonly likeButton = by.id("dish-category-group-vote-like-button");
	/** 投票カードの「いまいち」ボタン */
	readonly dislikeButton = by.id("dish-category-group-vote-dislike-button");

	/**
	 * ログイン状態の確定待ちに描かれるローディング（#1120）。
	 * これが出ている間は「ゲスト用 / ログイン済み用」どちらの分岐も描かれない。
	 */
	readonly completionLoading = by.id("dish-category-group-vote-completion-loading");
	/** 確定後に描かれる完了モーダルのフォーム本体 */
	readonly completionForm = by.id("dish-category-group-vote-completion-form");
	/** 表示名の入力欄 */
	readonly displayNameInput = by.id("dish-category-group-vote-display-name-input");
	/**
	 * ゲスト向けの名前サジェスト（絵文字候補）。
	 * #1120 で「ログイン済みユーザーにも一瞬だけ出ていた」当該 UI。
	 */
	readonly nameSuggestions = by.id("dish-category-group-vote-name-suggestions");

	/** 投票カードが操作できる状態になるまで待つ */
	async expectVoteCardLoaded(timeout?: number): Promise<void> {
		await waitUntilVisible(this.likeButton, timeout);
	}

	/**
	 * 完了モーダルが「確定後の状態」に落ち着くまで待つ。
	 *
	 * ローディングが消えてフォームが出た時点を「安定した」とみなす。
	 * ここを観測点にすることで、後続のアサーションが確定前の一瞬を見てしまうことがない。
	 */
	async expectCompletionSettled(timeout?: number): Promise<void> {
		await waitUntilVisible(this.completionForm, timeout);
		await waitUntilGone(this.completionLoading, timeout);
	}
}
