/*
#1398 (PR4/7) want 行から「食べたを記録」へ送るときの遷移先を固定する。

一覧のカードと Sheet の行という **2 つの呼び出し元**が同じ純関数を使うので、
ここが崩れると両方が同時に壊れる。逆に言えば、ここを固定しておけば
「片方だけパラメータ名が違う」という壊れ方をしない。
*/
import type { MyDishItem } from "@shared/api/v1/res";
import { buildMarkAsEatenRoute } from "./markAsEaten";

const makeItem = (overrides: Partial<MyDishItem>): MyDishItem =>
	({
		key: "dish:dish-1",
		status: "want",
		occurredAt: "2026-08-01T00:00:00.000Z",
		savedAt: "2026-08-01T00:00:00.000Z",
		eatenAt: null,
		restaurant: { id: "restaurant-1", name: "テスト食堂", image_url: null },
		dish: { id: "dish-1", name: "唐揚げ定食", categoryImageUrl: "https://example.com/c.jpg" },
		dishMedia: { id: "media-1", thumbnailImageUrl: "https://example.com/m.jpg" },
		myReview: null,
		distanceMeters: null,
		...overrides,
	}) as unknown as MyDishItem;

describe("buildMarkAsEatenRoute", () => {
	it("既存の review-from-media ルートへ送る（新しいルートは作らない）", () => {
		expect(buildMarkAsEatenRoute(makeItem({}), "ja-JP")).toEqual({
			pathname: "/[locale]/restaurant/[restaurantId]/review-from-media/[dishMediaId]",
			params: { locale: "ja-JP", restaurantId: "restaurant-1", dishMediaId: "media-1" },
		});
	});

	it("dishMedia.id は文字列へ落とす（数値で来ても URL に載せられる形にする）", () => {
		const route = buildMarkAsEatenRoute(
			makeItem({ dishMedia: { id: 42, thumbnailImageUrl: null } as unknown as MyDishItem["dishMedia"] }),
			"en-US",
		);
		expect(route?.params.dishMediaId).toBe("42");
	});

	// want 行の dishMedia は契約上必ず非 null（#1395 m-7）だが、`dishMedia.id` を触る前に必ず絞る
	it("dishMedia が無ければ null（遷移先を組めないので押させない）", () => {
		expect(buildMarkAsEatenRoute(makeItem({ dishMedia: null }), "ja-JP")).toBeNull();
	});
});
