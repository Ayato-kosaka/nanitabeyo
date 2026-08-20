/*
#1397 (PR3/5) 料理メディア Sheet 本体。

見るのは 5 つ。

1. `pin === null` の間は取得を 1 本も投げず、中身も描かない（ピンをタップするまで走らせない。§5-1）
2. **Sheet を開いても共有フィルタ（`useMyDishesFilterStore`）を一切書かない**（絶対条件1 / §7-1）。
   ここが崩れると、Sheet を開いただけで一覧と Map まで 1 店舗に絞られる。
3. **写真なし（`dishMedia === null`）も並べ、`dish.categoryImageUrl` を実画像として使う**
   （#1375 追補2 決定3）。灰色プレースホルダーにしない。
4. §8-3: Sheet の中に無限スクロールを持ち込まない。`hasNextPage` のときだけ「一覧で見る」を出し、
   押下は `router.setParams({ view: "list" })`（= ルートを push しない）。
5. R6: 中身は `SheetGestureRoot` で包み、TrueSheet には `scrollable` を渡す
   （縦 FlatList がシートの可視領域に収まる唯一のスイッチ。native は content へ flex:1、
   web は overflowY:auto の器を足す）。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

const mockPush = jest.fn();
const mockSetParams = jest.fn();
// M-1: #644（select-restaurant.tsx）と同じ 2 本を固定するため、useFocusEffect / useNavigation を
// 実際に動く最小限のスタブへ差し替える。useFocusEffect は「フォーカスされている間」を模す必要は
// なく、effect を 1 回実行してその cleanup を捕まえられれば十分（ここではその cleanup を
// 「フォーカスを失った」の代わりに呼ぶ）
let focusEffectCleanup: (() => void) | undefined;
let beforeRemoveHandler: (() => void) | undefined;
const mockAddListener = jest.fn((event: string, handler: () => void) => {
	if (event === "beforeRemove") beforeRemoveHandler = handler;
	return () => {};
});
jest.mock("expo-router", () => ({
	router: {
		push: (...args: unknown[]) => mockPush(...args),
		setParams: (...args: unknown[]) => mockSetParams(...args),
	},
	useFocusEffect: (effect: () => (() => void) | void) => {
		const cleanup = effect();
		focusEffectCleanup = typeof cleanup === "function" ? cleanup : undefined;
	},
	useNavigation: () => ({ addListener: mockAddListener }),
}));

// 画像の解決順（thumbnail → categoryImageUrl → restaurant.image_url）をアサートするために
// `source.uri` をそのまま props へ出すスタブにする
jest.mock("expo-image", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Image: ({ source, style }: { source?: { uri?: string }; style?: unknown }) =>
			ReactActual.createElement(RNView, { testID: "sheet-image", uri: source?.uri, style }),
	};
});

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

import React, { act } from "react";
import { FlatList } from "react-native";
import TestRenderer from "react-test-renderer";
import { TrueSheet } from "@lodev09/react-native-true-sheet";
import type { MyDishItem, MyDishPin } from "@shared/api/v1/res";
import { MyDishesRestaurantSheet } from "./MyDishesRestaurantSheet";
import {
	selectFilterQueryKey,
	selectRestaurantQueryKey,
	useMyDishesFilterStore,
} from "../stores/useMyDishesFilterStore";
import { useMyDishesStore } from "../stores/useMyDishesStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESTAURANT_ID = "11111111-1111-1111-1111-000000000001";

const mockPin = {
	restaurant: {
		id: RESTAURANT_ID,
		name: "テスト食堂",
		latitude: 35.5,
		longitude: 139.5,
		image_url: "https://example.com/restaurant.jpg",
	},
	counts: { want: 1, eaten: 2 },
	latestOccurredAt: "2026-08-01T00:00:00.000Z",
	representativeThumbnailUrl: null,
} as unknown as MyDishPin;

const makeItem = (overrides: Partial<MyDishItem> & { key: string }): MyDishItem =>
	({
		status: "eaten",
		occurredAt: "2026-08-01T00:00:00.000Z",
		savedAt: null,
		eatenAt: "2026-08-01T00:00:00.000Z",
		restaurant: mockPin.restaurant,
		dish: {
			id: "dish-1",
			name: "唐揚げ定食",
			restaurant_id: RESTAURANT_ID,
			reviewCount: 1,
			averageRating: 4,
			categoryImageUrl: "https://example.com/category.jpg",
		},
		dishMedia: null,
		myReview: null,
		distanceMeters: null,
		...overrides,
	}) as unknown as MyDishItem;

/** 写真なしの記録（#1395 で `created_dish_media_id` の NOT NULL を解除済み） */
const itemWithoutPhoto = makeItem({ key: "review:no-photo" });
/** 写真ありの記録 */
const itemWithPhoto = makeItem({
	key: "review:with-photo",
	dishMedia: { id: "media-1", thumbnailImageUrl: "https://example.com/media.jpg" } as MyDishItem["dishMedia"],
	myReview: { rating: 4 } as MyDishItem["myReview"],
});

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];

