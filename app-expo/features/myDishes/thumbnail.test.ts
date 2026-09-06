/*
#1398 PR5 サムネイル解決の共通関数（`features/myDishes/thumbnail.ts`）。

`calendar.ts` にあった `resolveDayThumbnailUrl` の実装をここへ切り出し、list ビューと
共有した。固定したいのは #1375 追補2 決定3 の 3 段フォールバックそのもの：
`dishMedia.thumbnailImageUrl` → `dish.categoryImageUrl` → `restaurant.imageUrls?.sm` → null。
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
		restaurant: {
			id: "restaurant-1",
			name: "テスト食堂",
			// ⚠️ #1779 `image_url` は **レスポンス契約から外した列**（DB からも落とす）。
			//    それでも «古い API から来た余計なキー» を実体として置いておく。
			//    誤ってフォールバック先へ戻したら赤くするためである（下のテスト参照）
			image_url: overrides.restaurantImageUrl ?? null,
			imageUrls: overrides.restaurantImageUrl ? { sm: overrides.restaurantImageUrl, md: overrides.restaurantImageUrl } : undefined,
		},
		dish: { id: "dish-1", name: "ラーメン", categoryImageUrl: overrides.categoryImageUrl ?? null },
		dishMedia:
			overrides.thumbnailImageUrl === undefined || overrides.thumbnailImageUrl === null
				? null
				: { id: "media-1", thumbnailImageUrl: overrides.thumbnailImageUrl },
		myReview: null,
		isOwnMediaDeleted: overrides.isOwnMediaDeleted ?? false,
	}) as unknown as MyDishItem;

describe("#1779 `restaurant.image_url` へは落とさない", () => {
	/*
	 ⚠️ **この列は消す。** 非空 2,423 行のうち 2,321 行が Google の写真 URI で、
	 ToS 3.2.3 により保持できない（#1779 / #1780）。#1680 が「店の画像は `imageUrls`
	 から取る」と決めたのに、list / calendar / 地図の 3 箇所だけ移行から漏れていた。

	 ここが緑である限り、フォールバック先を `image_url` へ戻すと赤くなる。
	*/
	it("imageUrls が無ければ、image_url があっても null を返す", () => {
		const item = makeItem({ thumbnailImageUrl: null, categoryImageUrl: null, restaurantImageUrl: null });
		// 実データと同じく «image_url だけ在る» 行を作る（imageUrls は image_path 由来なので付かない）。
		// 型からは外した列なので、実体だけを置く（古い API のレスポンスを模す）。
		(item.restaurant as unknown as Record<string, unknown>).image_url =
			"https://lh3.googleusercontent.com/places/legacy.jpg";
		expect(resolveMyDishThumbnailUrl(item)).toBeNull();
	});
});

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

	it("categoryImageUrl も無ければ restaurant.imageUrls?.sm へ落ちる", () => {
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
});

/*
#1513 «自分の投稿が削除済み» の行は、写真枠を墓標にする。

ここで固定したいのは **フォールバックより先に判定すること**。`isOwnMediaDeleted === true` の
とき API は `dishMedia` を null にして返すので、順序を逆にすると `categoryImageUrl` /
店の画像へ落ちてしまい、自分が消した写真の跡地に別の絵が入る
（= 消えたことが利用者に伝わらない）。オーナー確定仕様は「黙って差し替えない・行は消さない」。
*/
describe("resolveMyDishThumbnail（#1513 墓標）", () => {
	it("isOwnMediaDeleted なら、categoryImageUrl / 店の画像があっても deleted を返す", () => {
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
