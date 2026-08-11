// #1205 【設計】フィードバック送信が二重に走らないことを守るテスト。
//
// 背景（Issue #1205 の監査 A3）:
// `v1/feedback/issue` の POST が 2 回走ると **GitHub Issue が 2 件立つ**。
// サーバ側（`api/src/v1/feedback/feedback.service.ts` の `createIssue`）に重複排除は無く、
// 外部サービスへ出てしまうため取り消しも効かない（運用側の手作業になる）。
//
// 送信ボタンは `disabled={!canSubmit}`（`canSubmit` は `!isSubmitting` を含む）で操作不可にはなるが、
// `isSubmitting` は useState なので、React が再レンダリングをコミットする前の 2 発目は素通りする。
// 判定は同期 ref（`isSubmittingRef`）で行う必要がある。
//
// このテストは以下を赤で守る。
//   1. await 前に 2 回押しても `callBackend` は 1 回しか呼ばれない
//   2. 送信に失敗しても解除され、送り直せる（「1 回失敗したら二度と送れない」にしない）
//
// PrimaryButton は**本物を使う**こと。`loading` が disabled を兼ねる契約ごと通したいため。
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

// ---- 観測対象（callBackend の呼ばれ方）以外はすべてスタブ化する ----
// 翻訳の中身ではなくキーを見たいので、t はキーをそのまま返す
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
// LinearGradient は native view なので、素の View へ落として PrimaryButton を描画できるようにする
jest.mock("expo-linear-gradient", () => {
	const { View: RNView } = require("react-native");
	return { LinearGradient: RNView };
});
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { deviceName: "テスト端末", platform: {} } }));
jest.mock("@/hooks/useHaptics", () => {
	const lightImpact = jest.fn();
	const mediumImpact = jest.fn();
	return { useHaptics: () => ({ lightImpact, mediumImpact }) };
});
jest.mock("@/hooks/useLogger", () => {
	const logFrontendEvent = jest.fn();
	return { useLogger: () => ({ logFrontendEvent }) };
});
// jest.mock のファクトリから参照できるのは `mock` 始まりの変数だけ
const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

import { FeedbackForm } from "./FeedbackForm";

// React 19 では初期描画がスケジューラのタスクへ回されるため、act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};

/** 解決／棄却をテスト側から制御できる保留プロミスを作る */
const defer = () => {
	let resolve!: (value: unknown) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<unknown>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	// 未処理の rejection 警告を避けるため、呼び出し側とは別に握り潰しておく
	promise.catch(() => {});
	return { promise, resolve, reject };
};

describe("FeedbackForm の二重送信ガード（#1205）", () => {
	let tree: TestRenderer.ReactTestRenderer;
	let onSubmit: jest.Mock;

	/** バリデーションを満たした（＝送信ボタンが押せる）状態でマウントする */
	const mountReadyToSubmit = async () => {
		onSubmit = jest.fn();
		await act(async () => {
			tree = TestRenderer.create(
				<FeedbackForm
					initialTitle="テストのタイトル"
					initialMessage="これはテスト用の本文です。十分な長さがあります。"
					onSubmit={onSubmit}
					onCancel={noop}
				/>,
			);
		});
	};

	afterEach(() => {
		act(() => tree?.unmount());
	});

	/**
	 * 送信ボタン（PrimaryButton 内部の Pressable）の押下ハンドラ。
	 * `isDisabled` ガードごと通したいので handleSubmit を直接呼ばない。
	 */
	const submitHandler = (): ((...args: unknown[]) => void) => {
		const pressable = tree.root
			.findAll(
				(node) =>
					node.props?.accessibilityRole === "button" &&
					node.props?.android_ripple !== undefined &&
					typeof node.props?.onPress === "function",
			)
			.pop();
		if (!pressable) throw new Error("送信ボタンが見つかりません");
		return pressable.props.onPress;
	};

	it("await 前に 2 回押しても callBackend は 1 回しか呼ばれない", async () => {
		await mountReadyToSubmit();
		const pending = defer();
		mockCallBackend.mockReturnValueOnce(pending.promise);

		// 同一フレームの連打。isSubmitting の再レンダリングはまだコミットされていないため、
		// state ベースの disabled では 2 発目を止められない
		const press = submitHandler();
		act(() => {
			press();
			press();
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(mockCallBackend).toHaveBeenCalledWith("v1/feedback/issue", expect.objectContaining({ method: "POST" }));

		await act(async () => {
			pending.resolve({ issueNumber: 1, issueUrl: "https://example.test/1" });
		});
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it("送信に失敗しても解除され、送り直せる", async () => {
		await mountReadyToSubmit();
		const failing = defer();
		mockCallBackend.mockReturnValueOnce(failing.promise);

		act(() => {
			submitHandler()();
		});
		await act(async () => {
			failing.reject(new Error("network down"));
		});

		// 解除は finally の 1 箇所。ここが漏れると「1 回失敗したら二度と送れない」になる
		const retry = defer();
		mockCallBackend.mockReturnValueOnce(retry.promise);
		act(() => {
			submitHandler()();
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(2);

		await act(async () => {
			retry.resolve({ issueNumber: 2, issueUrl: "https://example.test/2" });
		});
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it("送信成功後も解除される（続けてもう 1 件送れる）", async () => {
		await mountReadyToSubmit();
		const first = defer();
		mockCallBackend.mockReturnValueOnce(first.promise);

		act(() => {
			submitHandler()();
		});
		await act(async () => {
			first.resolve({ issueNumber: 1, issueUrl: "https://example.test/1" });
		});

		const second = defer();
		mockCallBackend.mockReturnValueOnce(second.promise);
		act(() => {
			submitHandler()();
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(2);

		await act(async () => {
			second.resolve({ issueNumber: 2, issueUrl: "https://example.test/2" });
		});
	});
});
