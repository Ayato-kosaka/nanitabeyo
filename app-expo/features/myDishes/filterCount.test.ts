/*
#1375（オーナー指示）絞り込みアイコンのバッジの数。

**並び替えは数えない。** バッジは «棚を削っているものが何個あるか» を表すためのもので、
並び替え（と、その同伴の特徴量の軸）は棚を削らない。ここを数え始めると
「絞り込んでいないのにバッジが出る」ことになる。
*/
import {
	DEFAULT_MY_DISHES_FILTER,
	countActiveMyDishesFilters,
	type MyDishesFilter,
} from "./stores/useMyDishesFilterStore";

const f = (partial: Partial<MyDishesFilter>): MyDishesFilter => ({ ...DEFAULT_MY_DISHES_FILTER, ...partial });

describe("countActiveMyDishesFilters", () => {
	it("既定（何も絞っていない）は 0", () => {
		expect(countActiveMyDishesFilters(DEFAULT_MY_DISHES_FILTER)).toBe(0);
	});

	it("並び替えだけを変えても 0（棚は削れていない）", () => {
		expect(countActiveMyDishesFilters(f({ sort: "-rating" }))).toBe(0);
	});

	it("特徴量の軸も数えない（並び替えの同伴なので棚を削らない）", () => {
		expect(countActiveMyDishesFilters(f({ sort: "-featureScore", featureKeys: ["timeSlot:dinner"] }))).toBe(0);
	});

	it("状態・カテゴリー・評価・エリアはそれぞれ数える", () => {
		expect(countActiveMyDishesFilters(f({ status: ["eaten"] }))).toBe(1);
		expect(countActiveMyDishesFilters(f({ categoryIds: ["a", "b", "c"] }))).toBe(3);
		expect(countActiveMyDishesFilters(f({ minRating: 4 }))).toBe(1);
		expect(countActiveMyDishesFilters(f({ ratings: [5, 4] }))).toBe(2);
		expect(
			countActiveMyDishesFilters(f({ area: { lat: 35, lng: 139, radius: 3000 } })),
		).toBe(1);
	});

	it("重なれば足し算になる", () => {
		expect(countActiveMyDishesFilters(f({ status: ["eaten"], categoryIds: ["a"], minRating: 4 }))).toBe(3);
	});
});
