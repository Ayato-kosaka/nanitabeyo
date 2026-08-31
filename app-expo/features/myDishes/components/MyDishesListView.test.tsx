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
// #1629 シートが編集・削除を持ったので、API / ダイアログ / スナックバーまで芋づるで読まれる。
// このテストが見たいのは一覧の見た目と遷移先だけなので、口だけ塞ぐ
const mockCallBackend = jest.fn();
const mockConfirm = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/contexts/DialogProvider", () => ({ useDialog: () => ({ confirm: mockConfirm }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

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
		/** #1629 1 セル = 1 ページなので、行ごとに違う dish_media.id を差せるようにする */
		dishMediaId?: string;
		/** #1629 写真なしの行から «自分のクチコミ» を開けることを見るテスト用 */
		myReview?: Record<string, unknown> | null;
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
						id: overrides.dishMediaId ?? "media-1",
						thumbnailImageUrl: overrides.thumbnailImageUrl,
						render_type: overrides.externalEmbedProvider ? "external_embed" : "stored",
						externalEmbed: overrides.externalEmbedProvider ? { provider: overrides.externalEmbedProvider } : undefined,
					},
		myReview: overrides.myReview ?? null,
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
	mockCallBackend.mockReset();
	mockConfirm.mockReset();
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
		expect(tree.root.findAll((node) => node.props?.testID === DELETED_MEDIA_TOMBSTONE_TEST_ID).length).toBeGreaterThan(
			0,
		);
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

		// #1629 一覧からは «その 1 件» のスコープ（scope=list）で開く。店舗スコープではない
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/my-dishes/feed",
			params: { locale: "ja-JP", scope: "list", itemKey: "review:with-photo", dishMediaId: "media-1" },
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
#1629 【回帰】**グリッドで見えているセルの数と、縦に送れる数が一致すること。**

以前は «店舗 id を重複排除して» 縦の並びとして置いていたので、同じ店の記録が 3 セル並んでいても
縦のページは 1 枚に潰れ、残り 2 件は横軸へ回っていた（オーナー指摘「お店でグルーピングしてるなら
要らない。グリッドは上下だけ」）。

⚠️ ここが赤くなったら、また «グリッドのセルと縦のページがずれる» に戻っている。
   通しの «N 番目を開いて縦に払うと N+1 番目» は
   `__tests__/myDishesGridFeedVertical.test.tsx` が見る。
*/
describe("#1629 一覧から Feed へ入るときの縦ページャの並び", () => {
	const ROWS = [
		makeItem("review:a", {
			thumbnailImageUrl: "https://example.com/a.jpg",
			restaurantId: "r-1",
			dishMediaId: "media-a",
		}),
		// 同じ店の 2 件目。**潰さない**。グリッドに 2 セル出ているなら縦も 2 ページ
		makeItem("review:b", {
			thumbnailImageUrl: "https://example.com/b.jpg",
			restaurantId: "r-1",
			dishMediaId: "media-b",
		}),
		makeItem("review:c", {
			thumbnailImageUrl: "https://example.com/c.jpg",
			restaurantId: "r-2",
			dishMediaId: "media-c",
		}),
		// 写真なしの行は Feed に入れられないので、並びからも外す
		makeItem("review:d", { restaurantId: "r-3" }),
	];

	const pressNth = async (n: number) => {
		useMyDishesFeedScopeStore.getState().clear();
		mockUseMyDishesQuery.mockReturnValue({
			items: ROWS,
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
			nodes[n].props.onPress();
		});
	};

	it("グリッドに出ている行を、重複を潰さず順番どおりに置く", async () => {
		await pressNth(0);

		expect(useMyDishesFeedScopeStore.getState().listItems).toEqual([
			{ itemKey: "review:a", dishMediaId: "media-a" },
			{ itemKey: "review:b", dishMediaId: "media-b" },
			{ itemKey: "review:c", dishMediaId: "media-c" },
		]);
		// 店舗の並びは触らない（あれは Map の入口のもの）
		expect(useMyDishesFeedScopeStore.getState().restaurantIds).toEqual([]);
	});

	it("同じ店の 2 件目を開いても、その行（media-b）で開く", async () => {
		await pressNth(1);

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/my-dishes/feed",
			params: { locale: "ja-JP", scope: "list", itemKey: "review:b", dishMediaId: "media-b" },
		});
	});
});