const render = async (pin: MyDishPin | null, onDismissed = jest.fn()): Promise<TestRenderer.ReactTestRenderer> => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<MyDishesRestaurantSheet pin={pin} onDismissed={onDismissed} />);
	});
	mountedTrees.push(tree);
	return tree;
};

const respondWith = (data: MyDishItem[], nextCursor: string | null = null) => {
	mockCallBackend.mockResolvedValue({ data, nextCursor, meta: { oldestOccurredAt: null } });
};

/**
 * `testID` でホスト要素だけを拾う。
 *
 * ⚠️ `findAll` は **合成コンポーネントも数える**ので、`Pressable` のように testID を
 * そのまま下へ流す要素は 1 つの見た目に対して複数ヒットする（実測で 1 行が 3 件になった）。
 * ホスト要素（`typeof type === "string"`）へ絞ると «画面に出ている数» と一致する。
 */
const findAllByTestID = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
	tree.root.findAll((node) => typeof node.type === "string" && node.props?.testID === testID);

/** `onPress` を持つノード（= 合成コンポーネント側の Pressable）を押す */
const pressByTestID = async (tree: TestRenderer.ReactTestRenderer, testID: string) => {
	const nodes = tree.root.findAll(
		(node) => node.props?.testID === testID && typeof node.props?.onPress === "function",
	);
	expect(nodes.length).toBeGreaterThan(0);
	await act(async () => {
		nodes[0].props.onPress();
	});
};

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	useMyDishesStore.getState().clearQuery();
	mockCallBackend.mockReset();
	mockPush.mockClear();
	mockSetParams.mockClear();
	mockAddListener.mockClear();
	focusEffectCleanup = undefined;
	beforeRemoveHandler = undefined;
	respondWith([]);
});

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

describe("#1397 §5-1 ピンをタップするまで 1 本も投げない", () => {
	it("pin === null の間は callBackend を呼ばず、中身も描かない", async () => {
		const tree = await render(null);

		expect(mockCallBackend).not.toHaveBeenCalled();
		expect(findAllByTestID(tree, "my-dishes-sheet-item")).toHaveLength(0);
		// SheetGestureRoot 自体は常にマウントされている（present/dismiss を ref で制御するため）。
		// n-3: これは jest.setup.js のモックが children を常に描く仕様の言い換えであって、実際の
		// web 実装は閉じている間 Portal 自体を描かない。E2E は「閉じていても DOM にある」を前提にしないこと
		expect(findAllByTestID(tree, "my-dishes-sheet").length).toBeGreaterThan(0);
	});

	it("pin が渡ると restaurantId 付きで GET /v1/users/me/dishes を 1 回だけ投げる", async () => {
		respondWith([itemWithPhoto]);
		await render(mockPin);

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		const [path, options] = mockCallBackend.mock.calls[0];
		expect(path).toBe("v1/users/me/dishes");
		expect(options.requestPayload.restaurantId).toBe(RESTAURANT_ID);
	});
});

describe("#1397 絶対条件1 Sheet は共有フィルタ store を一切書かない（§7-1）", () => {
	it("開いても filter のオブジェクト参照と base の queryKey が変わらない", async () => {
		respondWith([itemWithPhoto, itemWithoutPhoto]);

		const filterBefore = useMyDishesFilterStore.getState().filter;
		const queryKeyBefore = selectFilterQueryKey(useMyDishesFilterStore.getState());

		await render(mockPin);

		// zustand の set() は新しいオブジェクトを作る。参照が同じ = 一度も set() されていない
		expect(useMyDishesFilterStore.getState().filter).toBe(filterBefore);
		expect(selectFilterQueryKey(useMyDishesFilterStore.getState())).toBe(queryKeyBefore);
		expect(Object.keys(useMyDishesFilterStore.getState().filter)).not.toContain("restaurantId");
	});
});

