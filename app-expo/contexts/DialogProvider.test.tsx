/**
 * #1205 確認ダイアログのアクションの多重実行ガード（A8）を固定するテスト。
 *
 * 背景:
 * 多重タップ防止が `state.confirming`（useState）だけで書かれていた。React が
 * 再レンダリングをコミットする前に 2 発目の押下が処理されると、両方の押下が
 * `state.confirming === false` を読んで通過するため、custom（`showDialog` + `onConfirm`）の
 * `onConfirm` が 2 回走る。`features/dishCategories/hooks/useBlockDishCategory.ts` では 2 発目が
 * `reactions` の一意制約で失敗し、**ブロックできているのにダイアログにエラーが残る**。
 *
 * このテストは以下を赤で守る。
 *   - await に入る前に OK を連打しても `onConfirm` が 1 回しか走らない（同期 ref のガード）
 *   - 失敗してエラー表示が残った後も押し直せる（解除が finally の 1 箇所に寄っていること）
 *   - prompt の validate エラーで閉じなかった後も OK を押し直せる（早期 return も finally を通る）
 *   - **共通基盤なので**、既存の呼び出し元の経路（confirm / prompt / showDialog+onConfirm /
 *     キャンセル / closeOnConfirm / closeOnError / キュー）が壊れていない
 *
 * DialogProvider の押下ハンドラ（`runConfirmFlow` / Button の `onPress`）は**本物を使う**。
 * react-native-paper 側の描画は検証対象ではないので、props をそのままホスト要素へ流す
 * 入れ物へ差し替え、ボタンの `onPress` / `disabled` を観測できるようにしている。
 */
import React, { act } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));

// paper の Dialog / Portal は PaperProvider（Portal.Host・テーマ・Animated）前提で、
// ここで検証したいのは DialogProvider 側のロジックなので最小の入れ物へ差し替える。
// Button は props をそのままホスト要素へ流し、onPress と disabled を観測できるようにする。
jest.mock("react-native-paper", () => {
	const ReactModule = require("react");
	const { View: RNView, Text: RNText, TextInput: RNTextInput } = require("react-native");

	const Passthrough = ({ children }: { children?: React.ReactNode }) =>
		ReactModule.createElement(RNView, null, children);

	const Dialog = ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
		visible ? ReactModule.createElement(RNView, { testID: "dialog-root" }, children) : null;
	Dialog.Title = Passthrough;
	Dialog.Content = Passthrough;
	Dialog.Actions = Passthrough;

	return {
		__esModule: true,
		Portal: Passthrough,
		Dialog,
		Button: ({ children, ...rest }: { children?: React.ReactNode }) =>
			ReactModule.createElement(RNView, rest, ReactModule.createElement(RNText, null, children)),
		Paragraph: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(RNText, null, children),
		Text: RNText,
		TextInput: RNTextInput,
		HelperText: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(RNText, null, children),
	};
});

import { DialogProvider, useDialog, type DialogContextType } from "./DialogProvider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Provider の外から API を叩けるように context を捕まえるだけの子 */
let dialog: DialogContextType;
const CaptureDialogApi = () => {
	dialog = useDialog();
	return null;
};

/** テスト側で解決／棄却できる保留 Promise */
const defer = <T,>() => {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {
		promise,
		resolve: (value: T) => act(async () => resolve(value)),
		reject: (reason: unknown) => act(async () => reject(reason)),
	};
};

