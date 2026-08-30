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

/*
⚠️ **UUID の形でないと投稿が 1 件も出ない。**

`posts.tsx` は #1477 の対策として `?ids=` を UUID 形式でフィルタし、
1 件も残らなければ API を呼ばずに «見つかりません» を出す。
`"media-mine-1"` のような読みやすい ID を置くと、モックまで到達せず
`dish-action-more` が現れないまま撮影が落ちる（run 32836956437 で実測）。
*/
const MEDIA_ID = "11111111-1111-1111-1111-000000000001";
const REVIEW_ID = "11111111-1111-1111-1111-000000000002";

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
	/*
	⚠️ 編集の導線（«編集» 行）は `myReview` が引けたときにだけ描画される
	（OwnPostActions.tsx）。`myReview` の条件は **`isMine === true`** かつ
	**`created_dish_media_id === この dish_media の id`** の 2 つである。
	どちらか一方でも欠けると «削除» だけのメニューが撮れてしまい、
	同じ面に出る «編集できるのはコメント・評価・価格です» と食い違う
	（run 32825872502 で実測。`isMine` と `created_dish_media_id` が無かった）。

	`lock_no` / `price_cents` / `currency_code` は編集フォームの初期値に要る。
	欠けると価格欄が空のまま撮れて「価格は編集できない」と読める。
	*/
	dish_reviews: [
		{
			id: REVIEW_ID,
			dish_id: "dish-1",
			user_id: "11111111-1111-1111-1111-111111111111",
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

const mock = (url) => {
	/*
	⚠️ posts 画面（`?ids=`）が期待する封筒は **`{ items, notFound }`** である
	（app/[locale]/(tabs)/posts.tsx が `res.items` を読む）。
	`{ data, nextCursor }` を返すとフィードが 1 件も描画されず、
	`dish-action-more` が現れないまま撮影が落ちる（run 32823007640 で実測）。
	*/
	if (url.includes("/v1/dish-media") && url.includes("ids="))
		return { body: ok({ items: [entry], notFound: [] }) };
	// 編集の保存（PATCH）。サーバーが返す «更新後の行» を模す。
	// lock_no を 1 進めておかないと、実装が «次の編集で 409» を踏む形になる
	if (url.includes(`/v1/dish-reviews/${REVIEW_ID}`)) {
		// `UpdateDishReviewResponse` は行そのもの（SupabaseDishReviews）なので、
		// 部分オブジェクトではなく更新後の行を丸ごと返す
		return {
			body: ok({
				...entry.dish_reviews[0],
				comment: "編集したレビュー",
				rating: 5,
				price_cents: 1500,
				lock_no: 2,
				updated_at: "2026-08-25T00:00:00.000Z",
			}),
		};
	}
	// DELETE は成功させる（押し切った先の «削除しました» まで撮るため）
	if (url.includes(`/v1/dish-media/${MEDIA_ID}`)) {
		return { body: ok({ deletedDishMediaId: MEDIA_ID, deletedDishReviewIds: [REVIEW_ID] }) };
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
			try {
				await more.waitFor({ state: "visible", timeout: 15000 });
			} catch (cause) {
				// «…» が出ない理由はたいてい «投稿がそもそも描画されていない» である。
				// 素の Timeout だけだと毎回 01-feed を目視するはめになるので、
				// 先に «見つかりません» かどうかを判定してメッセージに書く
				const bodyText = await page.locator("body").innerText().catch(() => "");
				const notFound = /見つかりません|Not found/i.test(bodyText);
				throw new Error(
					notFound
						? `投稿が描画されていない（«見つかりません» が出ている）。posts.tsx は ?ids= を UUID 形式で` +
							` フィルタする（#1477）ので、MEDIA_ID=${MEDIA_ID} が UUID かどうかをまず疑うこと`
						: `dish-action-more が出ない。01-feed を見て何が描画されているか確かめること: ${cause}`,
				);
			}
			await shot("02-more-button");

			// 2) メニュー（編集 / 削除 / 写真は変更できません）
			await more.click();
			const menu = page.getByTestId("own-post-menu");
			await menu.waitFor({ state: "visible", timeout: 10000 });

			/*
			撮る前に «編集» が居ることを確かめる。ここが無いと、モックの不備で
			«削除» だけのメニューが撮れても撮影は成功扱いになり、
			「編集導線がある」という受け入れ条件の嘘のエビデンスが納品される
			（run 32825872502 で実際に起きた）。
			*/
			await page.getByTestId("own-post-edit-button").waitFor({ state: "visible", timeout: 10000 });
			await page.waitForTimeout(500);
			await shot("03-menu");

			// 3) 編集フォーム。**写真を選び直す導線が無いこと**と、
			//    コメント・評価・価格が現在値で埋まっていることが見える面
			await page.getByTestId("own-post-edit-button").click();
			const editModal = page.getByTestId("edit-review-modal");
			await editModal.waitFor({ state: "visible", timeout: 10000 });
			await page.getByTestId("edit-review-media-locked-note").waitFor({ state: "visible", timeout: 10000 });
			await page.waitForTimeout(500);
			await shot("04-edit-form");

			// 4) 編集して保存する。«保存しました» まで押し切る
			await page.getByTestId("edit-review-comment-input").fill("編集したレビュー");
			await page.getByTestId("edit-review-star-5").click();
			await page.getByTestId("edit-review-price-input").fill("1500");
			await page.waitForTimeout(300);
			await shot("05-edit-filled");

			await page.getByTestId("edit-review-submit-button").click();
			await page.waitForTimeout(2500);
			await shot("06-edit-saved");

			// 5) 削除の確認ダイアログ。**元に戻せない**ことが文言で伝わる面
			await more.click();
			await menu.waitFor({ state: "visible", timeout: 10000 });
			await page.getByTestId("own-post-delete-button").click();
			const confirm = page.getByTestId("dialog-confirm-button");
			await confirm.waitFor({ state: "visible", timeout: 10000 });
			await page.waitForTimeout(500);
			await shot("07-delete-confirm");

			// 6) 押し切る。モックが 200 を返すので «削除しました» まで到達する
			await confirm.click();
			await page.waitForTimeout(2500);
			await shot("08-deleted");
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
	"- 04-edit-form … 編集フォーム。写真を選び直す導線が無いことと、現在値が入っていること（**本命**）",
	"- 05-edit-filled … コメント・評価・価格を書き換えた状態",
	"- 06-edit-saved … 保存を押し切った後。«保存しました» が出る",
	"- 07-delete-confirm … 削除の確認。«元に戻せません» が文言で伝わる（**本命**）",
	"- 08-deleted … 押し切った後。«削除しました» が出る",
	"",
	"⚠️ 削除後の一覧側（墓標）は tombstone-1513.mjs が撮る。こちらは操作そのもの。",
	"",
	"⚠️ 認証・API・地図はモック。DELETE もモックが 200 を返すだけで実データは消えていない。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
