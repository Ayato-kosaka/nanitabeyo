/*
#1810 PL レビュー 3番【回帰防止】«Google マップ検索結果 0 件» のフォールバックで確認したときの
挙動を、`MapsEmbedModalProvider` を実物のまま固定する。

`useGoogleMapsFallback.test.ts` は `useMapsEmbedModal` をモックしており、
「正しい params で `showMapsEmbedModal` を呼んだか」までしか検証できない
（トークン取得の成否で実際にモーダルが開くかどうかは検証対象の外）。
このファイルは Provider を実物のまま組み立て、トークン取得（`POST /v1/maps/embed-token`）
の成否によって実際に

  - 失敗 → モーダルを一度も開かず `openExternalUrl` で外部ブラウザへ直行する（main と同じ体験）
  - 成功 → モーダル（本物の `MapsEmbedModal`）が開く。`openExternalUrl` は呼ばない

ことだけが変わることを固定する。
*/
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useSheetBottomPadding", () => ({ useSheetBottomPadding: () => 0 }));
jest.mock("lucide-react-native", () => ({ X: () => null }));
jest.mock("@/contexts/ThemeProvider", () => ({
	useAppTheme: () => ({ colors: new Proxy({}, { get: () => "#000000" }) }),
	useThemedStyles: (factory: (c: Record<string, string>) => unknown) =>
		factory(new Proxy({}, { get: () => "#000000" }) as Record<string, string>),
}));
jest.mock("@/constants/Env", () => ({ Env: { BACKEND_BASE_URL: "https://api.example.com" } }));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

const mockOpenExternalUrl = jest.fn(async (_url: string) => {});
jest.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: (url: string) => mockOpenExternalUrl(url) }));

const mockShowDialog = jest.fn();
jest.mock("@/contexts/DialogProvider", () => ({ useDialog: () => ({ showDialog: mockShowDialog }) }));

// Portal.Host 前提の Portal を素通りへ差し替える（contexts/DialogProvider.test.tsx と同じ方針）
jest.mock("react-native-paper", () => {
	const ReactModule = require("react");
	const { View: RNView } = require("react-native");
	return {
		__esModule: true,
		Portal: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(RNView, null, children),
	};
});

import { MapsEmbedModalProvider } from "@/contexts/MapsEmbedModalProvider";
import { useGoogleMapsFallback } from "./useGoogleMapsFallback";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ShowDialogOptions = { onConfirm: () => void };

function renderHookWithRealProvider(): {
	hook: ReturnType<typeof useGoogleMapsFallback>;
	tree: TestRenderer.ReactTestRenderer;
} {
	let captured!: ReturnType<typeof useGoogleMapsFallback>;
	const Harness = () => {
		captured = useGoogleMapsFallback({ source: "search_result_screen" });
		return null;
	};
	let tree!: TestRenderer.ReactTestRenderer;
	act(() => {
		tree = TestRenderer.create(
			React.createElement(MapsEmbedModalProvider, null, React.createElement(Harness)),
		);
	});
	return { hook: captured, tree };
}

/** 保留中の act() 内マイクロタスクを流す */
const flush = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});

describe("#1810 useGoogleMapsFallback: トークン取得の成否でモーダル/外部ブラウザを出し分ける（実 Provider）", () => {
	afterEach(() => {
		mockCallBackend.mockReset();
		mockOpenExternalUrl.mockClear();
		mockShowDialog.mockClear();
		mockLogFrontendEvent.mockClear();
	});

	it("トークン取得に失敗したら、モーダルを開かず外部ブラウザへ直行する（main と同じ体験）", async () => {
		mockCallBackend.mockRejectedValue(new Error("network error"));
		const { hook, tree } = renderHookWithRealProvider();

		act(() => {
			hook.showGoogleMapsFallbackDialog({
				category: "ラーメン",
				location: { latitude: 35.6, longitude: 139.7 },
				locale: "ja-JP",
			});
		});
		const options = mockShowDialog.mock.calls[0][1] as ShowDialogOptions;
		act(() => {
			options.onConfirm();
		});
		await flush();

		expect(tree.root.findAllByProps({ testID: "maps-embed-modal" }).length).toBe(0);
		expect(mockOpenExternalUrl).toHaveBeenCalledTimes(1);
		expect(mockOpenExternalUrl.mock.calls[0][0]).toContain("https://www.google.com/maps/search/");
	});

	it("トークン取得に成功したら、モーダル（本物）が開く。外部ブラウザへは行かない", async () => {
		mockCallBackend.mockResolvedValue({ token: "evidence-stub-token", expiresAt: "2099-01-01T00:00:00.000Z" });
		const { hook, tree } = renderHookWithRealProvider();

		act(() => {
			hook.showGoogleMapsFallbackDialog({
				category: "ラーメン",
				location: { latitude: 35.6, longitude: 139.7 },
				locale: "ja-JP",
			});
		});
		const options = mockShowDialog.mock.calls[0][1] as ShowDialogOptions;
		act(() => {
			options.onConfirm();
		});
		await flush();

		expect(tree.root.findAllByProps({ testID: "maps-embed-modal" }).length).toBeGreaterThan(0);
		expect(mockOpenExternalUrl).not.toHaveBeenCalled();
	});
});
