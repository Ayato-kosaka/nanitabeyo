/*
#843 / #1810 MapsEmbedModal の表示ロジック検証。

#1810 PL レビュー 3番でトークン取得（`POST /v1/maps/embed-token`）は
`MapsEmbedModalProvider` 側へ移した（キー未設定の間 «モーダルが開く→表示できない→
もう一度押す» という無意味な往復を無くすため。取得に失敗したらそもそもモーダルを開かない）。
そのため、このコンポーネントは常に解決済みの `embedUrl` を受け取る前提になり、
ここで固定するのは次の 2 点だけになった。
- params が null なら何も描かない
- WebView が居ないテスト環境では MapsEmbedView 自身が fallback へ倒れ、
  フッタの外部リンクは重ねて出さない（#1810 PL レビュー 3番）

トークン取得の成功/失敗の分岐は `contexts/MapsEmbedModalProvider.test.tsx` が持つ。
*/
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
jest.mock("@/hooks/useSheetBottomPadding", () => ({ useSheetBottomPadding: () => 0 }));
jest.mock("lucide-react-native", () => ({ X: () => null }));
jest.mock("@/contexts/ThemeProvider", () => ({
	useAppTheme: () => ({ colors: new Proxy({}, { get: () => "#000000" }) }),
	useThemedStyles: (factory: (c: Record<string, string>) => unknown) =>
		factory(new Proxy({}, { get: () => "#000000" }) as Record<string, string>),
}));
jest.mock("@/constants/Env", () => ({ Env: { BACKEND_BASE_URL: "https://api.example.com" } }));

const mockOpenExternalUrl = jest.fn(async (_url: string) => {});
jest.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: (url: string) => mockOpenExternalUrl(url) }));

import { MapsEmbedModal, type ResolvedMapsEmbedModalParams } from "./MapsEmbedModal";

const PARAMS: ResolvedMapsEmbedModalParams = {
	mode: "search",
	q: "ラーメン",
	center: { latitude: 35.6, longitude: 139.7 },
	hl: "ja",
	title: "ラーメン",
	externalUrl: "https://www.google.com/maps/search/ramen/@35.6,139.7,14z",
	source: "search_result_screen",
	embedUrl: "https://api.example.com/v1/maps/embed?token=met1.abc.def",
};

/** 保留中の act() 内マイクロタスクを 1 サイクル流す */
const flush = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});

describe("MapsEmbedModal", () => {
	afterEach(() => {
		mockOpenExternalUrl.mockClear();
		mockLogFrontendEvent.mockClear();
	});

	it("params が null なら何も描かない", () => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<MapsEmbedModal params={null} onClose={jest.fn()} />);
		});
		expect(tree.toJSON()).toBeNull();
	});

	it("解決済みの embedUrl を MapsEmbedView へそのまま渡す。WebView 不在ビルド（テスト環境）では MapsEmbedView 自身が fallback へ倒れ、フッタは重ねない", async () => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<MapsEmbedModal params={PARAMS} onClose={jest.fn()} />);
		});
		await flush();

		// MapsEmbedView 側の fallback（testID サフィックス "-fallback"）が出ている
		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-view-fallback" }).length).toBeGreaterThan(0);
		expect(
			tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "maps-embed-modal-view")
				.length,
		).toBe(0);
		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-fallback-button" }).length).toBeGreaterThan(0);
		// #1810 PL レビュー 3番: fallback 表示中はフッタの同じボタンを出さない
		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-external-link" }).length).toBe(0);

		const fallbackButton = tree.root
			.findAllByProps({ testID: "maps-embed-modal-fallback-button" })
			.find((node) => typeof node.props.onPress === "function");
		act(() => fallbackButton!.props.onPress());
		expect(mockOpenExternalUrl).toHaveBeenCalledWith(PARAMS.externalUrl);
	});

	it("閉じるボタンを押すと onClose が呼ばれる", () => {
		const onClose = jest.fn();
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<MapsEmbedModal params={PARAMS} onClose={onClose} />);
		});

		const closeButton = tree.root
			.findAllByProps({ testID: "maps-embed-modal-close" })
			.find((node) => typeof node.props.onPress === "function");
		expect(closeButton).toBeDefined();

		act(() => closeButton!.props.onPress());
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
