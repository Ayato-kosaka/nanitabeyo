import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";

/**
 * 📐 候補カルーセルの横余白撤去(#1212)の回帰テスト(実 API)
 *
 * 背景: `useDishCategoryCardSize()` は既定で左右16pxずつ(計32px)の余白を残した
 * `contentWidth - 32` を返す。dishCategories.tsx の候補カルーセルだけは `fullBleed: true` を渡し、
 * 余白ゼロ(=中央カラム幅そのまま)の値を使うよう変更した(app-expo/features/dishCategories/hooks/useDishCategoryCardSize.ts)。
 *
 * Carousel(react-native-reanimated-carousel)は `style.width` を「カード幅」
 * 「スナップ間隔(size)」「クリップする外側コンテナ幅」の3箇所すべてに使うため、
 * 値が1つずれるとスワイプ後にアクティブカードが画面中央からずれて止まる恐れがある。
 * 見た目の印象ではなく、カード幅とスワイプ後の位置を数値で固定する。
 *
 * 観測点: `dish-categories-tutorial-target-swipe`(app-expo/features/dishCategories/components/DishCategoryCard.tsx)。
 * `tutorialTargetRefs` は dishCategories.tsx が isActiveCard のときにしか渡さないため、
 * この testID は**アクティブなカード1枚にだけ**存在する(前後の事前描画カードには付かない)。
 */
test.describe("候補カルーセルのカード幅とスナップ位置(#1212)", () => {
	// トピック生成に時間がかかる(実測30秒近くかかることがある)ため、dish-categories-flow.spec.ts と同じ理由で延長する。
	test.setTimeout(90_000);

	async function gotoDishCategories(searchPage: SearchPage, dishCategoriesPage: DishCategoriesPage): Promise<void> {
		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();
	}

	// ─ テストケース: カード幅が中央カラム幅(画面幅)と一致し、左右の余白が無い ─
	// 手順:
	//   1. 検索を実行しトピック画面へ到達する
	//   2. アクティブなカードの実測幅を取る
	//   3. ブラウザの `min(window.innerWidth, CONTENT_MAX_WIDTH)`(useContentWidth と同じ式)と比較する
	test("カード幅は中央カラム幅と一致し、左右の余白が無い", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		await gotoDishCategories(searchPage, dishCategoriesPage);

		const activeSwipeArea = appPage.getByTestId("dish-categories-tutorial-target-swipe");
		const box = await activeSwipeArea.boundingBox();
		if (!box) throw new Error("アクティブなカードの swipe area が見つかりません");

		// CenteredAppShell が課す中央カラム幅(CONTENT_MAX_WIDTH=560)を、
		// app-expo/hooks/useContentWidth.ts と同じ式でブラウザ側から実測する。
		const expectedContentWidth = await appPage.evaluate(() => Math.min(window.innerWidth, 560));

		expect(Math.abs(box.width - expectedContentWidth)).toBeLessThanOrEqual(2);
	});

	// ─ テストケース: スワイプしてもアクティブカードは画面中央のスナップ位置で止まる ─
	// 手順:
	//   1. トピック画面でアクティブなカードの矩形とタイトル画像(alt)を記録する
	//   2. カード上をドラッグして隣のカードへスワイプする
	//   3. スナップ完了後、新しくアクティブになったカードの矩形が元の矩形とズレていないことを検証する
	//   4. 近くにもう1枚以上プリロードされている場合のみ「実際に別のカードへ移った」ことも確認する
	//      (実 API のためトピック数は毎回変わりうる。1件しか無ければスワイプしても同じカードのまま
	//      なのは正しい挙動なので、その場合はタイトル比較をスキップする)
	test("スワイプ後もカードは画面中央のスナップ位置で止まる(横位置がズレない)", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		await gotoDishCategories(searchPage, dishCategoriesPage);

		const activeSwipeArea = appPage.getByTestId("dish-categories-tutorial-target-swipe");
		const beforeBox = await activeSwipeArea.boundingBox();
		if (!beforeBox) throw new Error("アクティブなカードの swipe area が見つかりません");
		const beforeAlt = await activeSwipeArea.locator("img").first().getAttribute("alt");

		// 事前描画で近くにマウントされているカード枚数の目安(#1027 の観測どおり複数一致しうる)。
		// 2枚以上あれば、スワイプで確実に別カードへ移れる。
		const mountedCardCount = await appPage.getByTestId("dish-categories-choose-button").count();

		// カード中央からやや右寄りを掴み、左へドラッグして「次のカード」へスワイプする
		// (distance-slider.spec.ts と同じ mouse down/move/up パターン)。
		await appPage.mouse.move(beforeBox.x + beforeBox.width * 0.85, beforeBox.y + beforeBox.height / 2);
		await appPage.mouse.down();
		await appPage.mouse.move(beforeBox.x + beforeBox.width * 0.15, beforeBox.y + beforeBox.height / 2, {
			steps: 10,
		});
		await appPage.mouse.up();

		// reanimated のスナップアニメーション完了を待つ
		await expect(activeSwipeArea).toBeVisible();
		await appPage.waitForTimeout(600);

		const afterBox = await activeSwipeArea.boundingBox();
		if (!afterBox) throw new Error("スワイプ後のアクティブなカードの swipe area が見つかりません");

		// #1212 の本題: 横位置(x)・幅(width)のどちらも変わっていないこと。
		// カード幅・スナップ間隔・クリップ幅の3値が1つでもズレていると、ここで中心からズレて止まる。
		expect(Math.abs(afterBox.x - beforeBox.x)).toBeLessThanOrEqual(2);
		expect(Math.abs(afterBox.width - beforeBox.width)).toBeLessThanOrEqual(2);

		if (mountedCardCount >= 2) {
			const afterAlt = await activeSwipeArea.locator("img").first().getAttribute("alt");
			expect(afterAlt).not.toBe(beforeAlt);
		}
	});
});
