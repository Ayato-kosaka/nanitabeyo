/*
#1398 PR5 リストビューの写真なしフォールバック（設計書 (2/2) §12 PR5 / #1375 追補2 決定3）。

固定したいのは 3 点：
1. `dishMedia === null` でも灰色プレースホルダーにせず、`dish.categoryImageUrl` →
   `restaurant.image_url` の順で実画像を出す
2. 実画像へフォールバックしても「写真なし」であること自体は分かる
   （`MyDishes.list.noPhoto` バッジが出る）
3. 3 つとも無いときだけ、従来どおりの無地プレースホルダー（`my-dishes-list-item-placeholder`）
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

jest.mock("expo-image", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Image: ({ source }: { source?: { uri?: string } }) =>
			ReactActual.createElement(RNView, { testID: "my-dishes-list-item-image", source }),
	};
});

// #1398 PR5 このテストが見たいのは MyDishCard（写真なしフォールバック）だけなので、
// GridList は data を renderItem にそのまま流すだけの薄いフェイクへ差し替える
jest.mock("@/components/collapsible-tabs/GridList", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		GridList: ({ data, renderItem }: { data: { id: string }[]; renderItem: (info: { item: unknown }) => unknown }) =>
			ReactActual.createElement(
				RNView,
				{ testID: "my-dishes-list" },
				data.map((item: { id: string }) => ReactActual.createElement(RNView, { key: item.id }, renderItem({ item }))),
			),
	};
});

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { MyDishItem } from "@shared/api/v1/res";
import { MyDishesListView } from "./MyDishesListView";
import { DELETED_MEDIA_TOMBSTONE_TEST_ID } from "@/components/DeletedMediaTombstone";
// #1629 一覧から Feed へ入るときの «縦ページャの並び» を検証する
import { useMyDishesFeedScopeStore } from "../stores/useMyDishesFeedScopeStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const makeItem = (
	key: string,
	overrides: {
		thumbnailImageUrl?: string | null;
		categoryImageUrl?: string | null;
		restaurantImageUrl?: string | null;
		isOwnMediaDeleted?: boolean;
		/** #1375（9 巡目）取り込んだ投稿か。`render_type` と provider をまとめて差す */
		externalEmbedProvider?: string;
		/** #1629 縦ページャの並びを見るテスト用。既定は従来どおり restaurant-1 */
		restaurantId?: string;
	} = {},
): MyDishItem =>
	({
		key,
		status: "eaten",
		occurredAt: "2026-08-10T12:00:00.000Z",
		savedAt: null,
		eatenAt: "2026-08-10T12:00:00.000Z",
		restaurant: {
			id: overrides.restaurantId ?? "restaurant-1",
			name: "テスト食堂",
			image_url: overrides.restaurantImageUrl ?? null,
		},
		dish: { id: "dish-1", name: "ラーメン", categoryImageUrl: overrides.categoryImageUrl ?? null },
		dishMedia:
			overrides.thumbnailImageUrl === undefined || overrides.thumbnailImageUrl === null
				? null
				: {
						id: "media-1",
						thumbnailImageUrl: overrides.thumbnailImageUrl,
						render_type: overrides.externalEmbedProvider ? "external_embed" : "stored",
						externalEmbed: overrides.externalEmbedProvider
							? { provider: overrides.externalEmbedProvider }
							: undefined,
					},
		myReview: null,
		isOwnMediaDeleted: overrides.isOwnMediaDeleted ?? false,
	}) as unknown as MyDishItem;

const mockUseMyDishesQuery = jest.fn();
jest.mock("../hooks/useMyDishesQuery", () => ({
	useMyDishesQuery: () => mockUseMyDishesQuery(),
}));

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (): Promise<TestRenderer.ReactTestRenderer> => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<MyDishesListView />);
	});
	mountedTrees.push(tree);
	return tree;
};

beforeEach(() => {
	mockPush.mockClear();
});

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

