/*
#1752 オーナー実機報告（2026-08-31）:

> カレンダーだと 8/20 が「見つかりません」になって、書いた «うますぎた！» が読めない。
> マップも «食べた 3 件» なのにフィードは 2 件しか出ない。

## 何を撮るか

1. **Calendar の 8/20**（その日の記録が «投稿を消した 1 件» だけ）を押す
   → 修正前: 「見つかりません」／修正後: クチコミが全画面で読める
2. **店舗スコープのフィード**（Map のピンから開く先。写真 2 件＋写真なし 1 件）
   → 修正前: 「1 / 2」で 2 ページ／修正後: 「1 / 3」で、真ん中にクチコミのページが挟まる

⚠️ **認証・API はモック。** 映るのは «画面と遷移» であって実データではない。
   web ビルドなので、ネイティブ特有のレイアウト（safe area 等）の保証にはならない。
*/
import { record, ok, solidCard, writeNote } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const NAME = process.env.EVIDENCE_NAME || "own-review-page-1752";
const PRESET = process.env.EVIDENCE_PRESET || "android";
const IMG = `data:image/svg+xml;base64,${Buffer.from(solidCard("F05537")).toString("base64")}`;

const USER_ID = "11111111-1111-1111-1111-111111111111";
const MEDIA_A = "33333333-3333-3333-3333-00000000000a";
const MEDIA_B = "33333333-3333-3333-3333-00000000000b";

const restaurant = {
	id: "restaurant-1",
	name: "梅蘭 ヤエチカ店",
	image_url: IMG,
	imageUrls: { sm: IMG, md: IMG },
	google_place_id: "place-1",
	latitude: 35.68,
	longitude: 139.77,
};

const dish = (id, label) => ({
	id,
	name: label,
	restaurant_id: "restaurant-1",
	category_id: null,
	categoryImageUrl: IMG,
	categoryLabels: { ja: label, en: label },
	reviewCount: 1,
	averageRating: 4,
});

/** 投稿を消した記録。サーバは dishMedia を null にし、墓標フラグだけ立てて返す */
const deletedRow = {
	key: "review:44444444-4444-4444-4444-000000000001",
	status: "eaten",
	occurredAt: "2026-08-20T03:00:00.000Z",
	savedAt: null,
	eatenAt: "2026-08-20T03:00:00.000Z",
	restaurant,
	dish: dish("dish-fruit-punch", "フルーツポンチ"),
	dishMedia: null,
	isOwnMediaDeleted: true,
	myReview: {
		id: "44444444-4444-4444-4444-000000000001",
		dish_id: "dish-fruit-punch",
		user_id: USER_ID,
		comment: "うますぎた！",
		rating: 4,
		price_cents: 500,
		currency_code: "JPY",
		created_dish_media_id: null,
		created_at: "2026-08-20T03:00:00.000Z",
		lock_no: 1,
		username: "オーナー",
		isLiked: false,
		likeCount: 0,
	},
	distanceMeters: null,
};

const mediaRow = (mediaId, dishId, label, day) => ({
	key: `review:${mediaId}`,
	status: "eaten",
	occurredAt: `2026-08-${day}T03:00:00.000Z`,
	savedAt: null,
	eatenAt: `2026-08-${day}T03:00:00.000Z`,
	restaurant,
	dish: dish(dishId, label),
	dishMedia: {
		id: mediaId,
		dish_id: dishId,
		user_id: USER_ID,
		media_path: "x",
		media_type: "image",
		thumbnail_path: "x",
		created_at: `2026-08-${day}T03:00:00.000Z`,
		isMine: true,
		mediaUrl: IMG,
		thumbnailImageUrl: IMG,
		render_type: "stored",
	},
	isOwnMediaDeleted: false,
	myReview: null,
	distanceMeters: null,
});

// 記録の並びは «新しい順»。真ん中に «写真なし» が来る形にして、末尾に足していないことを見せる
const ROWS = [
	mediaRow(MEDIA_A, "dish-yakisoba", "焼きそば", "21"),
	deletedRow,
	mediaRow(MEDIA_B, "dish-gyoza", "餃子", "19"),
];

