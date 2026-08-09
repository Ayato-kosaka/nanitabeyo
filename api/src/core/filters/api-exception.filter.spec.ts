// api/src/core/filters/api-exception.filter.spec.ts
//
// #1196 例外ログのレベルがステータスで分かれることを固定する。
//
// 「500 で返すのをやめて 429 にした」だけでは半分で、ログが error のままだと
// BigQuery 上は 500 時代と同じ「サーバー異常」に見え続ける。両方揃えて初めて分類が変わる。

jest.mock('../config/env', () => ({
  env: new Proxy({}, { get: (_target, key: string) => `test-${key}` }),
}));

import { HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ErrorCode } from '@shared/v1/res';
import { ApiExceptionFilter } from './api-exception.filter';
import { AppLoggerService } from '../logger/logger.service';
import { ClsService } from 'nestjs-cls';

const buildHost = () => {
  const res = {
    statusCode: 200,
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const req = { method: 'POST', url: '/v1/dishes/bulk-import', body: {} };

  return {
    host: {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ArgumentsHost,
    res,
  };
};

describe('#1196 ApiExceptionFilter のログレベル', () => {
  let filter: ApiExceptionFilter;
  let logger: { warn: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    logger = { warn: jest.fn(), error: jest.fn() };
    filter = new ApiExceptionFilter(
      { get: () => 'req-id' } as unknown as ClsService,
      logger as unknown as AppLoggerService,
    );
  });

  const throwThrough = (status: number) => {
    const { host, res } = buildHost();
    filter.catch(
      new HttpException(
        { code: ErrorCode.EXTERNAL_SERVICE_ERROR, message: 'x' },
        status,
      ),
      host,
    );
    return res;
  };

  // 上流クォータ枯渇はこの 429 で返る（DishesService.bulkImportFromGoogle）。
  // クライアントは Google Maps フォールバックへ逃げるので、ユーザーは行き止まりにならない。
  it('429 は warn（一時障害。アプリを直しても消えない）', () => {
    throwThrough(HttpStatus.TOO_MANY_REQUESTS);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([401, 408, 425, 426, 429])('%i は warn', (status) => {
    throwThrough(status);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  // ★ ここが warn に落ちると「フォールバックが無い経路の 500」が見えなくなる。
  //   400 / 422 も同じ理由で error のまま（logQueue.ts / error-triage の E6 と同じ定義）。
  it.each([400, 409, 422, 500, 502, 503])('%i は error のまま', (status) => {
    throwThrough(status);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('レベルが変わってもレスポンスのステータスは変わらない', () => {
    const res = throwThrough(HttpStatus.TOO_MANY_REQUESTS);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorCode: ErrorCode.EXTERNAL_SERVICE_ERROR,
      }),
    );
  });
});
