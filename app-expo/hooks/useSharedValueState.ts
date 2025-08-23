import { useState } from 'react';
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

export function useSharedValueState<T>(shared: SharedValue<T>): T {
  const [value, setValue] = useState(shared.value);
  useAnimatedReaction(
    () => shared.value,
    (next, prev) => {
      if (next !== prev) {
        runOnJS(setValue)(next);
      }
    },
    [shared]
  );
  return value;
}
