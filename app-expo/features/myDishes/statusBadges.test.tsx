/*
#1375 実機確認（5 巡目）「食べたい / 食べたの内訳が読めない」への対処の回帰テスト。

守るのは 3 つ。
1. 色の正が `statusColors.ts` の 1 箇所にあること（カード・一覧・カレンダー・地図で同じ緑とオレンジ）
   ＋ どちらの塗りも «上に載る白» が読める暗さであること（#1834 で区別が色相 1 本になったため）
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
import { FixedColors } from "@/constants/Palette";
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

describe("#1375 / #1834 食べたい=オレンジ / 食べた=緑 の内訳表示", () => {
	it("countMyDishStatuses は status を 2 つの数へ畳む", () => {
		expect(countMyDishStatuses([{ status: "want" }, { status: "eaten" }, { status: "eaten" }])).toEqual({
			want: 1,
			eaten: 2,
		});
		expect(countMyDishStatuses([])).toEqual({ want: 0, eaten: 0 });
	});

	it("色は statusColors の 1 箇所が正: 食べた = 緑塗り / 食べたい = オレンジ塗り", () => {
		// #1834（10 巡目・オーナー指示「食べたい は緑塗りにして欲しい」）。
		// 区別は **色相 1 本**で持つので、2 つの塗りが違う色であることが要である
		expect(MY_DISH_STATUS_COLORS.want.fill).not.toBe(MY_DISH_STATUS_COLORS.eaten.fill);
		/*
		#1834 続き（11 巡目・オーナー指示）**🟢 は «完了» の記号なので «食べた» 側へ当てる。**

		⚠️ ここは «2 色が違うこと» ではなく **«どちらの状態にどちらの色が当たるか»** を縛る。
		   10 巡目までこの向きを縛っていなかったため、当てる先を入れ替えても
		   テストが緑のまま通ってしまう状態だった（＝逆向きの再発を検知できない）。
		*/
		expect(MY_DISH_STATUS_COLORS.eaten.fill).toBe(FixedColors.myDishStatusGreen);
		expect(MY_DISH_STATUS_COLORS.want.fill).toBe(FixedColors.myDishStatusOrange);
		// どちらも塗りの上に白の文字・枠を載せる（3 つ組が揃っていること）
		expect(MY_DISH_STATUS_COLORS.want.on).toBe("#FFFFFF");
		expect(MY_DISH_STATUS_COLORS.want.border).toBe("#FFFFFF");
		expect(MY_DISH_STATUS_COLORS.eaten.on).toBe("#FFFFFF");
		expect(MY_DISH_STATUS_COLORS.eaten.border).toBe("#FFFFFF");
		// 「同色に同色」を作れないこと（塗りの上の文字が読めなくなる）
		expect(MY_DISH_STATUS_COLORS.want.fill).not.toBe(MY_DISH_STATUS_COLORS.want.on);
		expect(MY_DISH_STATUS_COLORS.eaten.fill).not.toBe(MY_DISH_STATUS_COLORS.eaten.on);
		/*
		#1834 ⚠️ **塗りの上に載る白が読めるだけの暗さを保つ。**
		   区別が色相 1 本になったぶん、明るい緑へ動かすと «白文字が読めない» が直に出る。
		   UI 部品の下限 3:1 を、輝度比で機械的に見る（`#2E7D32` = 5.13:1 / `#ED6C02` = 3.11:1）。
		*/
		const luminance = (hex: string) => {
			const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
			const lin = ch.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
			return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
		};
		for (const paint of Object.values(MY_DISH_STATUS_COLORS)) {
			expect(1.05 / (luminance(paint.fill) + 0.05)).toBeGreaterThanOrEqual(3);
		}
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
