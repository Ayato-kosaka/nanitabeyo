// #1205 【設計】OTP の再送・検証が二重に走らないことを守るテスト。
//
// 背景（Issue #1205 の監査 A1 / A2）:
// - 再送（`handleResend`）が 2 回走ると **SMS が 2 通送信されて実費が二重に掛かり**、
//   さらに Supabase の `only request this after N seconds` に当たって
//   **以後の正規の再送まで拒否される**（ユーザーがログインできなくなる）。
// - 検証（`handleVerify`）が 2 回走ると 2 発目は消費済みの OTP で失敗するため、
//   **ログイン成功直後にエラーが表示される**。認証のレート制限も無駄に消費する。
//
// どちらも `isResending` / `isLoading`（useState）でボタンを disabled にしてはいるが、
// React が再レンダリングをコミットする前の 2 発目は素通りするため防げない。
// 判定は同期 ref（`isResendingRef` / `isVerifyingRef`）で行う必要がある。
//
// 加えて、6 桁揃った時点の自動発火 useEffect は、`handleVerify` の finally が
// ref と `isLoading` を同時に戻すため **検証失敗後に発火条件が再び真になる**。
// 同じ 6 桁では自動発火しない（`autoVerifiedOtpRef`）ことで止めている。
//
// このテストは以下を赤で守る。
//   1. await 前に 2 回呼んでも `signInWithOtp` / `verifyOtp` は 1 回しか呼ばれない
//   2. 失敗しても解除され、再送・再検証ができる（「1 回失敗したら二度と押せない」にしない）
//   3. 検証失敗後に自動発火がループしない（＝手で押さない限り再試行されない）
import React, { act } from "react";
import { TextInput, TouchableOpacity } from "react-native";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";

// ---- 観測対象（signInWithOtp / verifyOtp の呼ばれ方）以外はすべてスタブ化する ----
// 翻訳の中身ではなくキーを見たいので、t はキーをそのまま返す
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
// LinearGradient は native view なので、素の View へ落として PrimaryButton を描画できるようにする
jest.mock("expo-linear-gradient", () => {
	const { View: RNView } = require("react-native");
	return { LinearGradient: RNView };
});
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/hooks/useHaptics", () => {
	const lightImpact = jest.fn();
	return { useHaptics: () => ({ lightImpact }) };
});
jest.mock("@/hooks/useLogger", () => {
	const logFrontendEvent = jest.fn();
	return { useLogger: () => ({ logFrontendEvent }) };
});
const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));
// jest.mock のファクトリから参照できるのは `mock` 始まりの変数だけ
const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ signInWithOtp: mockSignInWithOtp, verifyOtp: mockVerifyOtp }),
}));
jest.mock("../hooks/useProfile", () => ({ useProfile: () => ({ createUserProfile: jest.fn() }) }));

import { OtpModal } from "./OtpModal";

// React 19 では初期描画がスケジューラのタスクへ回されるため、act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PHONE = "+819012345678";
const noop = () => {};

/** 解決／棄却をテスト側から制御できる保留プロミスを作る */
const defer = () => {
	let resolve!: (value?: unknown) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res as (value?: unknown) => void;
		reject = rej;
	});
	// 未処理の rejection 警告を避けるため、呼び出し側とは別に握り潰しておく
	promise.catch(() => {});
	return { promise, resolve, reject };
};

/** 呼ばれても永久に解決しないプロミス（ループ検出時に 2 発目が走り切らないようにする） */
const never = () => new Promise<void>(() => {});

