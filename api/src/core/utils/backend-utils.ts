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
 * #1395 `dish_reviews.created_dish_media_id` は写真なしの「食べた」を記録できるよう
 * nullable 化される（20260819T0000）。
 *
 * 生成物（`api/prisma/schema.prisma` / `shared/supabase/database.types.ts`）が
 * 追随するまでの間、この列の型は `string`（NOT NULL）のままである。
 * 実値は NULL になりうるので、**型を信じずに** null 安全へ寄せるための小さな関門。
 *
 * `String(review.created_dish_media_id)` のように書くと `null` が **`"null"` という文字列**
 * になり、Map を引いて miss し、検知できない形で静かに失敗する。それを防ぐ。
 *
 * @example
 * const mediaId = toNullableId(review.created_dish_media_id);
 * if (mediaId === null) return null;   // 写真なしレビュー
 */
export function toNullableId(value: string | null | undefined): string | null {
  return value ?? null;
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
