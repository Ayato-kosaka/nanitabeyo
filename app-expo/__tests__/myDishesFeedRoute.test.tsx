/*
#1397 (PR4/5) my-dishes の全画面 Feed ルート（`app/[locale]/(tabs)/my-dishes/feed.tsx`）。

固定するのは 6 点。

1. **R1（最重要）: `itemKey` から index を確定させる。** Sheet / リストの並びは写真なしの記録を
   含み、Feed の並びは含まないので、URL に index を載せると **写真なしが 1 件混ざった瞬間に
   別の料理が開く**。「写真なしを先頭に含む並び」でここを固定する（リーダー判断 R1 の明示要求）。
2. **URL に `ids` を積まない**（§9-2）。`restaurantId` から `GET /v1/users/me/dishes` を引き直し、
   そこから `GET /v1/dish-media?ids=` を組む。web のリロード・直リンクでも成立する形。
3. **`MyDishItem` から `DishMediaEntry` を合成しない**（§2-3）。必ず `GET /v1/dish-media?ids=` を叩く。
4. **絶対条件6: `!error` ガード。** 失敗後に effect が再走しても 2 回目を叩かない。
5. **R5: `ids` を 42 で切る。**
6. **Q4: save の増減が起きたときだけ、閉じるときに店舗スコープの Sheet スライスだけを invalidate。**
   何も変えずに閉じたら **0 クエリ**（スライスがそのまま残る）。base（一覧・Map 共有）の
   queryKey は **どちらの場合も絶対に消さない**（964MB の走査になる）。

`app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている
（`__tests__/myDishesFiltersRoute.test.tsx` と同じ理由）。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

let mockParams: Record<string, string> = {};
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
	router: {
		back: (...args: unknown[]) => mockBack(...args),
		replace: (...args: unknown[]) => mockReplace(...args),
		canDismiss: () => true,
	},
	useLocalSearchParams: () => mockParams,
}));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

// `DishMediaFeed` は **1 行も変えない**（絶対条件1）。ここでは受け取った props をそのまま
// 覗けるスタブに差し替え、entriesKey / idType / initialIndex を検証する
jest.mock("@/features/dishMedia/components/DishMediaFeed", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: (props: { entriesKey: string; idType: string; initialIndex?: number }) =>
			ReactActual.createElement(RNView, { testID: "dish-media-feed", ...props }),
	};
});

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { MyDishItem } from "@shared/api/v1/res";

import MyDishesFeedScreen from "../app/[locale]/(tabs)/my-dishes/feed";
import { myDishesFeedKey } from "../features/myDishes/constants";
import {
	selectFilterQueryKey,
	selectRestaurantQueryKey,
	useMyDishesFilterStore,
} from "../features/myDishes/stores/useMyDishesFilterStore";
import { useMyDishesStore } from "../features/myDishes/stores/useMyDishesStore";
import { useDishMediaEntriesStore } from "../stores/useDishMediaEntriesStore";
import { mapReviewsKey } from "../features/map/constants";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESTAURANT_ID = "11111111-1111-1111-1111-000000000001";

const makeRow = (key: string, mediaId: string | null): MyDishItem =>
	({
		key,
		status: "eaten",
		occurredAt: "2026-08-01T00:00:00.000Z",
		savedAt: null,
		eatenAt: "2026-08-01T00:00:00.000Z",
		restaurant: { id: RESTAURANT_ID, name: "テスト食堂", image_url: null },
		dish: { id: "dish-1", name: "唐揚げ定食", categoryImageUrl: null },
		dishMedia: mediaId === null ? null : { id: mediaId, thumbnailImageUrl: "https://example.com/m.jpg" },
		myReview: null,
	}) as unknown as MyDishItem;

const makeEntry = (mediaId: string, isSaved = false) => ({
	restaurant: { id: RESTAURANT_ID, name: "テスト食堂" },
	dish: { id: "dish-1", name: "唐揚げ定食" },
	dish_media: { id: mediaId, isMine: false, isSaved, isLiked: false, likeCount: 0, mediaUrl: null, thumbnailImageUrl: "" },
	dish_reviews: [],
});

/** `callBackend` を「行の取得」と「メディアの取得」の 2 本立てに振り分ける */
const respond = (rows: MyDishItem[], entries: ReturnType<typeof makeEntry>[]) => {
	mockCallBackend.mockImplementation(async (path: string) => {
		if (path === "v1/users/me/dishes") return { data: rows, nextCursor: null, meta: { oldestOccurredAt: null } };
		if (path === "v1/dish-media") return { items: entries };
		throw new Error(`unexpected path: ${path}`);
	});
};

