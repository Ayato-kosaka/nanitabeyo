// api/src/v1/locations/locations.quota.spec.ts
//
// #1196 searchRestaurants のログレベルと、二重ログの解消を固定する。
//
// 既存の locations.service.spec.ts に相乗りしないのは、あちらが api/.env を要求して
// suite ごと落ちる（env をモックしていない）ため。ここは env をモックして単体で回せるようにする。

jest.mock('../../core/config/env', () => ({
  env: new Proxy({}, { get: (_target, key: string) => `test-${key}` }),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { LocationsService } from './locations.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { ExternalApiQuotaExceededError } from '../../core/external-api/external-api.errors';

const params = {
  location: '35.68944,139.69167',
  radius: 500,
  dishCategoryName: 'ラーメン',
};

describe('#1196 LocationsService.searchRestaurants の失敗ログ', () => {
  let service: LocationsService;
  let logger: jest.Mocked<AppLoggerService>;
  let externalApi: { callPlaceSearchText: jest.Mock };

  beforeEach(async () => {
    externalApi = { callPlaceSearchText: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationsService,
        {
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        { provide: ExternalApiService, useValue: externalApi },
      ],
    }).compile();

    service = module.get(LocationsService);
    logger = module.get(AppLoggerService);
    jest.clearAllMocks();
  });

  describe('上流クォータ枯渇', () => {
    const quotaError = new ExternalApiQuotaExceededError({
      apiName: 'Google Places Text Search API',
      upstreamStatus: 429,
      message:
        "Google Places Text Search API request failed: 429 Quota exceeded for quota metric 'SearchTextRequest'",
    });

    beforeEach(() => {
      externalApi.callPlaceSearchText.mockRejectedValue(quotaError);
    });

    // クライアントは Google Maps フォールバックへ逃げられるので「ユーザーが困っている error」ではない。
    // 枯渇そのものの error は ExternalApiService が 1 件出している（両方 warn にはしない）。
    it('warn で記録し、error は出さない', async () => {
      await service.searchRestaurants(params).catch(() => undefined);

      expect(logger.warn).toHaveBeenCalledWith(
        'GoogleMapsTextSearchQuotaExceeded',
        'searchRestaurants',
        expect.objectContaining({ upstream_status: 429 }),
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('例外の型は保ったまま再スローする（呼び出し側が 429 へ変換できる）', async () => {
      await expect(service.searchRestaurants(params)).rejects.toBe(quotaError);
    });

    // 以前は performSearch の catch と外側の catch が同じ失敗を2回 error でログしており、
    // BigQuery 上の件数が実際の2倍に見えていた。
    it('同じ失敗を二重にログしない', async () => {
      await service.searchRestaurants(params).catch(() => undefined);

      expect(logger.warn.mock.calls).toHaveLength(1);
    });
  });

  describe('クォータ以外の失敗', () => {
    const unexpected = new Error(
      'Google Places Text Search API request failed: 500 ',
    );

    beforeEach(() => {
      externalApi.callPlaceSearchText.mockRejectedValue(unexpected);
    });

    // ★ フォールバックがあるからといって一律 warn へ落とさない。
    //   分類できていない失敗は我々のバグの可能性があるので error のまま残す。
    it('error のまま残す', async () => {
      await service.searchRestaurants(params).catch(() => undefined);

      expect(logger.error).toHaveBeenCalledWith(
        'GoogleMapsAPICallError',
        'searchRestaurants',
        expect.objectContaining({
          error_message: expect.stringContaining('500'),
        }),
      );
    });

    it('二重にログしない（performSearch と外側 catch の重複を解消済み）', async () => {
      await service.searchRestaurants(params).catch(() => undefined);

      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  // 0 件は異常ではない（#636）。フォールバック3段を尽くしても 0 件なら空レスポンスを返す契約。
  it('0 件のときは error も warn(Quota) も出さずに空レスポンスを返す', async () => {
    externalApi.callPlaceSearchText.mockResolvedValue({});

    await expect(service.searchRestaurants(params)).resolves.toEqual({});
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalledWith(
      'GoogleMapsTextSearchQuotaExceeded',
      expect.anything(),
      expect.anything(),
    );
  });
});
