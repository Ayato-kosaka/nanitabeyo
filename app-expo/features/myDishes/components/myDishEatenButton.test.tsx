/*
#1398 (PR4/7)「食べたを記録」CTA の 2 つの不変条件を固定する。

1. **want 行にだけ出す。** eaten 行には出さない（再訪の記録は全画面 Feed の ActionButtons 側。設計 §1(b)）
2. **親のタップを起こさない。** カード・行の全体は #1397 PR4 で全画面 Feed への遷移になっている。
   native はタッチレスポンダが 1 つしか勝たないので放っておいても親は発火しないが、
   **web（react-native-web）は DOM の click がそのまま親へバブルする**。`stopPropagation()` を
   自分で呼ばないと、CTA を押しただけで Feed が開く。ここではその呼び出しを直接固定する。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { MyDishItem } from "@shared/api/v1/res";
import { MyDishEatenButton } from "./myDishCard";

const makeItem = (overrides: Partial<MyDishItem>): MyDishItem =>
	({
		key: "dish:dish-1",
		status: "want",
		occurredAt: "2026-08-01T00:00:00.000Z",
		savedAt: "2026-08-01T00:00:00.000Z",
		eatenAt: null,
		restaurant: { id: "restaurant-1", name: "テスト食堂", image_url: null },
		dish: { id: "dish-1", name: "唐揚げ定食", categoryImageUrl: "https://example.com/c.jpg" },
		dishMedia: { id: "media-1", thumbnailImageUrl: null },
		myReview: null,
		distanceMeters: null,
		...overrides,
	}) as unknown as MyDishItem;

const render = (item: MyDishItem, onPress = jest.fn()) => {
	let tree!: TestRenderer.ReactTestRenderer;
	act(() => {
		tree = TestRenderer.create(<MyDishEatenButton item={item} onPress={onPress} />);
	});
	return { tree, onPress };
};

// Pressable は memo / forwardRef でラップされていて `node.type === Pressable` では拾えないので
// testID と onPress の有無で指す（Pressable 要素と内側の View の両方が当たるため、先頭を使う）
const findButton = (tree: TestRenderer.ReactTestRenderer) =>
	tree.root.findAll(
		(node) => node.props?.testID === "my-dishes-mark-as-eaten" && typeof node.props?.onPress === "function",
	);

const hasButton = (tree: TestRenderer.ReactTestRenderer) => findButton(tree).length > 0;

describe("MyDishEatenButton", () => {
	it("want 行には出る", () => {
		const { tree } = render(makeItem({}));
		expect(hasButton(tree)).toBe(true);
	});

	it("eaten 行には出さない（再訪の記録は Feed の ActionButtons 側）", () => {
		const { tree } = render(makeItem({ status: "eaten" }));
		expect(hasButton(tree)).toBe(false);
	});

	// want の dishMedia は契約上必ず非 null（#1395 m-7）。ここは異常系の防御であって仕様ではない
	it("dishMedia が無ければ出さない（遷移先を組めないため）", () => {
		const { tree } = render(makeItem({ dishMedia: null }));
		expect(hasButton(tree)).toBe(false);
	});

	it("押すと onPress が item ごと呼ばれる", () => {
		const item = makeItem({});
		const { tree, onPress } = render(item);
		act(() => {
			findButton(tree)[0].props.onPress();
		});
		expect(onPress).toHaveBeenCalledWith(item);
	});

	// ここが web でカードごと Feed へ飛ばないための本体
	it("イベントを受け取ったら stopPropagation する（web で親の onPress まで走らせない）", () => {
		const { tree, onPress } = render(makeItem({}));
		const stopPropagation = jest.fn();
		act(() => {
			findButton(tree)[0].props.onPress({ stopPropagation });
		});
		expect(stopPropagation).toHaveBeenCalledTimes(1);
		expect(onPress).toHaveBeenCalledTimes(1);
	});

	// native の GestureResponderEvent は引数無しで呼ばれる経路もある。落ちないこと
	it("イベントが無くても落ちない", () => {
		const { tree, onPress } = render(makeItem({}));
		act(() => {
			expect(() => findButton(tree)[0].props.onPress(undefined)).not.toThrow();
		});
		expect(onPress).toHaveBeenCalledTimes(1);
	});
});
