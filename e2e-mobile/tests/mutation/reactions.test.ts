import { strict as assert } from "node:assert";

import { describeMutation, launchAppWithSession } from "../../fixtures/e2e";
import { ResultScreen } from "../../screens/ResultScreen";
import { SearchScreen } from "../../screens/SearchScreen";
import { DishCategoriesScreen } from "../../screens/DishCategoriesScreen";

/**
 * ❤️ いいね・保存リアクションのテスト @mutation（e2e-web の tests/authenticated/reactions.spec.ts に対応）
 *
 * ## この spec が dev DB に書き込むもの / 戻せるか
 * | 操作           | API                                        | 戻せるか |
 * | -------------- | ------------------------------------------ | -------- |
 * | いいね         | POST/DELETE `v1/dish-media/{id}/reaction`   | ✅ 末尾で解除して元の状態へ戻す |
 * | 保存           | POST/DELETE `v1/dish-media/{id}/reaction`   | ✅ 同上 |
 *
 * ⚠️ **これは保証されたロールバックではない**。テスト途中のアサーションが失敗すると
 * その時点で例外が投げられ、以降の解除処理は実行されない（try/finally は意図的に置いていない。
 * このテストの目的はロールバック機構の検証ではなく機能検証であり、後始末で本来の失敗が
 * 隠れるほうが有害なため）。**失敗時はいいね/保存が dev DB に残る（不可逆）ことを許容する**。
 * 操作は必ずテスト専用ユーザーで行うこと。
 *
 * ## 実行条件
 * `RUN_MUTATION=1` のときだけ実行される。二重ガード（#1030 レビュー M-3）:
 * 1. jest.config.js の `testPathIgnorePatterns` が `tests/mutation/` を探索から外す
 * 2. `describeMutation` がコード段でも skip する
 * さらに TEST_USER_* が無ければ `launchAppWithSession({ as: "authenticated" })` が fail-loud する。
 *
 * ## 状態の検証方法（#1031 確定判断 B1 の回避策）
 * いいね済みかどうかは `aria-selected` と SVG の塗り色でしか表現されておらず、Detox には
 * `accessibilityState` を検証する API が無い。app-expo 側が状態別の accessibilityLabel を
 * 付けているため、`getAttributes()` でラベルを読んで状態を観測する（ResultScreen 参照）。
 * ラベルには店名が差し込まれ、店名は AI が選ぶため事前に確定できないので、
 * **文字列の一致ではなく「タップ前後で変化したこと」「戻したら元に戻ったこと」**を検証する。
 */
describeMutation("リアクション @mutation", () => {
	const search = new SearchScreen();
	const dishCategories = new DishCategoriesScreen();
	const result = new ResultScreen();

	// #1031 【バグ】beforeAll だと前のテストが残した画面状態（開いたままのモーダル等）を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。ログイン済みセッションの注入は匿名クォータを消費しないため、
	// テストごとに「起動 → 検索 → トピック選択 → 結果フィード」までやり直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
		await search.expectLoaded();

		// 場所だけを確定させる（時間帯 lunch / 同行者 solo には初期値があるため追加選択は不要）
		await search.clearLocationIfPresent();
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(0);
		await search.submit();

		await dishCategories.expectLoaded();
		await dishCategories.chooseFirstDishCategory();
		await result.expectLoaded();
	});

	// ─ テストケース: いいね → 解除で元の状態へ戻る ─
	// 手順:
	//   1. 表示中カードのいいねボタンの現在ラベルを控える（= 現在の状態）
	//   2. タップしてラベルが変化することを検証（POST v1/dish-media/{id}/reaction）
	//   3. もう一度タップしてラベルが元に戻ることを検証（DELETE。dev DB を元の状態へ戻す）
	//   ※ 手順 2 が失敗した場合、手順 3 は実行されず「いいね」が dev DB に残る（冒頭コメント参照）
	it("いいね → 解除で元の状態へ戻る @mutation", async () => {
		const before = await result.likeLabel();

		await result.like();
		const afterLike = await result.waitForLikeLabelChange(before);
		assert.notEqual(afterLike, before, "いいね後は accessibilityLabel が変化するはず");

		await result.like();
		const afterUndo = await result.waitForLikeLabelChange(afterLike);
		assert.equal(afterUndo, before, "解除後は元の accessibilityLabel に戻るはず");
	});

	// ─ テストケース: 保存 → 解除で元の状態へ戻る ─
	// 手順: いいねと同じ（保存ボタン dish-action-save に対して実施）
	//   マイページの保存済みタブへの反映確認は非同期反映のタイミング差でフレークしやすいため、
	//   e2e-web と同じくボタンの状態変化を主検証とする
	it("保存 → 解除で元の状態へ戻る @mutation", async () => {
		const before = await result.saveLabel();

		await result.save();
		const afterSave = await result.waitForSaveLabelChange(before);
		assert.notEqual(afterSave, before, "保存後は accessibilityLabel が変化するはず");

		await result.save();
		const afterUndo = await result.waitForSaveLabelChange(afterSave);
		assert.equal(afterUndo, before, "解除後は元の accessibilityLabel に戻るはず");
	});
});
