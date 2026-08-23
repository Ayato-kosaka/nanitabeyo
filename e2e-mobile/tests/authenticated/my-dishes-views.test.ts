import { strict as assert } from "node:assert";

import { describeAuthenticated, launchAppWithSession, waitUntilExists, waitUntilGone } from "../../fixtures/e2e";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * 🍽 #1403 (PR1) my-dishes の 3 ビュー切替と、共有フィルタがビューをまたいで保たれること
 *（e2e-web の tests/authenticated/my-dishes-views.spec.ts に対応）
 *
 * ## web と何を分担しているか（#1403 の書き分け基準）
 *
 * | 検証したいこと | web | native（ここ） |
 * | --- | --- | --- |
 * | list / Map / Calendar を切り替えられる | ○ | ○ |
 * | 訪問済みビューがアンマウントされない（keep-alive / #1396 M-1） | ○ | ○ |
 * | フィルタ 1 回の適用が **3 ビューの取得クエリと描画**に効く | ○ | ✗ |
 * | フィルタの選択が **ビューをまたいで保たれる**（= store がビュー単位でない） | — | ○ |
 *
 * «棚が 2 件から 1 件へ削れた» を確かめるには「フィルタ前は 2 件」という前提を固定する必要があり、
 * dev DB のテストユーザーの記録は件数も日付も変動する。**Detox にはネットワーク傍受も
 * レスポンス差し替えも無い**（utils/waits.ts 冒頭）ので、件数を要する検証は
 * `route.fulfill` が使える web へ寄せた。ネイティブ側は代わりに、実データが 0 件でも
 * 成立する «ビュー切替» と «選択の保持» を持つ。
 *
 * ## ⚠️ `api-development` の未デプロイに引きずられない
 *
 * 統合ブランチの API は Cloud Run へ未デプロイで、`GET /v1/users/me/dishes` と
 * `.../map-pins` は現在 404 を返す。この spec が見ているのは
 * **共有フィルタとビュー切替というクライアント側の不変条件**だけで、一覧の中身は 1 行も見ない。
 * そのため取得が 404 でも（各ビューは EmptyState / 再試行の口を出す）検証は成立する。
 * デプロイ待ちの `test.skip` を置く必要が無いので置いていない。
 *
 * ## 「今どのビューか」は存在ではなく可視で見る
 *
 * 3 ビューは 1 ルート + `?view=` で切り替わり、一度訪問したビューは
 * `display: "none"` で隠れるだけでアンマウントされない（#1396 M-1）。
 * `waitUntilGone`（= not.toExist）で «切り替わったこと» を見ると、keep-alive された
 * ビューを検出できず **切り替わっていなくても緑になる**。判定は Screen Object の
 * `expectOnlyViewVisible()` に集約してある。
 *
 * ## dev DB への影響
 * 無し（読み取りのみ。記録の作成・更新は一切行わない = `@mutation` ではない）。
 */
describeAuthenticated("my-dishes の 3 ビュー（ログイン済みユーザー）", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態（開いたままのフィルタ画面等）を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため
	// （fixtures/e2e.ts の launchAppWithSession）、テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
	});

	// ─ テストケース: list / Map / Calendar を切り替えられ、訪問済みビューは残る ─
	// 手順:
	//   1. 食べたい/食べたタブへ遷移する（ログイン済みなので 3 ビューの器が出る）
	//   2. 既定ビューが list であることを検証（#1396 M-2。最も安いビューを着地点にする確定事項）
	//      併せて未訪問の Map / Calendar が **まだマウントされていない**ことを検証
	//   3. Map へ切り替え → Map だけが見え、list は隠れているだけ（ツリーに在る）ことを検証
	//   4. Calendar へ切り替え → Calendar だけが見えることを検証
	//   5. list へ戻せることを検証
	it("list / Map / Calendar を切り替えられ、訪問済みビューはアンマウントされない", async () => {
		const tabBar = new TabBar();
		const myDishes = new MyDishesScreen();

		await tabBar.gotoMyDishes();

		// ① 既定は list（#1396 M-2）
		await myDishes.expectOnlyViewVisible("list");
		// 未訪問のビューは «隠れている» のではなく «まだ無い»（遅延マウント）
		await waitUntilGone(myDishes.view("map"));
		await waitUntilGone(myDishes.view("calendar"));

		// ② Map へ。list はアンマウントされず、隠れているだけ（keep-alive / M-1）
		await myDishes.selectView("map");
		await myDishes.expectOnlyViewVisible("map");
		await waitUntilExists(myDishes.view("list"));

		// ③ Calendar へ
		await myDishes.selectView("calendar");
		await myDishes.expectOnlyViewVisible("calendar");
		await waitUntilExists(myDishes.view("map"));

		// ④ list へ戻す
		await myDishes.selectView("list");
		await myDishes.expectOnlyViewVisible("list");
	});

	// ─ テストケース: フィルタの選択がビューをまたいで保たれる ─
	// #1396 【設計】§3-1: フィルタは `useMyDishesFilterStore` **1 つ**が持ち、3 ビューはそれを共有する。
	// ビューごとに状態を持つ実装へ退行すると、切り替えた先で選択が消える（= このテストが赤くなる）。
	// 手順:
	//   1. list ビューでフィルタ画面を開き、状態「食べた」を選んで「適用する」
	//      （チップ押下はドラフト。store を書くのは「適用する」だけ。#1396 §8-5）
	//   2. Map へ切り替え、フィルタ画面を開き直して「食べた」が選択済みのままか読む
	//   3. 「適用する」を押さずに閉じ、Calendar へ切り替えて同じことを確認する
	//      （閉じ方を「適用しない」に固定するのは、2 回目以降の適用で store を書かないため。
	//        書いてしまうと «保持されていた» のか «今書いた» のかを区別できない）
	it("フィルタの選択が 3 ビューをまたいで保たれる", async () => {
		const tabBar = new TabBar();
		const myDishes = new MyDishesScreen();

		await tabBar.gotoMyDishes();
		await myDishes.expectOnlyViewVisible("list");

		// ★ 共有 store を書く唯一の操作
		await myDishes.applyStatusFilter("eaten");
		await myDishes.expectOnlyViewVisible("list");

		// Map ビューから開き直しても選択は残っている
		await myDishes.selectView("map");
		await myDishes.openFilters();
		const selectedFromMap = await myDishes.isFilterStatusSelected("eaten");
		assert.equal(
			selectedFromMap,
			true,
			`Map ビューから開いたフィルタで「食べた」が選択済みでない（実測: ${selectedFromMap}）。` +
				"null の場合は accessibilityState を読めていない（= 判定不能）ことを表す",
		);
		await myDishes.closeFiltersWithoutApplying();

		// Calendar ビューからも同じ
		await myDishes.selectView("calendar");
		await myDishes.openFilters();
		const selectedFromCalendar = await myDishes.isFilterStatusSelected("eaten");
		assert.equal(
			selectedFromCalendar,
			true,
			`Calendar ビューから開いたフィルタで「食べた」が選択済みでない（実測: ${selectedFromCalendar}）`,
		);
		await myDishes.closeFiltersWithoutApplying();
	});
});
