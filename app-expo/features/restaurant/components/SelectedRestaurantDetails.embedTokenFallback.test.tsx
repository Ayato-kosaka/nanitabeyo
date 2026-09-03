/*
#1810 PL レビュー 3番【回帰防止】店舗詳細の «Google マップで開く» を、`useMapsEmbedModal`
（features/maps/hooks/useMapsEmbedModal.ts）を実物のまま固定する。

`__tests__/restaurantDetailRoutes.test.tsx` は `useMapsEmbedModal` をモックしており、
押下先の分岐（feed への push 等）だけを検証対象にしている。ここでは hook を実物のまま
組み立て、トークン取得（`POST /v1/maps/embed-token`）の成否によって実際に

  - 失敗 → `/[locale]/maps-embed` へ一度も遷移せず `openExternalUrl` で外部ブラウザへ直行する
    （main と同じ体験）
  - 成功 → `/[locale]/maps-embed` へ解決済みの embedUrl で router.push する。
    `openExternalUrl` は呼ばない

ことだけが変わることを固定する。

#843 で `MapsEmbedModal` は Portal ベースの全画面オーバーレイから expo-router のルート
（`app/[locale]/maps-embed.tsx`）へ変わったため、以前のように «同じ描画ツリーにモーダルが
現れるか» では検証できない。ここでは `router.push` の呼び出しそのものを観測する
（遷移先の画面本体は `app/[locale]/maps-embed.tsx` 側で別途検証する）。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { RestaurantEntry } from "@/stores/useRestaurantStore";

jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => {
	const lightImpact = jest.fn();
	const mediumImpact = jest.fn();
	return { useHaptics: () => ({ lightImpact, mediumImpact }) };
});
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
jest.mock("@/hooks/useSheetBottomPadding", () => ({ useSheetBottomPadding: () => 0 }));

jest.mock("react-native-safe-area-context", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
		useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 800 }),
		SafeAreaView: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
	};
});

jest.mock("expo-image", () => ({ Image: "Image" }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("expo-linear-gradient", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		LinearGradient: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
	};
});
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/contexts/SnackbarProvider", () => {
	const showSnackbar = jest.fn();
	return { useSnackbar: () => ({ showSnackbar }) };
});

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

// collapsible tabs は「ヘッダーと中身を描く器」としてだけ必要（restaurantDetailRoutes.test.tsx と同じ）
jest.mock("@/components/collapsible-tabs", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Tabs: {
			Container: ({ renderHeader, children }: { renderHeader?: () => React.ReactNode; children?: React.ReactNode }) =>
				ReactActual.createElement(RNView, null, renderHeader?.(), children),
			Tab: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
			FlatList: () => null,
			ScrollView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
		},
	};
});
jest.mock("@/features/map/components/tabs/RestaurantReviewsTab", () => ({ RestaurantReviewsTab: () => null }));

jest.mock("@/constants/Env", () => ({ Env: { BACKEND_BASE_URL: "https://api.example.com" } }));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

const mockOpenExternalUrl = jest.fn(async (_url: string) => {});
jest.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: (url: string) => mockOpenExternalUrl(url) }));

// #843 «Google マップで開く» はモーダルを開く前に mapUrl / canOpen を取得する。押下先だけ見たいので口を塞ぐ
jest.mock("@/lib/googlePlaces", () => ({
	getGoogleMapsLink: jest.fn(async () => ({ mapUrl: "https://maps.google.com/?q=test", canOpen: true })),
}));

import { SelectedRestaurantDetails } from "./SelectedRestaurantDetails";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const restaurantEntry = {
	restaurant: { id: "restaurant-42", name: "テスト食堂", imageUrls: undefined, google_place_id: "place-1" },
	meta: { averageRating: 4.2, reviewCount: 12, totalCents: 0, maxEndDate: null },
} as unknown as RestaurantEntry;

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (element: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> => {
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
	mockCallBackend.mockReset();
	mockOpenExternalUrl.mockClear();
	mockLogFrontendEvent.mockClear();
	mockPush.mockClear();
});

const pressGoogleMapsButton = async (tree: TestRenderer.ReactTestRenderer): Promise<void> => {
	const target = tree.root.find((node) => node.props?.testID === "restaurant-detail-google-maps-button");
	await act(async () => {
		await target.props.onPress();
		// showMapsEmbedModal は fire-and-forget なので、トークン取得（mockCallBackend）の
		// 解決を待つためにもう数 tick 進める
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
};

describe("#1810 SelectedRestaurantDetails: トークン取得の成否でルート遷移/外部ブラウザを出し分ける（実 hook）", () => {
	it("トークン取得に失敗したら、/[locale]/maps-embed へ遷移せず外部ブラウザへ直行する（main と同じ体験）", async () => {
		mockCallBackend.mockRejectedValue(new Error("network error"));

		const tree = await render(<SelectedRestaurantDetails restaurantEntry={restaurantEntry} />);
		await pressGoogleMapsButton(tree);

		expect(mockPush).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: "/[locale]/maps-embed" }));
		expect(mockOpenExternalUrl).toHaveBeenCalledWith("https://maps.google.com/?q=test");
	});

	it("トークン取得に成功したら、/[locale]/maps-embed へ解決済みの embedUrl で router.push する。外部ブラウザへは行かない", async () => {
		mockCallBackend.mockResolvedValue({ token: "evidence-stub-token", expiresAt: "2099-01-01T00:00:00.000Z" });

		const tree = await render(<SelectedRestaurantDetails restaurantEntry={restaurantEntry} />);
		await pressGoogleMapsButton(tree);

		expect(mockPush).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: "/[locale]/maps-embed",
				params: expect.objectContaining({
					locale: "ja-JP",
					mode: "place",
					embedUrl: "https://api.example.com/v1/maps/embed?token=evidence-stub-token",
				}),
			}),
		);
		expect(mockOpenExternalUrl).not.toHaveBeenCalled();
	});
});
