/*
#1514 SAF-01 通報のエビデンス。

投稿フィードの「通報する」から通報シートを開き、理由を選んで送信するところまでを撮る。

⚠️ 実データではない。`GET /v1/dish-media?ids=` をモックして 1 件のフィードを作り、
通報の POST もモックが 200 を返すだけ。**dev の DB へは 1 行も書かない**。
それでも「利用者が通報に到達できるか」「シートに何が書いてあるか」は絵で確かめられる。
*/
import { record, ok, solidCard, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const IMG = `data:image/svg+xml;base64,${Buffer.from(solidCard("F05537")).toString("base64")}`;
const MEDIA_ID = "11111111-2222-4333-8444-555555555555";

const entry = {
	restaurant: {
		id: "restaurant-1",
		name: "エビデンス食堂",
		image_url: IMG,
		latitude: 35.0,
		longitude: 139.0,
	},
	dish: {
		id: "dish-1",
		name: "テスト料理",
		restaurant_id: "restaurant-1",
		reviewCount: 1,
		averageRating: 4,
		categoryImageUrl: IMG,
	},
	dish_media: {
		id: MEDIA_ID,
		dish_id: "dish-1",
		user_id: "99999999-9999-4999-8999-999999999999",
		media_path: "x",
		media_type: "image",
		thumbnail_path: "x",
		created_at: "2026-08-20T00:00:00.000Z",
		deleted_at: null,
		// 他人の投稿なので «通報する» が出る（自分の投稿だと編集・削除が出る）
		isMine: false,
		isSaved: false,
		isLiked: false,
		likeCount: 3,
		mediaUrl: IMG,
		thumbnailImageUrl: IMG,
		media_processing_status: "completed",
		thumbnail_processing_status: "completed",
	},
	dish_reviews: [],
};

const mock = (url) => {
	if (url.includes("/v1/dish-media") && url.includes("ids="))
		return { body: ok({ items: [entry], notFound: [] }) };
	if (url.includes("/v1/content-reports")) return { body: ok({ id: "report-1" }) };
	return null;
};

async function shootScheme(scheme) {
	return record({
		name: `report1514-${scheme}`,
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

			// 「通報する」は右側のアクション列にある
			const reportButton = page.getByTestId("dish-action-report");
			await reportButton.waitFor({ state: "visible", timeout: 15000 });
			await reportButton.scrollIntoViewIfNeeded().catch(() => {});
			await shot("02-report-button");

			await reportButton.click();
			await page.waitForTimeout(1200);

			const sheet = page.getByTestId("report-sheet");
			await sheet.waitFor({ state: "visible", timeout: 10000 });
			await shot("03-report-sheet");

			// 理由の選択肢がどう並んでいるかを絵で残す。文言はアプリの i18n に任せる
			const detailsInput = page.getByTestId("report-details-input");
			if (await detailsInput.count()) {
				await detailsInput.first().click().catch(() => {});
				await detailsInput.first().fill("[E2E] エビデンス撮影のための入力です").catch(() => {});
				await page.waitForTimeout(400);
				await shot("04-report-filled");
			}
		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("report1514", [
	"# #1514 SAF-01 通報",
	"",
	"- 01-feed … 他人の投稿のフィード",
	"- 02-report-button … 「通報する」ボタンが出ている状態",
	"- 03-report-sheet … 通報シートを開いた状態（理由の選択肢）",
	"- 04-report-filled … 詳細を入力した状態",
	"",
	"⚠️ API はモック。**dev の DB へは 1 行も書いていない**。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
