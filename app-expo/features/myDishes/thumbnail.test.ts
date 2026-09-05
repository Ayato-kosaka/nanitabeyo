/*
#1398 PR5 サムネイル解決の共通関数（`features/myDishes/thumbnail.ts`）。

`calendar.ts` にあった `resolveDayThumbnailUrl` の実装をここへ切り出し、list ビューと
共有した。固定したいのは #1375 追補2 決定3 の 3 段フォールバックそのもの：
`dishMedia.thumbnailImageUrl` → `dish.categoryImageUrl` → `restaurant.image_url` → null。
*/
import type { MyDishItem } from "@shared/api/v1/res";
import { resolveMyDishThumbnail, resolveMyDishThumbnailUrl } from "./thumbnail";

const makeItem = (
	overrides: {
		thumbnailImageUrl?: string | null;
		categoryImageUrl?: string | null;
		restaurantImageUrl?: string | null;
		isOwnMediaDeleted?: boolean;
	} = {},
): MyDishItem =>
	({
		key: "review:1",
		status: "eaten",
		occurredAt: "2026-08-10T12:00:00.000Z",
		savedAt: null,
		eatenAt: "2026-08-10T12:00:00.000Z",
		restaurant: { id: "restaurant-1", name: "テスト食堂", image_url: overrides.restaurantImageUrl ?? null },
		dish: { id: "dish-1", name: "ラーメン", categoryImageUrl: overrides.categoryImageUrl ?? null },
		dishMedia:
			overrides.thumbnailImageUrl === undefined || overrides.thumbnailImageUrl === null
				? null
				: { id: "media-1", thumbnailImageUrl: overrides.thumbnailImageUrl },
		myReview: null,
		isOwnMediaDeleted: overrides.isOwnMediaDeleted ?? false,
	}) as unknown as MyDishItem;

describe("resolveMyDishThumbnailUrl（#1375 追補2 決定3）", () => {
	it("dishMedia があればそのサムネイルを優先する", () => {
		const item = makeItem({
			thumbnailImageUrl: "https://example.com/media.jpg",
			categoryImageUrl: "https://example.com/category.jpg",
			restaurantImageUrl: "https://example.com/restaurant.jpg",
		});
		expect(resolveMyDishThumbnailUrl(item)).toBe("https://example.com/media.jpg");
	});

	it("dishMedia === null なら categoryImageUrl へ落ちる（灰色プレースホルダーにしない）", () => {
		const item = makeItem({
			thumbnailImageUrl: null,
			categoryImageUrl: "https://example.com/category.jpg",
			restaurantImageUrl: "https://example.com/restaurant.jpg",
		});
		expect(item.dishMedia).toBeNull();
		expect(resolveMyDishThumbnailUrl(item)).toBe("https://example.com/category.jpg");
	});

	it("categoryImageUrl も無ければ restaurant.image_url へ落ちる", () => {
		const item = makeItem({
			thumbnailImageUrl: null,
			categoryImageUrl: null,
			restaurantImageUrl: "https://example.com/restaurant.jpg",
		});
		expect(resolveMyDishThumbnailUrl(item)).toBe("https://example.com/restaurant.jpg");
	});

	it("3 つとも無ければ null（呼び出し側が無地プレースホルダーを出す唯一のケース）", () => {
		expect(
			resolveMyDishThumbnailUrl(
				makeItem({ thumbnailImageUrl: null, categoryImageUrl: null, restaurantImageUrl: null }),
			),
		).toBeNull();
	});

	/*
	#1273 **«無い» は null ではなく空文字で来る。**

	`dish_categories.image_url` も `restaurants.image_url` も NOT NULL の TEXT で、
	同期は `COALESCE(..., '')` で書く（`9_1_sync_dish_categories.py` / `9_1_sync_restaurants.py`）。
	`??` で繋いでいたので空文字が «見つかった» 扱いで通り、次の候補へ落ちていなかった。
	dev 実測（2026-09-05）で絵の無いカテゴリは 221 種類・usable の 2.15% にあたる。
	*/
	it("#1273 categoryImageUrl が空文字でも restaurant.image_url へ落ちる", () => {
		const item = makeItem({
			thumbnailImageUrl: null,
			categoryImageUrl: "",
			restaurantImageUrl: "https://example.com/restaurant.jpg",
		});
		expect(resolveMyDishThumbnailUrl(item)).toBe("https://example.com/restaurant.jpg");
	});

	it("#1273 全部空文字なら空文字ではなく null を返す", () => {
		const item = makeItem({ thumbnailImageUrl: null, categoryImageUrl: "", restaurantImageUrl: "" });
		expect(resolveMyDishThumbnailUrl(item)).toBeNull();
		// 呼び出し側の分岐（`url ? photo : none`）と `!== null` が食い違わないこと
		expect(resolveMyDishThumbnail(item)).toEqual({ kind: "none" });
	});
});

/*
#1513 «自分の投稿が削除済み» の行は、写真枠を墓標にする。

ここで固定したいのは **フォールバックより先に判定すること**。`isOwnMediaDeleted === true` の
とき API は `dishMedia` を null にして返すので、順序を逆にすると `categoryImageUrl` /
`restaurant.image_url` へ落ちてしまい、自分が消した写真の跡地に別の絵が入る
（= 消えたことが利用者に伝わらない）。オーナー確定仕様は「黙って差し替えない・行は消さない」。
*/
describe("resolveMyDishThumbnail（#1513 墓標）", () => {
	it("isOwnMediaDeleted なら、categoryImageUrl / restaurant.image_url があっても deleted を返す", () => {
		const item = makeItem({
			thumbnailImageUrl: null,
			categoryImageUrl: "https://example.com/category.jpg",
			restaurantImageUrl: "https://example.com/restaurant.jpg",
			isOwnMediaDeleted: true,
		});
		expect(resolveMyDishThumbnail(item)).toEqual({ kind: "deleted" });
	});

	it("削除されていなければ従来の 3 段フォールバックのまま（photo / none）", () => {
		expect(resolveMyDishThumbnail(makeItem({ thumbnailImageUrl: "https://example.com/media.jpg" }))).toEqual({
			kind: "photo",
			url: "https://example.com/media.jpg",
		});
		expect(resolveMyDishThumbnail(makeItem({ categoryImageUrl: "https://example.com/category.jpg" }))).toEqual({
			kind: "photo",
			url: "https://example.com/category.jpg",
		});
		expect(resolveMyDishThumbnail(makeItem())).toEqual({ kind: "none" });
	});
});
