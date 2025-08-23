import { useState } from 'react';
import { useAnimatedReaction, runOnJS, type SharedValue } from 'react-native-reanimated';

/**
 * Convert a Reanimated SharedValue into a React state value without
 * reading the shared value during render.
 */
export function useSharedValueState<T>(shared: SharedValue<T>) {
  const [value, setValue] = useState<T>(shared.value);

  useAnimatedReaction(
    () => shared.value,
    (v) => {
      runOnJS(setValue)(v);
    },
    [shared],
  );

  return value;
}
