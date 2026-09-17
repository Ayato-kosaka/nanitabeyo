/*
#1810 PL レビュー 3番【回帰防止】`showMapsEmbedModal` はルート（`/[locale]/maps-embed`）へ
遷移する前に `POST /v1/maps/embed-token` を叩き、
  - 成功 → その URL で `/[locale]/maps-embed` へ router.push する
  - 失敗（`GOOGLE_MAPS_EMBED_API_KEY` 未設定の 503 を含む、どんな理由でも）→
    画面へ一度も遷移せず、従来どおり `externalUrl` を外部ブラウザで開く
ことを固定する。

main（この修正前）はボタン 1 回で外部ブラウザへ直行していた。この修正前の実装は
先に画面を開いてから内部でトークンを取っていたため、キー未設定の間だけ
«画面が開く → 表示できない → もう一度ボタンを押す» という無意味な往復が挟まっていた。
ここを外すと再びその往復が復活する。

#843 でこの hook は Portal ベースの Provider（`contexts/MapsEmbedModalProvider.tsx`）から
router.push だけを行う素の hook へ変わった（#1350 で全廃したオーバーレイ層を作り直さない
ための CI ガード、`assert-legacy-blur-modal-boundary.mjs`）。以前は Provider がモーダルを
自分のツリー内に描画していたので「開かれたか」をレンダー結果で検証できたが、いまは
別画面への `router.push` を呼ぶだけなので、`router.push` の呼び出し自体を観測する。

画面本体（`app/[locale]/maps-embed.tsx` / `features/maps/components/MapsEmbedModal.tsx`）
は別ファイルで検証済み。
*/
import React from "react";
import { act } from "react";
import TestRenderer from "react-test-renderer";

jest.mock("@/constants/Env", () => ({ Env: { BACKEND_BASE_URL: "https://api.example.com" } }));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

const mockOpenExternalUrl = jest.fn(async (_url: string) => {});
jest.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: (url: string) => mockOpenExternalUrl(url) }));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));

import { useMapsEmbedModal, type UseMapsEmbedModalResult } from "./useMapsEmbedModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PARAMS = {
	mode: "place" as const,
	q: "place_id:test-place",
	hl: "ja",
	title: "テスト食堂",
	externalUrl: "https://maps.google.com/?q=test",
	source: "restaurant_detail",
};

/** useMapsEmbedModal() を素通しで取り出すための最小ハーネス */
function renderHook(): UseMapsEmbedModalResult {
	let captured!: UseMapsEmbedModalResult;
	const Harness = () => {
		captured = useMapsEmbedModal();
		return null;
	};
	act(() => {
		TestRenderer.create(React.createElement(Harness));
	});
	return captured;
}

/** 保留中の act() 内マイクロタスクを 1 サイクル流す */
const flush = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});

describe("useMapsEmbedModal#showMapsEmbedModal", () => {
	afterEach(() => {
		mockCallBackend.mockReset();
		mockOpenExternalUrl.mockClear();
		mockLogFrontendEvent.mockClear();
		mockPush.mockClear();
	});

	it("POST /v1/maps/embed-token を正しい payload で呼ぶ", () => {
		mockCallBackend.mockReturnValue(new Promise(() => {}));
		const api = renderHook();

		act(() => {
			api.showMapsEmbedModal(PARAMS);
		});

		expect(mockCallBackend).toHaveBeenCalledWith("v1/maps/embed-token", {
			method: "POST",
			requestPayload: { mode: "place", q: "place_id:test-place", center: undefined, zoom: undefined, hl: "ja" },
		});
	});

	it("トークン取得中は遷移しない（スピナー等の中間状態を挟まず、解決を待つ）", () => {
		mockCallBackend.mockReturnValue(new Promise(() => {}));
		const api = renderHook();

		act(() => {
			api.showMapsEmbedModal(PARAMS);
		});

		expect(mockPush).not.toHaveBeenCalled();
		expect(mockOpenExternalUrl).not.toHaveBeenCalled();
	});

	it("トークン取得に成功したら、その URL で /[locale]/maps-embed へ router.push する。外部ブラウザは開かない", async () => {
		mockCallBackend.mockResolvedValue({ token: "met1.abc.def", expiresAt: "2099-01-01T00:00:00.000Z" });
		const api = renderHook();

		act(() => {
			api.showMapsEmbedModal(PARAMS);
		});
		await flush();

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/maps-embed",
			params: {
				locale: "ja-JP",
				mode: "place",
				title: "テスト食堂",
				externalUrl: "https://maps.google.com/?q=test",
				source: "restaurant_detail",
				embedUrl: "https://api.example.com/v1/maps/embed?token=met1.abc.def",
			},
		});
		expect(mockOpenExternalUrl).not.toHaveBeenCalled();
		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event_name: "maps_embed_modal_shown" }),
		);
	});

	it("トークン取得に失敗したら、画面へ一度も遷移せずに外部ブラウザ（externalUrl）を開く", async () => {
		mockCallBackend.mockRejectedValue(new Error("network error"));
		const api = renderHook();

		act(() => {
			api.showMapsEmbedModal(PARAMS);
		});
		await flush();

		expect(mockPush).not.toHaveBeenCalled();
		expect(mockOpenExternalUrl).toHaveBeenCalledWith(PARAMS.externalUrl);
		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event_name: "maps_embed_token_fetch_failed" }),
		);
		expect(mockLogFrontendEvent).not.toHaveBeenCalledWith(
			expect.objectContaining({ event_name: "maps_embed_modal_shown" }),
		);
	});
});
