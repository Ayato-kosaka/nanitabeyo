/*
#1397 (PR5/5) 全画面 Feed の contextual filter chips。

固定するのは 6 点。

1. **並び替えの chip を作らない**（リーダー判断 Q3）。chips は「棚を削る」ものだけ。
   `sortScene` / `sortTimeSlot` に相当する chip が生えていないことをここで固定する。
2. カテゴリ chip は **追加ではなく置換**（`categoryIds` を 1 件に差し替える）。
3. ★N以上の chip は **`status` が `["eaten"]` のときだけ**出す（#1395 m-4: want 行は rating を
   持たないので、評価で絞ると「食べたい」が全消しになる）。
4. **押しても棚が広がらない**。#1629【42】既に効いている絞り込みの chip は、そもそも描かない。
5. 戻る手段はスナックバーの「元に戻す」。押す直前の filter へまるごと戻る。
6. **chip 専用の store を作らない**。書き先は共有の `useMyDishesFilterStore` 1 本だけ
   （= list / Map / Calendar の 3 ビューに同時に効く）。
*/
jest.mock("@/lib/i18n", () => ({
	__esModule: true,
	// ラベルの検証を «キー + 補間値» で行えるようにする（実文言はロケール依存なので見ない）
	default: {
		t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
	},
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));

const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";
import { MyDishesFeedChips, MY_DISHES_FEED_CHIP_MIN_RATING, buildMyDishesFeedChips } from "./MyDishesFeedChips";
import { DEFAULT_MY_DISHES_FILTER, useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CATEGORY_ID = "ramen";

/**
 * #1629【34】既定は «食べた かつ 食べたい» にしてある。状態 chip は
 * `dish_media.isEaten` / `isSaved` が立っているときだけ出るようになったので、
 * 既存のケース（chip の並び・押下・スナックバー）はこの既定で従来どおりの並びになる。
 */
const makeEntry = (overrides?: {
	categoryId?: string | null;
	name?: string | null;
	isEaten?: boolean | undefined;
	isSaved?: boolean;
}): NormalizedDishMediaEntry =>
	({
		restaurant: { id: "restaurant-1", name: "テスト食堂" },
		dish: {
			id: "dish-1",
			category_id: overrides?.categoryId === undefined ? CATEGORY_ID : overrides.categoryId,
			name: overrides?.name === undefined ? "味玉つけ麺" : overrides.name,
		},
		dish_media: {
			id: "media-a",
			isSaved: overrides?.isSaved ?? true,
			isEaten: "isEaten" in (overrides ?? {}) ? overrides?.isEaten : true,
			isLiked: false,
			likeCount: 0,
		},
		dishReviewIds: [],
	}) as unknown as NormalizedDishMediaEntry;

const filterOf = (partial: Partial<typeof DEFAULT_MY_DISHES_FILTER> = {}) => ({
	...DEFAULT_MY_DISHES_FILTER,
	...partial,
});

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = (entry: NormalizedDishMediaEntry | null): TestRenderer.ReactTestRenderer => {
	let tree!: TestRenderer.ReactTestRenderer;
	act(() => {
		tree = TestRenderer.create(<MyDishesFeedChips entry={entry} />);
	});
	mountedTrees.push(tree);
	return tree;
};

const chipNodes = (tree: TestRenderer.ReactTestRenderer) =>
	tree.root.findAll(
		(node) => node.props?.testID === "my-dishes-feed-chip" && typeof node.props?.onPress === "function",
	);

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	mockShowSnackbar.mockReset();
});

