// api/src/core/external-api/external-api.service.spec.ts
//
// Test for external API service error handling
//

import { Test, TestingModule } from '@nestjs/testing';
import { ExternalApiService } from './external-api.service';
import { AppLoggerService } from '../logger/logger.service';

// Mock fetch globally
global.fetch = jest.fn();

describe('ExternalApiService Error Handling', () => {
  let service: ExternalApiService;
  let mockLogger: jest.Mocked<AppLoggerService>;

  beforeEach(async () => {
    const mockLoggerService = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      externalApi: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExternalApiService,
        {
          provide: AppLoggerService,
          useValue: mockLoggerService,
        },
      ],
    }).compile();

    service = module.get<ExternalApiService>(ExternalApiService);
    mockLogger = module.get(AppLoggerService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('getCorrectedSpelling', () => {
    const query = 'test query';

    beforeEach(() => {
      // Mock environment variables
      process.env.GOOGLE_API_KEY = 'test-api-key';
      process.env.GOOGLE_SEARCH_ENGINE_ID = 'test-engine-id';
    });

    afterEach(() => {
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_SEARCH_ENGINE_ID;
    });

    it('should log 403 errors as warning instead of error', async () => {
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

      // Mock a 403 error response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: jest.fn().mockResolvedValue('Forbidden'),
        json: jest.fn(),
        clone: jest.fn().mockReturnThis(),
      } as any);

      const result = await service.getCorrectedSpelling(query);

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'GoogleCustomSearchAPICallError',
        'getCorrectedSpelling',
        {
          error_message: 'Google Custom Search API request failed: 403',
          query,
        },
      );
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should log non-403 errors as error level', async () => {
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

      // Mock a 500 error response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error'),
        json: jest.fn(),
        clone: jest.fn().mockReturnThis(),
      } as any);

      const result = await service.getCorrectedSpelling(query);

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'GoogleCustomSearchAPICallError',
        'getCorrectedSpelling',
        {
          error_message: 'Google Custom Search API request failed: 500',
          query,
        },
      );
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should log network errors as error level', async () => {
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

      // Mock a network error
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await service.getCorrectedSpelling(query);

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'GoogleCustomSearchAPICallError',
        'getCorrectedSpelling',
        {
          error_message: 'Network error',
          query,
        },
      );
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should return corrected spelling when API succeeds', async () => {
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
      const correctedQuery = 'corrected test query';

      // Mock successful response
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          spelling: {
            correctedQuery,
          },
        }),
        clone: jest.fn().mockReturnThis(),
      } as any);

      const result = await service.getCorrectedSpelling(query);

      expect(result).toBe(correctedQuery);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'getCorrectedSpelling',
        'getCorrectedSpelling',
        {
          correctedQuery,
        },
      );
    });

    it('should return null when no credentials are configured', async () => {
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_SEARCH_ENGINE_ID;

      const result = await service.getCorrectedSpelling(query);

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'getCorrectedSpelling',
        'getCorrectedSpelling',
        {
          error_message: 'Google API credentials are not configured',
        },
      );
    });
  });
});
