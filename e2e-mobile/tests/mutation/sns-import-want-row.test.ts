import { strict as assert } from "node:assert";

import {
	by,
	describeMutation,
	element,
	existsNow,
	launchAppWithSession,
	tapWhenVisible,
	waitUntilVisible,
	type E2ESession,
} from "../../fixtures/e2e";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";
import { createDisposableAuthenticatedSession, revokeDisposableSession } from "../../utils/disposableSession";
import { IMPORT_REEL_URL, fetchMyWantDishes, resolveImport } from "../../utils/snsImport";

/**
 * 📥 SNS 取り込み → 「食べたい」→ 一覧に出る、までの通し確認 @mutation（#1375 / 9〜10 巡目）
 *
 * ## なぜこのテストを足したか
 *
 * オーナー実機指摘: **「インスタをインポートして食べたいを押したら、メディアと料理が出ない」**。
 * これを «テスト漏れ» として指摘されている。取り込みの単体テストは app-expo 側にあるが、
 * **取り込んだものが一覧でどう見えるか**は誰も見ていなかった。
 * 「保存できた」は納品条件ではなく「保存したものをユーザーが使えた」が納品条件である
 * （CLAUDE.md「全方位でレビューして」§2）。
 *
 * ## ⚠️ **アプリの中で保存する**こと。API で入れて起動し直しては意味が無い
 *
 * この不具合の本体は «アプリが自分で保存したのに、自分の一覧を取り直さない» ことである。
 * 起動し直すと一覧は必ず取り直されるので、**API で入れてから起動する形では通ってしまう**
 * （最初に書いたテストが実際にそうなっており、これでは «直った» の根拠にならなかった）。
 *
 * したがってこの spec は
 *   1. 一覧を **先に開いて**キャッシュを作る
 *   2. その状態のまま ＋ → 取り込み画面 → 保存
 *   3. **起動し直さずに**一覧へ戻り、取り込んだものが出ていること
 * という順で見る。
 *
 * ## 使い捨てユーザーで実行する
 *
 * 共有のテストユーザーだと «前回の実行で入れた同じ投稿» が既に一覧に居るため、
 * 「増えたかどうか」で判定できない（取り込みはサービス側が冪等）。
 * この spec 専用のユーザーを 1 人発行し、**一覧が空の状態から 1 件になる**ことを見る。
 */
describeMutation("SNS 取り込み → 食べたい → 一覧に出る @mutation", () => {
	const myDishes = new MyDishesScreen();
	const tabBar = new TabBar();
	let session: E2ESession | null = null;
	let restaurantId: string;
	let dishCategoryId: string;

	beforeAll(async () => {
		session = await createDisposableAuthenticatedSession();

		// 取り込み画面で «どの候補を押せばよいか» を先に知っておく。
		// 候補の testID は id を含むので、Node 側で resolve して id を取る
		// （UI 側の候補の並びに依存しないため。DB へは 1 行も書かない）
		const resolved = await resolveImport(session.accessToken);
		const pickedRestaurant = resolved.prefill.restaurantId ?? resolved.candidates.restaurants[0]?.restaurantId;
		const pickedCategory = resolved.prefill.dishCategoryId ?? resolved.candidates.dishCategories[0]?.dishCategoryId;
		assert.ok(pickedRestaurant, "resolve が店舗候補を 1 つも返しませんでした（この spec の前提が崩れています）。");
		assert.ok(pickedCategory, "resolve が料理カテゴリ候補を 1 つも返しませんでした（この spec の前提が崩れています）。");
		restaurantId = pickedRestaurant;
		dishCategoryId = pickedCategory;
	});

	afterAll(async () => {
		if (session) await revokeDisposableSession(session);
	});

	it("一覧を開いたまま取り込んで保存すると、起動し直さずに一覧へ出る", async () => {
		await launchAppWithSession({ as: "authenticated", session: session!, injection: "once" });

		// 1. 一覧を先に開く（ここでキャッシュが作られる。不具合はこの後に起きる）
		await tabBar.gotoMyDishes();
		await myDishes.selectView("list");
		await waitUntilVisible(by.id("my-dishes-list"), 120_000);
		const hadItemsBefore = await existsNow(by.id("my-dishes-list-item"));
		assert.equal(hadItemsBefore, false, "使い捨てユーザーの一覧が空ではありません（前提が崩れています）。");

		// 2. ＋ → 取り込み画面。URL を貼って読み取る
		await tapWhenVisible(myDishes.recordButton);
		await waitUntilVisible(by.id("sns-import-url-input"), 60_000);
		await element(by.id("sns-import-url-input")).replaceText(IMPORT_REEL_URL);
		await tapWhenVisible(by.id("sns-import-resolve-button"), 60_000);

		// 3. 店舗と料理カテゴリを選ぶ。**prefill で既に選ばれていれば候補は描かれない**ので、
		//    «出ていたら押す» にする（出ていない = もう選ばれている）
		await tapIfPresent(by.id(`sns-import-restaurant-${restaurantId}`));
		await tapIfPresent(by.id(`sns-import-dish-category-${dishCategoryId}`));

		// 4. 保存
		await tapWhenVisible(by.id("sns-import-save-button"), 60_000);

		// 5. 起動し直さずに一覧へ戻ってくる。ここに出ていなければ «取り込んだのに出ない»
		await waitUntilVisible(by.id("my-dishes-list"), 60_000);
		await waitUntilVisible(by.id("my-dishes-list-item").withAncestor(by.id("my-dishes-list")), 60_000);

		// 写真が引けていること（無地のプレースホルダーは «メディアが出ない» そのもの）
		const hasPlaceholder = await existsNow(by.id("my-dishes-list-item-placeholder"));
		assert.equal(hasPlaceholder, false, "一覧に無地のプレースホルダーが出ています（= 写真が 1 つも引けていない）。");
		// 取り込み由来であることの印（#1375 9 巡目で足したロゴ）
		await waitUntilVisible(by.id("my-dishes-list-item-provider-badge"), 30_000);
	});

	it("サーバーが返す一覧にも、その行がメディアと料理名の材料つきで載っている", async () => {
		const { data } = await fetchMyWantDishes(session!.accessToken);
		assert.equal(data.length, 1, `«食べたい» が 1 件のはずが ${data.length} 件でした。`);
		const row = data[0];
		assert.ok(row.dishMedia !== null, `dishMedia が null です。row=${JSON.stringify(row)}`);
		const hasName =
			(row.dish.categoryLabels && Object.keys(row.dish.categoryLabels).length > 0) ||
			(row.dish.name ?? "").length > 0;
		assert.ok(hasName, `料理名の材料がありません（categoryLabels も name も空）。row=${JSON.stringify(row)}`);
		assert.ok(
			row.dishMedia?.thumbnailImageUrl || row.dish.categoryImageUrl,
			`サムネイルもカテゴリ画像も無く、一覧が無地になります。row=${JSON.stringify(row)}`,
		);
	});
});

/** 出ていたら押す。**出ていないことは失敗ではない**（prefill で既に選ばれている場合がある） */
async function tapIfPresent(matcher: Detox.NativeMatcher): Promise<void> {
	if (await existsNow(matcher)) await element(matcher).tap();
}
