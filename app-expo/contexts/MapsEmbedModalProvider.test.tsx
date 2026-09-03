/*
#1810 PL レビュー 3番【回帰防止】`showMapsEmbedModal` はモーダルを開く前に
`POST /v1/maps/embed-token` を叩き、
  - 成功 → その URL でモーダルを開く
  - 失敗（`GOOGLE_MAPS_EMBED_API_KEY` 未設定の 503 を含む、どんな理由でも）→
    モーダルを一度も開かず、従来どおり `externalUrl` を外部ブラウザで開く
ことを固定する。

main（この修正前）はボタン 1 回で外部ブラウザへ直行していた。この修正前の実装は
先にモーダルを開いてから内部でトークンを取っていたため、キー未設定の間だけ
«モーダルが開く → 表示できない → もう一度ボタンを押す» という無意味な往復が
挟まっていた。ここを外すと再びその往復が復活する。

`MapsEmbedModal`（表示コンポーネント）自体は別ファイル（./features/maps/components/MapsEmbedModal.test.tsx）
で検証済みなので、ここではスタブに差し替えて「開かれたかどうか・どの embedUrl で
開かれたか」だけを観測する。
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

// react-native-paper の Portal は Portal.Host 前提。ここで検証したいのは
// MapsEmbedModalProvider 自身のロジックなので、素通りの入れ物へ差し替える
// （contexts/DialogProvider.test.tsx と同じ方針）。
jest.mock("react-native-paper", () => {
	const ReactModule = require("react");
	const { View: RNView } = require("react-native");
	return {
		__esModule: true,
		Portal: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(RNView, null, children),
	};
});

// MapsEmbedModal 本体の描画は別ファイルで検証済み。ここでは「開かれたか / どの
// embedUrl を渡されたか」だけを観測したいので、最小のスタブへ差し替える
jest.mock("@/features/maps/components/MapsEmbedModal", () => {
	const ReactModule = require("react");
	return {
		MapsEmbedModal: ({ params }: { params: { embedUrl: string } | null }) =>
			params
				? ReactModule.createElement("MapsEmbedModalStub", { testID: "maps-embed-modal-stub", embedUrl: params.embedUrl })
				: null,
	};
});

import { MapsEmbedModalProvider, useMapsEmbedModal, type MapsEmbedModalContextType } from "./MapsEmbedModalProvider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PARAMS = {
	mode: "place" as const,
	q: "place_id:test-place",
	hl: "ja",
	title: "テスト食堂",
	externalUrl: "https://maps.google.com/?q=test",
	source: "restaurant_detail",
};

/** useMapsEmbedModal() を素通しで取り出すための最小ハーネス。tree も返し、スタブの描画を検証できるようにする */
function renderProvider(): { api: MapsEmbedModalContextType; tree: TestRenderer.ReactTestRenderer } {
	let captured!: MapsEmbedModalContextType;
	const Harness = () => {
		captured = useMapsEmbedModal();
		return null;
	};
	let tree!: TestRenderer.ReactTestRenderer;
	act(() => {
		tree = TestRenderer.create(React.createElement(MapsEmbedModalProvider, null, React.createElement(Harness)));
	});
	return { api: captured, tree };
}

/** 保留中の act() 内マイクロタスクを 1 サイクル流す */
const flush = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});

describe("MapsEmbedModalProvider#showMapsEmbedModal", () => {
	afterEach(() => {
		mockCallBackend.mockReset();
		mockOpenExternalUrl.mockClear();
		mockLogFrontendEvent.mockClear();
	});

	it("POST /v1/maps/embed-token を正しい payload で呼ぶ", () => {
		mockCallBackend.mockReturnValue(new Promise(() => {}));
		const { api } = renderProvider();

		act(() => {
			api.showMapsEmbedModal(PARAMS);
		});

		expect(mockCallBackend).toHaveBeenCalledWith("v1/maps/embed-token", {
			method: "POST",
			requestPayload: { mode: "place", q: "place_id:test-place", center: undefined, zoom: undefined, hl: "ja" },
		});
	});

	it("トークン取得中はモーダルを開かない（スピナー等の中間状態を挟まず、解決を待つ）", () => {
		mockCallBackend.mockReturnValue(new Promise(() => {}));
		const { api, tree } = renderProvider();

		act(() => {
			api.showMapsEmbedModal(PARAMS);
		});

		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-stub" }).length).toBe(0);
		expect(mockOpenExternalUrl).not.toHaveBeenCalled();
	});

	it("トークン取得に成功したら、その URL でモーダルを開く。外部ブラウザは開かない", async () => {
		mockCallBackend.mockResolvedValue({ token: "met1.abc.def", expiresAt: "2099-01-01T00:00:00.000Z" });
		const { api, tree } = renderProvider();

		act(() => {
			api.showMapsEmbedModal(PARAMS);
		});
		await flush();

		const stub = tree.root.findAllByProps({ testID: "maps-embed-modal-stub" });
		expect(stub.length).toBeGreaterThan(0);
		expect(stub[0].props.embedUrl).toBe("https://api.example.com/v1/maps/embed?token=met1.abc.def");
		expect(mockOpenExternalUrl).not.toHaveBeenCalled();
		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event_name: "maps_embed_modal_shown" }),
		);
	});

	it("トークン取得に失敗したら、モーダルを一度も開かずに外部ブラウザ（externalUrl）を開く", async () => {
		mockCallBackend.mockRejectedValue(new Error("network error"));
		const { api, tree } = renderProvider();

		act(() => {
			api.showMapsEmbedModal(PARAMS);
		});
		await flush();

		expect(tree.root.findAllByProps({ testID: "maps-embed-modal-stub" }).length).toBe(0);
		expect(mockOpenExternalUrl).toHaveBeenCalledWith(PARAMS.externalUrl);
		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event_name: "maps_embed_token_fetch_failed" }),
		);
		expect(mockLogFrontendEvent).not.toHaveBeenCalledWith(
			expect.objectContaining({ event_name: "maps_embed_modal_shown" }),
		);
	});
});
