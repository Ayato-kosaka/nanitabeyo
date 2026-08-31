/*
#1629【41】オーナー実機報告:

> グリッド画面の「このメディアは現在ご利用いただけません。」が出てると、投稿削除出来ない。
> z-index の不具合

«利用いただけません» / «処理中» の帯は `StyleSheet.absoluteFillObject` + `zIndex: 5` で
画面全面を覆う。`pointerEvents` を指定しない View は既定 `"auto"` なので **タップを
自分で受け取る**。「…」メニュー（投稿の削除）を含む下部の操作列は zIndex を持たず、
帯の下に潜っていたため、**利用できないメディアほど消したいのに、そのときだけ消せなかった**。

ここで固定すること:

1. 帯は `pointerEvents="none"`（押せるものが 1 つも無いので、タップを下へ素通りさせる）
2. 操作列（`ActionButtons`）の重ね順は帯より **上**（素通りするだけでは、押せても
   60% の黒に隠れて見えない）

⚠️ 「操作が押せる」は «見えている» と «タップが届く» の 2 つが揃って初めて成立する。
   片方だけを直して緑にしないこと。
*/
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn() }) }));
jest.mock("../hooks/useMediaTracking", () => ({
	useMediaTracking: () => ({ handleVideoProgress: jest.fn(), handleVideoLoop: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("react-native-gesture-handler", () => ({
	GestureDetector: ({ children }: { children: React.ReactNode }) => children,
	Gesture: {
		Tap: () => {
			const chain: Record<string, () => unknown> = {};
			for (const name of ["maxDistance", "onBegin", "onEnd", "onFinalize", "requireExternalGestureToFail"]) {
				chain[name] = () => chain as unknown as never;
			}
			return chain;
		},
	},
}));
jest.mock("expo-image", () => ({ __esModule: true, Image: () => null }));
jest.mock("../../../components/VideoPlayer", () => ({ __esModule: true, default: () => null }));
jest.mock("./ExternalEmbedPlayer", () => ({ ExternalEmbedPlayer: () => null }));
jest.mock("./DishReviewsSection", () => ({ DishReviewsSection: () => null }));
jest.mock("@/components/SkeletonShimmer", () => ({ SkeletonShimmer: () => null }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));

/** 操作列の代役。「…」メニューはこの中に居る */
const ACTION_BUTTONS_TEST_ID = "dish-media-action-buttons";
jest.mock("./ActionButtons", () => {
	const ReactActual = jest.requireActual("react");
	const { View } = jest.requireActual("react-native");
	return {
		ActionButtons: () => ReactActual.createElement(View, { testID: "dish-media-action-buttons" }),
	};
});

import DishMediaContent from "./DishMediaContent";
import { useDishMediaEntriesStore, type NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";

const MEDIA_ID = "dm-unavailable";

const entry = (status: string): NormalizedDishMediaEntry =>
	({
		dish_media: {
			id: MEDIA_ID,
			isMine: true,
			media_type: "image",
			mediaUrl: "https://example.test/dm.jpg",
			media_processing_status: status,
		},
		restaurant: { id: "restaurant-1", name: "テスト店" },
		dish: { id: "dish-1", name: "テスト料理" },
		dishReviewIds: [],
	}) as unknown as NormalizedDishMediaEntry;

/** style は配列・入れ子で来るので畳んでから読む */
const flattenStyle = (style: unknown): Record<string, unknown> => {
	if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
	return (style ?? {}) as Record<string, unknown>;
};

function render(status: string) {
	useDishMediaEntriesStore.setState({
		entriesByMediaId: { [MEDIA_ID]: entry(status) },
		mediaIdsByKey: {},
		reviewsByReviewId: {},
		reviewIdsByKey: {},
		deletedIds: {},
	});
	let tree!: ReactTestRenderer;
	act(() => {
		tree = create(
			<DishMediaContent
				id={MEDIA_ID}
				isActive
				sessionId="session"
				entriesKey="test"
				idType="dish_media"
				backgroundImageState={{ status: "ready", image: {} as never }}
			/>,
		);
	});
	return tree;
}

const zIndexOf = (tree: ReactTestRenderer, testID: string) =>
	Number(flattenStyle(tree.root.findByProps({ testID }).props.style).zIndex ?? 0);

describe("#1629【41】お知らせの帯が投稿の操作を塞がない", () => {
	it("「このメディアは現在ご利用いただけません」の帯はタップを素通りさせる", () => {
		const tree = render("failed");
		const overlay = tree.root.findByProps({ testID: "dish-media-error-overlay" });
		expect(overlay.props.pointerEvents).toBe("none");
	});

	it("その帯より «…メニューを含む操作列» の方が上に重なる", () => {
		const tree = render("failed");
		// 操作列が本当にそこに居ることを先に確かめる（zIndex だけ見て «居ない» を緑にしない）
		expect(tree.root.findAllByProps({ testID: ACTION_BUTTONS_TEST_ID }).length).toBeGreaterThan(0);
		expect(zIndexOf(tree, "dish-media-bottom-section")).toBeGreaterThan(zIndexOf(tree, "dish-media-error-overlay"));
	});

	it("«処理中» の帯も同じ扱い（同じ理由で削除を塞いでいた）", () => {
		const tree = render("processing");
		expect(tree.root.findByProps({ testID: "dish-media-processing-overlay" }).props.pointerEvents).toBe("none");
	});
});
