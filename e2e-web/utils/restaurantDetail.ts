import type { Page } from "@playwright/test";
import type {
	GetRestaurantByIdResponse,
	GetRestaurantOpeningHoursResponse,
	QueryRestaurantDishMediaResponse,
} from "@shared/api/v1/res";

/**
 * 🏪 店舗詳細まわり（#1386 でルート化した 4 画面）の E2E 用ユーティリティ
 *
 * ## なぜ API をモックするのか
 * 検証対象は「店舗詳細・入札・料理カテゴリ選択・フィードが **URL で指せる画面** になったこと」
 * であって、店舗やレビューのデータそのものではない。実データで検証しようとすると
 *
 * - 事前に dev DB へ店舗を作る（`POST /v1/restaurants` = @mutation 相当の書き込み）
 * - restaurantId をテストへ受け渡す
 * - Google Places のサジェスト結果に依存する（`tests/authenticated/review-post.spec.ts` の
 *   コメントにあるとおり、カタログ内で最もフレークしやすい経路）
 *
 * という前提が必要になり、ルーティングの不変条件と無関係な理由で落ちる。
 * 店舗取得 API を `page.route()` で固定レスポンスに差し替えれば、**匿名セッションのまま**
 * 決定論的に 4 画面を開けるうえ dev DB を一切汚さない（このテストが @mutation にならない理由）。
 *
 * ⚠️ **BaseResponse の封筒 `{ success, data }` を外さないこと。** `useAPICall` は `data` だけを
 * 取り出すので、素のレスポンスを返すと undefined が渡って画面がエラー表示になる
 *（utils/dishCategoryGroupVote.ts で 3 spec がこれで落ちた実績がある）。
 */

/** 固定 restaurantId。モックするので実在しなくてよい */
export const MOCK_RESTAURANT_ID = "e2e-1386-restaurant";

/** 店舗名。画面に出るのでアサーションから参照できるようにしておく */
export const MOCK_RESTAURANT_NAME = "E2E 自動テスト食堂";

/**
 * `GET /v1/restaurants/:id`（末尾にセグメントを持つ dish-media 系とは一致させない）。
 *
 * ⚠️ `search` を除外しているのは、地図の周辺検索（`GET /v1/restaurants/search`）が同じ形の URL で、
 * こちらは **配列** を返すため。除外しないと地図を開いたテストで型の違う応答を渡すことになる。
 */
const DETAIL_URL_PATTERN = /\/v1\/restaurants\/(?!search)[^/?]+(\?.*)?$/;

/** `GET /v1/restaurants/:id/dish-media` */
const DISH_MEDIA_URL_PATTERN = /\/v1\/restaurants\/[^/?]+\/dish-media(\?.*)?$/;

/**
 * `GET /v1/restaurants/:id/opening-hours`（#1666 で店舗詳細が呼ぶようになった）。
 *
 * ⚠️ これを固定していないと **実 API へ漏れる**。`MOCK_RESTAURANT_ID` は UUID ではないので
 * `RestaurantIdParamsDto` の `@IsUUID()` が弾いて **400** になり、console error ゲート
 * （`fixtures/test.ts`）がこの spec を «ルーティングとは無関係な理由で» 落とす。
 * 実際に 2026-09-09〜09-12 の夜間で 3 夜落ちた（#1666 をマージした日から）。
 */
const OPENING_HOURS_URL_PATTERN = /\/v1\/restaurants\/[^/?]+\/opening-hours(\?.*)?$/;

/**
 * `MOCK_RESTAURANT_ID` 配下の **まだ個別に固定していない** サブリソースを受け止める網。
 *
 * ## なぜ «個別に足す» だけで終わらせないのか
 * 上の opening-hours の事故は «画面が新しい API を呼ぶようになったのに、ここが追随していない»
 * という **形** の欠陥で、同じ形は画面へ 1 本 API が足されるたびに再発する。
 * 個別のパターンを足して回るのは «次に足した人» を待つことなので、形ごと塞ぐ。
 *
 * この店は実在しないので、ここへ来たリクエストは **実 API では必ず 400 / 404 になる**。
 * つまり網で受けて困るものは無い（受けなければ console error ゲートで落ちるだけ）。
 * ⚠️ 網は «エラーにしない» だけで «正しい中身を返す» わけではない。中身が要る API は
 * 上のように個別のパターンで固定すること（網より **後に** 登録すれば個別の方が勝つ）。
 */
const MOCK_RESTAURANT_ANY_SUBRESOURCE_PATTERN = new RegExp(`/v1/restaurants/${MOCK_RESTAURANT_ID}(/[^?]*)?(\\?.*)?$`);

/** 店舗詳細の URL（`app/[locale]/restaurant/[restaurantId].tsx`） */
export function restaurantDetailPath(restaurantId: string = MOCK_RESTAURANT_ID, locale = "ja-JP"): string {
	return `/${locale}/restaurant/${restaurantId}`;
}

/** 店舗詳細配下の子ルート（`dish-category` / `feed`）の URL */
export function restaurantSubPath(
	segment: "dish-category" | "feed",
	restaurantId: string = MOCK_RESTAURANT_ID,
	locale = "ja-JP",
): string {
	return `${restaurantDetailPath(restaurantId, locale)}/${segment}`;
}

