/*
#1375 実機確認（5 巡目）「食べたい / 食べたの内訳が読めない」への対処の回帰テスト。

守るのは 3 つ。
1. 色の正が `statusColors.ts` の 1 箇所にあること（カード・一覧・カレンダー・地図で同じ緑とオレンジ）
2. 内訳バッジは 0 件の側を描かないこと（1 件の日に «0» が並ばない）
3. 地図の帯タイルが `pin.counts` をそのまま出すこと（この表示のために API を増やさない）
*/
import React from "react";
import { Text } from "react-native";
import TestRenderer from "react-test-renderer";

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("@/lib/image", () => ({ getCacheKeyForImage: (uri: string) => uri }));

import { MY_DISH_STATUS_COLORS, countMyDishStatuses } from "./statusColors";
import { MyDishStatusLegend } from "./components/MyDishStatusLegend";
import { MyDishesMapSheet } from "./components/MyDishesMapSheet";
import type { MyDishPin } from "@shared/api/v1/res";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pin = (name: string, want: number, eaten: number): MyDishPin =>
	({
		restaurant: { id: `r-${name}`, name, image_url: null },
		counts: { want, eaten },
		latestOccurredAt: "2026-08-20T10:00:00.000Z",
		representativeThumbnailUrl: null,
	}) as unknown as MyDishPin;

function render(element: React.ReactElement) {
	let tree!: TestRenderer.ReactTestRenderer;
	TestRenderer.act(() => {
		tree = TestRenderer.create(element);
	});
	return tree;
}

/** ホスト要素だけ数える（合成要素と二重に当たるため。react-test-renderer の定石） */
const countOf = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
	tree.root.findAll((n) => typeof n.type === "string" && n.props?.testID === testID).length;

describe("#1375 / #1834 食べたい=緑 / 食べた=オレンジ の内訳表示", () => {
	it("countMyDishStatuses は status を 2 つの数へ畳む", () => {
		expect(countMyDishStatuses([{ status: "want" }, { status: "eaten" }, { status: "eaten" }])).toEqual({
			want: 1,
			eaten: 2,
		});
		expect(countMyDishStatuses([])).toEqual({ want: 0, eaten: 0 });
	});

	it("色は statusColors の 1 箇所が正: 食べたい = 白塗り緑枠 / 食べた = オレンジ塗り", () => {
		// #1375（5 巡目）オーナー指示で色相分けから «塗りの有無» へ変え、
		// #1834（チーム指摘）でその上に色相を **足した**（置き換えていない）。
		// 白塗りの側は文字も枠も緑でなければ読めないので、3 つ組が揃っていることまで見る
		expect(MY_DISH_STATUS_COLORS.want.fill).toBe("#FFFFFF");
		expect(MY_DISH_STATUS_COLORS.want.border).toBe(MY_DISH_STATUS_COLORS.want.on);
		expect(MY_DISH_STATUS_COLORS.eaten.on).toBe("#FFFFFF");
		// 「白地に白文字」を作れないこと
		expect(MY_DISH_STATUS_COLORS.want.fill).not.toBe(MY_DISH_STATUS_COLORS.want.on);
		expect(MY_DISH_STATUS_COLORS.eaten.fill).not.toBe(MY_DISH_STATUS_COLORS.eaten.on);
		/*
		#1834 **手がかりを 2 つ持つ**（どちらか片方を消さないための固定）。
		  1. 塗りの有無 … want は白塗り、eaten は色で塗る
		  2. 色相      … want と eaten の記号色が違う
		*/
		expect(MY_DISH_STATUS_COLORS.want.fill).not.toBe(MY_DISH_STATUS_COLORS.eaten.fill);
		expect(MY_DISH_STATUS_COLORS.want.on).not.toBe(MY_DISH_STATUS_COLORS.eaten.fill);
	});

	it("凡例は «食べたい» と «食べた» の 2 つを、それぞれの塗りの丸つきで出す", () => {
		const tree = render(<MyDishStatusLegend />);
		const dots = tree.root.findAll(
			(node) =>
				typeof node.type === "string" &&
				Array.isArray(node.props.style) &&
				node.props.style.some(
					(s: unknown) =>
						typeof s === "object" &&
						s !== null &&
						"backgroundColor" in (s as Record<string, unknown>) &&
						Object.values(MY_DISH_STATUS_COLORS)
							.map((paint) => paint.fill)
							.includes((s as { backgroundColor: string }).backgroundColor),
				),
		);
		expect(dots).toHaveLength(2);
	});

	it("地図の帯タイルは pin.counts をそのまま出し、0 件の側は描かない", () => {
		const tree = render(
			<MyDishesMapSheet pins={[pin("両方あり", 2, 3), pin("食べたいだけ", 1, 0)]} onSelectPin={jest.fn()} />,
		);
		// want: 2 枚とも / eaten: 1 枚だけ
		expect(countOf(tree, "my-dishes-map-tile-count-want")).toBe(2);
		expect(countOf(tree, "my-dishes-map-tile-count-eaten")).toBe(1);
		// 見出しは «レストランの件数»（ピン数）
		expect(tree.root.findAllByProps({ testID: "my-dishes-map-sheet-legend" }).length).toBeGreaterThan(0);
	});

	/**
	 * #1375（6 巡目・オーナー指示）**1 件でも数字を出す。**
	 *
	 * 5 巡目では «1 件なら点だけ» にしていたが、実機で見て «1 と書いてほしい» と指示された。
	 * 点だけだと «1 件なのか、単なる色の印なのか» が読み取れないため。
	 */
	it("件数が 1 でも «1» と表示する（点だけにしない）", () => {
		const tree = render(<MyDishesMapSheet pins={[pin("1 件ずつ", 1, 1)]} onSelectPin={jest.fn()} />);
		const textOf = (testID: string) =>
			tree.root
				.findAllByProps({ testID })
				.flatMap((node) => node.findAllByType(Text))
				.map((node) => node.props.children)
				.filter((child) => child !== undefined && child !== null);
		expect(textOf("my-dishes-map-tile-count-want")).toContain(1);
		expect(textOf("my-dishes-map-tile-count-eaten")).toContain(1);
	});
});
