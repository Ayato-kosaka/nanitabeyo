import { buildCategoryFacets } from "./categoryFacets";
import type { MyDishItem } from "@shared/api/v1/res";

const item = (categoryId: string | null, name: string | null): MyDishItem =>
	({ dish: { category_id: categoryId, name } }) as unknown as MyDishItem;

describe("#1375（3 巡目）buildCategoryFacets", () => {
	it("件数の多い順に並び、最頻の dish.name をラベルに使う", () => {
		const facets = buildCategoryFacets([
			item("Q1", "ラーメン"),
			item("Q1", "ラーメン"),
			item("Q1", "中華そば"),
			item("Q2", "寿司"),
		]);
		expect(facets).toEqual([
			{ categoryId: "Q1", label: "ラーメン", count: 3 },
			{ categoryId: "Q2", label: "寿司", count: 1 },
		]);
	});

	it("名前が 1 件も無いカテゴリは出さない（QID をユーザーに見せない）", () => {
		const facets = buildCategoryFacets([item("Q9", null), item("Q1", "うどん")]);
		expect(facets.map((f) => f.categoryId)).toEqual(["Q1"]);
	});

	it("category_id が無い行・上限超過は落とす", () => {
		const many = Array.from({ length: 10 }, (_v, i) => item(`Q${i}`, `料理${i}`));
		expect(buildCategoryFacets([item(null, "x"), ...many], 3)).toHaveLength(3);
	});
});
