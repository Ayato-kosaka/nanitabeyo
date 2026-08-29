/*
#1629【35/40】オーナー実機報告（3 巡連続）:

> 投稿を削除したら **次の投稿** が無限ローディングになった

## 何を撮るか

**グリッドから開いたフィード（`scope=list` ＝ 1 ページに 1 レコード）で、その 1 件を削除する。**
実ログ（BigQuery / 2026-08-29）で、オーナーが踏んでいたのがこの経路だと確定している
（`GET /v1/dish-media?ids=` が毎回 1 件だけだった）。

修正前: 墓標を含んだ `feedIds` で «中身がある» と判断してしまい、
        `DishMediaFeed` は墓標を除いて `null` を返すので **何も出ないまま固まる**
修正後: 墓標を引いた `liveFeedCount` で数えるので **0 件表示（見つかりません）へ落ちる**

⚠️ **認証・API はモック。** 映っているのは «画面の挙動» であって実データではない。
   性能（40 秒問題）の証拠にはならない — あちらは実 API を叩く Detox で別に撮る。

⚠️ このシナリオは «固まらないこと» を撮るためのものなので、**削除後に何が出るかを
   必ずスクリーンショットに残す**。「押せた」ところで止めない。
*/
import { record, ok, solidCard, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const NAME = process.env.EVIDENCE_NAME || "delete-last-1629";
const IMG = `data:image/svg+xml;base64,${Buffer.from(solidCard("F05537")).toString("base64")}`;

// ⚠️ UUID 形式でないと ids フィルタで落ちる（delete-flow-1513.mjs の教訓）
const MEDIA_ID = "22222222-2222-2222-2222-000000000001";
const REVIEW_ID = "22222222-2222-2222-2222-000000000002";
const ITEM_KEY = `review:${REVIEW_ID}`;
const USER_ID = "22222222-2222-2222-2222-111111111111";

const restaurant = {
	id: "restaurant-1",
	name: "エビデンス食堂",
	image_url: IMG,
	imageUrls: { sm: IMG, md: IMG },
	latitude: 35.0,
	longitude: 139.0,
};

/** isMine: true でないと «…» メニュー自体が描画されない（ActionButtons.tsx） */
const entry = {
	restaurant,
	dish: {
		id: "dish-1",
		name: "唐揚げ定食",
		restaurant_id: "restaurant-1",
		category_id: null,
		reviewCount: 1,
		averageRating: 4,
		categoryImageUrl: IMG,
		categoryLabels: null,
	},
	dish_media: {
		id: MEDIA_ID,
		dish_id: "dish-1",
		user_id: USER_ID,
		media_path: "x",
		media_type: "image",
		thumbnail_path: "x",
		created_at: "2026-08-20T00:00:00.000Z",
		deleted_at: null,
		isMine: true,
		isSaved: false,
		isLiked: false,
		likeCount: 0,
		mediaUrl: IMG,
		thumbnailImageUrl: IMG,
	},
	dish_reviews: [
		{
			id: REVIEW_ID,
			dish_id: "dish-1",
			user_id: USER_ID,
			created_dish_media_id: MEDIA_ID,
			comment: "自分で書いたレビュー",
			rating: 4,
			lock_no: 1,
			price_cents: 1200,
			currency_code: "JPY",
			created_at: "2026-08-20T00:00:00.000Z",
			updated_at: "2026-08-20T00:00:00.000Z",
			deleted_at: null,
			isMine: true,
			isLiked: false,
			likeCount: 0,
			username: "テス太",
			userAvatarUrls: { sm: IMG, md: IMG, lg: IMG },
		},
	],
};

const notes = [];

const mock = (url) => {
	// グリッドの行（item スコープには行が要らないが、タブ側が引くので空で返す）
	if (url.includes("/v1/users/me/dishes")) return { body: ok({ data: [], nextCursor: null }) };
	// フィード本体。`{ items, notFound }` の封筒（delete-flow-1513.mjs の教訓）
	if (url.includes("/v1/dish-media") && url.includes("ids="))
		return { body: ok({ items: [entry], notFound: [] }) };
	// 削除は成功させる。**押し切った先を撮るのが目的**
	if (url.includes(`/v1/dish-media/${MEDIA_ID}`))
		return { body: ok({ deletedDishMediaId: MEDIA_ID, deletedDishReviewIds: [REVIEW_ID] }) };
	return null;
};

await record({
	name: NAME,
	langs: ["ja"],
	mock,
	flow: async (page, shot) => {
		await page.addInitScript(() => {
			for (const k of [
				"search_tutorial_seen_v1",
				"topics_spotlight_tutorial_seen_v1",
				"my_dishes_spotlight_tutorial_seen_v1",
			]) {
				try { window.localStorage.setItem(k, "true"); } catch {}
			}
		});

		// グリッド由来のフィード = scope=list（1 ページ 1 レコード）
		const url =
			`${BASE}/ja-JP/my-dishes/feed?scope=list` +
			`&itemKey=${encodeURIComponent(ITEM_KEY)}&dishMediaId=${MEDIA_ID}`;
		await page.goto(url, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(6000);
		await shot("01-feed-opened");

		const more = page.getByTestId("dish-action-more").first();
		if (!(await more.count())) {
			notes.push("⚠️ dish-action-more が出ない。フィードへ到達できていないので、以降は撮れていない");
			await shot("01b-not-reached");
			writeNote(NAME, notes);
			return;
		}
		notes.push("1. 自分の投稿なので «…» メニューが出ている");

		await more.click();
		await page.waitForTimeout(1500);
		await shot("02-menu-open");

		const del = page.getByText("削除", { exact: false }).first();
		if (!(await del.count())) {
			notes.push("⚠️ «削除» の行が見つからない");
			writeNote(NAME, notes);
			return;
		}
		await del.click();
		await page.waitForTimeout(1200);
		await shot("03-confirm");

		// 確認ダイアログの «削除する» を押し切る
		const confirm = page.getByText("削除", { exact: false });
		const n = await confirm.count();
		await confirm.nth(n - 1).click();
		await page.waitForTimeout(4000);
		await shot("04-after-delete");

		/*
		ここが本題。**修正前は «何も出ないまま» だった。**
		修正後は 0 件表示（`my-dishes-feed-empty`）へ落ちる。
		*/
		const empty = page.getByTestId("my-dishes-feed-empty");
		const emptyShown = (await empty.count()) > 0;
		notes.push(
			emptyShown
				? "2. ✅ 削除後、**0 件表示へ落ちた**（固まっていない）"
				: "2. ❌ 削除後、0 件表示が出ていない。**固まっている可能性がある**",
		);

		// ⚠️ «何も出ない» ときに、どの分岐に落ちているのかを DOM から直接読む。
		// testID の有無だけだと「empty が出ない」までしか分からず、原因へ辿れない
		const ids = await page.evaluate(() =>
			Array.from(document.querySelectorAll("[data-testid]")).map((el) => el.getAttribute("data-testid")),
		);
		notes.push(`   出ている testID: ${JSON.stringify(ids.filter((v) => v && v.includes("feed")))}`);

		// 画面の実際の文字も残す（testID だけだと «何が見えているか» が分からない）
		const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 200);
		notes.push(`3. 削除後に画面へ出ている文字: ${JSON.stringify(bodyText)}`);

		await page.waitForTimeout(3000);
		await shot("05-settled");
		writeNote(NAME, notes);
	},
});

console.log(`done -> ${OUT}`);
