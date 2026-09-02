// core/filters/api-exception.filter.ts
import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ErrorCode, BaseResponse } from '@shared/v1/res';
import { ClsService } from 'nestjs-cls';
import { CLS_KEY_REQUEST_ID } from '../cls/cls.constants';
import { REQUEST_ID_HEADER } from '../request-id/request-id.constants';
import { AppLoggerService } from '../logger/logger.service';
import { maskSensitiveFields } from '../interceptors/response-wrap.utils';

/**
 * `http-errors`（body-parser / raw-body が使う）が投げたエラーか。
 *
 * Nest の HttpException とは別系統で、`status` / `expose` を持つ素の Error として飛んでくる。
 * ⚠️ `status` を持つだけで判定しないこと。任意のライブラリのエラーが
 * たまたま `status` を持っていた場合に «そのまま返す» と、意図しないステータスや
 * 内部メッセージの露出につながる。`expose` の有無まで見て http-errors 形状に限定する。
 */
function isHttpError(
  exception: unknown,
): exception is Error & { status: number } {
  if (!(exception instanceof Error)) return false;
  const candidate = exception as Error & {
    status?: unknown;
    expose?: unknown;
  };
  return (
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status < 600 &&
    typeof candidate.expose === 'boolean'
  );
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly cls: ClsService,
    private readonly logger: AppLoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    /* ---------- Request-ID をヘッダへ ---------- */
    const reqId = this.cls.get<string>(CLS_KEY_REQUEST_ID) ?? '';
    if (reqId) res.setHeader(REQUEST_ID_HEADER, reqId);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCode.INTERNAL_ERROR;
    let message = 'Internal server error';

    const logException = (
      eventName: string,
      error: unknown,
      statusOverride?: number,
    ) => {
      this.logger.error(eventName, 'ApiExceptionFilter', {
        method: req?.method,
        url: req?.url,
        statusCode: statusOverride ?? res?.statusCode,
        payload: maskSensitiveFields(req.body),
        error: error,
      });
    };

    // JSON パースエラーを詳細に処理
    if (
      exception instanceof SyntaxError &&
      exception.message.includes('JSON')
    ) {
      status = HttpStatus.BAD_REQUEST;
      code = ErrorCode.INVALID_REQUEST_BODY;
      message = `Invalid JSON format: ${exception.message}`;
      logException('JSONParseError', exception.stack, status);
    } else if (exception instanceof BadRequestException) {
      // バリデーションエラーの詳細メッセージを処理
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // ValidationPipe が投げるエラーの場合、詳細なメッセージ配列を取得
      if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
      ) {
        const responseObj = exceptionResponse as any;
        if (Array.isArray(responseObj.message)) {
          // バリデーションエラーメッセージの配列
          code = ErrorCode.VALIDATION_ERROR;
          message = responseObj.message.join(', ');
        } else {
          // 単一メッセージ
          code = ErrorCode.VALIDATION_ERROR;
          message = responseObj.message || exception.message;
        }
      } else {
        // 文字列レスポンスの場合
        code = ErrorCode.VALIDATION_ERROR;
        message =
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : exception.message;
      }
      logException(`ValidationError`, exception, status);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resObj = exceptionResponse as any;

        // ここで code を拾う
        if (
          typeof resObj.code === 'string' &&
          Object.values(ErrorCode).includes(resObj.code)
        ) {
          code = resObj.code as ErrorCode;
        } else {
          code = ErrorCode.INTERNAL_ERROR;
        }

        // message もできるだけレスポンスから
        if (typeof resObj.message === 'string') {
          message = resObj.message;
        } else {
          message = exception.message;
        }
      } else {
        // 文字列レスポンスなど
        code = ErrorCode.INTERNAL_ERROR;
        message =
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : exception.message;
      }

      logException(`HttpException`, exception.stack, status);
    } else if (isHttpError(exception)) {
      // #1194 body-parser / raw-body が投げる http-errors 系。
      // これらは **Nest のルータへ到達する前** に発生するため HttpException ではなく、
      // ここが無いと下の `instanceof Error` に落ちて «未処理例外 = 500» になる。
      //
      // 実害があった: フロントログのバッチが 100 kB（express の既定上限）を超えると
      // PayloadTooLargeError → 500 になり、クライアントは 5xx を «一時障害» と分類して
      // バッチごと破棄していた（実機で status=500 count=17 として観測）。
      // 413 を返せば「送り方が悪い」とクライアント側で正しく分類できる。
      status = exception.status;
      code =
        status === HttpStatus.PAYLOAD_TOO_LARGE
          ? ErrorCode.INVALID_REQUEST_BODY
          : ErrorCode.INTERNAL_ERROR;
      message = exception.message;
      logException('HttpError', exception.stack, status);
    } else if (exception instanceof Error) {
      message = exception.message;
      logException(`UnhandledException`, exception.stack, status);
    } else {
      logException('UnknownException', exception);
    }

    const body: BaseResponse<null> = {
      data: null,
      success: false,
      errorCode: code,
      message:
        status === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Internal server error'
          : message,
    };

    res.status(status).json(body);
  }
}
