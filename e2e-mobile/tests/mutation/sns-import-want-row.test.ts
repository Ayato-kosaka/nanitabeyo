import { strict as assert } from "node:assert";

import {
	by,
	describeMutation,
	element,
	existsNow,
	launchAppWithSession,
	tapWhenVisible,
	waitFor,
	waitUntilVisible,
	type E2ESession,
} from "../../fixtures/e2e";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";
import { createDisposableAuthenticatedSession, revokeDisposableSession } from "../../utils/disposableSession";
import { IMPORT_REEL_URL, fetchMyWantDishes, resolveImport, titleOfWantRow } from "../../utils/snsImport";

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
	let beforeKeys: Set<string>;

	beforeAll(async () => {
		session = await createDisposableAuthenticatedSession();

		// 取り込み画面で «どの候補を押せばよいか» を先に知っておく。
		// 候補の testID は id を含むので、Node 側で resolve して id を取る
		// （UI 側の候補の並びに依存しないため。DB へは 1 行も書かない）
		const resolved = await resolveImport(session.accessToken);
		const pickedRestaurant = resolved.prefill.restaurantId ?? resolved.candidates.restaurants[0]?.restaurantId;
		assert.ok(pickedRestaurant, "resolve が店舗候補を 1 つも返しませんでした（この spec の前提が崩れています）。");
		restaurantId = pickedRestaurant;

		/*
		⚠️ **「使い捨てユーザーだから一覧は空」は誤りだった**（run 32880759041）。
		`createDisposableAuthenticatedSession` が発行するのは «新しいセッション» であって
		«新しいユーザー» ではない。実際にはその時点で 17 件入っていた。

		そこで «件数» では判定しない。取り込みの自然キーは
		（投稿 × 料理）＝（restaurant, category）なので、**まだ取り込んでいない料理カテゴリ**を
		選べば、その 1 行だけが確実に新しく増える。増えた行の料理名を掴んでおき、
		«その名前がアプリの一覧に出るか» を見る。
		*/
		const before = await fetchMyWantDishes(session.accessToken);
		beforeKeys = new Set(before.data.map((row) => row.key));
		const used = new Set(
			before.data.filter((row) => row.restaurant.id === restaurantId).map((row) => row.dish.category_id),
		);
		const candidates = [
			resolved.prefill.dishCategoryId,
			...resolved.candidates.dishCategories.map((c) => c.dishCategoryId),
		].filter((id): id is string => Boolean(id));
		assert.ok(candidates.length > 0, "resolve が料理カテゴリ候補を 1 つも返しませんでした。");
		const unused = candidates.find((id) => !used.has(id));
		assert.ok(
			unused,
			`この店舗（${restaurantId}）へは候補の料理カテゴリを全て取り込み済みで、` +
				" «新しく 1 行増える» 状況を作れませんでした。別の投稿 URL か別の店舗が要ります。",
		);
		dishCategoryId = unused;
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
		// ⚠️ ここで «空であること» を前提にしない（上の beforeAll のコメント参照）。
		//    見たいのは «この後で増える 1 行が、起動し直さずに出るか» だけである。

		// 2. ＋ → 取り込み画面。URL を貼って読み取る
		await tapWhenVisible(myDishes.recordButton);
		await waitUntilVisible(by.id("sns-import-url-input"), 60_000);
		await element(by.id("sns-import-url-input")).replaceText(IMPORT_REEL_URL);
		await tapWhenVisible(by.id("sns-import-resolve-button"), 60_000);

		/*
		3. 店舗と料理カテゴリを選ぶ。

		⚠️ 読み取り後の画面は縦に長く、**② 店舗 / ③ 料理 / 保存ボタンは 1 画面に収まらない**。
		   最初はスクロールせずに押そうとして «保存ボタンが押せない»（= 料理と店舗が未選択のまま）
		   で落ちた（run 32878897475）。候補が見えるところまで送ってから押す。
		⚠️ prefill で既に選ばれていると候補チップは描かれない。«出ていたら押す» にしてある。
		*/
		await scrollUntilVisible(by.id(`sns-import-restaurant-${restaurantId}`));
		await tapIfPresent(by.id(`sns-import-restaurant-${restaurantId}`));
		await scrollUntilVisible(by.id(`sns-import-dish-category-${dishCategoryId}`));
		await tapIfPresent(by.id(`sns-import-dish-category-${dishCategoryId}`));

		// 4. 保存（押せない = 店舗か料理が選べていない、という意味で落ちる）
		await scrollUntilVisible(by.id("sns-import-save-button"));
		await tapWhenVisible(by.id("sns-import-save-button"), 60_000);

		// 5. 起動し直さずに一覧へ戻ってくる
		await waitUntilVisible(by.id("my-dishes-list"), 60_000);

		/*
		6. **増えた 1 行が、起動し直さずに一覧へ出ているか。**

		サーバー側で «増えた行» を特定し、その料理名がアプリの一覧に描かれていることを見る。
		件数では判定しない（この spec のユーザーは既に多数の記録を持っている）。
		*/
		const after = await fetchMyWantDishes(session!.accessToken);
		const added = after.data.filter((row) => !beforeKeys.has(row.key));
		assert.equal(
			added.length,
			1,
			`取り込みで «食べたい» が 1 行だけ増えるはずが ${added.length} 行でした。` +
				` （保存自体が失敗している可能性があります）`,
		);
		const title = titleOfWantRow(added[0]);
		assert.ok(title, `増えた行に料理名がありません。row=${JSON.stringify(added[0])}`);

		// **ここが本題。** アプリを起動し直していないので、キャッシュを捨てていなければ出ない
		await waitUntilVisible(by.text(title), 30_000);

		// 写真が引けていること（無地のプレースホルダーは «メディアが出ない» そのもの）
		const hasPlaceholder = await existsNow(by.id("my-dishes-list-item-placeholder"));
		assert.equal(hasPlaceholder, false, "一覧に無地のプレースホルダーが出ています（= 写真が 1 つも引けていない）。");
	});

	it("増えた行には、メディアと料理名の材料が揃っている", async () => {
		const { data } = await fetchMyWantDishes(session!.accessToken);
		const row = data.find((item) => !beforeKeys.has(item.key));
		assert.ok(row, "増えた行が見つかりませんでした（1 つ目のテストが失敗しているはずです）。");
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

/**
 * 取り込み画面のスクロールで、その要素が見えるところまで送る。
 * **見つからないまま終わっても失敗にしない**（prefill で既に選ばれていて描かれない場合がある）。
 */
async function scrollUntilVisible(matcher: Detox.NativeMatcher): Promise<void> {
	await waitFor(element(matcher))
		.toBeVisible()
		.whileElement(by.id("sns-import-scroll"))
		.scroll(250, "down")
		.catch(() => undefined);
}
