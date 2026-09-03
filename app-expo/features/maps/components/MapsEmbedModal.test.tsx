/*
#843 MapsEmbedModal の表示ロジック検証。
- params が null なら何も描かない
- WebView が居ないビルド（テスト環境の既定）では MapsEmbedView が fallback を出す
  （「Google マップで開く」の従来経路は消えず、そこから外部へ出られる）
- 埋め込みが動いていても、常に外部リンクを残す（退避として消さない要件）
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

import { MapsEmbedModal, type MapsEmbedModalParams } from "./MapsEmbedModal";

const PARAMS: MapsEmbedModalParams = {
	mode: "search",
	q: "ラーメン",
	center: { latitude: 35.6, longitude: 139.7 },
	hl: "ja",
	title: "ラーメン",
	externalUrl: "https://www.google.com/maps/search/ramen/@35.6,139.7,14z",
	source: "search_result_screen",
};

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

	it("WebView 不在ビルドでは地図の代わりに fallback（外部リンクの導線）を出す", () => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<MapsEmbedModal params={PARAMS} onClose={jest.fn()} />);
		});

		// host（実 View）に "maps-embed-modal-view" が付いていないこと（WebView 本体を描いていない）
		expect(
			tree.root.findAll(
				(node) => typeof node.type === "string" && node.props.testID === "maps-embed-modal-view",
			).length,
		).toBe(0);
		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-view-fallback" }).length).toBeGreaterThan(0);

		const fallbackButton = tree.root
			.findAllByProps({ testID: "maps-embed-modal-fallback-button" })
			.find((node) => typeof node.props.onPress === "function");
		expect(fallbackButton).toBeDefined();

		act(() => fallbackButton!.props.onPress());
		expect(mockOpenExternalUrl).toHaveBeenCalledWith(PARAMS.externalUrl);
	});

	it("常に外部リンク（退避）を出す。押すと externalUrl を開く", () => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<MapsEmbedModal params={PARAMS} onClose={jest.fn()} />);
		});

		const externalLink = tree.root
			.findAllByProps({ testID: "maps-embed-modal-external-link" })
			.find((node) => typeof node.props.onPress === "function");
		expect(externalLink).toBeDefined();

		act(() => externalLink!.props.onPress());
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