const callsTo = (path: string) => mockCallBackend.mock.calls.filter(([p]) => p === path);

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (): Promise<TestRenderer.ReactTestRenderer> => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<MyDishesFeedScreen />);
	});
	// 行の取得 → メディアの取得の 2 段なので、追加でもう 1 周させて effect を落ち着かせる
	await act(async () => {});
	mountedTrees.push(tree);
	return tree;
};

const feedProps = (tree: TestRenderer.ReactTestRenderer) => {
	const nodes = tree.root.findAll((node) => typeof node.type === "string" && node.props?.testID === "dish-media-feed");
	return nodes.length > 0 ? nodes[0].props : null;
};

const sheetQueryKey = () => selectRestaurantQueryKey(RESTAURANT_ID)(useMyDishesFilterStore.getState());
const baseQueryKey = () => selectFilterQueryKey(useMyDishesFilterStore.getState());

beforeEach(() => {
	mockParams = { locale: "ja-JP", restaurantId: RESTAURANT_ID, itemKey: "review:with-photo" };
	useMyDishesFilterStore.getState().reset();
	useMyDishesStore.getState().clearQuery();
	useDishMediaEntriesStore.getState().clearByKey();
	mockCallBackend.mockReset();
	mockBack.mockClear();
	mockReplace.mockClear();
	respond([], []);
});

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

describe("#1397 R1 index ではなく itemKey から開始位置を決める", () => {
	it("写真なしを先頭に含む並びでも、itemKey が指す料理から開く", async () => {
		// Sheet の並び: [写真なし, 写真あり(media-a), 写真あり(media-b)]
		// Feed の並び : [media-a, media-b]  ← 写真なしは入らない
		// 3 番目（Sheet の index 2）をタップした場面。index をそのまま渡していたら
		// ids[2] は存在せず（クランプで media-b ではなく末尾へ）別の料理が開く
		respond(
			[makeRow("review:no-photo", null), makeRow("review:a", "media-a"), makeRow("review:b", "media-b")],
			[makeEntry("media-a"), makeEntry("media-b")],
		);
		mockParams = { ...mockParams, itemKey: "review:b" };

		const tree = await render();

		const props = feedProps(tree);
		expect(props).not.toBeNull();
		expect(props!.initialIndex).toBe(1);
		expect(props!.idType).toBe("dish_media");
	});

	it("写真なしが先頭にあるとき、2 番目（Sheet の index 1）は Feed の index 0 になる", async () => {
		respond(
			[makeRow("review:no-photo", null), makeRow("review:a", "media-a"), makeRow("review:b", "media-b")],
			[makeEntry("media-a"), makeEntry("media-b")],
		);
		mockParams = { ...mockParams, itemKey: "review:a" };

		const tree = await render();

		// Sheet 側の index（1）をそのまま渡していたら media-b が開いていた
		expect(feedProps(tree)!.initialIndex).toBe(0);
	});

	it("itemKey が写真なしの行 / 未知の行を指していても落ちず、先頭から開く", async () => {
		respond([makeRow("review:no-photo", null), makeRow("review:a", "media-a")], [makeEntry("media-a")]);
		mockParams = { ...mockParams, itemKey: "review:no-photo" };

		const tree = await render();

		expect(feedProps(tree)!.initialIndex).toBe(0);
	});

	it("API の戻り順が Sheet の並びと違っても、Sheet で見えている順を保つ", async () => {
		respond(
			[makeRow("review:a", "media-a"), makeRow("review:b", "media-b")],
			// サーバが逆順で返した場面
			[makeEntry("media-b"), makeEntry("media-a")],
		);
		mockParams = { ...mockParams, itemKey: "review:b" };

		const tree = await render();

		const ids = useDishMediaEntriesStore.getState().mediaIdsByKey[myDishesFeedKey(RESTAURANT_ID)];
		expect(ids).toEqual(["media-a", "media-b"]);
		expect(feedProps(tree)!.initialIndex).toBe(1);
	});
});

