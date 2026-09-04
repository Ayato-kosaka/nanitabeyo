/*
#1780 完了条件 4「店舗画像の表示が自社側データへ移行しており、画像が無い店でも
灰色にならない」のエビデンス。

⚠️ 認証・API はすべてモック。映るのは **画面の描き方**であって実データではない。
   ここで確かめられるのは次の 2 点だけ。偽らないこと。
     - 店の画像が無いとき、空白 / 灰色の四角ではなく «店アイコンの受け皿» が出ること
     - `imageUrls` が付いていれば、従来どおりその絵が出ること
   API が dish_media サムネイルを `imageUrls` へ詰める部分はサーバ側の実装であり、
   ここではモックで «付いている / 付いていない» を作り分けているだけである。

3 画面を撮る（平面の表示 3 箇所 = RestaurantAvatar を通した全部）:
  01 店詳細（画像なし）        → 受け皿
  02 店詳細（dish_media 由来）  → 絵が出る
  03 店名検索の結果一覧（画像なし）→ 受け皿が並ぶ（以前はここが灰色の四角だった）
*/
import { record, ok } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "restaurant-image-1780";
const PRESET = process.env.EVIDENCE_PRESET || "default";
const RID = "restaurant-1780";

/** `EVIDENCE_WITH_IMAGE=1` で «dish_media サムネイルが付いた店» を撮る */
const withImage = () => process.env.EVIDENCE_WITH_IMAGE === "1";

/* 1x1 の実画像。CDN を呼ばずに «絵が出ている» を確かめるため data URI を使う */
const STUB_IMAGE =
	"data:image/svg+xml;base64," +
	Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#c8632f"/><text x="128" y="140" font-size="90" text-anchor="middle" fill="#fff">🍜</text></svg>`,
	).toString("base64");

const imageUrls = () => (withImage() ? { sm: STUB_IMAGE, md: STUB_IMAGE } : undefined);

const media = (id, name) => ({
	dish_media: { id, thumbnailImageUrl: "", mediaUrl: "", render_type: "stored", isMine: false },
	dish: { id: `dish-${id}`, name, reviewCount: 3, averageRating: 4.2, categoryImageUrl: null, categoryLabels: null },
	restaurant: { id: RID, name: "エビデンス用ラーメン", google_place_id: "place-1780" },
	reviews: [],
});

const searchResult = (i) => ({
	restaurant: {
		id: `search-${i}`,
		name: `画像を持たない店 ${i}`,
		google_place_id: `place-search-${i}`,
		imageUrls: imageUrls(),
	},
	meta: { averageRating: 0, reviewCount: 0, totalCents: 0, maxEndDate: null },
});

await record({
	name: NAME,
	preset: PRESET,
	mock: (url) => {
		if (/\/v1\/restaurants\/[^/]+\/dish-media/.test(url))
			return { body: ok({ data: [media("m1", "醤油ラーメン"), media("m2", "つけ麺")], nextCursor: null }) };

		if (/\/v1\/restaurants\/search/.test(url))
			return { body: ok([searchResult(1), searchResult(2), searchResult(3)]) };

		if (/\/v1\/restaurants\/(?!search)[^/?]+(\?.*)?$/.test(url))
			return {
				body: ok({
					restaurant: {
						id: RID,
						name: "エビデンス用ラーメン",
						google_place_id: "place-1780",
						imageUrls: imageUrls(),
					},
					meta: { averageRating: 4.2, reviewCount: 12, totalCents: 0, maxEndDate: null },
				}),
			};
		return null;
	},
	flow: async (page, shot) => {
		await page.goto(`http://localhost:8788/ja-JP/restaurant/${RID}`, { waitUntil: "domcontentloaded" });
		await page.getByTestId("restaurant-detail-screen-title").waitFor({ timeout: 30_000 });
		await page.waitForTimeout(1200);

		/*
		⚠️ «受け皿が出ている» を目視だけで確かめない。web は 60x60 の空白と
		   アイコン入りの受け皿がスクリーンショットでは似て見える。
		   testID で «どちらが描かれたか» を判定してから撮る。
		*/
		const placeholders = await page.getByTestId("restaurant-detail-avatar-placeholder").count();
		const images = await page.getByTestId("restaurant-detail-avatar").count();
		if (withImage()) {
			if (placeholders !== 0 || images === 0)
				throw new Error(`画像がある店なのに絵が出ていない（placeholder=${placeholders} image=${images}）`);
			await shot("02-detail-with-dish-media-thumbnail");
			return;
		}
		if (placeholders === 0)
			throw new Error(`画像が無い店なのに受け皿が出ていない（placeholder=${placeholders} image=${images}）`);
		await shot("01-detail-placeholder");

		/*
		店名検索（`RestaurantNameSearch`）。以前はここが «灰色の四角» の縦並びだった。
		部品が載っているのは «食べたを記録»（/add-record）で、入力しないと結果が出ない。
		⚠️ 画面へ行っただけのスクリーンショットを «検索結果のエビデンス» として出さないこと。
		*/
		const search = "sns-import-eaten-restaurant-search";
		await page.goto("http://localhost:8788/ja-JP/add-record", { waitUntil: "domcontentloaded" });
		// この部品は «食べたを記録» タブの中にある
		await page.getByTestId("sns-import-tab-eaten").waitFor({ timeout: 30_000 });
		await page.getByTestId("sns-import-tab-eaten").click();
		await page.getByTestId(`${search}-input`).waitFor({ timeout: 15_000 });
		await page.getByTestId(`${search}-input`).fill("画像を持たない店");
		await page.getByTestId(`${search}-results`).waitFor({ timeout: 15_000 });
		await page.waitForTimeout(800);

		const rows = await page.getByTestId(`${search}-result-0-image-placeholder`).count();
		if (rows === 0) throw new Error("検索結果の行に受け皿が出ていない（灰色の四角のままの可能性）");
		await shot("03-name-search-placeholder");
	},
});
