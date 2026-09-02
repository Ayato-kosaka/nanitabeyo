// api/src/core/external-api/external-api.service.spec.ts
//
// Test for external API service error handling
//

// #1596 `getCorrectedSpelling` は **モジュール読み込み時に確定した** `env` を読む
// （`env.GOOGLE_API_KEY`）。テストの中で `process.env` を消しても `env` は変わらないため、
// 「資格情報が無いとき null を返す」経路はこの mock 無しでは到達できない。
// 旧 spec は process.env を消して検査しており、実際には一度も «資格情報なし» を
// 通っていなかった（env 起因で suite ごと落ちていたため誰も気づけなかった）。
const mockEnv: Record<string, unknown> = {};
jest.mock('../config/env', () => ({ env: mockEnv }));

import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '@shared/v1/res';
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
      mockEnv.GOOGLE_API_KEY = 'test-api-key';
      mockEnv.GOOGLE_SEARCH_ENGINE_ID = 'test-engine-id';
    });

    afterEach(() => {
      delete mockEnv.GOOGLE_API_KEY;
      delete mockEnv.GOOGLE_SEARCH_ENGINE_ID;
    });

    it('should log 403 errors as warning instead of error', async () => {
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

      // Mock a 403 error response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: jest.fn().mockResolvedValue('Forbidden'),
        // #1596 makeExternalApiCall は成功・失敗にかかわらず
        // `response.clone().json().catch(() => null)` でログ用の本文を読む。
        // `jest.fn()` のままだと undefined が返り `.catch` で TypeError になり、
        // «403 は warn» を検査するはずのこのテストが別の理由で落ちていた。
        json: jest.fn().mockResolvedValue(null),
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
        // #1596 makeExternalApiCall は成功・失敗にかかわらず
        // `response.clone().json().catch(() => null)` でログ用の本文を読む。
        // `jest.fn()` のままだと undefined が返り `.catch` で TypeError になり、
        // «403 は warn» を検査するはずのこのテストが別の理由で落ちていた。
        json: jest.fn().mockResolvedValue(null),
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
      delete mockEnv.GOOGLE_API_KEY;
      delete mockEnv.GOOGLE_SEARCH_ENGINE_ID;

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
  /**
   * #1642 Places の日次上限を **503 で返してはいけない**。
   *
   * 503 は `MaintenanceGuard`（Remote Config の `is_maintenance`）の番号で、
   * クライアントは 503 を «ただいまメンテナンス中です。» と読む。#1629 でここを
   * 503 にしたため、メンテナンスでも何でもない «上限» でメンテ告知が実機に出た
   * （2026-08-31 のオーナー実機）。上流が言っている 429 をそのまま返す。
   */
  describe('callPlaceSearchText の日次上限', () => {
    beforeEach(() => {
      mockEnv.GOOGLE_PLACE_API_KEY = 'test-place-key';
    });

    afterEach(() => {
      delete mockEnv.GOOGLE_PLACE_API_KEY;
    });

    it('上流の 429 は 429 のまま返す（503 にしない）', async () => {
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue('RESOURCE_EXHAUSTED'),
        // makeExternalApiCall がログ用にボディを複製して読む
        clone: () => ({ json: jest.fn().mockRejectedValue(new Error('not json')) }),
      } as unknown as Response);

      const error: unknown = await service
        .callPlaceSearchText('places.id', { textQuery: '焼肉' })
        .then(
          () => {
            throw new Error('上限に達したのに成功した');
          },
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(HttpException);
      const httpError = error as HttpException;
      // 🛑 ここが 503 に戻ると、実機へメンテ告知が出る
      expect(httpError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(httpError.getStatus()).not.toBe(HttpStatus.SERVICE_UNAVAILABLE);
      // «相手が壊れている» ではなく «上限» だと呼び出し側が読めること
      expect((httpError.getResponse() as { code: string }).code).toBe(
        ErrorCode.EXTERNAL_QUOTA_EXCEEDED,
      );
    });
  });
});
