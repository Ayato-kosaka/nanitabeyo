import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { countRequests } from "../../utils/network";
import { clickRapid } from "../../utils/rapid-click";

/**
 * 👆👆 友達投票開始ボタンの連打耐性テスト @mutation（#1205 / 親 #1194）
 *
 * 目的: トピック提案画面の「友達投票開始」ボタンを待機なしで連打しても、
 *       **投票セッションが 2 件作られず、結果画面も 1 枚しか開かない**ことを保証する。
 *
 * ## 何を守っているか（#1205）
 * ボタンのガードは元々 `isCreating`(useState) だけだった。React が再レンダリングをコミットする前に
 * 2 発目の押下が処理されると両方が `isCreating === false` を読んで通過しうるため、
 * `POST v1/dish-category-group-votes` が二重に走る。API は呼び出しごとに新しい `shareToken` を
 * 発行し同一リクエストを冪等化していないので、**別々の投票セッションが 2 件できる**。
 * #1205 で `useCreateDishCategoryGroupVote` の `isCreatingRef` と、dishCategories 画面の
 * `isOpeningGroupVoteRef` による同期ガードを追加した
 *（`search/index.tsx` の `isSearchingRef` / `map/components/ReviewForm.tsx` の `isSubmittingRef` と同じ方式）。
 *
 * ## 観測点（#1084 設計 §3-1 / #1086 の教訓）
 * - **主観測点: POST `v1/dish-category-group-votes` の件数**。ここが 2 になることが事故そのもの
 *   （= 投票セッションが 2 件登録された）。GET の detail 取得が同じパス配下に居るため、
 *   `method: "POST"` で必ず絞ること
 * - 補助: **積み上がった結果画面の枚数**。`router.push` が二重に走ると
 *   「戻ると同じ結果画面が 2 回出る」という事故になる。web では前の画面も DOM に残るため
 *   ヘッダ文言の一致数で数えられる（`window.history.length` の増分は二重 push を検知できない。#1086 で実測）
 *
 * ## 連打の再現方法（#1086 で実測して確定）
 * `page.mouse` は 1 発ごとに CDP のラウンドトリップが挟まり、その隙に React のコミットが
 * 流れてしまうため連打にならない（感度ゼロ）。`utils/rapid-click.ts` の `clickRapid` で
 * **同一 JS タスク内に pointerdown → pointerup → click を N 回 dispatch** する。
 *
 * ## dev DB への影響（重要）
 * このテストは成功パスを 1 回通すので、**dev DB に投票セッションが 1 件積み上がる**（削除導線は無い）。
 * 事故が起きている場合は 2 件以上になる。作成リクエストの中身は検索結果の候補スナップショットで
 * 自由入力欄が無く、`[E2E]` のような目印を混ぜられない（review-double-submit.spec.ts との差分）。
 * 追跡が要る場合は実行時刻とホストの匿名ユーザー id で辿ること。
 * `RUN_MUTATION=1` を明示したときだけ実行される（playwright.config.ts の `grepInvert`）。
 * production は対象外（ビルド時に焼き込まれた `api-development` を叩く）。
 */
test.describe("友達投票開始ボタンの連打耐性 @mutation", () => {
	// AI によるトピック生成に実測 30 秒近くかかるうえ、投票セッションの作成と detail 取得が続くため、
	// dish-categories-flow.spec.ts と同じ理由で既定の 30 秒テストタイムアウトを延長する
	test.setTimeout(120_000);

	/** 何連打するか。review-double-submit.spec.ts と揃える */
	const PRESS_COUNT = 5;

	/** 投票結果画面のヘッダ（ja-JP: DishCategoryGroupVotes.resultTitle）。積み上がった枚数を数える観測点 */
	const RESULT_TITLE = "友達の投票結果";

	// ─ テストケース: 連打しても投票セッションは 1 件・結果画面は 1 枚 ─
	// 手順:
	//   1. appPage（匿名セッション確立済み）で起動し、場所に「渋谷」を入力してサジェスト先頭を選択
	//   2. 検索してトピック提案画面まで進む
	//   3. 計測を開始し、ヘッダーの「友達投票開始」を **5 連打**する
	//      （同一 JS タスク内の合成 pointer 連打。utils/rapid-click.ts 参照）
	//   4. 結果画面が描画されるまで待つ（枚数は問わない。二重 push はこの時点までに DOM へ載っている）
	//   5. POST `v1/dish-category-group-votes` がちょうど 1 回であることを検証（主観測点）
	//   6. 積み上がった結果画面がちょうど 1 枚であることを検証
	//   7. 1 回戻るとトピック画面に着くことを検証（= 結果画面が 2 枚積まれていない）
	//   8. 戻った先で **もう一度連打**し、作成 API が増えない（キャッシュ再利用）まま
	//      結果画面がやはり 1 枚だけ開くことを検証
	//      = 受け入れ条件「結果画面から戻った後、必要な操作が正常に行える」。
	//        ガードの解除は dishCategories.tsx の useFocusEffect が握っており、
	//        解除を消すと 8 で結果画面へ二度と進めなくなって赤くなる
	test("友達投票開始ボタンを連打しても投票セッションは 1 件しか作られない", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		const resultTitles = appPage.getByText(RESULT_TITLE, { exact: true });

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();

		// 計測は「連打の直前」に始める。ここより前の POST（レコメンド等）は対象外。
		// ⚠️ detail 取得（GET）が同じパス配下に居るため method の絞り込みは必須
		const createPosts = await countRequests(appPage, "**/v1/dish-category-group-votes*", { method: "POST" });

		await expect(dishCategoriesPage.groupVoteButton).toBeVisible();
		await clickRapid(dishCategoriesPage.groupVoteButton, PRESS_COUNT);

		// 結果画面の描画（= 作成 API の完了 + detail 取得）まで待ってから数える。
		// 二重 push はこの時点までに必ず DOM へ載っているため、1 枚目だけを見て取りこぼすことはない。
		// ⚠️ `.first()` ではなく `.last()` で待つこと（DishCategoriesPage.expectRenderedAllowingDuplicates と同じ理由）
		await expect(resultTitles.last()).toBeVisible({ timeout: 60_000 });

		expect(createPosts.count(), `${PRESS_COUNT} 連打で投票セッションが二重に作られている`).toBe(1);
		await expect(resultTitles, "連打で投票結果画面が二重に積まれている").toHaveCount(1);

		// ─ 結果画面から戻れること（二重 push なら 1 回の戻りではトピック画面に着かない） ─
		await appPage.goBack();
		await dishCategoriesPage.expectLoaded();
		await expect(resultTitles, "戻ったのに結果画面が残っている").toHaveCount(0);

		// ─ 戻った後も操作でき、かつ再度の連打でも 1 枚だけ開くこと ─
		// 作成済みレスポンスは createdGroupVoteRef にキャッシュされているため、
		// ここでの押下は API を呼ばず **同期的に router.push** する経路を通る（ガードが無いと即 2 枚積まる）
		await clickRapid(dishCategoriesPage.groupVoteButton, PRESS_COUNT);

		await expect(resultTitles.last()).toBeVisible({ timeout: 30_000 });
		expect(createPosts.count(), "戻った後の連打で投票セッションが追加で作られている").toBe(1);
		await expect(resultTitles, "戻った後の連打で結果画面が二重に積まれている").toHaveCount(1);

		await createPosts.stop();
	});
});
