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
