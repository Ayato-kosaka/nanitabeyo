/*
#1629 写真の無い «食べた» 記録を押すと、自分の書いたクチコミが読めることのエビデンス。

オーナー実機報告:
「梅欄ヤエチカ店が『削除されました』『写真なし』と表示されますが、押した時に
  レストラン詳細に行くのは仕様と違うはず。写真なしで良いから自分の書いたクチコミ見たい」

⚠️ 認証・API はすべてモックである。映るのは «画面と遷移» であって実データではない。

  EVIDENCE_NAME=my-dishes-own-review \
  EVIDENCE_PRESET=android \
  node .claude/skills/evidence-video/scenarios/my-dishes-own-review.mjs
*/
import { record, ok } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "my-dishes-own-review";
const PRESET = process.env.EVIDENCE_PRESET || "default";

/** 写真の無い «食べた» 行。`dishMedia: null` + `myReview` あり */
const noPhotoRow = (key, { deleted = false, name, comment }) => ({
	key,
	status: "eaten",
	occurredAt: "2026-08-10T12:00:00.000Z",
	savedAt: null,
	eatenAt: "2026-08-10T12:00:00.000Z",
	restaurant: { id: "restaurant-1", name, image_url: null, google_place_id: "place-1" },
	dish: {
		id: "dish-1",
		name: "焼肉",
		categoryImageUrl: null,
		categoryLabels: { ja: "焼肉", en: "Yakiniku" },
		reviewCount: 1,
		averageRating: 4,
	},
	dishMedia: null,
	isOwnMediaDeleted: deleted,
	myReview: {
		id: `review-${key}`,
		dish_id: "dish-1",
		user_id: "11111111-1111-1111-1111-111111111111",
		comment,
		rating: 4,
		price_cents: 3200,
		currency_code: "JPY",
		created_dish_media_id: null,
		created_at: "2026-08-10T12:00:00.000Z",
		username: "オーナー",
		isLiked: false,
		likeCount: 0,
	},
	distanceMeters: null,
});

const ROWS = [
	noPhotoRow("review:1", {
		deleted: true,
		name: "梅欄 ヤエチカ店",
		comment: "写真は消してしまったけれど、担々麺の痺れがちょうどよかった。次は大盛りにする。",
	}),
	noPhotoRow("review:2", {
		deleted: false,
		name: "焼肉うしごろ 表参道",
		comment: "写真を撮り忘れた。肉が厚くて satisfying。予約必須。",
	}),
];

await record({
	name: NAME,
	preset: PRESET,
	mock: (url) => {
		if (url.includes("/v1/users/me/dishes")) return { body: ok({ data: ROWS, nextCursor: null, meta: {} }) };
		return null;
	},
	flow: async (page, shot) => {
		await page.goto("http://localhost:8788/ja-JP/my-dishes", { waitUntil: "domcontentloaded" });
		// 一覧（グリッド）が描けるまで待つ
		await page.getByTestId("my-dishes-list-item").first().waitFor({ timeout: 30_000 });
		await page.waitForTimeout(800);
		await shot("01-list-no-photo-rows");

		// 1 件目 = 削除済みの行
		await page.getByTestId("my-dishes-list-item").first().click();
		await page.getByTestId("my-dish-own-review-sheet").waitFor({ timeout: 15_000 });
		await page.waitForTimeout(900);
		await shot("02-sheet-deleted-media");

		await page.getByTestId("my-dish-own-review-close").click();
		await page.waitForTimeout(600);

		// 2 件目 = «写真なし»（削除ではない）の行
		await page.getByTestId("my-dishes-list-item").nth(1).click();
		await page.getByTestId("my-dish-own-review-sheet").waitFor({ timeout: 15_000 });
		await page.waitForTimeout(900);
		await shot("03-sheet-no-photo");
	},
});
