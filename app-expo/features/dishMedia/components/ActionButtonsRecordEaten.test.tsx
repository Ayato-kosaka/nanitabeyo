/*
#1398 (PR3/7) 【設計】全画面 Feed（DishMediaFeed + ActionButtons）に「食べた」導線を追加する。

## なぜ必要か
全画面 Feed にはいいね / 保存（＝食べたい）/ シェア / 地図はあったが「食べた」が無かった。
遷移先は my-dishes カードや店舗詳細フィードと同じ既存ルート（review-from-media）で、
このボタンはその呼び出し元が1つ増えるだけ。ここでは
1. ゲストには出ないこと（like/save と同じ isGuestUser の作法）
2. ログイン済みで押すと restaurantId / dishMediaId 付きで review-from-media へ push すること
の 2 点を固定する。「済」表示は付けない仕様（dish_reviews は再訪＝別レビューが正しい）なので、
トグル状態の検証はしない。

⚠️ #1264 でこのファイルはもう «食べた» 専用ではない。レール上の **遷移するボタン**（食べた /
店舗詳細）をまとめて見る。モックが同じなので分けない（写経した複製を作らない）。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockPush = jest.fn();

/*
#1629 «…» メニュー（DishMediaMoreMenu）は `useDialog` など独自の依存を持つ。
このファイルの関心はレールの いいね / 保存 / 食べた なので、メニューは差し替える。
メニュー自身の挙動は DishMediaMoreMenu.test.tsx が見る。
*/
jest.mock("@/features/dishMedia/components/DishMediaMoreMenu", () => ({
	DishMediaMoreMenu: function MockDishMediaMoreMenu() {
		return null;
	},
}));

jest.mock("expo-router", () => {
	const stub = {
		push: (href: unknown) => mockPush(href),
		replace: () => {},
		back: () => {},
		canGoBack: () => true,
	};
	return { router: stub, useRouter: () => stub };
});

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
// #1375（5 巡目）アイコンの色で «記録済み» を表すので、色を観測できるモックにする
jest.mock("lucide-react-native", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return new Proxy(
		{},
		{
			get: (_target, prop) =>
				prop === "__esModule"
					? true
					: (props: Record<string, unknown>) =>
							ReactActual.createElement(RNView, { testID: `icon-${String(prop)}`, ...props }),
		},
	);
});
jest.mock("expo-image", () => ({
	Image: Object.assign(
		function MockExpoImage() {
			return null;
		},
		{ prefetch: () => Promise.resolve(true) },
	),
}));
// #694 buttonsGesture は GestureDetector に渡すだけのスタブでよい（gesture ロジックはここでは見ない）
jest.mock("react-native-gesture-handler", () => {
	const react = require("react");
	return {
		GestureDetector: ({ children }: { children?: React.ReactNode }) =>
			react.createElement(react.Fragment, null, children),
	};
});
jest.mock("@/hooks/useHaptics", () => {
	const lightImpact = jest.fn();
	return { useHaptics: () => ({ lightImpact, mediumImpact: jest.fn() }) };
});
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn(() => Promise.resolve()) }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));

const mockUseAuth = jest.fn();
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));

import { ActionButtons } from "./ActionButtons";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { MY_DISH_STATUS_COLORS } from "@/features/myDishes/statusColors";
import type { DishMediaEntry } from "@shared/api/v1/res";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESTAURANT_ID = "restaurant-1";
const DISH_MEDIA_ID = "dish-media-1";

/** ActionButtons が参照する最小限のフィールドだけを持つダミー DishMediaEntry */
const entry = {
	restaurant: { id: RESTAURANT_ID, name: "テスト食堂", google_place_id: "place-1" },
	dish: { id: "dish-1", name: "ラーメン" },
	dish_media: {
		id: DISH_MEDIA_ID,
		isMine: false,
		isSaved: false,
		isLiked: false,
		likeCount: 3,
		mediaUrl: null,
		thumbnailImageUrl: "",
	},
	dish_reviews: [],
} as unknown as DishMediaEntry;

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(element);
	});
	mountedTrees.push(tree);
	return tree;
};

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

/** 指定 testID の要素を押す */
const press = async (tree: TestRenderer.ReactTestRenderer, testID: string): Promise<void> => {
	const target = tree.root.find((node) => node.props?.testID === testID);
	await act(async () => {
		await target.props.onPress();
	});
};

/** 指定 testID の要素が描かれているか */
const exists = (tree: TestRenderer.ReactTestRenderer, testID: string): boolean =>
	tree.root.findAll((node) => node.props?.testID === testID).length > 0;