describe("#1397 §9-2 URL に ids を積まず、restaurantId から引き直す", () => {
	it("restaurantId で行を引き、その dish_media.id で GET /v1/dish-media を叩く", async () => {
		respond([makeRow("review:no-photo", null), makeRow("review:a", "media-a")], [makeEntry("media-a")]);

		await render();

		const rowCalls = callsTo("v1/users/me/dishes");
		expect(rowCalls).toHaveLength(1);
		expect(rowCalls[0][1].requestPayload.restaurantId).toBe(RESTAURANT_ID);

		// §2-3: MyDishItem から DishMediaEntry を合成せず、必ず引き直す
		const mediaCalls = callsTo("v1/dish-media");
		expect(mediaCalls).toHaveLength(1);
		// 写真なしの行は ids に載せない（dish_media.id が無い）
		expect(mediaCalls[0][1].requestPayload.ids).toEqual(["media-a"]);
	});

	it("entriesKey は myDishesFeed-<uuid>。店舗フィードの mapReviews-<uuid> には触らない", async () => {
		respond([makeRow("review:a", "media-a")], [makeEntry("media-a")]);

		const tree = await render();

		expect(feedProps(tree)!.entriesKey).toBe(`myDishesFeed-${RESTAURANT_ID}`);
		expect(useDishMediaEntriesStore.getState().mediaIdsByKey[mapReviewsKey(RESTAURANT_ID)]).toBeUndefined();
	});

	it("unmount で自分の entriesKey だけを clearByKey する", async () => {
		respond([makeRow("review:a", "media-a")], [makeEntry("media-a")]);
		// 店舗フィード（別キー）が同じメディアを持っている場面
		await act(async () => {
			useDishMediaEntriesStore.getState().upsertDishMediaEntries([makeEntry("media-a") as never]);
			useDishMediaEntriesStore.getState().updateMediaIdsByKey(mapReviewsKey(RESTAURANT_ID), () => ["media-a"]);
		});

		const tree = await render();
		expect(useDishMediaEntriesStore.getState().mediaIdsByKey[myDishesFeedKey(RESTAURANT_ID)]).toEqual(["media-a"]);

		await act(async () => {
			tree.unmount();
			mountedTrees.splice(mountedTrees.indexOf(tree), 1);
		});

		expect(useDishMediaEntriesStore.getState().mediaIdsByKey[myDishesFeedKey(RESTAURANT_ID)]).toBeUndefined();
		// 店舗フィードのキャッシュは残る（別名なので消し合わない）
		expect(useDishMediaEntriesStore.getState().mediaIdsByKey[mapReviewsKey(RESTAURANT_ID)]).toEqual(["media-a"]);
		expect(useDishMediaEntriesStore.getState().entriesByMediaId["media-a"]).toBeDefined();
	});
});

describe("#1397 絶対条件6 !error ガード（失敗しても 2 回目を叩かない）", () => {
	it("GET /v1/dish-media が失敗したあと effect が再走しても 2 回目を叩かない", async () => {
		mockCallBackend.mockImplementation(async (path: string) => {
			if (path === "v1/users/me/dishes") {
				return { data: [makeRow("review:a", "media-a")], nextCursor: null, meta: { oldestOccurredAt: null } };
			}
			throw new Error("boom");
		});

		const tree = await render();
		expect(callsTo("v1/dish-media")).toHaveLength(1);

		// 再レンダリング（＝ effect の依存が再評価される場面）を数回起こす
		await act(async () => {
			tree.update(<MyDishesFeedScreen />);
		});
		await act(async () => {
			tree.update(<MyDishesFeedScreen />);
		});

		expect(callsTo("v1/dish-media")).toHaveLength(1);
		// 見るものが無いので EmptyState（スピナーで固着させない）
		expect(
			tree.root.findAll((node) => typeof node.type === "string" && node.props?.testID === "my-dishes-feed-empty"),
		).toHaveLength(1);
	});
});

describe("#1397 R5 ids は 42 で切る", () => {
	it("写真ありの行が 45 件でも ids は 42 件までしか積まない", async () => {
		const rows = Array.from({ length: 45 }, (_, i) => makeRow(`review:${i}`, `media-${i}`));
		respond(
			rows,
			Array.from({ length: 42 }, (_, i) => makeEntry(`media-${i}`)),
		);

		await render();

		expect(callsTo("v1/dish-media")[0][1].requestPayload.ids).toHaveLength(42);
	});
});