describe("OtpModal の二重実行ガード（#1205）", () => {
	let tree: TestRenderer.ReactTestRenderer;
	let onClose: jest.Mock;

	const mount = async () => {
		onClose = jest.fn();
		await act(async () => {
			tree = TestRenderer.create(<OtpModal onClose={onClose} phone={PHONE} />);
		});
	};

	afterEach(() => {
		act(() => tree?.unmount());
	});

	/**
	 * 再送リンク（TouchableOpacity）の押下ハンドラ。
	 * `disabled` は state 由来で同一フレームの 2 発目を止められないため、
	 * ここで 2 回呼ぶことは実機の連打と等価。
	 */
	const resendHandler = (): ((...args: unknown[]) => void) => {
		const touchable = tree.root
			.findAllByType(TouchableOpacity)
			.find((node) => typeof node.props.onPress === "function");
		if (!touchable) throw new Error("再送ボタンが見つかりません");
		return touchable.props.onPress;
	};

	/** 検証ボタン（PrimaryButton 内部の Pressable）の押下ハンドラ。isDisabled ガードごと通す */
	const verifyHandler = (): ((...args: unknown[]) => void) => {
		const pressable = tree.root
			.findAll(
				(node) =>
					node.props?.accessibilityRole === "button" &&
					node.props?.android_ripple !== undefined &&
					typeof node.props?.onPress === "function",
			)
			.pop();
		if (!pressable) throw new Error("検証ボタンが見つかりません");
		return pressable.props.onPress;
	};

	/** OTP 入力欄（6 個）。貼り付けは 1 個目へまとめて流し込める */
	const otpInputs = (): ReactTestInstance[] =>
		tree.root.findAllByType(TextInput).filter((node) => node.props.maxLength === 1);

	/** 6 桁を貼り付けて自動発火 useEffect まで流し切る */
	const pasteOtp = async (code: string) => {
		await act(async () => {
			otpInputs()[0].props.onChangeText(code);
		});
	};

	describe("A1: 再送（SMS の二重送信とレート制限ロックアウト）", () => {
		it("await 前に 2 回押しても signInWithOtp は 1 回しか呼ばれない", async () => {
			await mount();
			const pending = defer();
			mockSignInWithOtp.mockReturnValueOnce(pending.promise);

			const press = resendHandler();
			act(() => {
				press();
				press();
			});

			expect(mockSignInWithOtp).toHaveBeenCalledTimes(1);

			await act(async () => {
				pending.resolve();
			});
		});

		it("再送に失敗しても解除され、押し直せる", async () => {
			await mount();
			const failing = defer();
			mockSignInWithOtp.mockReturnValueOnce(failing.promise);

			act(() => {
				resendHandler()();
			});
			await act(async () => {
				failing.reject(new Error("network down"));
			});

			expect(mockShowSnackbar).toHaveBeenCalledWith("Common.error");

			// 解除は finally の 1 箇所。ここが漏れると「1 回失敗したら二度と再送できない」になる
			const retry = defer();
			mockSignInWithOtp.mockReturnValueOnce(retry.promise);
			act(() => {
				resendHandler()();
			});
			expect(mockSignInWithOtp).toHaveBeenCalledTimes(2);

			await act(async () => {
				retry.resolve();
			});
		});
	});

	describe("A2: 検証（消費済み OTP での失敗と自動発火ループ）", () => {
		it("6 桁が揃うと自動で 1 回だけ検証され、検証中の押下は弾かれる", async () => {
			await mount();
			const pending = defer();
			mockVerifyOtp.mockReturnValueOnce(pending.promise);

			await pasteOtp("123456");

			expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
			expect(mockVerifyOtp).toHaveBeenCalledWith(PHONE, "123456");

			// 検証中にボタンを叩いても 2 発目は走らない
			act(() => {
				verifyHandler()();
			});
			expect(mockVerifyOtp).toHaveBeenCalledTimes(1);

			await act(async () => {
				pending.resolve();
			});
			expect(onClose).toHaveBeenCalledTimes(1);
		});

		it("検証に失敗しても自動発火はループせず、手動の押し直しはできる", async () => {
			await mount();
			const failing = defer();
			// 2 発目以降（＝ループしていたら走ってしまう呼び出し）は解決しないプロミスを返し、
			// 万一ループしても act() の中で無限に回らないようにする
			mockVerifyOtp.mockReturnValueOnce(failing.promise).mockImplementation(never);

			await pasteOtp("123456");
			await act(async () => {
				failing.reject(new Error("invalid otp"));
			});

			// 本丸: finally で isLoading が false に戻っても、同じ 6 桁では自動再試行しない
			expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
			expect(mockShowSnackbar).toHaveBeenCalledWith("Common.error");

			// ただし手動の復帰経路は塞がない。ボタンからは押し直せる
			act(() => {
				verifyHandler()();
			});
			expect(mockVerifyOtp).toHaveBeenCalledTimes(2);
		});

		it("失敗後にボタンを await 前に 2 回押しても verifyOtp は 1 回しか呼ばれない", async () => {
			await mount();
			const failing = defer();
			mockVerifyOtp.mockReturnValueOnce(failing.promise);

			await pasteOtp("123456");
			await act(async () => {
				failing.reject(new Error("invalid otp"));
			});
			expect(mockVerifyOtp).toHaveBeenCalledTimes(1);

			// 自動発火が止まった状態＝ボタンが押せる状態。ここで連打する
			const retry = defer();
			mockVerifyOtp.mockReturnValueOnce(retry.promise);
			const press = verifyHandler();
			act(() => {
				press();
				press();
			});

			expect(mockVerifyOtp).toHaveBeenCalledTimes(2);

			await act(async () => {
				retry.resolve();
			});
		});

		it("再送すると入力が消え、次に入れた 6 桁は再び自動検証される", async () => {
			await mount();
			const failing = defer();
			mockVerifyOtp.mockReturnValueOnce(failing.promise);

			await pasteOtp("123456");
			await act(async () => {
				failing.reject(new Error("invalid otp"));
			});

			const resend = defer();
			mockSignInWithOtp.mockReturnValueOnce(resend.promise);
			act(() => {
				resendHandler()();
			});
			await act(async () => {
				resend.resolve();
			});

			// 再送で自動発火の抑止記録も捨てるので、同じ 6 桁でも自動検証が復活する
			const second = defer();
			mockVerifyOtp.mockReturnValueOnce(second.promise);
			await pasteOtp("123456");
			expect(mockVerifyOtp).toHaveBeenCalledTimes(2);

			await act(async () => {
				second.resolve();
			});
		});
	});
});