/** 固定の店舗詳細レスポンス */
function buildRestaurantDetail(): GetRestaurantByIdResponse {
	return {
		restaurant: {
			id: MOCK_RESTAURANT_ID,
			name: MOCK_RESTAURANT_NAME,
			google_place_id: "e2e-1386-place",
			latitude: 35.681236,
			longitude: 139.767125,
			image_url: "",
			imageUrls: undefined,
			// 型は shared の SupabaseRestaurants 由来で、画面が参照しないカラムまで必須になっている。
			// ここでは «画面が読む分だけ» を埋めてキャストで通す（アプリ側の型を緩めないため）
		} as unknown as GetRestaurantByIdResponse["restaurant"],
		meta: { reviewCount: 0, averageRating: 0, totalCents: 0, maxEndDate: null },
	};
}

/**
 * 固定の営業時間。**既定は «1 件も無い»**（`days` が空なら画面は欄ごと出さない）。
 *
 * ルーティングの検証に営業時間は要らないので、ここでは «出さない» を固定する。
 * 中身を検証したくなったら `buildRestaurantDetail` と同じくオプションで分岐させること。
 */
function buildOpeningHours(): GetRestaurantOpeningHoursResponse {
	return { days: [], sources: [], fetchedAt: null };
}

/** グリッドに 1 件だけ出すときの dish_media id。押下先（feed）のアサーションから参照する */
export const MOCK_DISH_MEDIA_ID = "e2e-1386-dish-media";

/**
 * 料理メディア。既定は 0 件（グリッドは空。ルーティングの検証には影響しない）。
 *
 * #1629 `withItem` で 1 件返せるようにした。店舗詳細から «アプリ内 push» で出る経路が
 * **投稿グリッド → feed の 1 本だけ**になったため（写真・動画の投稿ボタンを外し、
 * Google マップは外部アプリを開くので push しない）。ブラウザバックの検証に要る。
 *
 * ⚠️ 型は shared の DishMediaEntry 由来で、画面が読まないカラムまで必須になっている。
 *    店舗詳細（`buildRestaurantDetail`）と同じく «画面が読む分だけ» 埋めてキャストで通す。
 *    グリッドが読むのは `dish_media.id` と `dish_media.thumbnailImageUrl` だけである
 *    （`features/map/components/tabs/RestaurantReviewsTab.tsx`）。
 */
function buildDishMedia(withItem: boolean): QueryRestaurantDishMediaResponse {
	if (!withItem) return { data: [], nextCursor: null };
	return {
		data: [
			{
				dish_media: {
					id: MOCK_DISH_MEDIA_ID,
					// 空文字なら expo-image は何も描かないが、タイル（押せる器）は出る
					thumbnailImageUrl: "",
					mediaUrl: "",
					render_type: "stored",
				},
				dish: { id: "e2e-1386-dish", name: "E2E ラーメン" },
				restaurant: { id: MOCK_RESTAURANT_ID, name: MOCK_RESTAURANT_NAME },
				reviews: [],
			} as unknown as QueryRestaurantDishMediaResponse["data"][number],
		],
		nextCursor: null,
	};
}

/**
 * 店舗詳細が呼ぶ API を固定レスポンスへ差し替える。
 *
 * `page.goto()` より前に呼ぶこと（route の登録前に飛んだリクエストは素通しになる）。
 *
 * ⚠️ **Playwright は «後から登録した route を先に» 見る。** 登録順は «広い → 狭い» にすること。
 * 先頭の網（`MOCK_RESTAURANT_ANY_SUBRESOURCE_PATTERN`）は最初に登録するので、
 * あとから登録した個別パターンが必ず勝つ。
 */
export async function mockRestaurantDetail(page: Page, options: { withDishMedia?: boolean } = {}): Promise<void> {
	/*
	いちばん広い網を «最初に» 登録する（= いちばん弱い）。個別に固定していないサブリソースが
	実 API へ漏れて 400 / 404 になり、console error ゲートで «無関係な理由の赤» を作るのを防ぐ。

	⚠️ 握り潰さない。**どの URL が網に落ちたかを CI のログへ必ず出す。**
	   黙って 200 を返すと «画面に何も出ない理由» が誰にも分からなくなる。
	*/
	await page.route(MOCK_RESTAURANT_ANY_SUBRESOURCE_PATTERN, async (route) => {
		process.stdout.write(
			`[mockRestaurantDetail] 固定していない店舗 API が呼ばれた: ${route.request().url()}\n` +
				"  → 中身が要るなら utils/restaurantDetail.ts へ個別のパターンを足すこと\n",
		);
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ success: true, data: null }),
		});
	});
	await page.route(DETAIL_URL_PATTERN, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ success: true, data: buildRestaurantDetail() }),
		});
	});
	await page.route(DISH_MEDIA_URL_PATTERN, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ success: true, data: buildDishMedia(options.withDishMedia === true) }),
		});
	});
	await page.route(OPENING_HOURS_URL_PATTERN, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ success: true, data: buildOpeningHours() }),
		});
	});
}
