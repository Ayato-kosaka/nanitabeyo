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
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockPush = jest.fn();

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
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
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
		GestureDetector: ({ children }: { children?: React.ReactNode }) => react.createElement(react.Fragment, null, children),
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
import type { DishMediaEntry } from "@shared/api/v1/res";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESTAURANT_ID = "restaurant-1";
const DISH_MEDIA_ID = "dish-media-1";

/** ActionButtons が参照する最小限のフィールドだけを持つダミー DishMediaEntry */
const entry = {
	restaurant: { id: RESTAURANT_ID, name: "テスト食堂", google_place_id: "place-1" },
	dish: { id: "dish-1", name: "ラーメン" },
	dish_media: { id: DISH_MEDIA_ID, isMine: false, isSaved: false, isLiked: false, likeCount: 3, mediaUrl: null, thumbnailImageUrl: "" },
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

	// #1398 【仕様】「済」表示は付けない。dish_reviews に (user_id, dish_id) の一意制約は無く、
	// 再訪＝別レビューが正しいため、押した後も同じボタンを再度押せる（disabled にならない）ことを見る
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
