/*
#1667 【バグ】レビュー 0 件の店で ★ 空 5 つ + 「0」が出て、«最低評価» と見分けが付かなかった。

【オーナー確定 2026-09-03】0 件のときは **何も出さない**。「未評価」というラベルも出さない
（無いものを言葉で埋めない、が標準）。1 件以上のときの見た目は変えない
（→ `SelectedRestaurantDetails.tsx` の分岐）。API の `averageRating` / `reviewCount` は
nullable にしていないので、この画面がレビュー件数で出し分けることを固定する。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { RestaurantEntry } from "@/stores/useRestaurantStore";

jest.mock("expo-router", () => ({
	useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, canGoBack: () => true }),
}));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 800 }),
}));
jest.mock("expo-image", () => ({ Image: "Image" }));
jest.mock("expo-linear-gradient", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		LinearGradient: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
	};
});
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("@/lib/googlePlaces", () => ({
	getGoogleMapsLink: jest.fn(async () => ({ mapUrl: "https://maps.google.com/?q=test", canOpen: true })),
}));
jest.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: jest.fn(async () => {}) }));
// #843 «Google マップで開く» はアプリ内地図モーダルを開くようになった。Provider 抜きで
// SelectedRestaurantDetails を描くため、フックだけ差し替える
jest.mock("@/contexts/MapsEmbedModalProvider", () => ({
	useMapsEmbedModal: () => ({ showMapsEmbedModal: jest.fn() }),
}));

// タブの中身は今回の検証に無関係。ヘッダーだけ見たいので器だけ描く
jest.mock("@/components/collapsible-tabs", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Tabs: {
			Container: ({ renderHeader }: { renderHeader?: () => React.ReactNode }) =>
				ReactActual.createElement(RNView, null, renderHeader?.()),
			Tab: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
		},
	};
});
jest.mock("@/features/map/components/tabs/RestaurantReviewsTab", () => ({
	RestaurantReviewsTab: () => null,
}));

import { SelectedRestaurantDetails } from "@/features/restaurant/components/SelectedRestaurantDetails";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const buildEntry = (averageRating: number, reviewCount: number) =>
	({
		restaurant: { id: "restaurant-1", name: "テスト食堂", imageUrls: undefined, google_place_id: "place-1" },
		meta: { averageRating, reviewCount, totalCents: 0, maxEndDate: null },
	}) as unknown as RestaurantEntry;

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

// react-test-renderer は合成コンポーネントと host の両方を辿るため、testID を持つ Text は
// `deep: false` を付けないと 1 個が 2 件に見える（restaurantDetailRoutes.test.tsx と同じ注意）
const findByTestId = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
	tree.root.findAll((node) => node.props?.testID === testID, { deep: false });

describe("#1667 レビュー 0 件の店は、評価まわりを何も描かない", () => {
	it("reviewCount=0 のとき、星も数字も «未評価» ラベルも描かない", async () => {
		const tree = await render(<SelectedRestaurantDetails restaurantEntry={buildEntry(0, 0)} />);

		// «未評価» のようなラベルへ戻したらここが赤くなる
		expect(findByTestId(tree, "restaurant-detail-unrated")).toHaveLength(0);
		expect(findByTestId(tree, "restaurant-detail-rating-value")).toHaveLength(0);
		expect(findByTestId(tree, "restaurant-detail-review-count")).toHaveLength(0);
	});

	it("reviewCount>=1 のときは従来どおり星と数字を描く", async () => {
		const tree = await render(<SelectedRestaurantDetails restaurantEntry={buildEntry(4.2, 12)} />);

		expect(findByTestId(tree, "restaurant-detail-unrated")).toHaveLength(0);
		const ratingValue = findByTestId(tree, "restaurant-detail-rating-value");
		expect(ratingValue).toHaveLength(1);
		expect(ratingValue[0].props.children).toBe(4.2);
		const reviewCount = findByTestId(tree, "restaurant-detail-review-count");
		expect(reviewCount).toHaveLength(1);
		expect(reviewCount[0].props.children).toEqual(["(", 12, ")"]);
	});
});
