// api/src/core/external-api/external-api.quota.spec.ts
//
// #1196 callPlaceSearchText のクォータ枯渇まわりのログレベルと例外型を固定する。
//
// 既存の external-api.service.spec.ts に相乗りしなかった理由:
//   あちらは `process.env` を直接いじって「認証情報が無い」ケースを検証しているため、
//   env モジュールをモックすると既存テストが壊れる。こちらは env をモックしないと
//   api/.env の無い環境で suite ごと落ちる（pr-check.yml が api を CI に入れていない理由）。
//   要求が両立しないので別ファイルに分ける。

// core/config/env は import 時に process.env をバリデーションして throw するため、
// 実APIに触れない単体テストでも .env が無いと suite ごと落ちる。
jest.mock('../config/env', () => ({
  env: new Proxy({}, { get: (_target, key: string) => `test-${key}` }),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ExternalApiService } from './external-api.service';
import { ExternalApiQuotaExceededError } from './external-api.errors';
import { AppLoggerService } from '../logger/logger.service';

global.fetch = jest.fn();

/** 上流のエラーレスポンス（makeExternalApiCall は clone().json() も呼ぶ） */
const upstreamErrorResponse = (status: number, body: string) =>
  ({
    ok: false,
    status,
    text: jest.fn().mockResolvedValue(body),
    json: jest.fn().mockResolvedValue(null),
    clone: jest.fn().mockReturnThis(),
  }) as any;

const QUOTA_BODY =
  "Quota exceeded for quota metric 'SearchTextRequest' and limit 'SearchTextRequest per day'";

describe('#1196 ExternalApiService.callPlaceSearchText のクォータ枯渇', () => {
  let service: ExternalApiService;
  let logger: jest.Mocked<AppLoggerService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExternalApiService,
        {
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            externalApi: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ExternalApiService);
    logger = module.get(AppLoggerService);
    jest.clearAllMocks();
  });

  it('429 のとき ExternalApiQuotaExceededError を投げる（呼び出し側が型で分岐できる）', async () => {
    (fetch as jest.Mock).mockResolvedValue(
      upstreamErrorResponse(429, QUOTA_BODY),
    );

    const error = await service.callPlaceSearchText('places.id', {}).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ExternalApiQuotaExceededError);
    expect((error as ExternalApiQuotaExceededError).upstreamStatus).toBe(429);
  });

  // ★ #1196 論点3「ユーザー影響とシステム異常を分けて扱う」の要。
  //   ユーザーは Google Maps フォールバックで行き止まりにならないが、
  //   「1日でクォータが尽きている」ことは運用が直すべき異常なので、ここだけは error で残す。
  //   ここが warn になると error-triage（error_level = 'error' のみを対象にする）が拾わず、
  //   クォータ枯渇に誰も気づけなくなる。
  it('クォータ枯渇そのものは error で残す（専用の event_name で）', async () => {
    (fetch as jest.Mock).mockResolvedValue(
      upstreamErrorResponse(429, QUOTA_BODY),
    );

    await service.callPlaceSearchText('places.id', {}).catch(() => undefined);

    expect(logger.error).toHaveBeenCalledWith(
      'GooglePlacesQuotaExceeded',
      'callPlaceSearchText',
      expect.objectContaining({ upstream_status: 429 }),
    );
  });

  // triage の E6 は payload.statusCode を beHttpStatus として読み、
  // EXCLUDED_HTTP_STATUSES（429 を含む）に入るものを除外する。
  // ここに statusCode を載せると、せっかく error で残したシグナルが除外されて消える。
  it('payload に statusCode を載せない（error-triage の除外に巻き込まれないため）', async () => {
    (fetch as jest.Mock).mockResolvedValue(
      upstreamErrorResponse(429, QUOTA_BODY),
    );

    await service.callPlaceSearchText('places.id', {}).catch(() => undefined);

    const payload = logger.error.mock.calls[0][2] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('statusCode');
  });

  it('クォータ以外の失敗は従来どおり GooglePlacesAPICallError / error のまま', async () => {
    (fetch as jest.Mock).mockResolvedValue(
      upstreamErrorResponse(500, 'Internal Server Error'),
    );

    const error = await service.callPlaceSearchText('places.id', {}).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).not.toBeInstanceOf(ExternalApiQuotaExceededError);
    expect(logger.error).toHaveBeenCalledWith(
      'GooglePlacesAPICallError',
      'callPlaceSearchText',
      expect.objectContaining({
        error_message: expect.stringContaining('500'),
      }),
    );
  });

  it('同じ失敗を2つの event_name で二重にログしない', async () => {
    (fetch as jest.Mock).mockResolvedValue(
      upstreamErrorResponse(429, QUOTA_BODY),
    );

    await service.callPlaceSearchText('places.id', {}).catch(() => undefined);

    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
