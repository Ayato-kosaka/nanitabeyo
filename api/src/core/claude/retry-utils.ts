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

export const LOGICAL_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 1, // Only one logical retry for schema validation failures
  baseDelayMs: 0, // No delay for logical retries
  maxDelayMs: 0,
  jitterMs: 0,
};

/**
 * Result type for two-layer retry tracking
 */
export interface RetryResult<T> {
  result: T;
  metrics: {
    apiRetries: number;
    logicalRetries: number;
    totalAttempts: number;
  };
}

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
      if (totalDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, totalDelay));
      }
    }
  }

  // lastError is guaranteed to be defined here because we only reach this
  // line after at least one iteration of the loop where an error occurred
  throw lastError!;
}

/**
 * Two-layer retry strategy: API retries + logical retries with metrics
 * @param apiCall Function that makes the API call
 * @param validator Function that validates the result (throws for logical failures)
 * @param apiRetryOptions Options for API-level retries
 * @param logicalRetryOptions Options for logical retries
 * @returns Promise with result and retry metrics
 */
export async function withTwoLayerRetry<T>(
  apiCall: () => Promise<T>,
  validator: (result: T) => T, // Should throw on validation failure
  apiRetryOptions: Partial<RetryOptions> = {},
  logicalRetryOptions: Partial<RetryOptions> = LOGICAL_RETRY_OPTIONS,
): Promise<RetryResult<T>> {
  const apiConfig = { ...DEFAULT_RETRY_OPTIONS, ...apiRetryOptions };
  const logicalConfig = { ...LOGICAL_RETRY_OPTIONS, ...logicalRetryOptions };
  
  let apiRetries = 0;
  let logicalRetries = 0;
  let totalAttempts = 0;

  for (let logicalAttempt = 0; logicalAttempt <= logicalConfig.maxRetries; logicalAttempt++) {
    try {
      // Layer 1: API retry with transport-level error handling
      const apiResult = await withRetry(async () => {
        totalAttempts++;
        const result = await apiCall();
        return result;
      }, apiConfig);

      // Track API retries (total attempts - 1 for the successful call - previous logical attempts)
      const currentAttemptApiRetries = totalAttempts - 1 - (logicalAttempt * (apiConfig.maxRetries + 1));
      apiRetries += Math.max(0, currentAttemptApiRetries);

      // Layer 2: Logical validation
      const validatedResult = validator(apiResult);
      
      return {
        result: validatedResult,
        metrics: {
          apiRetries,
          logicalRetries,
          totalAttempts,
        },
      };
    } catch (error) {
      const isLastLogicalAttempt = logicalAttempt === logicalConfig.maxRetries;
      
      if (isLastLogicalAttempt) {
        throw error;
      }

      // Check if this is a logical validation error (not an API error)
      if (isLogicalValidationError(error)) {
        logicalRetries++;
        // Add delay for logical retries if configured
        if (logicalConfig.baseDelayMs > 0) {
          const delay = Math.min(
            logicalConfig.baseDelayMs * Math.pow(2, logicalAttempt),
            logicalConfig.maxDelayMs,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        continue;
      }

      // If it's an API error, it should have been handled by the inner retry
      throw error;
    }
  }

  throw new Error('Unexpected end of two-layer retry logic');
}

/**
 * Determines if an error is worth retrying at the API/transport layer
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

/**
 * Determines if an error is a logical validation error (schema mismatch, etc.)
 * These errors should trigger logical retries, not API retries
 * @param error The error to check
 * @returns true if the error is a logical validation failure
 */
export function isLogicalValidationError(error: any): boolean {
  if (!error) return false;

  const errorMessage = error.message || '';

  // Logical validation error patterns
  return (
    errorMessage.includes('Schema validation failed') ||
    errorMessage.includes('Invalid tool response') ||
    errorMessage.includes('Expected tool_use content') ||
    errorMessage.includes('Invalid item count') ||
    errorMessage.includes('Missing required fields') ||
    errorMessage.includes('Tool response validation failed')
  );
}