describe("#1397 §3 写真なしの記録も並べ、実画像へ落とす（#1375 追補2 決定3）", () => {
	it("dishMedia === null の行も並び、dish.categoryImageUrl を使う（灰色プレースホルダーにしない）", async () => {
		// R1 の並び（写真なしを先頭に含む）をそのまま固定する
		respondWith([itemWithoutPhoto, itemWithPhoto]);
		const tree = await render(mockPin);

		const rows = findAllByTestID(tree, "my-dishes-sheet-item");
		expect(rows).toHaveLength(2);

		const images = findAllByTestID(tree, "sheet-image");
		expect(images.map((n) => n.props.uri)).toEqual([
			"https://example.com/category.jpg",
			"https://example.com/media.jpg",
		]);

		// 写真なしの行だけ E2E 用の目印が付く（動的 ID は作らない。nth() で指す）
		// n-1: 一覧ビューの my-dishes-list-item-placeholder（本物の灰色プレースホルダー）とは
		// 逆の意味（＝実画像が入っている行）なので、同じ接尾辞 -placeholder は使わない
		expect(findAllByTestID(tree, "my-dishes-sheet-item-no-photo")).toHaveLength(1);
	});

	it("categoryImageUrl が空なら restaurant.image_url へ落ちる", async () => {
		respondWith([
			makeItem({
				key: "review:no-category-image",
				dish: { ...itemWithoutPhoto.dish, categoryImageUrl: "" } as MyDishItem["dish"],
			}),
		]);
		const tree = await render(mockPin);

		const images = findAllByTestID(tree, "sheet-image");
		expect(images.map((n) => n.props.uri)).toEqual(["https://example.com/restaurant.jpg"]);
	});
});

describe("#1397 Q6 店舗詳細への導線はヘッダ（店名タップ）だけ", () => {
	it("ヘッダの店名タップで /[locale]/restaurant/[restaurantId] へ push する", async () => {
		respondWith([itemWithPhoto]);
		const tree = await render(mockPin);

		expect(findAllByTestID(tree, "my-dishes-sheet-title").length).toBeGreaterThan(0);
		await pressByTestID(tree, "my-dishes-sheet-title");

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]",
			params: { locale: "ja-JP", restaurantId: RESTAURANT_ID },
		});
	});

	it("「この店の全レビューを見る」（店舗フィード）への導線は置かない", async () => {
		respondWith([itemWithPhoto]);
		const tree = await render(mockPin);

		const pushed = tree.root
			.findAll((node) => typeof node.props?.onPress === "function")
			.map((node) => node.props.testID);
		expect(pushed).not.toContain("my-dishes-sheet-all-reviews");
	});
});