beforeEach(() => {
	mockPush.mockClear();
	mockUseAuth.mockReset();
	useDishMediaEntriesStore.getState().clearByKey();
	useDishMediaEntriesStore.getState().upsertDishMediaEntries([entry]);
});

describe("#1398 (PR3/7) ActionButtons の「食べた」導線", () => {
	it("ゲストには「食べた」ボタンを出さない", async () => {
		mockUseAuth.mockReturnValue({ user: { id: "anon-1", is_anonymous: true }, isAuthResolved: true });

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);

		expect(exists(tree, "dish-action-eaten")).toBe(false);
		// ゲストでも like/save は出る（既存仕様）ことも合わせて確認し、ゲスト判定を「食べた」だけ誤って
		// 全ボタンへ広げていないことを見る
		expect(exists(tree, "dish-action-like")).toBe(true);
		expect(exists(tree, "dish-action-save")).toBe(true);
	});

	it("user が未確定（null）でもゲスト扱いで「食べた」ボタンを出さない", async () => {
		mockUseAuth.mockReturnValue({ user: null, isAuthResolved: false });

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);

		expect(exists(tree, "dish-action-eaten")).toBe(false);
	});

	it("ログイン済みで押すと restaurantId / dishMediaId 付きで review-from-media へ push する", async () => {
		mockUseAuth.mockReturnValue({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true });

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);

		expect(exists(tree, "dish-action-eaten")).toBe(true);

		await press(tree, "dish-action-eaten");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]/review-from-media/[dishMediaId]",
			params: { locale: "ja-JP", restaurantId: RESTAURANT_ID, dishMediaId: DISH_MEDIA_ID },
		});
	});

	// #1398 / #1375（5 巡目）【仕様】記録済みは **色でだけ** 表す。
	// dish_reviews に (user_id, dish_id) の一意制約は無く、再訪＝別レビューが正しいため、
	// 押した後も同じボタンを再度押せる（disabled にならない）ことを見る
	it("押した後もボタンは活性のまま（再訪の記録を妨げない）", async () => {
		mockUseAuth.mockReturnValue({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true });

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);

		await press(tree, "dish-action-eaten");
		await press(tree, "dish-action-eaten");

		expect(mockPush).toHaveBeenCalledTimes(2);
	});
});

/*
#1375 実機確認（5 巡目）:「フィードの『食べたを記録』ボタンに記録済みの色を付けてほしい」。

見るのは 2 つ。
1. `isEaten` が来たら色が変わり、読み上げでも «記録済み» が分かる（色だけに頼らない）
2. それでも **押せる**（再訪は別の記録として正しい。済 = 無効化ではない）
*/
describe("#1375 / #1834 記録済み・保存済みの色", () => {
	const eatenEntry = {
		...entry,
		dish_media: { ...entry.dish_media, isEaten: true },
	} as unknown as DishMediaEntry;

	const savedEntry = {
		...entry,
		dish_media: { ...entry.dish_media, isSaved: true },
	} as unknown as DishMediaEntry;

	/** 「保存（＝食べたい）」ボタンの中のアイコン（ホスト要素だけを見る） */
	const savedIconColor = (tree: TestRenderer.ReactTestRenderer): string =>
		tree.root
			.find((node) => node.props?.testID === "dish-action-save")
			.find((node) => typeof node.type === "string" && node.props?.testID === "icon-Bookmark").props.color;

	/** 「食べたを記録」ボタンの中のアイコン（ホスト要素だけを見る） */
	const eatenIconColor = (tree: TestRenderer.ReactTestRenderer): string =>
		tree.root
			.find((node) => node.props?.testID === "dish-action-eaten")
			.find((node) => typeof node.type === "string" && node.props?.testID === "icon-UtensilsCrossed").props.color;

	it("isEaten が false / undefined のときは白のまま", async () => {
		mockUseAuth.mockReturnValue({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true });
		useDishMediaEntriesStore.getState().upsertDishMediaEntries([entry]);

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);
		expect(eatenIconColor(tree)).toBe("#FFFFFF");
		const button = tree.root.find((node) => node.props?.testID === "dish-action-eaten");
		expect(button.props["aria-selected"]).toBe(false);
	});

	it("isEaten のときは «食べた» の色になり、読み上げでも記録済みが分かる", async () => {
		mockUseAuth.mockReturnValue({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true });
		useDishMediaEntriesStore.getState().upsertDishMediaEntries([eatenEntry]);

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);
		expect(eatenIconColor(tree)).toBe(MY_DISH_STATUS_COLORS.eaten.fill);
		const button = tree.root.find((node) => node.props?.testID === "dish-action-eaten");
		expect(button.props["aria-selected"]).toBe(true);
		expect(button.props.accessibilityLabel).toBe("DishMediaContent.accessibility.recordEatenAgain");
	});

	/*
	#1834 続き（11 巡目）**«食べたい»（保存）側の «状態 → 色» も、CI が回すテストで縛る。**

	この向きを見ていたのは `reactions.spec.ts` だけで、あれは `@mutation` ゲート
	（`RUN_MUTATION=1` かつ認証情報が要る）なので既定の CI では回らない。
	つまりここで色名の定数を直に書き戻しても、回るテストは全部緑のままだった。
	上の «食べた» 側と対にして、両方向を同じ形で固定する。
	*/
	it("isSaved のときブックマークは «食べたい» の色になる（色名の直書きへ戻さない）", async () => {
		mockUseAuth.mockReturnValue({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true });
		useDishMediaEntriesStore.getState().upsertDishMediaEntries([savedEntry]);

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);
		expect(savedIconColor(tree)).toBe(MY_DISH_STATUS_COLORS.want.fill);
		// «食べたい» と «食べた» が同じ色に潰れていないこと（色相 1 本で区別しているため）
		expect(MY_DISH_STATUS_COLORS.want.fill).not.toBe(MY_DISH_STATUS_COLORS.eaten.fill);
	});

	it("isSaved が false のときブックマークは白のまま", async () => {
		mockUseAuth.mockReturnValue({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true });
		useDishMediaEntriesStore.getState().upsertDishMediaEntries([entry]);

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);
		expect(savedIconColor(tree)).toBe("#FFFFFF");
	});

	it("記録済みでも押せる（再訪の記録を妨げない）", async () => {
		mockUseAuth.mockReturnValue({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true });
		useDishMediaEntriesStore.getState().upsertDishMediaEntries([eatenEntry]);

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);
		await press(tree, "dish-action-eaten");
		expect(mockPush).toHaveBeenCalledTimes(1);
	});
});