afterEach(() => {
	act(() => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

describe("buildMyDishesFeedChips（絞り込みだけ / 並び替えは作らない）", () => {
	it("既定のフィルタでは «カテゴリ・食べた・食べたい» の 3 つだけを出す", () => {
		const chips = buildMyDishesFeedChips(filterOf(), makeEntry());

		expect(chips.map((chip) => chip.id)).toEqual(["category", "statusEaten", "statusWant"]);
		// リーダー判断 Q3: 並び替えの chip は 1 つも作らない
		expect(chips.some((chip) => chip.patch.sort !== undefined)).toBe(false);
		expect(chips.some((chip) => chip.patch.featureKeys !== undefined)).toBe(false);
	});

	it("カテゴリ chip は «追加ではなく置換»（既存の categoryIds を引き継がない）", () => {
		const chips = buildMyDishesFeedChips(filterOf({ categoryIds: ["curry", "sushi"] }), makeEntry());
		const category = chips.find((chip) => chip.id === "category");

		expect(category?.patch).toEqual({ categoryIds: [CATEGORY_ID] });
	});

	it("エントリが無いときは chip を 1 つも出さない（#1629【34】状態 chip も entry 由来になった）", () => {
		expect(buildMyDishesFeedChips(filterOf(), null)).toEqual([]);
	});

	it("カテゴリが無いときはカテゴリ chip だけを落とす（状態 chip は残る）", () => {
		expect(buildMyDishesFeedChips(filterOf(), makeEntry({ categoryId: "" })).map((chip) => chip.id)).toEqual([
			"statusEaten",
			"statusWant",
		]);
	});

	it("料理名が無いときはカテゴリ chip を出さない（QID をラベルに出さない）", () => {
		// #1375 実機確認（3 巡目）: 名前が無い dish（SNS 取り込み等）で ID へ落とすと
		// 「「Q234646」で絞る」のような意味不明の chip が出る。名前があるときだけ出す
		const chips = buildMyDishesFeedChips(filterOf(), makeEntry({ name: null }));

		expect(chips.some((chip) => chip.id === "category")).toBe(false);
		expect(chips[0].id).toBe("statusEaten");
	});

	it('★N以上の chip は status が ["eaten"] のときだけ出す（want は評価を持たない）', () => {
		// 既定（= 両方）でも「食べたい」を含む間は出さない
		expect(buildMyDishesFeedChips(filterOf(), makeEntry()).some((chip) => chip.id === "minRating")).toBe(false);
		expect(
			buildMyDishesFeedChips(filterOf({ status: ["want"] }), makeEntry()).some((chip) => chip.id === "minRating"),
		).toBe(false);
		expect(
			buildMyDishesFeedChips(filterOf({ status: ["eaten", "want"] }), makeEntry()).some(
				(chip) => chip.id === "minRating",
			),
		).toBe(false);

		const chips = buildMyDishesFeedChips(filterOf({ status: ["eaten"] }), makeEntry());
		const minRating = chips.find((chip) => chip.id === "minRating");
		expect(minRating?.patch).toEqual({ minRating: MY_DISHES_FEED_CHIP_MIN_RATING });
	});
});

/*
#1629【42】オーナー指示「フィード画面で『カレーで絞る』とか押したら、そのチップは非表示にして欲しい」。

修正前は «既に効いている chip を選択状態で描き、押しても no-op» にしていたので、下の 5 ケースは
すべて «消えるはずの chip がまだ出ている» で落ちる。

対象はこの Feed が出す 4 種すべて（category / statusEaten / statusWant / minRating）。
エリア・期間・並び替えは chip を持たないので対象外である（根拠は実装側のコメント）。
*/
describe("#1629【42】既にその絞り込みが効いている chip は出さない", () => {
	it("そのカテゴリ 1 件だけに絞られていれば «〈料理名〉で絞る» を出さない", () => {
		const chips = buildMyDishesFeedChips(filterOf({ categoryIds: [CATEGORY_ID] }), makeEntry());

		expect(chips.some((chip) => chip.id === "category")).toBe(false);
		// 他の条件はまだ効いていないので残る
		expect(chips.map((chip) => chip.id)).toEqual(["statusEaten", "statusWant"]);
	});

	it("別のカテゴリも一緒に絞られている間はカテゴリ chip を出す（押せば «置換» で棚が削れる）", () => {
		const chips = buildMyDishesFeedChips(filterOf({ categoryIds: [CATEGORY_ID, "curry"] }), makeEntry());

		expect(chips.some((chip) => chip.id === "category")).toBe(true);
	});

	it('status が ["eaten"] のときは «食べたで絞る» を出さない（«食べたいで絞る» は残る）', () => {
		const chips = buildMyDishesFeedChips(filterOf({ status: ["eaten"] }), makeEntry());

		expect(chips.some((chip) => chip.id === "statusEaten")).toBe(false);
		expect(chips.some((chip) => chip.id === "statusWant")).toBe(true);
	});

	it('status が ["want"] のときは «食べたいで絞る» を出さない', () => {
		const chips = buildMyDishesFeedChips(filterOf({ status: ["want"] }), makeEntry());

		expect(chips.some((chip) => chip.id === "statusWant")).toBe(false);
		expect(chips.some((chip) => chip.id === "statusEaten")).toBe(true);
	});

	it("既に ★N 以上で絞られていれば ★ chip を出さない", () => {
		const chips = buildMyDishesFeedChips(
			filterOf({ status: ["eaten"], minRating: MY_DISHES_FEED_CHIP_MIN_RATING }),
			makeEntry(),
		);

		expect(chips.some((chip) => chip.id === "minRating")).toBe(false);
	});

	it("出せる chip が全部«既に効いている»状態になれば、帯ごと消える", () => {
		// «食べた» だけのエントリ（保存していない）なので «食べたいで絞る» はそもそも出ない（【34】）
		const tree = render(makeEntry({ isSaved: false }));
		act(() => {
			useMyDishesFilterStore.getState().patch({
				categoryIds: [CATEGORY_ID],
				status: ["eaten"],
				minRating: MY_DISHES_FEED_CHIP_MIN_RATING,
			});
		});

		expect(chipNodes(tree)).toHaveLength(0);
		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-feed-chips")).toHaveLength(0);
	});
});

/*
#1629【34】オーナー実機報告「食べたをしてないフィードで『食べたで絞る』と出る」。

修正前は `statusEaten` / `statusWant` を entry を見ずに無条件で積んでいたので、
下の 4 ケースはすべて «出てはいけない chip が出ている» で落ちる。
*/
describe("#1629【34】状態 chip は、いま見ているエントリがその状態のときだけ出す", () => {
	it("まだ食べていない（isEaten: false）エントリでは «食べたで絞る» を出さない", () => {
		const chips = buildMyDishesFeedChips(filterOf(), makeEntry({ isEaten: false }));

		expect(chips.some((chip) => chip.id === "statusEaten")).toBe(false);
		// 食べたい（isSaved）は立っているので、そちらは残る
		expect(chips.map((chip) => chip.id)).toEqual(["category", "statusWant"]);
	});

	it("isEaten が undefined（`GET /v1/dish-media?ids=` 以外の経路）でも «食べたで絞る» を出さない", () => {
		const chips = buildMyDishesFeedChips(filterOf(), makeEntry({ isEaten: undefined }));

		expect(chips.some((chip) => chip.id === "statusEaten")).toBe(false);
	});

	it("保存していない（isSaved: false）エントリでは «食べたいで絞る» を出さない", () => {
		const chips = buildMyDishesFeedChips(filterOf(), makeEntry({ isSaved: false }));

		expect(chips.some((chip) => chip.id === "statusWant")).toBe(false);
		expect(chips.map((chip) => chip.id)).toEqual(["category", "statusEaten"]);
	});

	it("食べたも食べたいも付いていないエントリでは、状態 chip が 1 つも描かれない", () => {
		const tree = render(makeEntry({ isEaten: false, isSaved: false }));
		const labels = chipNodes(tree).map((node) => node.props.accessibilityLabel);

		expect(labels).toEqual(['MyDishes.feed.chips.filterCategory:{"name":"味玉つけ麺"}']);
	});
});

describe("MyDishesFeedChips（共有フィルタ store だけを書く）", () => {
	it("カテゴリ chip を押すと共有 store の categoryIds が置き換わる", () => {
		const tree = render(makeEntry());

		act(() => {
			chipNodes(tree)[0].props.onPress();
		});

		expect(useMyDishesFilterStore.getState().filter.categoryIds).toEqual([CATEGORY_ID]);
		// 絞り込み以外は 1 つも動かない（並び替え・エリア・期間は chip の責務ではない）
		expect(useMyDishesFilterStore.getState().filter.sort).toBe(DEFAULT_MY_DISHES_FILTER.sort);
		expect(useMyDishesFilterStore.getState().filter.area).toBeNull();
	});

	it("状態 chip を押すと status が 1 件に置き換わり、押した chip が消えて ★ chip が現れる", () => {
		const tree = render(makeEntry());

		// [category, statusEaten, statusWant] の 2 番目
		act(() => {
			chipNodes(tree)[1].props.onPress();
		});

		expect(useMyDishesFilterStore.getState().filter.status).toEqual(["eaten"]);
		// #1629【42】押した «食べたで絞る» は消え、「食べた」だけになったので ★N以上 が出る
		expect(chipNodes(tree).map((node) => node.props.accessibilityLabel)).toEqual([
			'MyDishes.feed.chips.filterCategory:{"name":"味玉つけ麺"}',
			"MyDishes.feed.chips.filterStatusWant",
			`MyDishes.feed.chips.filterMinRating:{"count":${MY_DISHES_FEED_CHIP_MIN_RATING}}`,
		]);
	});

	it("スナックバーの「元に戻す」で、押す直前のフィルタへ戻る", () => {
		useMyDishesFilterStore.getState().patch({ status: ["eaten"], categoryIds: ["curry"] });
		const tree = render(makeEntry());

		act(() => {
			chipNodes(tree)[0].props.onPress();
		});
		expect(useMyDishesFilterStore.getState().filter.categoryIds).toEqual([CATEGORY_ID]);

		const [, options] = mockShowSnackbar.mock.calls[0];
		act(() => {
			options.action.onPress();
		});

		expect(useMyDishesFilterStore.getState().filter.categoryIds).toEqual(["curry"]);
		expect(useMyDishesFilterStore.getState().filter.status).toEqual(["eaten"]);
	});

	it("chip が 1 つも無いときは何も描かない（#1629【34】entry が無ければ chips は空）", () => {
		const tree = render(null);
		console.log(
			"DBG",
			JSON.stringify(chipNodes(tree).map((n) => n.props.accessibilityLabel)),
			JSON.stringify(useMyDishesFilterStore.getState().filter),
		);
		expect(chipNodes(tree)).toHaveLength(0);
		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-feed-chips")).toHaveLength(0);
	});
});
