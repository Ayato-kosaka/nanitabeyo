/*
#843【回帰】検索結果 0 件のフォールバックは、確認後に外部ブラウザへ直行していたのを
アプリ内地図（`showMapsEmbedModal`, mode=search）へ変えた。
ダイアログの confirm を押したときに、外部 URL を直接開かず、埋め込みモーダルを
正しいパラメータ（mode/q/center/hl/externalUrl）で開くことだけを固定する。
（`openExternalUrl` を直接呼ばなくなったこと自体も、mock の呼び出し回数 0 件で確認する）
*/
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockShowDialog = jest.fn();
jest.mock("@/contexts/DialogProvider", () => ({ useDialog: () => ({ showDialog: mockShowDialog }) }));

const mockShowMapsEmbedModal = jest.fn();
jest.mock("@/features/maps/hooks/useMapsEmbedModal", () => ({
	useMapsEmbedModal: () => ({ showMapsEmbedModal: mockShowMapsEmbedModal }),
}));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

const mockOpenExternalUrl = jest.fn(async (_url: string) => {});
jest.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: (url: string) => mockOpenExternalUrl(url) }));

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

import { useGoogleMapsFallback } from "./useGoogleMapsFallback";

function renderHook<T>(hook: () => T): T {
	let captured!: T;
	const Harness = () => {
		captured = hook();
		return null;
	};
	act(() => {
		TestRenderer.create(React.createElement(Harness));
	});
	return captured;
}

describe("useGoogleMapsFallback", () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	it("confirm を押すと、外部ブラウザではなくアプリ内地図モーダル（mode=search）を開く", () => {
		const { showGoogleMapsFallbackDialog } = renderHook(() => useGoogleMapsFallback({ source: "search_result_screen" }));

		showGoogleMapsFallbackDialog({
			entriesKey: "key1",
			category: "ラーメン",
			location: { latitude: 35.6, longitude: 139.7 },
			locale: "ja-JP",
		});

		expect(mockShowDialog).toHaveBeenCalledTimes(1);
		const options = mockShowDialog.mock.calls[0][1];

		act(() => {
			options.onConfirm();
		});

		expect(mockOpenExternalUrl).not.toHaveBeenCalled();
		expect(mockShowMapsEmbedModal).toHaveBeenCalledWith({
			mode: "search",
			q: "ラーメン",
			center: { latitude: 35.6, longitude: 139.7 },
			hl: "ja",
			title: "ラーメン",
			externalUrl: expect.stringContaining("https://www.google.com/maps/search/"),
			source: "search_result_screen",
		});
	});

	it("ダイアログを confirm 以外で閉じたときは dismiss をログするだけで、モーダルは開かない", () => {
		const { showGoogleMapsFallbackDialog } = renderHook(() => useGoogleMapsFallback({ source: "search_result_screen" }));

		showGoogleMapsFallbackDialog({
			category: "寿司",
			location: { latitude: 35.0, longitude: 135.0 },
			locale: "en-US",
		});

		const options = mockShowDialog.mock.calls[0][1];
		act(() => {
			options.onHide("cancel");
		});

		expect(mockShowMapsEmbedModal).not.toHaveBeenCalled();
		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event_name: "google_maps_fallback_dismissed" }),
		);
	});
});