describe("#1397 §8-3 Sheet の中に無限スクロールを持ち込まない", () => {
	it("nextCursor が null なら「一覧で見る」を出さない", async () => {
		respondWith([itemWithPhoto], null);
		const tree = await render(mockPin);

		expect(findAllByTestID(tree, "my-dishes-sheet-see-all-in-list")).toHaveLength(0);
	});

	it("nextCursor があるときだけ「一覧で見る」を出し、押下はルートを push せず view=list へ切り替える", async () => {
		respondWith([itemWithPhoto], "cursor-1");
		const tree = await render(mockPin);

		expect(findAllByTestID(tree, "my-dishes-sheet-see-all-in-list").length).toBeGreaterThan(0);
		await pressByTestID(tree, "my-dishes-sheet-see-all-in-list");

		expect(mockSetParams).toHaveBeenCalledWith({ view: "list" });
		// ⚠️ push すると Map が再マウントされ hasFitPinsRef が二度走る（§9-1）
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("FlatList に onEndReached を渡さない（追加読み込みは Sheet の責務ではない）", async () => {
		respondWith([itemWithPhoto], "cursor-1");
		const tree = await render(mockPin);

		const lists = tree.root.findAllByType(FlatList);
		expect(lists.length).toBeGreaterThan(0);
		expect(lists.every((node) => node.props.onEndReached === undefined)).toBe(true);
	});
});

describe("#1397 R6/R7 TrueSheet の使い方", () => {
	it("scrollable を渡す（縦 FlatList をシートの可視領域に収める唯一のスイッチ）", async () => {
		respondWith([itemWithPhoto]);
		const tree = await render(mockPin);

		const sheet = tree.root.findByType(TrueSheet);
		expect(sheet.props.scrollable).toBe(true);
	});

	it("中身は SheetGestureRoot（testID: my-dishes-sheet）で包む", async () => {
		respondWith([itemWithPhoto]);
		const tree = await render(mockPin);

		const sheet = tree.root.findByType(TrueSheet);
		expect(sheet.findAll((node) => node.props?.testID === "my-dishes-sheet").length).toBeGreaterThan(0);
	});
});

describe("#1397 取得失敗時は再試行の口を残す（一覧・Map と揃える）", () => {
	it("error のとき EmptyState と再試行ボタンが出る", async () => {
		mockCallBackend.mockRejectedValue(new Error("boom"));
		const tree = await render(mockPin);

		expect(findAllByTestID(tree, "my-dishes-sheet-empty").length).toBeGreaterThan(0);
		expect(findAllByTestID(tree, "my-dishes-sheet-empty-retry").length).toBeGreaterThan(0);
	});

	// m-1: #1442 / #1446 と同じ回帰ガード。「描かれること」だけでなく「押下が実取得へ届くこと」まで
	// 固定する。このファイルは useMyDishesRestaurantQuery をモックしていないので、mockCallBackend の
	// 呼び出し回数を数えるだけで足りる
	it("再試行ボタン押下で callBackend の 2 回目が実際に飛ぶ", async () => {
		mockCallBackend.mockRejectedValueOnce(new Error("boom"));
		const tree = await render(mockPin);

		// 初回取得が失敗している
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		mockCallBackend.mockResolvedValueOnce({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });
		await pressByTestID(tree, "my-dishes-sheet-empty-retry");

		expect(mockCallBackend).toHaveBeenCalledTimes(2);
		const [path, options] = mockCallBackend.mock.calls[1];
		expect(path).toBe("v1/users/me/dishes");
		expect(options.requestPayload.restaurantId).toBe(RESTAURANT_ID);
	});
});

describe("#1397 (PR4/5) 行タップの遷移先は写真の有無で分かれる（設計 (1/2) §3）", () => {
	it("写真ありの行は全画面 Feed へ push する。渡すのは index ではなく itemKey（R1）", async () => {
		// R1 の並び（写真なしが先頭）。index を渡す実装なら、ここで 1 が渡って別の料理が開く
		respondWith([itemWithoutPhoto, itemWithPhoto]);
		const tree = await render(mockPin);

		const rows = tree.root.findAll(
			(node) => node.props?.testID === "my-dishes-sheet-item" && typeof node.props?.onPress === "function",
		);
		await act(async () => {
			rows[rows.length - 1].props.onPress();
		});

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/my-dishes/feed",
			params: { locale: "ja-JP", restaurantId: RESTAURANT_ID, itemKey: "review:with-photo", dishMediaId: "media-1" },
		});
		// URL に index は載せない（載せると写真なしが 1 件混ざった瞬間にずれる）
		expect(Object.keys(mockPush.mock.calls[0][0].params)).not.toContain("initialIndex");
	});

	it("写真なしの行は従来どおり店舗詳細へ push する（Feed に入れられない）", async () => {
		respondWith([itemWithoutPhoto]);
		const tree = await render(mockPin);

		await pressByTestID(tree, "my-dishes-sheet-item");

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]",
			params: { locale: "ja-JP", restaurantId: RESTAURANT_ID },
		});
	});
});

describe("#1397 (PR4/5)「全画面で見る」", () => {
	it("写真ありの記録があるときだけ出て、先頭の写真あり行の itemKey で Feed を開く", async () => {
		respondWith([itemWithoutPhoto, itemWithPhoto]);
		const tree = await render(mockPin);

		expect(findAllByTestID(tree, "my-dishes-sheet-expand").length).toBeGreaterThan(0);
		await pressByTestID(tree, "my-dishes-sheet-expand");

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/my-dishes/feed",
			params: { locale: "ja-JP", restaurantId: RESTAURANT_ID, itemKey: "review:with-photo", dishMediaId: "media-1" },
		});
	});

	it("その店の記録が全部写真なしなら出さない（Feed に入れるものが無い）", async () => {
		respondWith([itemWithoutPhoto]);
		const tree = await render(mockPin);

		expect(findAllByTestID(tree, "my-dishes-sheet-item")).toHaveLength(1);
		expect(findAllByTestID(tree, "my-dishes-sheet-expand")).toHaveLength(0);
	});
});

