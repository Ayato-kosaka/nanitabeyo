/*
#843【回帰】検索結果 0 件のフォールバックは、確認後に外部ブラウザへ直行していたのを
アプリ内地図（`showMapsEmbedModal`, mode=search）へ変えた。
ダイアログの confirm を押したときに、外部 URL を直接開かず、埋め込みモーダルを
正しいパラメータ（mode/q/center/hl/externalUrl）で開くことだけを固定する。
（`openExternalUrl` を直接呼ばなくなったこと自体も、mock の呼び出し回数 0 件で確認する）
*/
import { readFileSync } from "fs";
import { resolve } from "path";
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

import { googleMapsFallbackReasonFor, useGoogleMapsFallback } from "./useGoogleMapsFallback";

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
			reason: "empty",
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
			reason: "empty",
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
	/*
	#843【回帰】**«0 件だった» と «取れなかった» を 1 つのイベントに混ぜない。**

	このダイアログは `ids.length === 0` で出るので、Places の日次上限（429）で
	取得が失敗したときも «条件に合う店が無い» と同じ見た目・同じログになっていた。
	本番 30 日の実測で 5,627 件のうち 3,021 件（53.7%）が «直前に bulk-import で 429» で、
	09-11 以降は日ごとに **ほぼ 100%** がそれだった（09-26 は 87/87）。
	#843 の coverage をこのイベントで測っている限り、混ざっていると進捗が読めない。

	⚠️ 値ではなく «形» を固定する: 3 つのイベントすべてが原因を持つこと、
	そして dismissed の `reason`（閉じ方）を原因で上書きしないこと。
	*/
	it.each([["empty"], ["fetch_failed"]] as const)(
		"shown / opened の両方に fallbackReason=%s を載せる",
		(reason) => {
			const { showGoogleMapsFallbackDialog } = renderHook(() =>
				useGoogleMapsFallback({ source: "search_result_screen" }),
			);

			showGoogleMapsFallbackDialog({
				reason,
				entriesKey: "key1",
				category: "ラーメン",
				location: { latitude: 35.6, longitude: 139.7 },
				locale: "ja-JP",
			});

			expect(mockLogFrontendEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					event_name: "google_maps_fallback_dialog_shown",
					payload: expect.objectContaining({ fallbackReason: reason }),
				}),
			);

			act(() => {
				mockShowDialog.mock.calls[0][1].onConfirm();
			});

			expect(mockLogFrontendEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					event_name: "google_maps_fallback_opened",
					payload: expect.objectContaining({ fallbackReason: reason }),
				}),
			);
		},
	);

	it("dismissed は原因と «閉じ方» を別の名前で持つ（既存の reason の意味を変えない）", () => {
		const { showGoogleMapsFallbackDialog } = renderHook(() =>
			useGoogleMapsFallback({ source: "search_result_screen" }),
		);

		showGoogleMapsFallbackDialog({
			reason: "fetch_failed",
			category: "寿司",
			location: { latitude: 35.0, longitude: 135.0 },
			locale: "ja-JP",
		});

		act(() => {
			mockShowDialog.mock.calls[0][1].onHide("backdrop");
		});

		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				event_name: "google_maps_fallback_dismissed",
				payload: expect.objectContaining({
					fallbackReason: "fetch_failed",
					// ⚠️ 以前からある `reason` は «閉じ方»。原因で上書きしていないこと
					reason: "backdrop",
				}),
			}),
		);
	});

	/*
	#843【回帰】**`search/result` が «取れなかった» を «無かった» に潰さない。**

	真因はこの 1 行だった: `result.tsx` は selector から `{ ids, isLoading }` だけを取り出し、
	selector が最初から返していた `error` を捨てていた。そのため Places の日次上限（429）で
	取得が落ちても `ids.length === 0` だけを見て «条件に合う店が無い» の退避導線を出していた。

	⚠️ **判定を 2 箇所に書かない。** 画面側で `error ? … : …` を手書きすると、
	いずれ片方だけ直る。判定は `googleMapsFallbackReasonFor` 1 箇所で、画面はそれを呼ぶ。
	*/
	describe("googleMapsFallbackReasonFor", () => {
		it.each([
			[null, "empty"],
			[undefined, "empty"],
			["データの読み込みに失敗しました: 429", "fetch_failed"],
		] as const)("error=%p なら %s", (error, expected) => {
			expect(googleMapsFallbackReasonFor(error)).toBe(expected);
		});

		it("空文字は «エラー無し» として扱う（i18n が空を返しても fetch_failed を名乗らない）", () => {
			expect(googleMapsFallbackReasonFor("")).toBe("empty");
		});

		it("search/result は error を selector から読み、判定を手書きしない", () => {
			const source = readFileSync(
				resolve(__dirname, "../../../app/[locale]/(tabs)/search/result.tsx"),
				"utf8",
			);
			// selector の error を捨てて `{ ids, isLoading }` だけに戻されたら赤くする
			expect(source).toContain("const { ids, isLoading, error } = useDishMediaEntriesStore(");
			expect(source).toContain("reason: googleMapsFallbackReasonFor(error)");
			// 画面側で理由をベタ書きしていないこと
			expect(source).not.toMatch(/reason:\s*"(empty|fetch_failed)"/);
		});
	});
});
