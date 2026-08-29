// #1629【30】お店提案の «チカチカ» を、**画像を何回取りに行ったかで測る。**
//
// オーナー指摘（2 回）:
//   > このお店提案は 5 件しか表示されないんで、今の状態だとチカチカするんですよね。
//   > これまだチカチカするんですよ？動画で直ったエビデンスを自分で確認しろって。
//
// ## なぜ «回数» で測るのか
//
// チカチカの正体は `useDishMediaBackgroundImageResources` が
// **先読みの集合から外れた画像を release する**ことである。窓が動くと、外れた画像は
// 破棄され、戻ってきたときに **取り直し**になる。つまり
//   «同じ画像を 2 回以上取りに行っている» = チカチカしている
//   «どの画像もちょうど 1 回» = チカチカしない
// 目視では «撮れたかどうか» が運任せになるので、回数で機械的に判定する。
//
// ⚠️ お店提案は `DishMediaMap`（`search/result.tsx:203`）である。`DishMediaFeed` ではない。
//    ここを取り違えて Feed 側だけ直し、«直った» と誤報したのが 2026-08-27 の事故。
//
// 使い方（e2e-web から）:
//   node ../.claude/skills/evidence-video/scenarios/preload-churn-1629.mjs
import { BASE, record, ok, solidCard, dismissTutorial } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "preload-churn-1629";

/** お店提案は 5 件（オーナーの言葉のまま） */
const COUNT = 5;
const HUES = ["e74c3c", "e67e22", "f1c40f", "2ecc71", "3498db"];

/** 料理提案（dish-categories）を通らないと お店提案 へ到達できない。topics.mjs と同じ形 */
const SEARCH_PARAMS = {
	address: "country:JP, administrative_area_level_1:東京都, locality:渋谷区",
	location: { latitude: 35.658034, longitude: 139.701636 },
	distance: 800,
	priceLevels: ["PRICE_LEVEL_MODERATE"],
	timeSlot: "dinner",
	scene: "friends",
	taste: null,
	diningPace: null,
	coreIngredient: null,
	localLanguageCode: "ja",
};
const RECOMMENDATIONS = [
	{
		category: "ラーメン",
		topicTitle: "こってり豚骨で満たされる",
		reason: "夜に食べたくなる定番",
		categoryId: "cat-1",
		imageUrl: "https://evidence.invalid/cat-1.svg",
		deepDiveFeatures: [],
		isSaved: false,
	},
];

/** 画像ごとの取得回数 */
const fetches = new Map();

const entries = Array.from({ length: COUNT }, (_, i) => ({
	dish_media: {
		id: `dm-${i}`,
		dish_id: `dish-${i}`,
		user_id: "u-1",
		mediaPath: "",
		mediaUrl: null,
		// 背景画像。**1 枚ずつ別 URL** にして «どれを何回取ったか» を数えられるようにする
		// ⚠️ **ホストを BASE（localhost:8788）にしないこと。** harness の installMocks は
		//    BASE 宛てを route.continue() で素通しするので、モックが数えられず
		//    «0 回取得 → 判定 ✅» の空振りになる（実際に 1 回踏んだ）
		thumbnailImageUrl: `https://evidence.invalid/bg-${i}.svg`,
		likeCount: 0,
		isLiked: false,
		isSaved: false,
		isEaten: false,
		render_type: "stored",
		externalEmbed: null,
		media_processing_status: "completed",
		thumbnail_processing_status: "completed",
	},
	dish: { id: `dish-${i}`, name: `料理 ${i}`, categoryImageUrl: null, categoryLabels: null },
	restaurant: {
		id: `r-${i}`,
		name: `お店 ${i}`,
		latitude: 35.68 + i * 0.001,
		longitude: 139.76 + i * 0.001,
		imageUrls: [],
		google_place_id: `p-${i}`,
	},
	reviews: [],
}));

const files = await record({
	name: NAME,
	langs: ["ja"],
	mock: (url) => {
		// 背景画像。取得回数を数えて色板を返す
		const m = url.match(/evidence\.invalid\/bg-(\d+)\.svg$/);
		if (m) {
			const i = Number(m[1]);
			fetches.set(i, (fetches.get(i) ?? 0) + 1);
			return { body: solidCard(HUES[i] ?? "888888"), contentType: "image/svg+xml" };
		}
		// ⚠️ `SearchDishMediaResponse` は **素の配列**（`shared/api/v1/res/dish-media.response.ts:121`）。
		//    封筒（BaseResponse）の中に入れるのは配列そのものであって `{data:[]}` ではない
		if (url.includes("/v1/dish-media/search")) return { body: ok(entries) };
		if (url.includes("dish-categories/recommendations")) return { body: ok(RECOMMENDATIONS) };
		if (url.includes("evidence.invalid/cat-")) {
			return { body: solidCard("888888"), contentType: "image/svg+xml" };
		}
		return null;
	},
	flow: async (page, shot) => {
		/*
		⚠️ **result 画面へ直接 goto しても «予期しないエラー» になる。**

		この画面は自分でデータを取りに行かず、**料理提案（dish-categories）で
		カードを押したときに store へ入った entries を entriesKey で引く**だけである
		（`search/result.tsx:60`）。直リンクでは store が空なので必ずエラーになる。
		実際に 1 回それで撮ってしまい、«画像 0 回取得 → 判定 ✅» という
		**空振りの合格**が出た（判定 (2) がそれを検知した）。
		だから料理提案から入って、カードを押して到達する。
		*/
		await page.goto(`${BASE}/ja-JP/search/dish-categories?searchParams=${encodeURIComponent(JSON.stringify(SEARCH_PARAMS))}`, {
			waitUntil: "domcontentloaded",
		});
		await page.waitForTimeout(9000);
		await dismissTutorial(page);
		await shot("00-topics");

		// 先頭のカードを押してお店提案（result）へ。押した瞬間に dish-media/search が飛ぶ
		await page.getByText(RECOMMENDATIONS[0].topicTitle, { exact: false }).first().click();
		await page.waitForTimeout(6000);
		await shot("01-opened");

		// 5 件を «行って戻る» で往復する。窓が動けばここで release → 取り直しが起きる
		const swipe = async (dir) => {
			await page.keyboard.press(dir);
			await page.waitForTimeout(900);
		};
		for (let i = 0; i < COUNT - 1; i++) await swipe("ArrowRight");
		await shot("02-forward");
		for (let i = 0; i < COUNT - 1; i++) await swipe("ArrowLeft");
		await shot("03-back");
		for (let i = 0; i < COUNT - 1; i++) await swipe("ArrowRight");
		await shot("04-forward-again");

		console.log("\n=== 背景画像を取りに行った回数 ===");
		const counts = [];
		for (let i = 0; i < COUNT; i++) {
			const n = fetches.get(i) ?? 0;
			counts.push(n);
			console.log(`  画像 ${i}: ${n} 回`);
		}
		const refetched = counts.filter((n) => n > 1).length;
		const never = counts.filter((n) => n === 0).length;
		console.log(`\n判定 (1) 2 回以上取り直した画像: ${refetched} 枚 → ${refetched === 0 ? "✅" : "❌ チカチカする"}`);
		console.log(`判定 (2) 1 度も取られなかった画像: ${never} 枚（5 件すべてが先読み対象なら 0）`);
	},
});

console.log(files);
