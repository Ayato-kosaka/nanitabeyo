import { strict as assert } from "node:assert";

import { by, describeMutation, element, existsNow, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";
import { localeDeepLink } from "../../utils/locale";
import { readSessionFromEnv } from "../../utils/sessionEnv";
import { anyRestaurantId, createImport, fetchMyWantDishes, resolveImport } from "../../utils/snsImport";

/**
 * 📥 SNS 取り込み → 「食べたい」→ 一覧に出る、までの通し確認 @mutation（#1375 / 9 巡目）
 *
 * ## なぜこのテストを足したか
 *
 * オーナー実機指摘: **「インスタをインポートして食べたいを押したら、メディアと料理が出ない」**。
 * これを «テスト漏れ» として指摘されている。取り込みの単体テストは app-expo 側にあるが、
 * **取り込んだものが一覧でどう見えるか**は誰も見ていなかった。
 * 「保存できた」は納品条件ではなく、「保存したものをユーザーが使えた」が納品条件である
 * （CLAUDE.md「全方位でレビューして」の §2）。
 *
 * ## 検証の 2 段
 *
 * 1. **サーバーが返す形**（Node 側）… 取り込んだ行が `GET /v1/users/me/dishes?statuses=want` に
 *    現れ、`dishMedia` が null でなく、料理名を出すための材料（`categoryLabels` か `name`）が
 *    あること。ここが欠けていれば **API の問題**である
 * 2. **アプリが描く形**（端末側）… 一覧タブを開いて、その行がプレースホルダー
 *    （`my-dishes-list-item-placeholder`）ではなく画像として描かれていること。
 *    1 が通って 2 が落ちれば **クライアントの問題**である
 *
 * この 2 段にしてあるのは、«出ない» と言われたときに **どちら側かを言い切れる**ようにするため。
 *
 * ## ⚠️ dev DB へ書く
 * 取り込みはサービス側が冪等（同じ投稿 × 同じ料理は既存行を再利用する）なので、
 * 実行のたびに増えるのは «テストユーザーの食べたい» 1 件だけである。
 */
describeMutation("SNS 取り込み → 食べたい → 一覧に出る @mutation", () => {
	const myDishes = new MyDishesScreen();
	const tabBar = new TabBar();
	let accessToken: string;
	let importedDishId: string;

	beforeAll(async () => {
		const session = readSessionFromEnv("authenticated");
		if (!session) throw new Error("認証済みセッションが無いため取り込みを準備できません。");
		accessToken = session.accessToken;

		const resolved = await resolveImport(accessToken);
		// 店舗・料理カテゴリは «ユーザーが選ぶ» ものなので、候補 → prefill → 検索の順に拾う
		const restaurantId =
			resolved.prefill.restaurantId ??
			resolved.candidates.restaurants[0]?.restaurantId ??
			(await anyRestaurantId(accessToken));
		const dishCategoryId = resolved.prefill.dishCategoryId ?? resolved.candidates.dishCategories[0]?.dishCategoryId;

		assert.ok(restaurantId, "取り込み先の店舗が 1 つも決められませんでした（resolve の候補も店名検索も空）。");
		assert.ok(dishCategoryId, "取り込み先の料理カテゴリが決められませんでした（resolve の候補が空）。");

		const created = await createImport(accessToken, { restaurantId, dishCategoryId });
		importedDishId = created.dishId;
	});

	it("取り込んだ行が «食べたい» の一覧に出て、メディアと料理名の材料が揃っている", async () => {
		const { data } = await fetchMyWantDishes(accessToken);
		const row = data.find((item) => item.dish.id === importedDishId);

		assert.ok(
			row,
			`取り込んだ dish（${importedDishId}）が «食べたい» の一覧に 1 件も出ませんでした。` +
				` 返ってきたのは ${data.length} 件です。`,
		);

		// メディア: 取り込んだ dish_media そのものが載っていること
		assert.ok(
			row.dishMedia !== null,
			`取り込んだ行の dishMedia が null です（= 一覧のサムネイルが料理カテゴリ画像へ落ちる）。row=${JSON.stringify(row)}`,
		);

		// 料理名: 取り込みは dishes.name を入れないので、**カテゴリの表記が必須**である
		const hasName =
			(row.dish.categoryLabels && Object.keys(row.dish.categoryLabels).length > 0) ||
			(row.dish.name ?? "").length > 0;
		assert.ok(
			hasName,
			`取り込んだ行に料理名の材料がありません（categoryLabels も name も空）。row=${JSON.stringify(row)}`,
		);

		// サムネイル: null だと «カテゴリ画像» へ落ちる。落ちること自体は仕様だが、
		// **その場合は必ずカテゴリ画像がある**こと（両方無いと灰色のプレースホルダーになる）
		assert.ok(
			row.dishMedia?.thumbnailImageUrl || row.dish.categoryImageUrl,
			`サムネイルもカテゴリ画像も無く、一覧が無地のプレースホルダーになります。row=${JSON.stringify(row)}`,
		);
	});

	it("一覧タブを開くと、その行が画像として描かれている（プレースホルダーではない）", async () => {
		await launchAppWithSession({ as: "authenticated", url: localeDeepLink("my-dishes") });
		await tabBar.gotoMyDishes();
		await myDishes.selectView("list");
		await waitUntilVisible(by.id("my-dishes-list"), 120_000);

		// 先頭が «食べたい» に並ぶとは限らないので、絞り込みで «食べたい» だけにする
		await myDishes.applyStatusFilter("want");

		await waitUntilVisible(by.id("my-dishes-list-item"), 60_000);
		const hasPlaceholder = await existsNow(by.id("my-dishes-list-item-placeholder"));
		assert.equal(
			hasPlaceholder,
			false,
			"一覧に無地のプレースホルダーが出ています（= サムネイルもカテゴリ画像も引けていない）。",
		);
		// 取り込んだ行にだけ付く provider のロゴ（#1375 9 巡目）が出ていること
		await waitUntilVisible(by.id("my-dishes-list-item-provider-badge"), 30_000);
		await element(by.id("my-dishes-list-item")).atIndex(0).tap();
	});
});
