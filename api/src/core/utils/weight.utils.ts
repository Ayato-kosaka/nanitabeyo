// api/src/core/utils/weight.utils.ts
//
// Weight-based utility functions for random selection
//

/**
 * 重み付けに基づいてランダムに要素を選択
 */
export function pickByWeight<T extends { weight: number }>(
  items: T[],
): T | null {
  if (!items || items.length === 0) {
    return null;
  }

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  let random = Math.random() * totalWeight;

  for (const item of items) {
    random -= item.weight;
    if (random <= 0) {
      return item;
    }
  }

  // フォールバック: 最後の要素を返す
  return items[items.length - 1];
}
