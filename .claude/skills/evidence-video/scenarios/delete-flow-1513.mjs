/*
#1513 UGC-01 «自分の投稿を削除する» フロー本体のエビデンス。

`tombstone-1513.mjs` は **削除された後の一覧（墓標）** を撮る。
こちらは **削除する操作そのもの** を撮る。オーナー指摘「削除フローのエビデンスがない」への対応。

撮る面（受け入れ条件の本体）:
  1. 自分の投稿に «…» メニューが出る（他人の投稿には出ない）
  2. メニューに «編集» と «削除» が並び、«写真は変更できません» が明示される
  3. 削除は確認ダイアログを挟み、**元に戻せないこと**が文言で伝わる
  4. 実際に削除すると «削除しました» が出る

**最後まで押し切る。** DELETE はモックが 200 を返すので実データは消えない。

⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。
*/
import { record, ok, solidCard, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const IMG = `data:image/svg+xml;base64,${Buffer.from(solidCard("F05537")).toString("base64")}`;

const MEDIA_ID = "media-mine-1";

const restaurant = {
	id: "restaurant-1",
	name: "エビデンス食堂",
	image_url: IMG,
	latitude: 35.0,
	longitude: 139.0,
};

/** isMine: true でないと «…» メニュー自体が描画されない（ActionButtons.tsx） */
const entry = {
	restaurant,
	dish: {
		id: "dish-1",
		name: "自分の投稿",
		restaurant_id: "restaurant-1",
		category_id: null,
		reviewCount: 1,
		averageRating: 4,
		categoryImageUrl: IMG,
	},
	dish_media: {
		id: MEDIA_ID,
		dish_id: "dish-1",
		user_id: "11111111-1111-1111-1111-111111111111",
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
			id: "review-1",
			dish_id: "dish-1",
			user_id: "11111111-1111-1111-1111-111111111111",
			comment: "自分で書いたレビュー",
			rating: 4,
			created_at: "2026-08-20T00:00:00.000Z",
			username: "テス太",
			userAvatarUrls: { sm: IMG, md: IMG, lg: IMG },
		},
	],
};

const mock = (url) => {
	/*
	⚠️ posts 画面（`?ids=`）が期待する封筒は **`{ items, notFound }`** である
	（app/[locale]/(tabs)/posts.tsx が `res.items` を読む）。
	`{ data, nextCursor }` を返すとフィードが 1 件も描画されず、
	`dish-action-more` が現れないまま撮影が落ちる（run 32823007640 で実測）。
	*/
	if (url.includes("/v1/dish-media") && url.includes("ids="))
		return { body: ok({ items: [entry], notFound: [] }) };
	// DELETE は成功させる（押し切った先の «削除しました» まで撮るため）
	if (url.includes(`/v1/dish-media/${MEDIA_ID}`)) {
		return { body: ok({ deletedDishMediaId: MEDIA_ID, deletedDishReviewIds: ["review-1"] }) };
	}
	return null;
};

async function shootScheme(scheme) {
	return record({
		name: `delete1513-${scheme}`,
		mock,
		contextOptions: { colorScheme: scheme },
		flow: async (page, shot) => {
			await page.addInitScript((s) => {
				try { window.localStorage.setItem("theme_preference_v1", s); } catch {}
				for (const k of [
					"search_tutorial_seen_v1",
					"topics_spotlight_tutorial_seen_v1",
					"my_dishes_spotlight_tutorial_seen_v1",
				]) {
					try { window.localStorage.setItem(k, "true"); } catch {}
				}
			}, scheme);

			await page.goto(`${BASE}/ja-JP/posts?ids=${MEDIA_ID}`, { waitUntil: "domcontentloaded" });
			await page.waitForTimeout(4000);
			await shot("01-feed");

			// 1) 自分の投稿にだけ出る «…» ボタン
			const more = page.getByTestId("dish-action-more").first();
			await more.waitFor({ state: "visible", timeout: 15000 });
			await shot("02-more-button");

			// 2) メニュー（編集 / 削除 / 写真は変更できません）
			await more.click();
			const menu = page.getByTestId("own-post-menu");
			await menu.waitFor({ state: "visible", timeout: 10000 });
			await page.waitForTimeout(500);
			await shot("03-menu");

			// 3) 削除の確認ダイアログ。**元に戻せない**ことが文言で伝わる面
			await page.getByTestId("own-post-delete-button").click();
			const confirm = page.getByTestId("dialog-confirm-button");
			await confirm.waitFor({ state: "visible", timeout: 10000 });
			await page.waitForTimeout(500);
			await shot("04-delete-confirm");

			// 4) 押し切る。モックが 200 を返すので «削除しました» まで到達する
			await confirm.click();
			await page.waitForTimeout(2500);
			await shot("05-deleted");
		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("delete1513", [
	"# #1513 UGC-01 投稿を削除するフロー",
	"",
	"- 01-feed … 自分の投稿を開いた状態",
	"- 02-more-button … 自分の投稿にだけ出る «…» ボタン",
	"- 03-menu … 編集 / 削除 と «写真は変更できません» の明示（**本命**）",
	"- 04-delete-confirm … 削除の確認。«元に戻せません» が文言で伝わる（**本命**）",
	"- 05-deleted … 押し切った後。«削除しました» が出る",
	"",
	"⚠️ 削除後の一覧側（墓標）は tombstone-1513.mjs が撮る。こちらは操作そのもの。",
	"",
	"⚠️ 認証・API・地図はモック。DELETE もモックが 200 を返すだけで実データは消えていない。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