/*
#1629【オーナー実機報告】「梅欄ヤエチカ店が『削除されました』『写真なし』と表示されますが、
 押した時にレストラン詳細に行くのは仕様と違うはず。**写真なしで良いから自分の書いたクチコミ見たい**」

修正前は `dishMedia === null` の行がすべて店舗詳細へ push されていた。店舗詳細には自分の
書いた文章がどこにも出ないので、記録を開いても記録が読めなかった。

⚠️ アサーションを «シートが出たこと» だけに置かない。**店舗詳細へ push «しない» こと**を
   同時に見ないと、両方起きる実装（シートを出しつつ裏で遷移する）でも緑になる。
*/
describe("#1629 写真の無い記録から自分のクチコミを読む", () => {
	const REVIEW = {
		id: "review-1",
		rating: 4,
		comment: "肉が厚くて満足",
		price_cents: 3200,
		currency_code: "JPY",
		created_at: "2026-08-10T12:00:00.000Z",
		lock_no: 3,
	};

	const setItems = (items: MyDishItem[]) =>
		mockUseMyDishesQuery.mockReturnValue({
			items,
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasNextPage: false,
			loadMore: jest.fn(),
			refresh: jest.fn(),
		});

	/*
	⚠️ `findAll` は «合成要素» と «ホスト要素» の両方を拾うので、testID 1 つにつき 2 件返る。
	   数を見るアサーションではホスト要素（`type` が文字列）だけに絞ること。
	*/
	const hostsWithTestId = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
		tree.root.findAll((n) => n.props?.testID === testID && typeof n.type === "string");

	/*
	押すための要素はホスト側ではなく «onPress を持っているほう» を取る。
	TouchableOpacity のホスト View は onResponder* しか持たないので、
	ホストに絞ると押せない（実際にこれで 1 本落ちた）。
	*/
	const pressableWithTestId = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
		tree.root.findAll((n) => n.props?.testID === testID && typeof n.props?.onPress === "function")[0];

	const pressFirstCard = async (tree: TestRenderer.ReactTestRenderer) => {
		const card = tree.root.findAll((node) => node.props?.testID === "my-dishes-list-item")[0];
		await act(async () => {
			card.props.onPress();
		});
	};

	it("写真が無くても自分のレビューがあれば、店舗詳細へ飛ばさずクチコミを出す", async () => {
		setItems([makeItem("review:1", { myReview: REVIEW })]);
		const tree = await render();
		await pressFirstCard(tree);

		expect(hostsWithTestId(tree, "my-dish-own-review-sheet")).toHaveLength(1);
		const comment = hostsWithTestId(tree, "my-dish-own-review-comment")[0];
		expect(comment.props.children).toBe("肉が厚くて満足");
		// 修正前はここが呼ばれていた
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("削除済みの投稿でも同じくクチコミを読める（墓標は出したまま）", async () => {
		setItems([makeItem("review:1", { myReview: REVIEW, isOwnMediaDeleted: true })]);
		const tree = await render();
		await pressFirstCard(tree);

		expect(hostsWithTestId(tree, "my-dish-own-review-sheet")).toHaveLength(1);
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("シートの「お店の詳細を見る」を押したときだけ店舗詳細へ行く", async () => {
		setItems([makeItem("review:1", { myReview: REVIEW, restaurantId: "restaurant-9" })]);
		const tree = await render();
		await pressFirstCard(tree);

		const button = pressableWithTestId(tree, "my-dish-own-review-open-restaurant");
		await act(async () => {
			button.props.onPress();
		});

		expect(mockPush).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: "/[locale]/restaurant/[restaurantId]",
				params: expect.objectContaining({ restaurantId: "restaurant-9" }),
			}),
		);
	});

	it("レビューが無い行（食べたい等）は従来どおり店舗詳細へ行く", async () => {
		setItems([makeItem("dish:1", { myReview: null, restaurantId: "restaurant-3" })]);
		const tree = await render();
		await pressFirstCard(tree);

		expect(hostsWithTestId(tree, "my-dish-own-review-sheet")).toHaveLength(0);
		expect(mockPush).toHaveBeenCalledWith(
			expect.objectContaining({ params: expect.objectContaining({ restaurantId: "restaurant-3" }) }),
		);
	});

	/*
	#1629【オーナー実機報告】「編集&削除できない」。

	編集・削除はフィード右レールの «…»（`DishMediaMoreMenu`）にしか無く、写真の無い記録は
	フィードに出ないので **到達する手段がゼロ**だった。このシートが唯一の «その記録を開く場所»
	なので、ここから両方できることを固定する。
	*/
	describe("編集と削除", () => {
		it("「編集」から開くフォームには、いま保存されている内容が入っている", async () => {
			setItems([makeItem("review:1", { myReview: REVIEW })]);
			const tree = await render();
			await pressFirstCard(tree);

			await act(async () => {
				pressableWithTestId(tree, "my-dish-own-review-edit").props.onPress();
			});

			expect(hostsWithTestId(tree, "edit-review-modal")).toHaveLength(1);
			const input = tree.root.findAll(
				(n) => n.props?.testID === "edit-review-comment-input" && typeof n.type === "string",
			)[0];
			expect(input.props.value).toBe("肉が厚くて満足");
			// 3200 は最小単位。JPY は 0 桁なので「3200」のまま出す（100 で割らない）
			const price = tree.root.findAll(
				(n) => n.props?.testID === "edit-review-price-input" && typeof n.type === "string",
			)[0];
			expect(price.props.value).toBe("3200");
		});

		it("保存は lockNo を必ず送る（競合検知を無効化しない）", async () => {
			setItems([makeItem("review:1", { myReview: REVIEW })]);
			mockCallBackend.mockResolvedValue({ ...REVIEW, comment: "書き直した", lock_no: 4 });
			const tree = await render();
			await pressFirstCard(tree);
			await act(async () => {
				pressableWithTestId(tree, "my-dish-own-review-edit").props.onPress();
			});
			await act(async () => {
				pressableWithTestId(tree, "edit-review-submit-button").props.onPress();
			});

			expect(mockCallBackend).toHaveBeenCalledWith(
				"v1/dish-reviews/review-1",
				expect.objectContaining({
					method: "PATCH",
					requestPayload: expect.objectContaining({ lockNo: 3, priceCents: 3200, currencyCode: "JPY" }),
				}),
			);
		});

		it("削除は確認を挟み、承諾されたときだけレビュー 1 件を消す", async () => {
			setItems([makeItem("review:1", { myReview: REVIEW })]);
			mockConfirm.mockResolvedValue(false);
			const tree = await render();
			await pressFirstCard(tree);

			await act(async () => {
				pressableWithTestId(tree, "my-dish-own-review-delete").props.onPress();
			});
			expect(mockConfirm).toHaveBeenCalled();
			expect(mockCallBackend).not.toHaveBeenCalled();

			mockConfirm.mockResolvedValue(true);
			await act(async () => {
				pressableWithTestId(tree, "my-dish-own-review-delete").props.onPress();
			});
			// 写真は «無い» か «既に削除済み» なので、消せるのはクチコミ 1 件だけ
			expect(mockCallBackend).toHaveBeenCalledWith(
				"v1/dish-reviews/review-1",
				expect.objectContaining({ method: "DELETE" }),
			);
			expect(mockCallBackend).not.toHaveBeenCalledWith(
				expect.stringContaining("dish-media"),
				expect.anything(),
			);
			// 消したらシートは閉じる（消えたものを開いたままにしない）
			expect(hostsWithTestId(tree, "my-dish-own-review-sheet")).toHaveLength(0);
		});

		it("編集と削除の導線がシートに出る（フィードに出ない記録の唯一の出口）", async () => {
			setItems([makeItem("review:1", { myReview: REVIEW })]);
			const tree = await render();
			await pressFirstCard(tree);
			expect(hostsWithTestId(tree, "my-dish-own-review-edit")).toHaveLength(1);

			expect(hostsWithTestId(tree, "my-dish-own-review-delete")).toHaveLength(1);
		});
	});
});
