import { DEFAULT_TIMEOUT, by, existsNow, tapWhenVisible, waitUntilVisible } from "../fixtures/e2e";

/**
 * 🗳「グループ投票の履歴」一覧画面の Screen Object（e2e-web の pages/MyDishCategoryGroupVotesPage.ts に対応）（#1505）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/dish-category-group-votes.tsx
 *
 * ## 一覧に出るもの
 * **自分が主催した投票だけ**。参加しただけの投票は API 側（where 句）で除かれるため出ない。
 * 全行が主催なので「主催」バッジは無く、行に出るバッジは投票済み／未投票の 1 つだけ。
 *
 * ## 行に testID が無い理由
 * `VoteListItem`（画面側コンポーネント）は `accessibilityRole="link"` /
 * `accessibilityLabel={formattedDate}` しか持たない。同じ `formattedDate` は行内の
 * `<Text>`（itemDate）としても描画されているため、`by.text()` でも一致しうるが、
 * **行の識別・タップ対象としては明示的に付与された `accessibilityLabel` の方を正とする**
 * （`by.label()`）。バッジ（投票済み／未投票）が「どの行に属するか」を見るときは
 * Detox の `withAncestor()` で `by.label(<行の日付>)` を祖先に指定してスコープする
 * （e2e-web の `Locator.getByText()` チェーンに相当）。
 */
export class MyDishCategoryGroupVotesScreen {
	/** ヘッダーのタイトル（ScreenHeader が `${testID}-title` を付与） */
	readonly headerTitle = by.id("me-dish-category-group-votes-header-title");
	/** 0 件時の空表示（既存 testID） */
	readonly emptyState = by.id("me-dish-category-group-votes-empty-state");

	/** 画面が表示されるまで待つ */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.headerTitle, timeout);
	}

	/** 表示日付（accessibilityLabel）で行を特定する */
	item(dateLabel: string): Detox.NativeMatcher {
		return by.label(dateLabel);
	}

	/**
	 * 指定した行が表示されるまで待つ。
	 * @param index 同じ表示日付の行が複数ありうる場合に絞り込む添字（省略時は一意一致を要求する）
	 */
	async expectItemVisible(dateLabel: string, timeout: number = DEFAULT_TIMEOUT, index?: number): Promise<void> {
		await waitUntilVisible(this.item(dateLabel), timeout, index);
	}

	/** 指定した行に「未投票」バッジが出ているかを **待たずに** 判定する */
	async hasNotVotedBadge(dateLabel: string): Promise<boolean> {
		return existsNow(by.text("未投票").withAncestor(this.item(dateLabel)));
	}

	/** 指定した行に「投票済み」バッジが出ているかを **待たずに** 判定する */
	async hasVotedBadge(dateLabel: string): Promise<boolean> {
		return existsNow(by.text("投票済み").withAncestor(this.item(dateLabel)));
	}

	/**
	 * 指定した行をタップして投票結果画面（`[shareToken]` ルート）へ遷移する。
	 * @param index 同じ表示日付の行が複数ありうる場合に絞り込む添字（省略時は一意一致を要求する）
	 */
	async openItem(dateLabel: string, index?: number): Promise<void> {
		await tapWhenVisible(this.item(dateLabel), undefined, index);
	}
}
