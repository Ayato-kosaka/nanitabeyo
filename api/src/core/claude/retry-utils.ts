/**
 * Retry utilities for Claude API calls with exponential backoff
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000, // 1 second base delay
  maxDelayMs: 10000, // 10 second max delay
  jitterMs: 200, // Random jitter up to 200ms
};

/**
 * Executes a function with exponential backoff retry logic
 * @param fn The async function to retry
 * @param options Retry configuration options
 * @returns Promise resolving to the function result
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on the last attempt
      if (attempt === config.maxRetries) {
        break;
      }

      // Check if error is retryable
      if (!isRetryableError(error)) {
        throw lastError;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = Math.min(
        config.baseDelayMs * Math.pow(2, attempt),
        config.maxDelayMs,
      );
      const jitter = Math.random() * config.jitterMs;
      const totalDelay = exponentialDelay + jitter;

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, totalDelay));
    }
  }

  // lastError is guaranteed to be defined here because we only reach this
  // line after at least one iteration of the loop where an error occurred
  throw lastError!;
}

/**
 * Determines if an error is worth retrying
 * @param error The error to check
 * @returns true if the error indicates a transient failure
 */
export function isRetryableError(error: any): boolean {
  if (!error) return false;

  const errorMessage = error.message || '';
  const statusCode = error.status || error.statusCode;

  // Retry on network errors
  if (
    errorMessage.includes('ECONNRESET') ||
    errorMessage.includes('ENOTFOUND') ||
    errorMessage.includes('ETIMEDOUT') ||
    errorMessage.includes('ECONNREFUSED')
  ) {
    return true;
  }

  // Retry on HTTP 429 (rate limit) and 5xx server errors
  if (statusCode === 429 || (statusCode >= 500 && statusCode < 600)) {
    return true;
  }

  // Retry on specific Claude API errors
  if (errorMessage.includes('Claude API request failed') && statusCode >= 500) {
    return true;
  }

  return false;
}
