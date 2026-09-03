/*
#1810 PL レビュー 3番【回帰防止】«Google マップ検索結果 0 件» のフォールバックで確認したときの
挙動を、`useMapsEmbedModal`（features/maps/hooks/useMapsEmbedModal.ts）を実物のまま固定する。

`useGoogleMapsFallback.test.ts` は `useMapsEmbedModal` をモックしており、
「正しい params で `showMapsEmbedModal` を呼んだか」までしか検証できない
（トークン取得の成否で実際に遷移するかどうかは検証対象の外）。
このファイルは hook を実物のまま組み立て、トークン取得（`POST /v1/maps/embed-token`）
の成否によって実際に

  - 失敗 → `/[locale]/maps-embed` へ一度も遷移せず `openExternalUrl` で外部ブラウザへ直行する
    （main と同じ体験）
  - 成功 → `/[locale]/maps-embed` へ解決済みの embedUrl で router.push する。
    `openExternalUrl` は呼ばない

ことだけが変わることを固定する。

#843 で `MapsEmbedModal` は Portal ベースの全画面オーバーレイから expo-router のルート
（`app/[locale]/maps-embed.tsx`）へ変わったため、以前のように «同じ描画ツリーにモーダルが
現れるか» では検証できない。ここでは `router.push` の呼び出しそのものを観測する。
*/
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useSheetBottomPadding", () => ({ useSheetBottomPadding: () => 0 }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
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

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

import { useGoogleMapsFallback } from "./useGoogleMapsFallback";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ShowDialogOptions = { onConfirm: () => void };

function renderHook(): ReturnType<typeof useGoogleMapsFallback> {
	let captured!: ReturnType<typeof useGoogleMapsFallback>;
	const Harness = () => {
		captured = useGoogleMapsFallback({ source: "search_result_screen" });
		return null;
	};
	act(() => {
		TestRenderer.create(React.createElement(Harness));
	});
	return captured;
}

/** 保留中の act() 内マイクロタスクを流す */
const flush = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});

describe("#1810 useGoogleMapsFallback: トークン取得の成否でルート遷移/外部ブラウザを出し分ける（実 hook）", () => {
	afterEach(() => {
		mockCallBackend.mockReset();
		mockOpenExternalUrl.mockClear();
		mockShowDialog.mockClear();
		mockLogFrontendEvent.mockClear();
		mockPush.mockClear();
	});

	it("トークン取得に失敗したら、/[locale]/maps-embed へ遷移せず外部ブラウザへ直行する（main と同じ体験）", async () => {
		mockCallBackend.mockRejectedValue(new Error("network error"));
		const hook = renderHook();

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

		expect(mockPush).not.toHaveBeenCalled();
		expect(mockOpenExternalUrl).toHaveBeenCalledTimes(1);
		expect(mockOpenExternalUrl.mock.calls[0][0]).toContain("https://www.google.com/maps/search/");
	});

	it("トークン取得に成功したら、/[locale]/maps-embed へ解決済みの embedUrl で router.push する。外部ブラウザへは行かない", async () => {
		mockCallBackend.mockResolvedValue({ token: "evidence-stub-token", expiresAt: "2099-01-01T00:00:00.000Z" });
		const hook = renderHook();

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

		expect(mockPush).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: "/[locale]/maps-embed",
				params: expect.objectContaining({
					locale: "ja-JP",
					mode: "search",
					embedUrl: "https://api.example.com/v1/maps/embed?token=evidence-stub-token",
				}),
			}),
		);
		expect(mockOpenExternalUrl).not.toHaveBeenCalled();
	});
});