describe("#1398 PR5 dishMedia === null の写真なしフォールバック", () => {
	it("categoryImageUrl があればそれを画像として出す（灰色プレースホルダーにしない）", async () => {
		mockUseMyDishesQuery.mockReturnValue({
			items: [makeItem("review:1", { categoryImageUrl: "https://example.com/category.jpg" })],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		const images = tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-image");
		expect(images.length).toBeGreaterThan(0);
		expect(images[0].props.source.uri).toBe("https://example.com/category.jpg");

		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-placeholder")).toHaveLength(0);
	});

	it("categoryImageUrl も無ければ restaurant.image_url へ落ちる", async () => {
		mockUseMyDishesQuery.mockReturnValue({
			items: [makeItem("review:1", { restaurantImageUrl: "https://example.com/restaurant.jpg" })],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		const images = tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-image");
		expect(images[0].props.source.uri).toBe("https://example.com/restaurant.jpg");
	});

	it("実画像へフォールバックしても『写真なし』バッジが出る", async () => {
		mockUseMyDishesQuery.mockReturnValue({
			items: [makeItem("review:1", { categoryImageUrl: "https://example.com/category.jpg" })],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		expect(
			tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-no-photo-badge").length,
		).toBeGreaterThan(0);
	});

	it("dishMedia があるとき（写真あり）はバッジを出さない", async () => {
		mockUseMyDishesQuery.mockReturnValue({
			items: [makeItem("review:1", { thumbnailImageUrl: "https://example.com/media.jpg" })],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-no-photo-badge")).toHaveLength(0);
	});

	it("categoryImageUrl / restaurant.image_url も無いときだけ従来どおりの無地プレースホルダーになる", async () => {
		mockUseMyDishesQuery.mockReturnValue({
			items: [makeItem("review:1")],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		expect(
			tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-placeholder").length,
		).toBeGreaterThan(0);
		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-image")).toHaveLength(0);
	});
});

describe("#1513 isOwnMediaDeleted の行は墓標になる（黙って消さない・差し替えない）", () => {
	const queryResult = (items: MyDishItem[]) => ({
		items,
		isLoading: false,
		isLoadingMore: false,
		error: null,
		hasNextPage: false,
		loadMore: jest.fn(),
		refresh: jest.fn(),
	});

	it("categoryImageUrl / restaurant.image_url があっても画像を出さず、墓標と「削除されました」を出す", async () => {
		mockUseMyDishesQuery.mockReturnValue(
			queryResult([
				makeItem("review:1", {
					categoryImageUrl: "https://example.com/category.jpg",
					restaurantImageUrl: "https://example.com/restaurant.jpg",
					isOwnMediaDeleted: true,
				}),
			]),
		);
		const tree = await render();

		// 跡地に別の絵を入れない
		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item-image")).toHaveLength(0);
		expect(tree.root.findAll((node) => node.props?.testID === DELETED_MEDIA_TOMBSTONE_TEST_ID).length).toBeGreaterThan(0);
		// 文言（i18n はキーをそのまま返すモック）
		expect(
			tree.root.findAll((node) => typeof node.type === "string" && node.children.includes("MyDishes.deleted.label"))
				.length,
		).toBeGreaterThan(0);
	});

	it("行そのものは残る（一覧から消えない）", async () => {
		mockUseMyDishesQuery.mockReturnValue(queryResult([makeItem("review:1", { isOwnMediaDeleted: true })]));
		const tree = await render();

		expect(
			tree.root.findAll(
				(node) => node.props?.testID === "my-dishes-list-item" && typeof node.props?.onPress === "function",
			),
		).toHaveLength(1);
	});

	it("削除されていない行には墓標を出さない", async () => {
		mockUseMyDishesQuery.mockReturnValue(
			queryResult([makeItem("review:1", { thumbnailImageUrl: "https://example.com/media.jpg" })]),
		);
		const tree = await render();

		expect(tree.root.findAll((node) => node.props?.testID === DELETED_MEDIA_TOMBSTONE_TEST_ID)).toHaveLength(0);
	});
});

describe("#1397 (PR4/5) Q2 リスト項目のタップ先は «その項目の店舗スコープの Feed»", () => {
	const pressFirstItem = async (tree: TestRenderer.ReactTestRenderer) => {
		const nodes = tree.root.findAll(
			(node) => node.props?.testID === "my-dishes-list-item" && typeof node.props?.onPress === "function",
		);
		expect(nodes.length).toBeGreaterThan(0);
		await act(async () => {
			nodes[0].props.onPress();
		});
	};

	it("写真ありの項目は my-dishes/feed へ push する。渡すのは index ではなく itemKey（R1）", async () => {
		mockUseMyDishesQuery.mockReturnValue({
			items: [
				// R1: 一覧の並びは写真なしを含むので、index を渡すと Feed 側とずれる
				makeItem("review:no-photo"),
				makeItem("review:with-photo", { thumbnailImageUrl: "https://example.com/media.jpg" }),
			],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		const nodes = tree.root.findAll(
			(node) => node.props?.testID === "my-dishes-list-item" && typeof node.props?.onPress === "function",
		);
		await act(async () => {
			nodes[nodes.length - 1].props.onPress();
		});

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/my-dishes/feed",
			params: { locale: "ja-JP", restaurantId: "restaurant-1", itemKey: "review:with-photo", dishMediaId: "media-1" },
		});
		expect(Object.keys(mockPush.mock.calls[0][0].params)).not.toContain("initialIndex");
	});

	it("写真なしの項目は従来どおり店舗詳細へ push する（Feed に入れられない）", async () => {
		mockUseMyDishesQuery.mockReturnValue({
			items: [makeItem("review:no-photo", { categoryImageUrl: "https://example.com/category.jpg" })],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		await pressFirstItem(tree);

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]",
			params: { locale: "ja-JP", restaurantId: "restaurant-1" },
		});
	});
});

describe("#1398 (PR4/7) want カードの「食べたを記録」CTA", () => {
	const wantItem = () =>
		({
			...makeItem("dish:dish-1", { thumbnailImageUrl: "https://example.com/media.jpg" }),
			status: "want",
		}) as unknown as MyDishItem;

	const findCta = (tree: TestRenderer.ReactTestRenderer) =>
		tree.root.findAll(
			(node) => node.props?.testID === "my-dishes-mark-as-eaten" && typeof node.props?.onPress === "function",
		);

	const renderWith = async (items: MyDishItem[]) => {
		mockUseMyDishesQuery.mockReturnValue({
			items,
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		return render();
	};

	it("want カードの CTA は既存の review-from-media へ push する（新ルートを作らない）", async () => {
		const tree = await renderWith([wantItem()]);

		await act(async () => {
			findCta(tree)[0].props.onPress({ stopPropagation: jest.fn() });
		});

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]/review-from-media/[dishMediaId]",
			params: { locale: "ja-JP", restaurantId: "restaurant-1", dishMediaId: "media-1" },
		});
	});

	// ここが崩れると CTA を押しただけで #1397 PR4 の全画面 Feed が開く
	it("CTA を押してもカードの Feed 遷移は起きない（push は 1 回だけ）", async () => {
		const tree = await renderWith([wantItem()]);

		await act(async () => {
			findCta(tree)[0].props.onPress({ stopPropagation: jest.fn() });
		});

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush.mock.calls[0][0].pathname).not.toBe("/[locale]/(tabs)/my-dishes/feed");
	});

	it("eaten カードには CTA を出さない", async () => {
		const tree = await renderWith([makeItem("review:eaten", { thumbnailImageUrl: "https://example.com/m.jpg" })]);
		expect(findCta(tree)).toHaveLength(0);
	});
});

/*
#1375（9 巡目・オーナー指摘「リストにインスタマークが欲しい（インスタのサムネだったら）」）

一覧には «自分で撮った写真» と «SNS から取り込んだもの» が混ざる。タイルを見ただけで
どちらか分かるよう、取り込んだ投稿にだけ provider のロゴを重ねる。

判定は `render_type === "external_embed"` を先に見る（`externalEmbed` は詰めていない経路が
あるフィールドなので、その有無で stored かどうかを決めてはいけない）。
*/
describe("#1375 取り込んだ投稿には provider のロゴを重ねる", () => {
	const queryResult = (items: MyDishItem[]) => ({
		items,
		isLoading: false,
		isLoadingMore: false,
		error: null,
		hasNextPage: false,
		loadMore: jest.fn(),
		refresh: jest.fn(),
	});
	const has = (tree: TestRenderer.ReactTestRenderer, testID: string): boolean =>
		tree.root.findAll((node) => node.props?.testID === testID).length > 0;

	it("取り込んだ投稿にはロゴが出る", async () => {
		mockUseMyDishesQuery.mockReturnValue(
			queryResult([makeItem("a", { thumbnailImageUrl: "https://img/1.jpg", externalEmbedProvider: "instagram" })]),
		);
		const tree = await render();
		expect(has(tree, "my-dishes-list-item-provider-badge")).toBe(true);
	});

	it("自分で撮った写真にはロゴを出さない", async () => {
		mockUseMyDishesQuery.mockReturnValue(queryResult([makeItem("b", { thumbnailImageUrl: "https://img/1.jpg" })]));
		const tree = await render();
		expect(has(tree, "my-dishes-list-item-provider-badge")).toBe(false);
	});
});

/*
#1629 【回帰】一覧からフィードへ入ると縦スクロールできなかった。

全画面 Feed の «外側 = 縦（前後のスコープ）» の並びは `useMyDishesFeedScopeStore` から取るが、
そこへ並びを置いていたのは **Map と Calendar だけ**で、一覧は置いていなかった。
store が空のとき Feed は 1 ページへ縮退するので、縦に払っても何も起きない。

⚠️ ここが赤くなったら、また «一覧から入ると縦に動かない» に戻っている。
*/
describe("#1629 一覧から Feed へ入るときの縦ページャの並び", () => {
	it("いま一覧に出ている店舗の並びを、重複を潰して store へ置く", async () => {
		useMyDishesFeedScopeStore.getState().clear();
		mockUseMyDishesQuery.mockReturnValue({
			items: [
				makeItem("review:a", { thumbnailImageUrl: "https://example.com/a.jpg", restaurantId: "r-1" }),
				// 同じ店の 2 件目。ページャの key は店舗 id なので、重複を残すと衝突する
				makeItem("review:b", { thumbnailImageUrl: "https://example.com/b.jpg", restaurantId: "r-1" }),
				makeItem("review:c", { thumbnailImageUrl: "https://example.com/c.jpg", restaurantId: "r-2" }),
				// 写真なしの行は Feed に入れられないので、並びからも外す
				makeItem("review:d", { restaurantId: "r-3" }),
			],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();

		const nodes = tree.root.findAll(
			(node) => node.props?.testID === "my-dishes-list-item" && typeof node.props?.onPress === "function",
		);
		await act(async () => {
			nodes[0].props.onPress();
		});

		expect(useMyDishesFeedScopeStore.getState().restaurantIds).toEqual(["r-1", "r-2"]);
	});

	/*
	#1629 出どころを «list» として置く。Feed 側はこれを見て **前後を絞らない**。
	Map 由来（前後 1 件）と同じ扱いにすると、一覧から入った縦フリックが 3 ページで終わる
	（オーナー実機報告「グリッドのフィードが無限に下スクロールできない」）。
	*/
	it("並びの出どころを «list» として置く（Feed 側が前後を絞らない根拠）", async () => {
		useMyDishesFeedScopeStore.getState().clear();
		mockUseMyDishesQuery.mockReturnValue({
			items: [makeItem("review:a", { thumbnailImageUrl: "https://example.com/a.jpg", restaurantId: "r-1" })],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});
		const tree = await render();
		const nodes = tree.root.findAll(
			(node) => node.props?.testID === "my-dishes-list-item" && typeof node.props?.onPress === "function",
		);
		await act(async () => {
			nodes[0].props.onPress();
		});

		expect(useMyDishesFeedScopeStore.getState().restaurantIdsSource).toBe("list");
	});
});
