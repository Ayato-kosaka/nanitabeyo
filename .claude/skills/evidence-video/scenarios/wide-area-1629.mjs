// #1629 引き（ズームアウト）の検索。**«50km の足切り» が本当に外れたかを、実際に飛ぶ URL で測る。**
//
// オーナー指摘:
//   > 日本全体を映して「このエリアで再検索」を押しても «日本の中心から 50km» の円しか
//   > 検索していない。東京の記録は全部その外へ落ちるので、必ず 0 件になる。
//
// ⚠️ **モックの API に «サーバと同じ意地悪» をさせるのが要点。**
//    半径が東京駅まで届いていなければ 0 件を返す。こうすると
//      - 直す前（半径が 50km で頭打ち）… 0 件 → 空状態が出る
//      - 直した後（半径が viewport ぶん）… ピンが返る
//    という形で、**同じシナリオが修正前後で違う絵になる**。
//    「速くなった」は web では測れないので測らない。ここで見るのは «届く範囲» だけ。
//
// 使い方（e2e-web から）:
//   node ../.claude/skills/evidence-video/scenarios/wide-area-1629.mjs
import { record, ok } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "wide-area-1629";

/** 日本のだいたいの中心（REGION_JP。features/map/constants.ts） */
const JP_CENTER = { lat: 36.2048, lng: 138.2529 };
/** 東京駅 */
const TOKYO = { latitude: 35.6812, longitude: 139.7671 };

/** 2 点間の距離(m)。ハバサイン */
const distanceM = (aLat, aLng, bLat, bLng) => {
	const R = 6371000;
	const toRad = (d) => (d * Math.PI) / 180;
	const dLat = toRad(bLat - aLat);
	const dLng = toRad(bLng - aLng);
	const s =
		Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(s));
};

/*
東京駅の記録を 1 件だけ持つユーザー、という体にする。

⚠️ **契約の «封筒» を間違えないこと。** この endpoint は `BaseResponse<R>` の中がさらに
   `{ data: MyDishPin[], truncated: boolean }` である（`shared/api/v1/res/users.response.ts`）。
   素の配列を入れるとアプリ側は 0 件として扱い、**アプリが直っていても空状態が出る**。
   最初の実行でこれを踏み、危うく «直っていない» と誤読するところだった。
*/
const pin = {
	restaurant: {
		id: "r-tokyo",
		name: "東京駅の店",
		latitude: TOKYO.latitude,
		longitude: TOKYO.longitude,
		image_url: null,
		google_place_id: "place-tokyo",
	},
	counts: { want: 0, eaten: 1 },
	latestOccurredAt: "2026-08-01T12:00:00.000Z",
	representativeThumbnailUrl: null,
	isOwnMediaDeleted: false,
};

const seenRadii = [];

const files = await record({
	name: NAME,
	langs: ["ja"],
	mock: (url) => {
		if (!url.includes("/v1/users/me/dishes/map-pins")) return null;
		const u = new URL(url);
		const radius = Number(u.searchParams.get("radius") ?? 0);
		const lat = Number(u.searchParams.get("lat") ?? JP_CENTER.lat);
		const lng = Number(u.searchParams.get("lng") ?? JP_CENTER.lng);
		const reach = distanceM(lat, lng, TOKYO.latitude, TOKYO.longitude);
		const hit = radius >= reach;
		seenRadii.push({ radius, reach: Math.round(reach), hit });
		console.log(
			`  API: radius=${Math.round(radius)}m / 東京駅まで=${Math.round(reach)}m → ${hit ? "ピンを返す" : "0 件"}`,
		);
		return { body: ok({ data: hit ? [pin] : [], truncated: false }) };
	},
	flow: async (page, shot) => {
		await page.goto("http://localhost:8788/ja-JP/my-dishes", { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(3000);

		// 地図ビューへ切り替える
		await page.getByTestId("my-dishes-view-map").click().catch(() => {});
		await page.waitForTimeout(2500);
		await shot("01-map");

		// 「このエリアで再検索」を押す（初期表示は日本全体 = REGION_JP）
		const button = page.getByTestId("my-dishes-search-this-area");
		await button.click();
		await page.waitForTimeout(3000);
		await shot("02-after-search-this-area");

		const emptyVisible = await page
			.getByTestId("my-dishes-map-empty")
			.isVisible()
			.catch(() => false);

		console.log("\n=== 実際に飛んだ半径 ===");
		for (const r of seenRadii) console.log(`  radius=${r.radius}m / 必要=${r.reach}m / ${r.hit ? "届いた" : "届かず"}`);

		const widest = seenRadii.reduce((m, r) => Math.max(m, r.radius), 0);
		console.log(`\n判定 (1) 半径が 50km の頭打ちを超えた: ${widest > 50000 ? "✅" : "❌"}（最大 ${Math.round(widest)}m）`);
		console.log(`判定 (2) 東京駅まで届いた: ${seenRadii.some((r) => r.hit) ? "✅" : "❌"}`);
		console.log(`判定 (3) 空状態が出ていない: ${emptyVisible ? "❌ 出ている" : "✅ 出ていない"}`);
	},
});

console.log(files);
