// #1194 body-parser が投げる http-errors を «未処理例外 = 500» にしないこと。
//
// 実機で踏んだ症状:
//   フロントログのバッチが express の既定上限 100 kB を超えると
//   PayloadTooLargeError が **Nest のルータへ到達する前** に発生し、
//   HttpException ではないのでこのフィルタの `instanceof Error` 分岐に落ちて 500 になっていた。
//   クライアントは 5xx を «一時障害» と分類して再送しないため、そのバッチのログは消える。
//   （dev の Cloud Run ログで PayloadTooLargeError を実測、
//     実機側は `⚠️ frontend log batch dropped: kind=transient status=500 count=17`）

// フィルタは logger.service 経由で env を読み込む。ここで見たいのは例外の分類だけなので、
// 実際の環境変数一式を用意する代わりに env モジュールごと差し替える
// （share-links.service.spec.ts と同じ流儀）
jest.mock('src/core/config/env', () => ({
  env: { API_COMMIT_ID: 'test-commit', API_NODE_ENV: 'test' },
}));

import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@shared/v1/res';
import { ApiExceptionFilter } from './api-exception.filter';

/** body-parser / raw-body が投げる http-errors 形状のエラーを作る */
const makeHttpError = (status: number, message: string, type: string) =>
  Object.assign(new Error(message), {
    status,
    statusCode: status,
    expose: status < 500,
    type,
  });

const runFilter = (exception: unknown) => {
  const json = jest.fn();
  const res = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnValue({ json }),
    statusCode: 200,
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/v1/logs/frontend/batch',
        body: {},
      }),
      getResponse: () => res,
    }),
  } as any;

  const logger = { error: jest.fn() } as any;
  const cls = { get: jest.fn().mockReturnValue('req-1') } as any;

  new ApiExceptionFilter(cls, logger).catch(exception, host);

  return {
    status: res.status.mock.calls[0][0],
    body: json.mock.calls[0][0],
    logger,
  };
};

describe('#1194 ApiExceptionFilter が http-errors を素通しする', () => {
  it('PayloadTooLargeError を 413 で返す（500 にしない）', () => {
    const { status, body } = runFilter(
      makeHttpError(413, 'request entity too large', 'entity.too.large'),
    );

    expect(status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(body.errorCode).toBe(ErrorCode.INVALID_REQUEST_BODY);
    expect(body.success).toBe(false);
  });

  it('未処理例外ではなく HttpError として記録する（原因の切り分けに要る）', () => {
    const { logger } = runFilter(
      makeHttpError(413, 'request entity too large', 'entity.too.large'),
    );

    expect(logger.error).toHaveBeenCalledWith(
      'HttpError',
      'ApiExceptionFilter',
      expect.objectContaining({ statusCode: 413 }),
    );
  });

  // ⚠️ `status` を持つだけのエラーを素通しすると、無関係なライブラリの内部メッセージを
  // そのまま返してしまう。http-errors 形状（expose を持つ）に限定していることを固定する
  it('status を持つだけの素の Error は従来どおり 500 のまま', () => {
    const { status, body } = runFilter(
      Object.assign(new Error('boom'), { status: 418 }),
    );

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.message).toBe('Internal server error');
  });

  it('Nest の HttpException は従来どおり扱う', () => {
    const { status } = runFilter(
      new HttpException('nope', HttpStatus.FORBIDDEN),
    );

    expect(status).toBe(HttpStatus.FORBIDDEN);
  });

  it('5xx の http-errors は内部メッセージを露出しない', () => {
    const { status, body } = runFilter(
      makeHttpError(500, 'internal detail leaked', 'entity.parse.failed'),
    );

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.message).toBe('Internal server error');
  });
});