describe("#1450 n-2 行があるのに error が立っても、読めているリストを消さない", () => {
	// PR4 の Q4（Feed を閉じるときに店舗スコープの Sheet スライスだけ invalidate する）を入れると
	// この状態が到達可能になる。ここが崩れると「保存を外して戻ったら通信が一瞬こけただけで
	// 記録が全部消えたように見える」
	it("items があるうちは error が立っても EmptyState に差し替えない", async () => {
		respondWith([itemWithPhoto, itemWithoutPhoto]);
		const tree = await render(mockPin);
		expect(findAllByTestID(tree, "my-dishes-sheet-item")).toHaveLength(2);

		const queryKey = selectRestaurantQueryKey(RESTAURANT_ID)(useMyDishesFilterStore.getState());
		await act(async () => {
			useMyDishesStore.setState((s) => ({ errorByQuery: { ...s.errorByQuery, [queryKey]: "boom" } }));
		});

		expect(findAllByTestID(tree, "my-dishes-sheet-item")).toHaveLength(2);
		expect(findAllByTestID(tree, "my-dishes-sheet-empty")).toHaveLength(0);
	});

	it("行が 0 件のときは従来どおり EmptyState（再試行の口）を出す", async () => {
		respondWith([]);
		const tree = await render(mockPin);

		const queryKey = selectRestaurantQueryKey(RESTAURANT_ID)(useMyDishesFilterStore.getState());
		await act(async () => {
			useMyDishesStore.setState((s) => ({ errorByQuery: { ...s.errorByQuery, [queryKey]: "boom" } }));
		});

		expect(findAllByTestID(tree, "my-dishes-sheet-empty").length).toBeGreaterThan(0);
	});
});

describe("#1450 M-1 画面遷移で開いたままにしない（#644 対策）", () => {
	it("フォーカスを失うと dismiss が呼ばれる（unmount を待たない）", async () => {
		respondWith([itemWithPhoto]);
		const tree = await render(mockPin);

		const sheet = tree.root.findByType(TrueSheet);
		expect(sheet.instance.dismiss).not.toHaveBeenCalled();

		// 遷移直後にフォーカスを失う場面を模す。my-dishes/index.tsx は push 先の root stack から
		// アンマウントされないため、unmount クリーンアップだけでは一度も走らない
		expect(focusEffectCleanup).toBeDefined();
		act(() => {
			focusEffectCleanup?.();
		});

		expect(sheet.instance.dismiss).toHaveBeenCalled();
	});

	it("戻る操作の開始（beforeRemove）でも dismiss が呼ばれる", async () => {
		respondWith([itemWithPhoto]);
		const tree = await render(mockPin);

		const sheet = tree.root.findByType(TrueSheet);
		expect(beforeRemoveHandler).toBeDefined();
		act(() => {
			beforeRemoveHandler?.();
		});

		expect(sheet.instance.dismiss).toHaveBeenCalled();
	});

	it("onDidDismiss 経由で onDismissed が呼ばれ、戻ってきて同じピンを再び開ける", async () => {
		respondWith([itemWithPhoto]);
		const onDismissed = jest.fn();
		const tree = await render(mockPin, onDismissed);

		const sheet = tree.root.findByType(TrueSheet);
		// dismiss は「閉じ切った」ことそのものではない。ネイティブ / web は dismiss 完了時に
		// onDidDismiss を呼ぶので、それを模して呼ぶ（呼び出し側はここで selectedPin を null に戻す）
		act(() => {
			sheet.props.onDidDismiss();
		});

		expect(onDismissed).toHaveBeenCalledTimes(1);

		// selectedPin が null に戻らないと（= このコミット前の不具合）、呼び出し側が同じ pin を
		// 再び渡しても setSelectedPin が同一参照のため state が変わらず、restaurantId も変化しない
		// ので present 用 effect（:167-193）が再発火せず、行が二度と描かれない。
		// ここでは MyDishesMapView と同じ手順（一度 null を経由してから同じ pin を渡す）を再現し、
		// 行が再び描かれる（＝ Sheet を再び開ける）ことを固定する
		await act(async () => {
			tree.update(<MyDishesRestaurantSheet pin={null} onDismissed={onDismissed} />);
		});
		expect(findAllByTestID(tree, "my-dishes-sheet-item")).toHaveLength(0);

		await act(async () => {
			tree.update(<MyDishesRestaurantSheet pin={mockPin} onDismissed={onDismissed} />);
		});
		expect(findAllByTestID(tree, "my-dishes-sheet-item")).toHaveLength(1);
	});
});
