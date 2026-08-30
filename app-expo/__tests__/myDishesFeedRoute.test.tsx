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
// #1397 (PR5/5) chips のラベルは «キー + 補間値» で見る（実文言はロケール依存なので見ない）
jest.mock("@/lib/i18n", () => ({
	__esModule: true,
	default: {
		t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
		// #1629 カテゴリの表示名は `labels[言語]` から引くのでロケールが要る（実機では必ず入っている）
		locale: "ja-JP",
	},
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

let mockParams: Record<string, string> = {};
const mockBack = jest.fn();
const mockReplace = jest.fn();
// m-2: `canDismiss` を可変にして、履歴が無い着地（直リンク / リロード）の枝も通せるようにする
let mockCanDismiss = true;
jest.mock("expo-router", () => ({
	router: {
		back: (...args: unknown[]) => mockBack(...args),
		replace: (...args: unknown[]) => mockReplace(...args),
		canDismiss: () => mockCanDismiss,
	},
	useLocalSearchParams: () => mockParams,
}));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

// #1397 (PR5/5) chips は「元に戻す」をスナックバーで出す（`SnackbarProvider` は
// `app/[locale]/_layout.tsx` でアプリ全体に載っているが、ルート単体の描画では入らない）
const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));

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

const makeEntry = (mediaId: string, isSaved = false, categoryId = "karaage", dishName = "唐揚げ定食") => ({
	restaurant: { id: RESTAURANT_ID, name: "テスト食堂" },
	/*
	#1397 (PR5/5) chips はここの `category_id` で絞る。
	#1629 ラベルは `dishes.name` ではなく **`dish_categories.labels`** から locale で引く。
	*/
	dish: { id: "dish-1", category_id: categoryId, name: "店での呼び名", categoryLabels: { ja: dishName } },
	dish_media: {
		id: mediaId,
		isMine: false,
		isSaved,
		// #1629【34】状態 chip は entry のフラグで出し分ける。既定は «食べた記録がある» にして
		// 従来の期待（«食べたで絞る» が出る）をそのまま保つ
		isEaten: true,
		isLiked: false,
		likeCount: 0,
		mediaUrl: null,
		thumbnailImageUrl: "",
	},
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
	// #1375 実機確認（3 巡目）: ページャは onLayout で実寸法が確定するまで描かない
	// （ウィンドウ寸法で計算すると黒画面に着地する）。テストでは layout イベントが
	// 来ないので、実機相当の寸法を明示的に流す
	await act(async () => {
		const pager = tree.root.findAll(
			(node) => typeof node.props?.onLayout === "function" && node.props?.style === undefined,
		);
		void pager;
		const containers = tree.root.findAll((node) => typeof node.props?.onLayout === "function");
		containers[0]?.props.onLayout({ nativeEvent: { layout: { width: 390, height: 780 } } });
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
	mockCanDismiss = true;
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
		// m-1: 失敗と 0 件は区別する。スピナーで固着させず、再試行の口がある失敗表示へ落ちる
		expect(
			tree.root.findAll((node) => typeof node.type === "string" && node.props?.testID === "my-dishes-feed-error"),
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

describe("#1397 M-2 dishMediaId でページ外の記録も開ける", () => {
	it("itemKey がページ内に無くても、dishMediaId を渡せばその料理が開く", async () => {
		// 1 店舗 43 件以上の場面を模す: タップした行（dishMediaId="media-old"）はページ
		// （`items` = review:a / review:b の 2 件だけ）に含まれない。呼び出し元は必ず
		// `item.dishMedia.id` を持っているので、itemKey が見つからなくても dishMediaId で開ける
		respond(
			[makeRow("review:a", "media-a"), makeRow("review:b", "media-b")],
			[makeEntry("media-old"), makeEntry("media-a"), makeEntry("media-b")],
		);
		mockParams = { ...mockParams, itemKey: "review:old", dishMediaId: "media-old" };

		const tree = await render();

		// ページ内に無ければ ids の先頭へ積む
		const mediaCalls = callsTo("v1/dish-media");
		expect(mediaCalls).toHaveLength(1);
		expect(mediaCalls[0][1].requestPayload.ids).toEqual(["media-old", "media-a", "media-b"]);

		// index ではなく id で開始位置を決めるので、先頭に積んだ media-old が index 0 になる
		expect(feedProps(tree)!.initialIndex).toBe(0);
	});

	it("dishMediaId がページ内に既にあれば、そのまま従来どおりの位置を使う（重複して積まない）", async () => {
		respond(
			[makeRow("review:a", "media-a"), makeRow("review:b", "media-b")],
			[makeEntry("media-a"), makeEntry("media-b")],
		);
		mockParams = { ...mockParams, itemKey: "review:b", dishMediaId: "media-b" };

		const tree = await render();

		expect(callsTo("v1/dish-media")[0][1].requestPayload.ids).toEqual(["media-a", "media-b"]);
		expect(feedProps(tree)!.initialIndex).toBe(1);
	});
});

describe("#1397 M-1 取得が返る前に unmount しても残骸が復活しない", () => {
	it("メディア取得が決着する前に unmount すると、決着後も mediaIdsByKey / entriesByMediaId が復活しない", async () => {
		let resolveMedia!: (value: { items: ReturnType<typeof makeEntry>[] }) => void;
		mockCallBackend.mockImplementation(async (path: string) => {
			if (path === "v1/users/me/dishes") {
				return { data: [makeRow("review:a", "media-a")], nextCursor: null, meta: { oldestOccurredAt: null } };
			}
			if (path === "v1/dish-media") {
				return new Promise((resolve) => {
					resolveMedia = resolve;
				});
			}
			throw new Error(`unexpected path: ${path}`);
		});
		mockParams = { ...mockParams, itemKey: "review:a" };

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<MyDishesFeedScreen />);
		});
		// ページャの onLayout を流してページを描かせる（render ヘルパと同じ理由）
		await act(async () => {
			const containers = tree.root.findAll((node) => typeof node.props?.onLayout === "function");
			containers[0]?.props.onLayout({ nativeEvent: { layout: { width: 390, height: 780 } } });
		});
		// 行の取得は終わり、メディア取得（GET /v1/dish-media）は飛行中のまま unmount する
		await act(async () => {
			tree.unmount();
		});

		// unmount 後に決着する（電波の細いところで戻った場面の再現）
		await act(async () => {
			resolveMedia({ items: [makeEntry("media-a")] });
		});

		const key = myDishesFeedKey(RESTAURANT_ID);
		expect(useDishMediaEntriesStore.getState().mediaIdsByKey[key]).toBeUndefined();
		expect(useDishMediaEntriesStore.getState().entriesByMediaId["media-a"]).toBeUndefined();
	});
});

describe("#1397 m-1 失敗と 0 件を区別し、再試行で叩き直す", () => {
	it("行の取得が失敗したら再試行の口が出て、押すと v1/users/me/dishes の 2 回目が飛ぶ", async () => {
		let rowCallCount = 0;
		mockCallBackend.mockImplementation(async (path: string) => {
			if (path === "v1/users/me/dishes") {
				rowCallCount += 1;
				if (rowCallCount === 1) throw new Error("boom");
				return { data: [makeRow("review:a", "media-a")], nextCursor: null, meta: { oldestOccurredAt: null } };
			}
			if (path === "v1/dish-media") return { items: [makeEntry("media-a")] };
			throw new Error(`unexpected path: ${path}`);
		});
		mockParams = { ...mockParams, itemKey: "review:a" };

		const tree = await render();

		expect(
			tree.root.findAll((node) => typeof node.type === "string" && node.props?.testID === "my-dishes-feed-error"),
		).toHaveLength(1);
		expect(callsTo("v1/users/me/dishes")).toHaveLength(1);

		const retryButton = tree.root.findAll(
			(node) => node.props?.testID === "my-dishes-feed-retry" && typeof node.props?.onPress === "function",
		)[0];
		await act(async () => {
			retryButton.props.onPress();
		});
		await act(async () => {});

		expect(callsTo("v1/users/me/dishes")).toHaveLength(2);
		expect(feedProps(tree)).not.toBeNull();
	});
});

describe("#1397 m-2 canDismiss が false の着地（直リンク / リロード）", () => {
	it("戻れない着地で閉じると router.back ではなく router.replace で my-dishes タブへ逃がす", async () => {
		respond([makeRow("review:a", "media-a")], [makeEntry("media-a")]);
		mockCanDismiss = false;

		const tree = await render();

		const closeButton = tree.root.findAll(
			(node) => node.props?.testID === "my-dishes-feed-close-button" && typeof node.props?.onPress === "function",
		)[0];
		await act(async () => {
			closeButton.props.onPress();
		});

		expect(mockBack).not.toHaveBeenCalled();
		expect(mockReplace).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/my-dishes",
			params: { locale: "ja-JP" },
		});
	});
});

describe("#1397 (PR5/5) contextual filter chips（§10）", () => {
	/** chip の Pressable（testID は固定。動的 ID は作らない。§11-2） */
	const chipNodes = (tree: TestRenderer.ReactTestRenderer) =>
		tree.root.findAll(
			(node) => node.props?.testID === "my-dishes-feed-chip" && typeof node.props?.onPress === "function",
		);

	it("Feed の上に chips が出る。並び替えの chip は 1 つも無い（リーダー判断 Q3）", async () => {
		// #1629【34】«食べた» も «食べたい» も付いているエントリなら状態 chip は 2 つとも出る
		respond([makeRow("review:a", "media-a")], [makeEntry("media-a", true)]);

		const tree = await render();

		const labels = chipNodes(tree).map((node) => node.props.accessibilityLabel);
		expect(labels).toEqual([
			'MyDishes.feed.chips.filterCategory:{"name":"唐揚げ定食"}',
			"MyDishes.feed.chips.filterStatusEaten",
			"MyDishes.feed.chips.filterStatusWant",
		]);
		// 「〜順に並べる」系のキーは i18n にも UI にも存在しない
		expect(labels.some((label: string) => label.includes("sort"))).toBe(false);
	});

	it("chip を押すと共有フィルタが変わり、3 ビュー共有の base queryKey が変わる", async () => {
		respond([makeRow("review:a", "media-a")], [makeEntry("media-a")]);

		const tree = await render();
		const keyBefore = baseQueryKey();

		await act(async () => {
			chipNodes(tree)[0].props.onPress();
		});

		// list / Map / Calendar が読む唯一のキーが変わる = 3 ビューすべてに反映される
		expect(useMyDishesFilterStore.getState().filter.categoryIds).toEqual(["karaage"]);
		expect(baseQueryKey()).not.toBe(keyBefore);
		expect(baseQueryKey()).toContain("categoryIds=karaage");
	});

	it("§10-3 chip を押しても足元の Feed の並びは崩れない（ids はそのまま）", async () => {
		respond(
			[makeRow("review:a", "media-a"), makeRow("review:b", "media-b")],
			[makeEntry("media-a"), makeEntry("media-b")],
		);

		const tree = await render();
		const idsBefore = useDishMediaEntriesStore.getState().mediaIdsByKey[myDishesFeedKey(RESTAURANT_ID)];

		await act(async () => {
			chipNodes(tree)[1].props.onPress();
		});
		await act(async () => {});

		expect(useDishMediaEntriesStore.getState().mediaIdsByKey[myDishesFeedKey(RESTAURANT_ID)]).toEqual(idsBefore);
		// Feed 自身も同じ entriesKey / initialIndex のまま描かれ続ける
		expect(feedProps(tree)!.entriesKey).toBe(myDishesFeedKey(RESTAURANT_ID));
	});

	it("スワイプで見ている料理が変わると、カテゴリ chip もその料理のものになる", async () => {
		respond(
			[makeRow("review:a", "media-a"), makeRow("review:b", "media-b")],
			[makeEntry("media-a", false, "karaage", "唐揚げ定食"), makeEntry("media-b", false, "ramen", "味玉つけ麺")],
		);

		const tree = await render();
		expect(chipNodes(tree)[0].props.accessibilityLabel).toBe(
			'MyDishes.feed.chips.filterCategory:{"name":"唐揚げ定食"}',
		);

		// `DishMediaFeed` の既存 prop `onIndexChange`（この経路のためだけに 1 行も改造していない）
		await act(async () => {
			feedProps(tree)!.onIndexChange(1);
		});

		expect(chipNodes(tree)[0].props.accessibilityLabel).toBe(
			'MyDishes.feed.chips.filterCategory:{"name":"味玉つけ麺"}',
		);
		await act(async () => {
			chipNodes(tree)[0].props.onPress();
		});
		expect(useMyDishesFilterStore.getState().filter.categoryIds).toEqual(["ramen"]);
	});

	it("スワイプが 1 度も起きなくても、開いた位置の料理の chip が出る（onIndexChange は変化時しか来ない）", async () => {
		respond(
			[makeRow("review:a", "media-a"), makeRow("review:b", "media-b")],
			[makeEntry("media-a", false, "karaage", "唐揚げ定食"), makeEntry("media-b", false, "ramen", "味玉つけ麺")],
		);
		mockParams = { ...mockParams, itemKey: "review:b", dishMediaId: "media-b" };

		const tree = await render();

		expect(feedProps(tree)!.initialIndex).toBe(1);
		expect(chipNodes(tree)[0].props.accessibilityLabel).toBe(
			'MyDishes.feed.chips.filterCategory:{"name":"味玉つけ麺"}',
		);
	});

	it("行もメディアも取れていない間は chips を出さない（押す対象が無い）", async () => {
		respond([makeRow("review:no-photo", null)], []);

		const tree = await render();

		expect(chipNodes(tree)).toHaveLength(0);
		expect(
			tree.root.findAll((node) => typeof node.type === "string" && node.props?.testID === "my-dishes-feed-empty"),
		).toHaveLength(1);
	});
});

/*
#1375 実機確認（5 巡目）: 「Map から開いたフィードも、カレンダーから開いたのと同じ軸に
してほしい（縦でレストランを切り替え、横で同じ店の中）」。

2 巡目では date スコープだけを «縦 = 日 / 横 = 同じ日の投稿» にしていたため、
**同じ全画面フィードなのに入口によって指の向きが変わっていた**。ここはその回帰テストで、
外側のページャが常に縦・内側が常に横であることを両スコープで見る。
*/
describe("#1375 フィードの軸は入口によらず «縦 = スコープ送り / 横 = スコープ内»", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockParams = { locale: "ja-JP", restaurantId: RESTAURANT_ID, itemKey: "review:with-photo" };
		respond(
			[makeRow("review:with-photo", "media-1"), makeRow("review:b", "media-2")],
			[makeEntry("media-1"), makeEntry("media-2")],
		);
	});

	const axisOf = (tree: TestRenderer.ReactTestRenderer) => {
		const pager = tree.root.find((node) => node.props?.testID === "my-dishes-feed-pager");
		// FlatList の horizontal は未指定＝縦
		return pager.props.horizontal === true ? "horizontal" : "vertical";
	};
	const innerAxisOf = (tree: TestRenderer.ReactTestRenderer) => {
		const feeds = tree.root.findAll((node) => node.props?.testID === "dish-media-feed");
		return feeds[0]?.props.horizontal === true ? "horizontal" : "vertical";
	};

	it("restaurant スコープ: 外側は縦、内側は横", async () => {
		const tree = await render();
		expect(axisOf(tree)).toBe("vertical");
		expect(innerAxisOf(tree)).toBe("horizontal");
	});

	it("date スコープ: 外側は縦、内側は横（2 巡目からの挙動を保つ）", async () => {
		mockParams = { locale: "ja-JP", scope: "date", date: "2026-08-01", itemKey: "review:with-photo" };
		const tree = await render();
		expect(axisOf(tree)).toBe("vertical");
		expect(innerAxisOf(tree)).toBe("horizontal");
	});
});
