import { useState } from "react";
import { useAnimatedReaction, runOnJS, type SharedValue } from "react-native-reanimated";

/**
 * Subscribe to a Reanimated SharedValue and keep it in React state.
 * This avoids reading `.value` directly during render.
 */
export function useSharedValueState<T>(sharedValue: SharedValue<T>): T {
	const [state, setState] = useState(sharedValue.value);

	useAnimatedReaction(
		() => sharedValue.value,
		(value) => {
			runOnJS(setState)(value as T);
		},
		[sharedValue],
	);

	return state;
}
