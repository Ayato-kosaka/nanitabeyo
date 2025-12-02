// lib/retry.ts
type RetryOptions = {
	retries?: number; // 最大リトライ回数
	initialDelayMs?: number; // 初回の待機時間
	maxDelayMs?: number; // 最大待機時間
	backoffFactor?: number; // 指数バックオフ係数
	shouldRetry?: (error: unknown, attempt: number) => boolean;
};

export const retry = async <T>(
	fn: () => Promise<T>,
	{
		retries = 3,
		initialDelayMs = 500,
		maxDelayMs = 4000,
		backoffFactor = 2,
		shouldRetry = () => true,
	}: RetryOptions = {},
): Promise<T> => {
	let attempt = 0;
	let delay = initialDelayMs;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		try {
			return await fn();
		} catch (err) {
			attempt += 1;

			const canRetry = attempt <= retries && shouldRetry(err, attempt);
			if (!canRetry) {
				throw err;
			}

			// 指数バックオフ
			await new Promise((resolve) => setTimeout(resolve, delay));
			delay = Math.min(maxDelayMs, delay * backoffFactor);
		}
	}
};
