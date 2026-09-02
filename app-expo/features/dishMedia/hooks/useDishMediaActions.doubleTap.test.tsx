// #1205 二重送信ガードの横展開（A10）
//
// `shareRestaurant` は `createShareLink`（POST /v1/share-links）を呼ぶ。連打すると
// **同じ投稿に対する share_links の行が 2 本できる**。このフックには表示用の state すら無く、
// 呼び出し側のボタンにも disabled が無いため、ここで弾かないと止まる場所がどこにもない。
//
// ⚠️ 単一の boolean ではなく **dishMediaId ごとの Set** で持っている。投稿一覧では
// 別々の投稿の共有ボタンが同時に存在するので、boolean だと「A を共有中は B も押せない」になる。
// そのため「別 id は巻き添えに弾かれない」ケースを必ず含めること。

import { act } from "react";
import TestRenderer from "react-test-renderer";

const mockCallBackend = jest.fn();
const mockHandleShare = jest.fn();

jest.mock("@/hooks/useAPICall", () => ({
	useAPICall: () => ({ callBackend: mockCallBackend }),
}));
jest.mock("@/hooks/useLogger", () => ({
	useLogger: () => ({ logFrontendEvent: jest.fn() }),
}));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn() }),
}));
jest.mock("@/contexts/SnackbarProvider", () => ({
	useSnackbar: () => ({ showSnackbar: jest.fn() }),
}));
jest.mock("@/hooks/useLocale", () => ({
	useLocale: () => "ja-JP",
}));
jest.mock("@/lib/share", () => ({
	handleShare: (...args: unknown[]) => mockHandleShare(...args),
	generateShareUrl: (path: string) => `https://example.invalid${path}`,
}));

import { useDishMediaActions } from "./useDishMediaActions";

// React 19 では初期描画がスケジューラのタスクへ回されるため act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** フックを 1 回だけ描画して参照を取り出す（react-test-renderer 版の renderHook 相当） */
function renderHook() {
	let hookRef!: ReturnType<typeof useDishMediaActions>;
	const Probe = () => {
		hookRef = useDishMediaActions({ source: "test" as never });
		return null;
	};
	let renderer!: TestRenderer.ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(<Probe />);
	});
	return { get current() { return hookRef; }, unmount: () => renderer.unmount() };
}

const RESTAURANT = { id: "restaurant-1", name: "テスト店" };

/** `createShareLink` が解決するまで待たせるための門 */
function createGate() {
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { wait, release };
}

describe("#1205 shareRestaurant の二重実行ガード", () => {
	beforeEach(() => {
		mockCallBackend.mockReset();
		mockHandleShare.mockReset();
		mockHandleShare.mockResolvedValue(undefined);
	});

	it("await 前に 2 回呼んでも共有リンクの作成は 1 回しか走らない", async () => {
		const gate = createGate();
		mockCallBackend.mockImplementation(async () => {
			await gate.wait;
			return { token: "s1_abcdefghijklmnopqrstuv", url: "https://example.invalid/s/x", locale: "ja-JP" };
		});

		const result = renderHook();

		await act(async () => {
			// await せずに 2 回続けて呼ぶ = 同一 JS タスク内の連打
			const first = result.current.shareRestaurant({ dishMediaId: "media-1", restaurant: RESTAURANT });
			const second = result.current.shareRestaurant({ dishMediaId: "media-1", restaurant: RESTAURANT });
			gate.release();
			await Promise.all([first, second]);
		});

		// ⚠️ ここが本題。ガードを外すと 2 になる
		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(mockHandleShare).toHaveBeenCalledTimes(1);
	});

	it("別の投稿の共有は巻き添えに弾かれない", async () => {
		const gate = createGate();
		mockCallBackend.mockImplementation(async () => {
			await gate.wait;
			return { token: "s1_abcdefghijklmnopqrstuv", url: "https://example.invalid/s/x", locale: "ja-JP" };
		});

		const result = renderHook();

		await act(async () => {
			const a = result.current.shareRestaurant({ dishMediaId: "media-1", restaurant: RESTAURANT });
			const b = result.current.shareRestaurant({ dishMediaId: "media-2", restaurant: RESTAURANT });
			gate.release();
			await Promise.all([a, b]);
		});

		// 単一 boolean のガードにすると、ここが 1 になって別投稿まで潰れる
		expect(mockHandleShare).toHaveBeenCalledTimes(2);
	});

	it("失敗しても解除され、再試行できる", async () => {
		mockCallBackend.mockRejectedValueOnce(new Error("boom"));

		const result = renderHook();

		// 1 回目: createShareLink が失敗しても、共有そのものは既存形式の URL で継続する
		await act(async () => {
			await result.current.shareRestaurant({ dishMediaId: "media-1", restaurant: RESTAURANT });
		});

		mockCallBackend.mockResolvedValueOnce({
			token: "s1_abcdefghijklmnopqrstuv",
			url: "https://example.invalid/s/x",
			locale: "ja-JP",
		});

		// 2 回目: 「1 回失敗したら二度と押せない」になっていないこと
		await act(async () => {
			await result.current.shareRestaurant({ dishMediaId: "media-1", restaurant: RESTAURANT });
		});

		expect(mockHandleShare).toHaveBeenCalledTimes(2);
	});
});
