/*
#843 / #1810 MapsEmbedModal の表示ロジック検証。
- params が null なら何も描かない
- トークン取得中はスピナーだけを出す（埋め込みも fallback もまだ出さない）
- トークン取得に失敗したら、埋め込みを試さず fallback（外部リンクの導線）へ倒す
- トークン取得に成功しても、WebView が居ないテスト環境では MapsEmbedView 自身が
  fallback へ倒れる（従来どおり）
- fallback が出ているときは、フッタの外部リンクを重ねて出さない（#1810 PL レビュー 3番）
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

// jest.mock のファクトリから参照できるのは `mock` 始まりの変数だけ
const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

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

/** pending な Promise を作る（トークン取得がまだ終わっていない状態を作るため） */
const pendingForever = () => new Promise(() => {});

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
		mockCallBackend.mockReset();
	});

	it("params が null なら何も描かない", () => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<MapsEmbedModal params={null} onClose={jest.fn()} />);
		});
		expect(tree.toJSON()).toBeNull();
	});

	it("トークン取得中はスピナーのみ（fallback ブロックはまだ出さない。フッタの外部リンクは残す）", () => {
		mockCallBackend.mockReturnValue(pendingForever());

		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<MapsEmbedModal params={PARAMS} onClose={jest.fn()} />);
		});

		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-loading" }).length).toBeGreaterThan(0);
		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-fallback-button" }).length).toBe(0);
		// fallback ブロック（と同じボタン）が出ていないので、フッタの外部リンクは重複にならない
		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-external-link" }).length).toBeGreaterThan(0);
	});

	it("POST /v1/maps/embed-token を正しい payload で呼ぶ", () => {
		mockCallBackend.mockReturnValue(pendingForever());

		act(() => {
			create(<MapsEmbedModal params={PARAMS} onClose={jest.fn()} />);
		});

		expect(mockCallBackend).toHaveBeenCalledWith("v1/maps/embed-token", {
			method: "POST",
			requestPayload: { mode: "search", q: "ラーメン", center: "35.6,139.7", zoom: undefined, hl: "ja" },
		});
	});

	it("トークン取得に失敗したら、埋め込みを試さず fallback へ倒す（フッタの外部リンクは重ねない）", async () => {
		mockCallBackend.mockRejectedValue(new Error("network error"));

		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<MapsEmbedModal params={PARAMS} onClose={jest.fn()} />);
		});
		await flush();

		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-loading" }).length).toBe(0);
		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-view" }).length).toBe(0);
		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-fallback-button" }).length).toBeGreaterThan(0);
		// #1810 PL レビュー 3番: fallback 表示中はフッタの同じボタンを出さない
		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-external-link" }).length).toBe(0);

		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event_name: "maps_embed_token_fetch_failed" }),
		);

		const fallbackButton = tree.root
			.findAllByProps({ testID: "maps-embed-modal-fallback-button" })
			.find((node) => typeof node.props.onPress === "function");
		act(() => fallbackButton!.props.onPress());
		expect(mockOpenExternalUrl).toHaveBeenCalledWith(PARAMS.externalUrl);
	});

	it("トークン取得に成功しても、WebView 不在ビルド（テスト環境）では MapsEmbedView 自身が fallback へ倒れ、フッタは重ねない", async () => {
		mockCallBackend.mockResolvedValue({ token: "met1.abc.def", expiresAt: "2099-01-01T00:00:00.000Z" });

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
		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-external-link" }).length).toBe(0);
	});

	it("閉じるボタンを押すと onClose が呼ばれる", () => {
		mockCallBackend.mockReturnValue(pendingForever());
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
