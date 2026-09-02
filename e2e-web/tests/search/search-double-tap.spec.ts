import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { countRequests } from "../../utils/network";

/**
 * 👆👆 検索ボタンの連打耐性テスト(#1084 / 親 #1082)
 *
 * 目的: 検索 FAB を待機なしで連打しても、二重遷移・二重の API 呼び出しが起きないことを保証する。
 *
 * ## 現行実装の前提(#1084 設計 §1)
 * `PrimaryButton` に連打ガードは無い(`disabled` / `loading` を渡したときにしか効かず、
 * 検索 FAB はどちらも渡していない)。ガードは `handleSearch` 側の `isSearchingRef`(useRef)にあり、
 * 代入が同期的に反映されるため同一 JS タスク内の連続呼び出しでもレースしない。
 * ただし **必須項目のバリデーションはガードより手前**にあるため、未充足時はガードが効かない。
 * 未充足時に実害が無いのは、スナックバーが単一インスタンス(SnackbarProvider)だからである。
 *
 * ## 投入の位置づけ
 * 現行実装は既にガードされているため、この 3 本は **緑で入る回帰ガード**であって
 * 修正を駆動する赤いテストではない(#1084 設計 §6)。
 *
 * ## 実 API のコスト
 * P1 のみ `v1/dish-categories/recommendations` を 1 回叩く(「連打しても 1 回」が期待値そのもの)。
 * P2 は 0 回。dev DB へ書き込まないため `@mutation` は付けない(Tier 2)。
 */
test.describe("検索ボタンの連打耐性", () => {
	// AI によるトピック生成に実測 30 秒近くかかるため、dish-categories-flow.spec.ts と同じ理由で 90 秒へ延長する
	test.setTimeout(90_000);

	// ─ テストケース: 場所未確定のまま連打しても API を呼ばず遷移しない ─
	// 手順:
	//   1. appPage で起動し、自動取得された現在地が入っている場合に備えて明示的にクリアする
	//   2. レコメンド API の呼び出しを計測開始する(素通しのまま数えるだけ)
	//   3. 検索ボタンを 5 連打する(同一 JS タスク内の合成 pointer 連打。SearchPage.clickRapid 参照)
	//   4. スナックバーが出て、トピック画面へ遷移していないことを検証
	//   5. レコメンド API が 1 回も呼ばれていないことを検証
	//      = router.push がバリデーションより手前へ移動する回帰を止める
	test("場所が未確定のまま検索ボタンを連打しても API を呼ばず遷移しない", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);

		if (await searchPage.locationClearButton.isVisible()) {
			await searchPage.locationClearButton.click();
		}

		const recommendations = await countRequests(appPage, "**/v1/dish-categories/recommendations*");

		await searchPage.submitRapid(5);

		await expect(searchPage.snackbar).toBeVisible();
		await expect(appPage).not.toHaveURL(/\/search\/dishCategories/);
		await searchPage.expectLoaded();
		expect(recommendations.count(), "未充足のまま連打してレコメンド API が呼ばれている").toBe(0);

		await recommendations.stop();
	});

	// ─ テストケース: 必須項目を満たした状態で連打しても検索は 1 回だけ実行される ─
	// 手順:
	//   1. appPage で起動し、場所に「渋谷」を入力してサジェスト先頭を選択(location 確定)
	//      (時間帯・シーンには初期値があるため追加選択は不要)
	//   2. 連打前の履歴段数を控え、レコメンド API の計測を開始する
	//   3. 検索ボタンを 5 連打する(同一 JS タスク内の合成 pointer 連打。SearchPage.clickRapid 参照)
	//   4. トピック画面のカードが描画されるまで待つ(枚数は問わない)
	//   5. **積み上がったトピック画面がちょうど 1 枚**であることを検証(主観測点 = 二重 push の検知)
	//   6. レコメンド API の呼び出しが 1 回であることを検証
	//   7. 1 回戻ると検索画面に着くことを検証
	//      = 「戻ると同じトピック画面が 2 回出る」という事故そのものを直接見る
	//
	// ⚠️ #1086 感度について
	//   このテストは `handleSearch` の多重検索防止ガード(`if (isSearchingRef.current) return;`)を
	//   外すと赤くなることを **実測で確認済み**(ガードを外して再ビルド → 5 連打で
	//   トピック画面 5 枚 / レコメンド API 5 回)。以下の 2 点はそのための必須要件なので、
	//   触るときは必ず「ガードを外すと赤くなるか」を再確認すること:
	//   - 連打は `page.mouse` ではなく同一 JS タスク内の dispatch であること(SearchPage.clickRapid)
	//   - 二重 push の観測点が **画面の枚数**であること(履歴段数では検知できない。下記参照)
	test("必須項目を満たした状態で検索ボタンを連打しても検索は 1 回だけ実行される", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);

		const historyBefore = await searchPage.historyLength();
		const recommendations = await countRequests(appPage, "**/v1/dish-categories/recommendations*");

		await searchPage.submitRapid(5);

		// カードの描画(= レコメンド API の完了)まで待ってから枚数を数える。
		// 二重 push はこの時点までに必ず DOM へ載っているため、1 枚目だけを見て取りこぼすことはない
		await dishCategoriesPage.expectRenderedAllowingDuplicates();

		await expect(dishCategoriesPage.stackedScreens(), "連打でトピック画面が二重に積まれている").toHaveCount(1);
		expect(recommendations.count(), "連打でレコメンド API が二重に呼ばれている").toBe(1);

		// ⚠️ 履歴段数は **二重 push を検知できない**(#1086 で実測。トピック画面が 5 枚積まっても増分は 1)。
		//    残してあるのは「連打で余計な履歴が積まれないこと」を補助的に見るためで、
		//    このアサートだけでは事故を捕まえられない
		expect((await searchPage.historyLength()) - historyBefore, "連打で履歴が二重に積まれている").toBe(1);

		await recommendations.stop();

		await appPage.goBack();
		await searchPage.expectLoaded();
	});
});
