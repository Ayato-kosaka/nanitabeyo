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
