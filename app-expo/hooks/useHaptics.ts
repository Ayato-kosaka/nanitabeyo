import { useCallback, useEffect } from "react";
import * as Haptics from "expo-haptics";
import { getHapticsEnabledSnapshot, loadHapticsEnabled } from "@/features/settings/hapticsSettingsStore";

/**
 * Custom hook for haptic feedback management
 * Provides consistent haptic patterns across the app
 *
 * #1504 【設計】設定でオフにされている間は各メソッドを no-op にする。呼び出し側(100 箇所以上)を
 * 書き換えず、ここ 1 箇所で止める。判定は毎回呼び出し時点の最新値(`getHapticsEnabledSnapshot`)を
 * 見るため、設定画面でトグルした結果は既にマウント済みの呼び出し元にも次回呼び出しから反映される
 */
export const useHaptics = () => {
	useEffect(() => {
		// 多重呼び出しはストア側で 1 つの Promise に畳まれるので、AsyncStorage の読み込みは 1 回だけ
		void loadHapticsEnabled();
	}, []);

	// Light haptic for regular button taps and interactions
	const lightImpact = useCallback(() => {
		if (!getHapticsEnabledSnapshot()) return;
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
	}, []);

	// Medium haptic for important operations (purchase, order confirmation, save)
	const mediumImpact = useCallback(() => {
		if (!getHapticsEnabledSnapshot()) return;
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
	}, []);

	// Heavy haptic for very important operations
	const heavyImpact = useCallback(() => {
		if (!getHapticsEnabledSnapshot()) return;
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
	}, []);

	// Error haptic for delete/remove actions and errors
	const errorNotification = useCallback(() => {
		if (!getHapticsEnabledSnapshot()) return;
		Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
	}, []);

	// Success haptic for successful operations
	const successNotification = useCallback(() => {
		if (!getHapticsEnabledSnapshot()) return;
		Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
	}, []);

	// Warning haptic for warning states
	const warningNotification = useCallback(() => {
		if (!getHapticsEnabledSnapshot()) return;
		Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
	}, []);

	// Selection haptic for picker/slider interactions
	const selectionChanged = useCallback(() => {
		if (!getHapticsEnabledSnapshot()) return;
		Haptics.selectionAsync();
	}, []);

	return {
		lightImpact,
		mediumImpact,
		heavyImpact,
		errorNotification,
		successNotification,
		warningNotification,
		selectionChanged,
	};
};
