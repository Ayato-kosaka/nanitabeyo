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
 * #1358 詳細モーダルは Portal（react-native-paper）ではなく、**結果画面の子として** 描かれる
 * （app-expo/features/dishCategoryGroupVotes/components/DishCategoryGroupVoteInlineOverlay.tsx）。
 * 観測点（testID）は移行前後で変えていないので、この Screen Object の使い方も変わらない。
 * 意味だけが変わる: **モーダル本体の testID が消えたこと = 詳細レイヤーがアンマウントされたこと**。
 * #1122 の「閉じてから遷移する」はこの観測点で検証する。
 *
 * 対応する e2e-web 側の変更: `e2e-web/tests/search/dish-category-group-vote-navigation.spec.ts`
 * （web も同じ testID / 右上 X の accessibilityLabel を観測点にしている。片方だけ直さないこと）
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

	/**
	 * 結果ヘッダーの「共有リンクをコピー」（#1205）。
	 *
	 * 候補 id を知らなくても「結果画面が開いた」ことを判定できる、**画面 1 枚につき 1 つだけ**の要素。
	 * 連打テストではこの「1 つだけ」という性質そのものを観測点に使う（{@link expectSingleLoaded}）。
	 */
	readonly shareLinkButton = by.id("dish-category-group-vote-copy-share-link");

	/** ヘッダーの戻るボタン（ScreenHeader 共通） */
	readonly backButton = by.id("screen-header-back");

	/** 候補一覧が表示されるまで待つ */
	async expectLoaded(candidateId: string, timeout?: number): Promise<void> {
		await waitUntilVisible(this.candidateCard(candidateId), timeout);
	}

	/**
	 * 結果画面が **ちょうど 1 枚** 開くまで待つ（#1205 の連打テストの観測点）。
	 *
	 * Detox には e2e-web の `toHaveCount(1)` に相当する件数アサーションが無いが、
	 * `atIndex` を付けずに解決したマッチャが複数一致すると Detox 自身が
	 * 「Multiple elements were matched」で失敗する。二重 push が起きていれば
	 * `shareLinkButton` は 2 件一致するため、**添字を渡さないこと自体が枚数の検証**になる。
	 *
	 * @param timeout 待機タイムアウト (ms)。投票セッションの作成 + detail 取得を見込んで長めに渡すこと
	 */
	async expectSingleLoaded(timeout?: number): Promise<void> {
		await waitUntilVisible(this.shareLinkButton, timeout);
	}

	/**
	 * ヘッダーの戻るボタンでトピック画面へ戻る。
	 *
	 * ⚠️ この画面は ScreenHeader に testID を渡していないため、戻るは共通の `screen-header-back` のまま。
	 * 背面のトピック画面は #1404 で `dish-categories-header-back` になったので id は衝突しなくなったが、
	 * この画面自身にも testID を付けるまでは «共通 id を引いている» ことに変わりはない。
	 * react-native-screens のネイティブスタックは背面の画面をビュー階層から外すため実行時は一意に解決する
	 * 想定だが、もし「Multiple elements were matched」で落ちる場合は背面が階層に残っているということなので、
	 * `tapWhenVisible(this.backButton, undefined, <最前面の添字>)` へ切り替えること。
	 */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
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

	/** 詳細モーダルが閉じ切る（詳細レイヤーがアンマウントされる）まで待つ */
	async expectDetailClosed(): Promise<void> {
		await waitUntilGone(this.detailModal);
	}
}
