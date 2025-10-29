// api/src/core/utils/backend-utils.ts
//
// Backend utility functions
//
export async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 8,
): Promise<R[]> {
  const ret: R[] = new Array(items.length);
  let i = 0;

  async function run() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      ret[idx] = await worker(items[idx], idx);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    run,
  );
  await Promise.all(workers);
  return ret;
}

/**
 * Round a number to one decimal place
 * @param value - The number to round
 * @returns The rounded number to one decimal place
 * @example
 * roundToOneDecimal(3.333) // => 3.3
 * roundToOneDecimal(4.66)  // => 4.7
 * roundToOneDecimal(4.0)   // => 4.0
 */
export function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Shuffle an array using the Fisher-Yates algorithm
 * @param array - The array to shuffle
 * @returns A new array with the elements shuffled
 */
export function shuffle<T>(array: T[]): T[] {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}