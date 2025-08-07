import { useCallback } from "react";
import * as Haptics from "expo-haptics";

/**
 * Custom hook for haptic feedback management
 * Provides consistent haptic patterns across the app
 */
export const useHaptics = () => {
	// Light haptic for regular button taps and interactions
	const lightImpact = useCallback(() => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
	}, []);

	// Medium haptic for important operations (purchase, order confirmation, save)
	const mediumImpact = useCallback(() => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
	}, []);

	// Heavy haptic for very important operations
	const heavyImpact = useCallback(() => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
	}, []);

	// Error haptic for delete/remove actions and errors
	const errorNotification = useCallback(() => {
		Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
	}, []);

	// Success haptic for successful operations
	const successNotification = useCallback(() => {
		Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
	}, []);

	// Warning haptic for warning states
	const warningNotification = useCallback(() => {
		Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
	}, []);

	// Selection haptic for picker/slider interactions
	const selectionChanged = useCallback(() => {
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
