/*
#1375 実機確認（5 巡目）「料理カテゴリーは縦スクロールで選びたい。その上に検索ボックス」。

打たないと何も出ない画面だったので、**その店で既に記録がある料理**を縦に並べる。
守るのは 3 つ。
1. 専用の API を作らず、店舗フィードの既存 1 本から数えて畳む
2. 多い順に並ぶ（同数はラベル順。取得のたびに並びが変わらない）
3. 失敗しても画面は壊さない（候補ゼロへ静かに縮退する。検索欄では選べる）
*/
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP" }) }));

import { useRestaurantDishCategories } from "./useRestaurantDishCategories";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
#1629（オーナー確定）候補の表示名は `dish_categories.labels` から locale で引く。
`dishes.name`（その店での呼び名）は表示に使わないので、labels を動かして書く。
*/
const entry = (categoryId: string | null, ja: string | null) => ({
	dish: {
		category_id: categoryId,
		name: "その店での呼び名（表示には使わない）",
		categoryLabels: ja === null ? null : { ja },
	},
});
/** labels に日本語が無い行（英語だけ / 何も無い）を作る */
const entryWithLabels = (categoryId: string, categoryLabels: Record<string, string> | null) => ({
	dish: { category_id: categoryId, name: "udon", categoryLabels },
});

function Probe({ restaurantId }: { restaurantId: string }) {
	const { categories } = useRestaurantDishCategories(restaurantId);
	return <Text testID="result">{categories.map((c) => `${c.label}:${c.count}`).join(",")}</Text>;
}

const renderProbe = async () => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<Probe restaurantId="r-1" />);
	});
	await act(async () => {});
	return tree;
};

const resultOf = (tree: TestRenderer.ReactTestRenderer): string =>
	tree.root.find((n) => typeof n.type === "string" && n.props?.testID === "result").props.children;

describe("useRestaurantDishCategories", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("店舗フィードの既存エンドポイントだけを叩く（専用 API を作らない）", async () => {
		mockCallBackend.mockResolvedValue({ data: [entry("cat-a", "ラーメン")] });
		await renderProbe();
		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(mockCallBackend.mock.calls[0][0]).toBe("v1/restaurants/r-1/dish-media");
	});

	it("同じカテゴリを数え、多い順（同数はラベル順）に並べる", async () => {
		mockCallBackend.mockResolvedValue({
			data: [entry("cat-a", "ラーメン"), entry("cat-b", "餃子"), entry("cat-a", "ラーメン"), entry("cat-c", "炒飯")],
		});
		const tree = await renderProbe();
		// ラーメン 2 件が先頭。餃子と炒飯は同数なのでラベル順
		expect(resultOf(tree)).toBe("ラーメン:2,炒飯:1,餃子:1");
	});

	it("カテゴリを持たない行は候補にしない（選んでも id を返せないため）", async () => {
		mockCallBackend.mockResolvedValue({ data: [entry(null, "名前だけの料理"), entry("cat-a", "ラーメン")] });
		const tree = await renderProbe();
		expect(resultOf(tree)).toBe("ラーメン:1");
	});

	it("失敗しても候補ゼロへ静かに縮退し、ログだけ残す", async () => {
		mockCallBackend.mockRejectedValue(new Error("boom"));
		const tree = await renderProbe();
		expect(resultOf(tree)).toBe("");
		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event_name: "restaurant_dish_categories_failed", error_level: "warn" }),
		);
	});
});

/*
#1629【オーナー実機報告】「このお店の料理が **9483163** って出てる」。

表示名を `dish.name || category_id` にしていたため、その店での呼び名が空の行では
**カテゴリ id が画面に出て**、選ぶとその id が «料理の名前» として下流へ流れていた。
表示名は `dishCategoryLabel.ts` の規則（`labels[言語] → labels["en"] → name`）で解決し、
**id へは絶対に落とさない**。
*/
describe("#1629 表示名の解決", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	// ★ ここが本命。id が画面へ出ることを二度と許さない
	it("名前も labels も無い行は候補にしない（カテゴリ id を表示名にしない）", async () => {
		mockCallBackend.mockResolvedValue({ data: [entry("9483163", ""), entry("cat-a", "ラーメン")] });
		const tree = await renderProbe();
		expect(resultOf(tree)).toBe("ラーメン:1");
		expect(resultOf(tree)).not.toContain("9483163");
	});

	it("labels があれば、その店での呼び名より labels[言語] を優先する", async () => {
		mockCallBackend.mockResolvedValue({ data: [entryWithLabels("cat-a", { ja: "うどん", en: "Udon" })] });
		const tree = await renderProbe();
		expect(resultOf(tree)).toBe("うどん:1");
	});

	// ★ #1629: 呼び名（udon）へは落ちない。en があれば en、無ければ候補から外れる
	it("labels に自分の言語が無ければ en。en も無ければ候補にしない（呼び名へ落ちない）", async () => {
		mockCallBackend.mockResolvedValue({
			data: [entryWithLabels("cat-a", { en: "Udon" }), entry("cat-b", "餃子"), entryWithLabels("cat-c", {})],
		});
		const tree = await renderProbe();
		expect(resultOf(tree)).toBe("Udon:1,餃子:1");
	});
});
