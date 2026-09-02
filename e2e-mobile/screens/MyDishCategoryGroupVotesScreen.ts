import { DEFAULT_TIMEOUT, by, existsNow, tapWhenVisible, waitUntilVisible } from "../fixtures/e2e";

/**
 * 🗳「グループ投票の履歴」一覧画面の Screen Object（e2e-web の pages/MyDishCategoryGroupVotesPage.ts に対応）（#1505）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/dish-category-group-votes.tsx
 *
 * ## 一覧に出るもの
 * **自分が主催した投票だけ**。参加しただけの投票は API 側（where 句）で除かれるため出ない。
 *
 * ## 行の掴み方（#1505 デザイン再設計で変わった）
 * 旧実装は行に testID が無く、`accessibilityLabel`（表示日付）だけが観測点だった。
 * 同じ日付の投票が 2 件あると行を特定できず、`atIndex(0)` に頼るしかなかった。
 *
 * 再設計で行に **全行共通の testID**（`me-dish-category-group-votes-item`）を付けた。
 * session id を含めていないのは、実データで検証するこちら側が id を知らないためである
 * （Detox の matcher には prefix 一致が無い）。行の区別は `atIndex(n)` で行う。
 *
 * ## 状態（投票済み / 未投票）の観測点
 * テキストバッジは廃止した。画面上の表現は「未投票の行にだけ出る控えめなドット」
 * （`me-dish-category-group-votes-item-unvoted`）で、「未投票」という語そのものは
 * 行の accessibilityLabel が持つ。ラベルは «日付・候補名・人数・状態» を 1 文へ畳んだもので、
 * 候補名は実データ依存で事前に組み立てられないため、ここではドットの有無で判定する。
 */
export class MyDishCategoryGroupVotesScreen {
	/** ヘッダーのタイトル（ScreenHeader が `${testID}-title` を付与） */
	readonly headerTitle = by.id("me-dish-category-group-votes-header-title");
	/** 0 件時の空表示（既存 testID） */
	readonly emptyState = by.id("me-dish-category-group-votes-empty-state");
	/** 0 件時の CTA（EmptyState が `${testID}-action` を付与） */
	readonly emptyAction = by.id("me-dish-category-group-votes-empty-state-action");
	/** 一覧の行（全行共通） */
	readonly item = by.id("me-dish-category-group-votes-item");
	/** 行の 1 行目（勝者名 or 候補名の要約） */
	readonly itemTitle = by.id("me-dish-category-group-votes-item-title");
	/** 未投票を示すドット。投票済みの行には存在しない */
	readonly unvotedDot = by.id("me-dish-category-group-votes-item-unvoted");

	/** 画面が表示されるまで待つ */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.headerTitle, timeout);
	}

	/**
	 * 指定した行が表示されるまで待つ。
	 * @param index 上から何番目の行か（一覧は「最後に動きがあった順」で並ぶ）
	 */
	async expectItemVisible(index = 0, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.item, timeout, index);
	}

	/**
	 * 行が «何を投票したのか» を出しているか（1 行目のテキストが描画されているか）。
	 * 中身は実データ依存なので、ここでは «出ていること» だけを見る。
	 */
	async expectItemTitleVisible(index = 0, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.itemTitle, timeout, index);
	}

	/** 未投票のドットが出ているかを **待たずに** 判定する */
	async hasUnvotedDot(index = 0): Promise<boolean> {
		// existsNow(matcher, timeout, index) の第 2 引数は timeout。index は第 3 引数
		return existsNow(this.unvotedDot, undefined, index);
	}

	/**
	 * 指定した行をタップして投票結果画面（`[shareToken]` ルート）へ遷移する。
	 * @param index 上から何番目の行か
	 */
	async openItem(index = 0): Promise<void> {
		await tapWhenVisible(this.item, undefined, index);
	}
}