describe("#1205 DialogProvider の確認アクションの多重実行ガード", () => {
	let tree: TestRenderer.ReactTestRenderer;

	beforeEach(async () => {
		await act(async () => {
			tree = TestRenderer.create(
				<DialogProvider>
					<CaptureDialogApi />
				</DialogProvider>,
			);
		});
	});

	afterEach(async () => {
		await act(async () => tree?.unmount());
	});

	/** testID を持つノードのうちホスト要素（type が文字列）の方 */
	const hostByTestID = (testID: string): ReactTestInstance | undefined =>
		tree.root.findAll((node) => node.props?.testID === testID && typeof node.type === "string")[0];

	const isDialogVisible = () => !!hostByTestID("dialog-root");
	const hasText = (text: string) =>
		tree.root.findAll((node) => typeof node.type === "string" && node.children.includes(text)).length > 0;

	/**
	 * ボタンを「再レンダリングを挟まずに」`times` 回押す。
	 *
	 * 1 つの act() の中で同じ onPress（= 同じ render の closure）を続けて呼ぶことが重要。
	 * 押下ごとに act を分けると React が state を反映してしまい、
	 * `state.confirming` でも弾けてしまうため **ref が無くても通ってしまう**。
	 */
	const press = async (testID: string, times = 1) => {
		const button = hostByTestID(testID);
		if (!button) throw new Error(`ボタンが見つかりません: ${testID}`);
		const onPress = button.props.onPress as () => Promise<void>;
		await act(async () => {
			for (let i = 0; i < times; i += 1) void onPress();
		});
	};

	const showDialog = async (options: Parameters<DialogContextType["showDialog"]>[1]) => {
		await act(async () => {
			dialog.showDialog("message", options);
		});
	};

	describe("custom（showDialog + onConfirm）", () => {
		it("await 前に OK を連打しても onConfirm は 1 回しか走らない", async () => {
			const confirming = defer<void>();
			const onConfirm = jest.fn(() => confirming.promise);
			await showDialog({ onConfirm });

			await press("dialog-action-ok", 3);

			// #1205 これが本丸。state.confirming だけのガードでは 2 発目・3 発目も通り、
			// useBlockDishCategory のように 2 発目が一意制約で失敗して「成功しているのにエラー表示」になる
			expect(onConfirm).toHaveBeenCalledTimes(1);

			await confirming.resolve(undefined);
		});

		it("onConfirm 実行中は OK ボタンが disabled になる（表示用の state.confirming は残す）", async () => {
			const confirming = defer<void>();
			await showDialog({ onConfirm: () => confirming.promise });

			await press("dialog-action-ok");

			expect(hostByTestID("dialog-action-ok")?.props.disabled).toBe(true);
			expect(hostByTestID("dialog-action-cancel")?.props.disabled).toBe(true);

			await confirming.resolve(undefined);
		});

		it("onConfirm が失敗するとエラーを表示して閉じず、そのまま押し直せる", async () => {
			const failing = defer<void>();
			const onConfirm = jest.fn(() => failing.promise);
			const onError = jest.fn();
			await showDialog({ onConfirm, onError, errorMessage: "Common.error" });

			await press("dialog-action-ok");
			await failing.reject(new Error("unique constraint"));

			// closeOnError の既定は false。エラーを出して開いたままにする既存挙動
			expect(onError).toHaveBeenCalledTimes(1);
			expect(isDialogVisible()).toBe(true);
			expect(hasText("Common.error")).toBe(true);
			expect(hostByTestID("dialog-action-ok")?.props.disabled).toBe(false);

			// 解除は finally の 1 箇所。try 側へ散らすと ref が立ったままになり二度と押せない
			const retry = defer<void>();
			onConfirm.mockImplementation(() => retry.promise);
			await press("dialog-action-ok");
			expect(onConfirm).toHaveBeenCalledTimes(2);

			await retry.resolve(undefined);
			expect(isDialogVisible()).toBe(false);
		});

		it("成功すると閉じる（closeOnConfirm の既定）", async () => {
			const onConfirm = jest.fn(async () => {});
			await showDialog({ onConfirm });

			await press("dialog-action-ok");

			expect(onConfirm).toHaveBeenCalledTimes(1);
			expect(isDialogVisible()).toBe(false);
		});

		it("closeOnError: true なら失敗時も閉じる", async () => {
			const failing = defer<void>();
			await showDialog({ onConfirm: () => failing.promise, closeOnError: true });

			await press("dialog-action-ok");
			await failing.reject(new Error("boom"));

			expect(isDialogVisible()).toBe(false);
		});

		it("キャンセルは onCancel を呼んで閉じる", async () => {
			const onCancel = jest.fn();
			const onConfirm = jest.fn();
			await showDialog({ onCancel, onConfirm });

			await press("dialog-action-cancel");

			expect(onCancel).toHaveBeenCalledTimes(1);
			expect(onConfirm).not.toHaveBeenCalled();
			expect(isDialogVisible()).toBe(false);
		});

		it("表示中に積まれた 2 件目は、1 件目を閉じたあとに表示される（キュー）", async () => {
			await showDialog({ onConfirm: jest.fn() });
			await showDialog({ title: "second" });

			expect(dialog.getQueueSize()).toBe(1);

			await press("dialog-action-ok");

			expect(dialog.getQueueSize()).toBe(0);
			expect(isDialogVisible()).toBe(true);
			expect(hasText("second")).toBe(true);
		});
	});

	describe("Promise API（既存呼び出し元の経路）", () => {
		it("confirm は OK で true、キャンセルで false を返す", async () => {
			let okResult: boolean | undefined;
			await act(async () => {
				void dialog.confirm({ message: "ok?" }).then((v) => {
					okResult = v;
				});
			});
			await press("dialog-confirm-button");
			expect(okResult).toBe(true);
			expect(isDialogVisible()).toBe(false);

			let cancelResult: boolean | undefined;
			await act(async () => {
				void dialog.confirm({ message: "ok?" }).then((v) => {
					cancelResult = v;
				});
			});
			await press("dialog-cancel-button");
			expect(cancelResult).toBe(false);
		});

		it("prompt は validate エラーで閉じず、直してから OK を押し直せる", async () => {
			let promptResult: string | null | undefined;
			await act(async () => {
				void dialog
					.prompt({ message: "name?", validate: (v) => (v.trim() ? null : "Common.errors.required") })
					.then((v) => {
						promptResult = v;
					});
			});

			// 空のまま OK → validate エラーで閉じない
			await press("dialog-confirm-button");
			expect(promptResult).toBeUndefined();
			expect(isDialogVisible()).toBe(true);
			expect(hasText("Common.errors.required")).toBe(true);

			// 入力し直して OK。早期 return する経路でも ref が解除されていなければここで詰む
			const input = tree.root.findAll(
				(node) => typeof node.type === "string" && typeof node.props.onChangeText === "function",
			)[0];
			await act(async () => input.props.onChangeText("ramen"));
			await press("dialog-confirm-button");

			expect(promptResult).toBe("ramen");
			expect(isDialogVisible()).toBe(false);
		});

		it("prompt のキャンセルは null を返す", async () => {
			let promptResult: string | null | undefined;
			await act(async () => {
				void dialog.prompt({ message: "name?" }).then((v) => {
					promptResult = v;
				});
			});

			await press("dialog-cancel-button");

			expect(promptResult).toBeNull();
		});

		it("hideDialog は confirm を false で解決して閉じる", async () => {
			let result: boolean | undefined;
			await act(async () => {
				void dialog.confirm({ message: "ok?" }).then((v) => {
					result = v;
				});
			});

			await act(async () => dialog.hideDialog());

			expect(result).toBe(false);
			expect(isDialogVisible()).toBe(false);
		});
	});
});