/** フィードが引く実体。写真のある 2 件だけが存在する（消した 1 件は返らない） */
const entryFor = (row) => ({
	restaurant,
	dish: row.dish,
	dish_media: { ...row.dishMedia, deleted_at: null, isSaved: false, isLiked: false, likeCount: 0 },
	dish_reviews: [],
});

const notes = [];

const mock = (url) => {
	if (url.includes("/v1/users/me/dishes")) {
		// 日付スコープは from / to が付く。その日の記録だけを返さないと «8/20 に 1 件だけ» が作れない
		const query = new URL(url, BASE).searchParams;
		const from = query.get("from");
		const to = query.get("to");
		const rows =
			from && to ? ROWS.filter((row) => row.occurredAt >= from && row.occurredAt <= to) : ROWS;
		return { body: ok({ data: rows, nextCursor: null, meta: {} }) };
	}
	if (url.includes("/v1/dish-media") && url.includes("ids=")) {
		// ⚠️ 配列は `String(v)` でカンマ連結される（lib/fetchWithAuth.ts の toQueryString）。
		//    getAll("ids") では 1 本の "a,b" が返る。ここを取り違えると «写真が 1 枚も無い» 動画が撮れる
		const ids = (new URL(url, BASE).searchParams.get("ids") ?? "").split(",");
		const items = ROWS.filter((row) => row.dishMedia && ids.includes(String(row.dishMedia.id))).map(entryFor);
		return { body: ok({ items, notFound: [] }) };
	}
	return null;
};

await record({
	name: NAME,
	preset: PRESET,
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

		// --- 1. Calendar: その日の記録が «消した 1 件» だけ ---------------------
		await page.goto(`${BASE}/ja-JP/my-dishes/feed?scope=date&date=2026-08-20`, {
			waitUntil: "domcontentloaded",
		});
		await page.waitForTimeout(6000);
		await shot("01-calendar-date-feed");
		if (await page.getByTestId("my-dishes-feed-empty").count()) {
			notes.push("⚠️ 8/20 が «見つかりません» のまま（修正が効いていない）");
		} else if (await page.getByTestId("my-dish-own-review-page").count()) {
			notes.push("1. 8/20（消した投稿しかない日）でクチコミが全画面で読める");
		} else {
			notes.push("⚠️ 空でもクチコミページでもない。到達できていない可能性がある");
		}

		// --- 2. 店舗スコープ: 写真 2 件＋写真なし 1 件 = 3 ページ ---------------
		await page.goto(`${BASE}/ja-JP/my-dishes/feed?scope=restaurant&restaurantId=restaurant-1`, {
			waitUntil: "domcontentloaded",
		});
		await page.waitForTimeout(6000);
		await shot("02-restaurant-feed-first-page");
		const counter = page.getByTestId("my-dishes-feed-position-counter");
		if (await counter.count()) {
			notes.push(`2. 店舗スコープの件数表示: 「${(await counter.first().innerText()).trim()}」（修正前は 1 / 2）`);
		} else {
			notes.push("⚠️ 位置バーが出ていない（ページが 1 枚しか無い）");
		}

		/*
		横へ 1 枚送る = 真ん中に挟まったクチコミのページ。

		⚠️ **«描かれているか» で判定しないこと。** FlatList は windowSize のぶん前後のページも
		   マウントするので、`my-dish-own-review-page` は 1 ページ目に居ても存在する。
		   1 周これで «送れたつもり» の動画を撮った。**位置バーの数字**で判定する。
		⚠️ mouse.down/move では RN Web の横 FlatList は動かない（スクロールコンテナなので）。
		   wheel の deltaX で送る。
		*/
		const box = await page.viewportSize();
		await page.mouse.move(box.width / 2, box.height / 2);
		await page.mouse.wheel(box.width, 0);
		await page.waitForTimeout(2500);
		await shot("03-restaurant-feed-review-page");
		const after = (await counter.first().innerText()).trim();
		notes.push(
			after === "2 / 3"
				? "3. 横へ 1 枚送ると「2 / 3」= 真ん中に «削除されました» のクチコミページが挟まっている"
				: `⚠️ 送ったあとの件数表示が「${after}」（«2 / 3» を期待）。ページ送りができていない`,
		);

		writeNote(NAME, notes);
	},
});
