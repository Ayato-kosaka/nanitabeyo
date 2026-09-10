/*
#1667 レビュー 0 件の料理は、評価まわりを何も描かない。

【オーナー確定 2026-09-03】「未評価の場合は何も出さないのが標準かと。」

この規則は最初 `SelectedRestaurantDetails.tsx`（店の評価）にだけ入り、**料理の評価を
出す 2 画面が取り残されていた**。dev 実測で dish_media の 29.32%（1,443/4,922）が
未評価なので、絵に描いた話ではない
（`scripts/db-checks/measure_unrated_dishes.py`）。

⚠️ **この spec の後半は «判定が 1 箇所に閉じていること» を見る。**
画面側が `reviewCount > 0 &&` を自前で書き足すと、4 つ目の画面でまた取り残される。
*/
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@expo/vector-icons", () => ({ FontAwesome: "FontAwesome" }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

import { DishRating } from "@/components/DishRating";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	act(() => {
		tree = TestRenderer.create(element);
	});
	return tree;
};

describe("#1667 DishRating", () => {
	it("reviewCount=0 のとき、何も描かない（★ 空 5 つ + (0) にしない）", () => {
		const tree = render(<DishRating averageRating={0} reviewCount={0} testID="r" />);
		expect(tree.toJSON()).toBeNull();
	});

	it("⚠️ «未評価» のようなラベルも描かない（無いものを言葉で埋めない）", () => {
		const tree = render(<DishRating averageRating={0} reviewCount={0} testID="r" />);
		expect(JSON.stringify(tree.toJSON())).not.toMatch(/未評価|unrated|No rating/i);
	});

	it("averageRating が 0 でも、レビューが 1 件あれば描く（★0 は正当な評価）", () => {
		const tree = render(<DishRating averageRating={0} reviewCount={1} testID="r" />);
		expect(tree.root.findAll((n) => n.props?.testID === "r", { deep: false })).toHaveLength(1);
	});

	it("reviewCount>=1 のときは星と件数を描く", () => {
		const tree = render(<DishRating averageRating={4.2} reviewCount={12} testID="r" />);
		const count = tree.root.findAll((n) => n.props?.testID === "r-count", { deep: false });
		expect(count).toHaveLength(1);
		expect(count[0].props.children).toEqual(["(", 12, ")"]);
	});

	it("負の件数（あり得ないが）でも描かない", () => {
		expect(render(<DishRating averageRating={3} reviewCount={-1} />).toJSON()).toBeNull();
	});
});

/*
⚠️ 判定の置き場を 1 箇所に保つための検査。

「料理の評価を出す画面」が `reviewCount > 0 &&` を自前で書いていたら赤くする。
新しい画面を足すときは DishRating を使うこと。ここへ画面を足す場合は、
**その画面が DishRating を使っていること**を確かめてから CONSUMERS へ加える。
*/
const CONSUMERS = ["features/profile/tabs/LikeTab.tsx", "features/map/components/tabs/RestaurantReviewsTab.tsx"];

describe("#1667 判定は DishRating に閉じている", () => {
	it.each(CONSUMERS)("%s は DishRating を使い、自前で件数を見ない", (relative) => {
		const source = readFileSync(join(__dirname, "..", relative), "utf8");

		expect(source).toContain("DishRating");
		// 自前の出し分けを書き足したら赤くする
		expect(source).not.toMatch(/reviewCount\s*>\s*0\s*&&/);
		// Stars を直接描くのも、判定を迂回する形なので止める
		expect(source).not.toMatch(/<Stars\b/);
	});
});