/*
#1264 【設計】結果フィードから店舗詳細へ行く導線。

#1071 が «押しても何も起きないので出さない / 画面が実装されたら復活させる» として落としていた
ボタンを、条件が満たされたので復活させた。ここで固定するのは 3 点。

1. 押すと店舗詳細ルートへ **restaurantId 付きで** push すること（#1071 のコメントに残っていた
   `/(tabs)/(home)/restaurant/1` は存在しないルートなので、そこへ戻さない）
2. **ゲストにも出す**こと。レビューを読むのに認証は要らない（like/save と同じ扱い）
3. 店の写真が無いときは **アイコンに倒す**こと。空の丸を出さない
   （`imageUrls` は `image_path` 由来で、無い店がある / #1680 #1902）

本番 90 日の実測では、検索結果まで来た 15,936 人のうち店舗詳細へ着いたのは 21 人（0.13%）だった。
*/
describe("#1264 ActionButtons の店舗詳細への導線", () => {
	it("押すと restaurantId 付きで店舗詳細ルートへ push する", async () => {
		mockUseAuth.mockReturnValue({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true });

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);

		expect(exists(tree, "dish-action-restaurant")).toBe(true);

		await press(tree, "dish-action-restaurant");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]",
			params: { locale: "ja-JP", restaurantId: RESTAURANT_ID },
		});
	});

	it("ゲストにも出す（レビューを読むのに認証は要らない）", async () => {
		mockUseAuth.mockReturnValue({ user: { id: "anon-1", is_anonymous: true }, isAuthResolved: true });

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);

		// «食べた» はゲストに出さないが、こちらは出す。ゲスト判定をレール全体へ広げていないことを見る
		expect(exists(tree, "dish-action-eaten")).toBe(false);
		expect(exists(tree, "dish-action-restaurant")).toBe(true);
	});

	it("店の写真が無ければアイコンに倒す（空の丸を出さない）", async () => {
		mockUseAuth.mockReturnValue({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true });

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);

		// entry は imageUrls を持たない（上のダミー）。lucide のモックは testID を icon-<名前> で出す
		expect(exists(tree, "icon-Store")).toBe(true);
	});

	it("店の写真があればアイコンではなく写真を出す", async () => {
		mockUseAuth.mockReturnValue({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true });
		useDishMediaEntriesStore.getState().clearByKey();
		useDishMediaEntriesStore.getState().upsertDishMediaEntries([
			{
				...entry,
				restaurant: { ...entry.restaurant, imageUrls: { sm: "https://cdn.example.test/r.webp" } },
			} as unknown as DishMediaEntry,
		]);

		const tree = await render(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);

		expect(exists(tree, "dish-action-restaurant")).toBe(true);
		expect(exists(tree, "icon-Store")).toBe(false);
	});
});
