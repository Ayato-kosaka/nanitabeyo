/*
#1397 一覧ビューのカードと Sheet の行が共有する «画像の決め方» を固定する。

ここが崩れると、写真なしの記録（#1395 で `dish_reviews.created_dish_media_id` の NOT NULL を
解除したので実際に来る）が Sheet で灰色の箱になる（#1375 追補2 決定3 違反）か、
逆に一覧ビューのプレースホルダーが勝手に実画像へ変わる（#1396 PR3 の挙動の回帰）。
*/
import type { MyDishItem } from "@shared/api/v1/res";
import { formatMyDishOccurredAt, resolveMyDishImageUrl, resolveMyDishTitle } from "./myDishCard";

const makeItem = (overrides: Record<string, unknown> = {}): MyDishItem =>
	({
		key: "review:1",
		status: "eaten",
		occurredAt: "2026-08-01T00:00:00.000Z",
		// #1680 店の画像は imageUrls から取る。`image_url`（@deprecated）は **意図的に非空のまま**にして、
		// «うっかり image_url へ戻したら落ちる» 形にしてある（下の «使わない» ケースを参照）
		restaurant: {
			id: "r1",
			name: "テスト食堂",
			image_url: "https://example.com/deprecated-should-not-be-used.jpg",
			imageUrls: { sm: "https://example.com/restaurant-sm.jpg", md: "https://example.com/restaurant-md.jpg" },
		},
		dish: { id: "d1", name: "唐揚げ定食", categoryImageUrl: "https://example.com/category.jpg" },
		dishMedia: null,
		myReview: null,
		...overrides,
	}) as unknown as MyDishItem;

describe("resolveMyDishImageUrl", () => {
	it("写真があれば常に dishMedia.thumbnailImageUrl を使う", () => {
		const item = makeItem({ dishMedia: { thumbnailImageUrl: "https://example.com/media.jpg" } });
		expect(resolveMyDishImageUrl(item, "none")).toBe("https://example.com/media.jpg");
		expect(resolveMyDishImageUrl(item, "category")).toBe("https://example.com/media.jpg");
	});

	it('fallback "none"（一覧ビュー）は写真なしで null を返す（呼び出し側がプレースホルダーを描く）', () => {
		expect(resolveMyDishImageUrl(makeItem(), "none")).toBeNull();
	});

	it('fallback "category"（Sheet）は categoryImageUrl → restaurant.imageUrls.sm の順で実画像を返す', () => {
		expect(resolveMyDishImageUrl(makeItem(), "category")).toBe("https://example.com/category.jpg");

		const noCategory = makeItem({ dish: { id: "d1", name: "唐揚げ定食", categoryImageUrl: "" } });
		expect(resolveMyDishImageUrl(noCategory, "category")).toBe("https://example.com/restaurant-sm.jpg");
	});

	// #1680 @deprecated な image_url へ戻ったら落ちる。fixture の image_url は非空なので、
	// 実装が image_url を読んでいればこのテストは «画像が返って» 落ちる
	it("@deprecated な restaurant.image_url は使わない（imageUrls が無ければ null）", () => {
		const noImageUrls = makeItem({
			dish: { id: "d1", name: "唐揚げ定食", categoryImageUrl: "" },
			restaurant: { id: "r1", name: "テスト食堂", image_url: "https://example.com/deprecated.jpg" },
		});
		expect(resolveMyDishImageUrl(noImageUrls, "category")).toBeNull();
	});

	it("どれも無ければ null（`<Image>` へ空文字を渡さない）", () => {
		const bare = makeItem({
			dish: { id: "d1", name: null, categoryImageUrl: "" },
			restaurant: { id: "r1", name: "テスト食堂", image_url: "", imageUrls: undefined },
		});
		expect(resolveMyDishImageUrl(bare, "category")).toBeNull();
	});
});

describe("resolveMyDishTitle", () => {
	it("料理名 → 店名の順で落とす", () => {
		expect(resolveMyDishTitle(makeItem())).toBe("唐揚げ定食");
		expect(resolveMyDishTitle(makeItem({ dish: { id: "d1", name: null, categoryImageUrl: "" } }))).toBe("テスト食堂");
	});
});

describe("formatMyDishOccurredAt", () => {
	it("パースできる日時は端末ロケールの日付になる", () => {
		expect(formatMyDishOccurredAt("2026-08-01T00:00:00.000Z", "en-US")).toContain("2026");
	});

	it("パースできない値では Invalid Date を出さず null を返す", () => {
		expect(formatMyDishOccurredAt("not-a-date", "en-US")).toBeNull();
	});
});
