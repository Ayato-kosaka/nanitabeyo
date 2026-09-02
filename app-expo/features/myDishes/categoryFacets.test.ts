import { buildCategoryFacets } from "./categoryFacets";
import type { MyDishItem } from "@shared/api/v1/res";

/*
#1629（オーナー確定）表示名は `dish_categories.labels` から locale で引く。
`dishes.name`（その店での呼び名）は**表示に使わない**ので、fixture も labels で作る。
*/
const item = (categoryId: string | null, labels: Record<string, string> | null): MyDishItem =>
	({ dish: { category_id: categoryId, name: "ローマ字が入っていることもある", categoryLabels: labels } }) as unknown as MyDishItem;

describe("#1375（3 巡目）buildCategoryFacets", () => {
	it("件数の多い順に並び、カテゴリの正式表記をラベルに使う", () => {
		const facets = buildCategoryFacets([
			item("Q1", { ja: "ラーメン" }),
			item("Q1", { ja: "ラーメン" }),
			item("Q1", { ja: "ラーメン" }),
			item("Q2", { ja: "寿司" }),
		]);
		expect(facets).toEqual([
			{ categoryId: "Q1", label: "ラーメン", count: 3 },
			{ categoryId: "Q2", label: "寿司", count: 1 },
		]);
	});

	it("表記が 1 つも無いカテゴリは出さない（QID をユーザーに見せない）", () => {
		const facets = buildCategoryFacets([item("Q9", null), item("Q1", { ja: "うどん" })]);
		expect(facets.map((f) => f.categoryId)).toEqual(["Q1"]);
	});

	// ★ #1629: 呼び名がどれだけ入っていても、表記が無ければ出さない
	it("店での呼び名しか無いカテゴリも出さない（dishes.name は表示に使わない）", () => {
		expect(buildCategoryFacets([item("Q9", {})])).toHaveLength(0);
	});

	it("category_id が無い行・上限超過は落とす", () => {
		const many = Array.from({ length: 10 }, (_v, i) => item(`Q${i}`, { ja: `料理${i}` }));
		expect(buildCategoryFacets([item(null, { ja: "x" }), ...many], 3)).toHaveLength(3);
	});
});
