/**
 * Tests for retry utilities including two-layer retry strategy
 */

import {
  withRetry,
  withTwoLayerRetry,
  isRetryableError,
  isLogicalValidationError,
  DEFAULT_RETRY_OPTIONS,
  LOGICAL_RETRY_OPTIONS,
} from './retry-utils';

// Mock function to simulate API calls
const createMockApiCall = (
  failureCount: number,
  finalResult: string = 'success',
) => {
  let callCount = 0;
  return jest.fn(async () => {
    callCount++;
    if (callCount <= failureCount) {
      const error = new Error('ECONNRESET'); // Network error (retryable)
      throw error;
    }
    return finalResult;
  });
};

describe('Retry Utils', () => {
  describe('withRetry', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should succeed immediately if no error occurs', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');

      const result = await withRetry(mockFn, { maxRetries: 3 });

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors and eventually succeed', async () => {
      const mockFn = createMockApiCall(2); // Fail twice, succeed on third attempt

      const result = await withRetry(mockFn, {
        maxRetries: 3,
        baseDelayMs: 10, // Fast for testing
        maxDelayMs: 50,
      });

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should throw error after max retries exceeded', async () => {
      const mockFn = createMockApiCall(5); // Always fail

      await expect(
        withRetry(mockFn, {
          maxRetries: 2,
          baseDelayMs: 10,
          maxDelayMs: 50,
        }),
      ).rejects.toThrow('ECONNRESET');

      expect(mockFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should not retry on non-retryable errors', async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValue(new Error('Authentication failed'));

      await expect(withRetry(mockFn, { maxRetries: 3 })).rejects.toThrow(
        'Authentication failed',
      );

      expect(mockFn).toHaveBeenCalledTimes(1); // No retries
    });
  });

  describe('isRetryableError', () => {
    it('should identify network errors as retryable', () => {
      expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
      expect(isRetryableError(new Error('ENOTFOUND'))).toBe(true);
      expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    });

    it('should identify HTTP 5xx errors as retryable', () => {
      const serverError = new Error('Server error');
      (serverError as any).status = 500;
      expect(isRetryableError(serverError)).toBe(true);

      const badGateway = new Error('Bad gateway');
      (badGateway as any).statusCode = 502;
      expect(isRetryableError(badGateway)).toBe(true);
    });

    it('should identify HTTP 429 as retryable', () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).status = 429;
      expect(isRetryableError(rateLimitError)).toBe(true);
    });

    it('should not retry on HTTP 4xx client errors (except 429)', () => {
      const authError = new Error('Unauthorized');
      (authError as any).status = 401;
      expect(isRetryableError(authError)).toBe(false);

      const notFoundError = new Error('Not found');
      (notFoundError as any).status = 404;
      expect(isRetryableError(notFoundError)).toBe(false);
    });

    it('should handle null/undefined errors', () => {
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
    });
  });
});

// Note: We're not exporting isRetryableError from retry-utils, so we need to test it indirectly
// through the withRetry function behavior or make it exported for testing

describe('Two-Layer Retry Strategy', () => {
  describe('withTwoLayerRetry', () => {
    it('should succeed with no retries', async () => {
      const mockApiCall = jest.fn().mockResolvedValue('api-result');
      const mockValidator = jest.fn().mockReturnValue('validated-result');

      const result = await withTwoLayerRetry(mockApiCall, mockValidator);

      expect(result.result).toBe('validated-result');
      expect(result.metrics.apiRetries).toBe(0);
      expect(result.metrics.logicalRetries).toBe(0);
      expect(result.metrics.totalAttempts).toBe(1);
      expect(mockApiCall).toHaveBeenCalledTimes(1);
      expect(mockValidator).toHaveBeenCalledWith('api-result');
    });

    it('should handle logical validation retries', async () => {
      const mockApiCall = jest.fn().mockResolvedValue('api-result');
      const mockValidator = jest.fn()
        .mockImplementationOnce(() => {
          throw new Error('Schema validation failed');
        })
        .mockReturnValueOnce('validated-result');

      const result = await withTwoLayerRetry(mockApiCall, mockValidator);

      expect(result.result).toBe('validated-result');
      expect(result.metrics.apiRetries).toBe(0);
      expect(result.metrics.logicalRetries).toBe(1);
      expect(result.metrics.totalAttempts).toBe(2);
      expect(mockApiCall).toHaveBeenCalledTimes(2);
      expect(mockValidator).toHaveBeenCalledTimes(2);
    });

    it('should throw after max logical retries', async () => {
      const mockApiCall = jest.fn().mockResolvedValue('api-result');
      const mockValidator = jest.fn().mockImplementation(() => {
        throw new Error('Schema validation failed');
      });

      await expect(
        withTwoLayerRetry(mockApiCall, mockValidator, {}, { maxRetries: 1 })
      ).rejects.toThrow('Schema validation failed');
    });
  });

  describe('isLogicalValidationError', () => {
    it('should identify schema validation errors', () => {
      expect(isLogicalValidationError(new Error('Schema validation failed'))).toBe(true);
      expect(isLogicalValidationError(new Error('Invalid tool response'))).toBe(true);
      expect(isLogicalValidationError(new Error('Expected tool_use content'))).toBe(true);
      expect(isLogicalValidationError(new Error('Invalid item count'))).toBe(true);
      expect(isLogicalValidationError(new Error('Missing required fields'))).toBe(true);
      expect(isLogicalValidationError(new Error('Tool response validation failed'))).toBe(true);
    });

    it('should not identify API errors as logical errors', () => {
      expect(isLogicalValidationError(new Error('ECONNRESET'))).toBe(false);
      expect(isLogicalValidationError(new Error('Authentication failed'))).toBe(false);
    });

    it('should handle null/undefined errors', () => {
      expect(isLogicalValidationError(null)).toBe(false);
      expect(isLogicalValidationError(undefined)).toBe(false);
    });
  });

  describe('constants', () => {
    it('should have correct default retry options', () => {
      expect(DEFAULT_RETRY_OPTIONS).toEqual({
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        jitterMs: 200,
      });
    });

    it('should have correct logical retry options', () => {
      expect(LOGICAL_RETRY_OPTIONS).toEqual({
        maxRetries: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterMs: 0,
      });
    });
  });
});