describe("#1397 Q4 保存の反映（店舗スコープの Sheet スライスだけを invalidate）", () => {
	/** base（一覧・Map 共有）のスライスを «読み込み済み» にしておく */
	const seedBaseSlice = async () => {
		await act(async () => {
			await useMyDishesStore
				.getState()
				.fetchInitial(baseQueryKey(), async () => ({ data: [makeRow("review:base", "media-base")], nextCursor: null }));
		});
	};

	it("何も変えずに閉じたら 0 クエリ（Sheet スライスも base も残る）", async () => {
		respond([makeRow("review:a", "media-a")], [makeEntry("media-a", true)]);
		await seedBaseSlice();
		const key = sheetQueryKey();

		const tree = await render();
		expect(useMyDishesStore.getState().hasFetchedInitialByQuery[key]).toBe(true);
		const callsBefore = mockCallBackend.mock.calls.length;

		await act(async () => {
			tree.unmount();
			mountedTrees.splice(mountedTrees.indexOf(tree), 1);
		});

		// スライスが残っている = 次に Sheet を開いても 0 クエリ
		expect(useMyDishesStore.getState().hasFetchedInitialByQuery[key]).toBe(true);
		expect(useMyDishesStore.getState().itemKeysByQuery[key]).toEqual(["review:a"]);
		expect(mockCallBackend.mock.calls).toHaveLength(callsBefore);
	});

	it("save を解除して閉じたら Sheet スライスだけを invalidate する（base は残す）", async () => {
		respond([makeRow("review:a", "media-a")], [makeEntry("media-a", true)]);
		await seedBaseSlice();
		const key = sheetQueryKey();
		const base = baseQueryKey();
		expect(key).not.toBe(base);

		const tree = await render();

		// Feed の中で保存を外した場面（ActionButtons は updateEntry で楽観更新する）
		await act(async () => {
			useDishMediaEntriesStore.getState().updateEntry("media-a", (entry) => ({
				...entry,
				dish_media: { ...entry.dish_media, isSaved: false },
			}));
		});

		await act(async () => {
			tree.unmount();
			mountedTrees.splice(mountedTrees.indexOf(tree), 1);
		});

		expect(useMyDishesStore.getState().hasFetchedInitialByQuery[key]).toBeUndefined();
		expect(useMyDishesStore.getState().itemKeysByQuery[key]).toBeUndefined();
		// ⚠️ base は 964MB の走査になるので絶対に消さない
		expect(useMyDishesStore.getState().hasFetchedInitialByQuery[base]).toBe(true);
		expect(useMyDishesStore.getState().itemKeysByQuery[base]).toEqual(["review:base"]);
	});

	it("押して戻した（正味の変化なし）なら invalidate しない", async () => {
		respond([makeRow("review:a", "media-a")], [makeEntry("media-a", false)]);
		const key = sheetQueryKey();

		const tree = await render();

		await act(async () => {
			const { updateEntry } = useDishMediaEntriesStore.getState();
			updateEntry("media-a", (e) => ({ ...e, dish_media: { ...e.dish_media, isSaved: true } }));
			updateEntry("media-a", (e) => ({ ...e, dish_media: { ...e.dish_media, isSaved: false } }));
		});

		await act(async () => {
			tree.unmount();
			mountedTrees.splice(mountedTrees.indexOf(tree), 1);
		});

		expect(useMyDishesStore.getState().hasFetchedInitialByQuery[key]).toBe(true);
	});
});

describe("#1397 §7-1 共有フィルタ store を一切書かない", () => {
	it("Feed を開いても filter の参照と base の queryKey が変わらない", async () => {
		respond([makeRow("review:a", "media-a")], [makeEntry("media-a")]);

		const filterBefore = useMyDishesFilterStore.getState().filter;
		const keyBefore = baseQueryKey();

		await render();

		expect(useMyDishesFilterStore.getState().filter).toBe(filterBefore);
		expect(baseQueryKey()).toBe(keyBefore);
		expect(Object.keys(useMyDishesFilterStore.getState().filter)).not.toContain("restaurantId");
	});
});
