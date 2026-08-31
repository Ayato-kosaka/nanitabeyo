/*
#1752【オーナー実機報告 2026-08-31】

> 梅蘭 ヤエチカ店のフルーツポンチ。投稿を消すとクチコミが «削除されました» になるのは仕様通り。
> でもカレンダーだと 8/20 が「見つかりません」になって、書いた «うますぎた！» が読めない。
> マップも «食べた 3 件» なのにフィードは 2 件しか出ない。

真因は `MyDishesFeedPage` が **ページ列を «メディアの列» で組んでいた**こと。
`dish_media` を消した記録は `dishMedia: null` で返るので、ページ列から黙って落ちていた。

ここで固定するのは 2 つ。
 1. 写真のある記録が 1 件も無い日でも「見つかりません」にしない（クチコミのページを出す）
 2. 混在（写真 2 件＋写真なし 1 件）で **3 ページ**並ぶ。ピンの «3 件» と食い違わせない

⚠️ `DishMediaFeed` はモックしない。«合成ページを混ぜた並び» を組み立てるのはあちらなので、
   モックすると «テストは緑・実機は 2 件のまま» になる。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));
jest.mock("@/features/myDishes/components/MyDishesFeedChips", () => ({ MyDishesFeedChips: () => null }));
const mockCallBackend = jest.fn(async () => ({ items: [] as unknown[] }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ selectionChanged: jest.fn(), lightImpact: jest.fn() }),
}));
// セルの中身（動画プレイヤー）は jest 環境で読めない。並びを見るのが目的なので中身は空でよい
jest.mock("@/features/dishMedia/components/DishMediaContent", () => ({ __esModule: true, default: () => null }));
/*
クチコミのページは «どの記録が、何番目に置かれたか» が分かれば十分なので、`item.key` を
testID に載せた薄いものへ差し替える。本物は API・ダイアログ・スナックバーを引きずり込む。
*/
jest.mock("@/features/myDishes/components/MyDishOwnReviewPage", () => {
	const { View } = jest.requireActual("react-native");
	const ReactActual = jest.requireActual("react");
	return {
		MyDishOwnReviewPage: ({ item }: { item: { key: string } }) =>
			ReactActual.createElement(View, { testID: `own-review-page-${item.key}` }),
	};
});

type MockRow = {
	key: string;
	dishMedia: { id: string } | null;
	myReview: { id: string } | null;
	isOwnMediaDeleted: boolean;
};

const mockRows: { current: MockRow[] } = { current: [] };
const mockQuery = () => ({
	items: mockRows.current,
	queryKey: "q",
	error: null,
	hasFetchedInitial: true,
	refresh: () => {},
});
jest.mock("@/features/myDishes/hooks/useMyDishesRestaurantQuery", () => ({
	useMyDishesRestaurantQuery: (id: string | null) => (id === null ? mockEmpty() : mockQuery()),
}));
jest.mock("@/features/myDishes/hooks/useMyDishesDateQuery", () => ({
	useMyDishesDateQuery: (date: string | null) => (date === null ? mockEmpty() : mockQuery()),
}));
const mockEmpty = () => ({ items: [], queryKey: null, error: null, hasFetchedInitial: false, refresh: () => {} });

import React, { act } from "react";
import TestRenderer from "react-test-renderer";

import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { myDishesFeedKey } from "@/features/myDishes/constants";
import { MyDishesFeedPage } from "./MyDishesFeedPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 実機の «取得できたメディア» を再現する（モックの callBackend は空応答なので自分で置く） */
function seedMediaIds(scopeId: string, ids: string[]) {
	const key = myDishesFeedKey(scopeId);
	useDishMediaEntriesStore.setState((state) => ({
		...state,
		mediaIdsByKey: { ...state.mediaIdsByKey, [key]: ids },
		deletedIds: {},
	}));
	return key;
}

function findByTestId(tree: TestRenderer.ReactTestRenderer, testID: string) {
	return tree.root.findAll((node) => node.props?.testID === testID, { deep: true });
}

/** FlatList は寸法が決まるまでセルを描かない。実機の onLayout をここで代わりに起こす */
function layout(tree: TestRenderer.ReactTestRenderer) {
	for (const node of findByTestId(tree, "dish-media-feed-root")) {
		node.props.onLayout?.({ nativeEvent: { layout: { width: 390, height: 800 } } });
	}
}

/** 開いたツリーは必ず畳んでからストアを掃除する（マウントしたまま触ると act 警告が出る） */
const mounted: TestRenderer.ReactTestRenderer[] = [];
function render(element: React.ReactElement) {
	const tree = TestRenderer.create(element);
	mounted.push(tree);
	return tree;
}

afterEach(() => {
	act(() => {
		for (const tree of mounted.splice(0)) tree.unmount();
	});
	useDishMediaEntriesStore.setState((state) => ({
		...state,
		mediaIdsByKey: {},
		deletedIds: {},
		errorByKey: {},
		isLoadingByKey: {},
	}));
	mockRows.current = [];
	mockCallBackend.mockClear();
});

const deletedRow = (key: string): MockRow => ({
	key,
	dishMedia: null,
	myReview: { id: `rv-${key}` },
	isOwnMediaDeleted: true,
});
const mediaRow = (key: string, mediaId: string): MockRow => ({
	key,
	dishMedia: { id: mediaId },
	myReview: { id: `rv-${key}` },
	isOwnMediaDeleted: false,
});

describe("#1752 写真の無い記録もフィードのページになる", () => {
	it("その日の記録が «削除済みの投稿» だけでも «見つかりません» にしない", async () => {
		mockRows.current = [deletedRow("review:fruit-punch")];

		let tree: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			tree = render(<MyDishesFeedPage scope={{ kind: "date", date: "2026-08-20" }} isActive />);
		});
		await act(async () => {
			await Promise.resolve();
		});
		act(() => layout(tree!));

		// 修正前はここが true（＝「見つかりません」）だった
		expect(findByTestId(tree!, "my-dishes-feed-empty")).toHaveLength(0);
		expect(findByTestId(tree!, "own-review-page-review:fruit-punch").length).toBeGreaterThan(0);
	});

	it("写真あり 2 件＋写真なし 1 件は 3 ページになる（ピンの件数と食い違わせない）", async () => {
		mockRows.current = [mediaRow("review:a", "dm-a"), deletedRow("review:fruit-punch"), mediaRow("review:b", "dm-b")];
		seedMediaIds("rest-1", ["dm-a", "dm-b"]);

		let tree: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			tree = render(<MyDishesFeedPage scope={{ kind: "restaurant", restaurantId: "rest-1" }} isActive />);
		});
		await act(async () => {
			await Promise.resolve();
		});
		// 空応答の決着でストアの ids が消えるので、実機と同じ «取得できた 2 件» を置き直す
		act(() => {
			seedMediaIds("rest-1", ["dm-a", "dm-b"]);
		});
		act(() => layout(tree!));

		// 修正前は「1 / 2」だった
		const counter = findByTestId(tree!, "my-dishes-feed-position-counter")[0];
		expect(counter?.props.children).toBe("1 / 3");
		// 記録の並び（写真あり → 写真なし → 写真あり）のまま、真ん中に挟まっていること
		expect(findByTestId(tree!, "own-review-page-review:fruit-punch").length).toBeGreaterThan(0);
	});
});
