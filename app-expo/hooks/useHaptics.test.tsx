// #1504 SET-01: ハプティクス設定がオフのとき、useHaptics の各メソッドが
// 実際に expo-haptics を呼び出さないことを固定する。
//
// 呼び出し側(100 箇所以上)を書き換えず、useHaptics 内で判定する1箇所に閉じたことの検証。
import { act } from "react";
import TestRenderer from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("expo-haptics", () => ({
	ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
	NotificationFeedbackType: { Error: "error", Success: "success", Warning: "warning" },
	impactAsync: jest.fn(),
	notificationAsync: jest.fn(),
	selectionAsync: jest.fn(),
}));

import * as Haptics from "expo-haptics";
import { useHaptics } from "./useHaptics";
import { setHapticsEnabled, __resetHapticsSettingsStoreForTest } from "@/features/settings/hapticsSettingsStore";

// React 19 では初期描画がスケジューラのタスクへ回されるため act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** フックを 1 回だけ描画して参照を取り出す（react-test-renderer 版の renderHook 相当） */
function renderHook() {
	let hookRef!: ReturnType<typeof useHaptics>;
	const Probe = () => {
		hookRef = useHaptics();
		return null;
	};
	act(() => {
		TestRenderer.create(<Probe />);
	});
	return {
		get current() {
			return hookRef;
		},
	};
}

describe("useHaptics", () => {
	beforeEach(async () => {
		__resetHapticsSettingsStoreForTest();
		await AsyncStorage.clear();
		jest.clearAllMocks();
	});

	it("既定値(オン)では各メソッドが expo-haptics を呼ぶ", () => {
		const result = renderHook();

		act(() => {
			result.current.lightImpact();
			result.current.mediumImpact();
			result.current.heavyImpact();
			result.current.errorNotification();
			result.current.successNotification();
			result.current.warningNotification();
			result.current.selectionChanged();
		});

		expect(Haptics.impactAsync).toHaveBeenCalledTimes(3);
		expect(Haptics.notificationAsync).toHaveBeenCalledTimes(3);
		expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
	});

	it("設定をオフにすると、各メソッドを呼んでも expo-haptics は一切実行されない", async () => {
		await setHapticsEnabled(false);
		const result = renderHook();

		act(() => {
			result.current.lightImpact();
			result.current.mediumImpact();
			result.current.heavyImpact();
			result.current.errorNotification();
			result.current.successNotification();
			result.current.warningNotification();
			result.current.selectionChanged();
		});

		expect(Haptics.impactAsync).not.toHaveBeenCalled();
		expect(Haptics.notificationAsync).not.toHaveBeenCalled();
		expect(Haptics.selectionAsync).not.toHaveBeenCalled();
	});

	it("オフの状態がアプリ再起動(モジュール再読み込み相当)をまたいで保持される", async () => {
		await setHapticsEnabled(false);
		// ストアの読み込み Promise だけを初期化し、AsyncStorage の内容はそのまま保つことで
		// 「再起動後に読み直す」状況を模す
		__resetHapticsSettingsStoreForTest();

		const result = renderHook();
		// マウント直後は読み込み前のため既定値(オン)だが、読み込みが終わるとオフへ収束する
		await act(async () => {
			await Promise.resolve();
		});

		act(() => {
			result.current.lightImpact();
		});

		expect(Haptics.impactAsync).not.toHaveBeenCalled();
	});

	it("オフからオンへ戻すと再び expo-haptics が実行される", async () => {
		await setHapticsEnabled(false);
		const result = renderHook();

		await act(async () => {
			await setHapticsEnabled(true);
		});

		act(() => {
			result.current.lightImpact();
		});

		expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
	});
});
