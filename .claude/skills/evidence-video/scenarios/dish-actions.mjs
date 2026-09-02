// #1501 / PR #1516 いいね・保存の楽観更新が API 失敗でロールバックすることを撮る。
// Topics 画面のカードをタップすると結果画面へ遷移するので、その経路で
// dish-media/search をモックして 1 件だけ出し、reaction API を 500 にする。
import { BASE, ok, record, solidCard, writeNote } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "dat01-rollback";
const FAIL = process.env.EVIDENCE_FAIL !== "0"; // 既定は失敗系（ロールバックを見せる）
const REACTION_DELAY_MS = Number(process.env.EVIDENCE_REACTION_DELAY ?? 2500);

const MEDIA_ID = "11111111-2222-3333-4444-555555555555";
const NOW = "2026-08-01T00:00:00Z";

const ENTRY = {
	restaurant: {
		id: "rest-1", name: "エビデンス食堂", latitude: 35.658, longitude: 139.7015,
		google_place_id: "place-1", image_url: null, address: "東京都渋谷区",
		created_at: NOW, updated_at: NOW,
	},
	dish: {
		id: "dish-1", restaurant_id: "rest-1", category_id: "cat-1", name: "特製ラーメン",
		created_at: NOW, updated_at: NOW, reviewCount: 3, averageRating: 4.5,
	},
	dish_media: {
		id: MEDIA_ID, dish_id: "dish-1", user_id: "someone-else", media_path: "p.jpg",
		media_type: "image", thumbnail_path: "t.jpg", created_at: NOW,
		media_processing_status: "completed",
		isMine: false, isSaved: false, isLiked: false, likeCount: 12,
		mediaUrl: "https://evidence.invalid/img-0.svg",
		thumbnailImageUrl: "https://evidence.invalid/img-0.svg",
	},
	dish_reviews: [{
		id: "rev-1", dish_id: "dish-1", user_id: "u-2", comment: "スープが濃くて好みでした",
		rating: 5, created_at: NOW, price_cents: 100000, currency_code: "JPY",
		username: "たろう", isLiked: false, likeCount: 2,
	}],
};

const CATS = [{ category: "ラーメン", topicTitle: "こってり豚骨で満たされる", reason: "夜に食べたくなる定番" }];
const RECOMMENDATIONS = CATS.map((c, i) => ({
	...c, categoryId: `cat-${i + 1}`, imageUrl: `https://evidence.invalid/img-${i}.svg`,
	deepDiveFeatures: [], isSaved: false,
}));

const searchParams = {
	address: "country:JP, administrative_area_level_1:東京都, locality:渋谷区",
	location: { latitude: 35.658034, longitude: 139.701636 },
	distance: 800, priceLevels: ["PRICE_LEVEL_MODERATE"], timeSlot: "dinner",
	scene: "friends", taste: null, diningPace: null, coreIngredient: null, localLanguageCode: "ja",
};

const notes = [];
let reactionCalls = 0;

await record({
	name: NAME,
	langs: ["ja"],
	mock: async (url) => {
		const m = url.match(/evidence\.invalid\/img-(\d+)\.svg/);
		if (m) return { contentType: "image/svg+xml", body: solidCard(["e8734a", "3a7bd5"][Number(m[1]) % 2]) };
		if (url.includes("dish-categories/recommendations")) return { body: ok(RECOMMENDATIONS) };
		if (url.includes("v1/dish-media/search")) return { body: ok([ENTRY]) };
		if (/v1\/dish-media\/[^/]+\/reaction/.test(url)) {
			reactionCalls += 1;
			await new Promise((r) => setTimeout(r, REACTION_DELAY_MS));
			if (FAIL) {
				console.log(`reaction #${reactionCalls} → 500`);
				return { status: 500, body: JSON.stringify({ success: false }) };
			}
			console.log(`reaction #${reactionCalls} → 200`);
			return { body: ok(null) };
		}
		return null;
	},
	flow: async (page, shot) => {
		const url = `${BASE}/ja-JP/search/topics?searchParams=${encodeURIComponent(JSON.stringify(searchParams))}`;
		await page.goto(url, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(9000);
		// カードをタップして結果画面へ（カルーセルはタップで遷移する）
		const cta = page.getByText("この料理にする！", { exact: false });
		if (await cta.count()) { await cta.first().click(); } else { await page.mouse.click(195, 420); }
		await page.waitForTimeout(6000);
		await shot("01-result");

		const like = page.getByTestId("dish-action-like");
		if (!(await like.count())) {
			notes.push("⚠️ dish-action-like が見つからず、以降は撮れていない。結果画面へ到達できていない可能性が高い。");
			return;
		}
		const readLike = async () => (await page.getByTestId("dish-action-like").innerText()).replace(/\s+/g, " ").trim();
		const before = await readLike();
		notes.push(`1. タップ前のいいね表示: "${before}"`);

		await like.click();
		await page.waitForTimeout(800); // 楽観更新が見えている時間
		await shot("02-optimistic");
		const during = await readLike();
		notes.push(`2. タップ直後（楽観更新・API 応答前）: "${during}"`);

		await page.waitForTimeout(REACTION_DELAY_MS + 3500); // 失敗が返るまで待つ
        await shot("03-after-response");
		const after = await readLike();
		notes.push(`3. API が ${FAIL ? "500 を返した" : "200 を返した"} 後: "${after}"`);
		notes.push(`   → 期待: ${FAIL ? "タップ前の値へ戻っている" : "楽観更新のまま"}。実測: ${after === before ? "戻った" : "戻っていない"}`);
		notes.push(`   reaction API の呼び出し回数: ${reactionCalls}`);
	},
});

await writeNote(NAME, notes);
console.log(notes.join("\n"));
