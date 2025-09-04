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

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly cls: ClsService,
    private readonly logger: AppLoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    /* ---------- Request-ID をヘッダへ ---------- */
    const reqId = this.cls.get<string>(CLS_KEY_REQUEST_ID) ?? '';
    if (reqId) res.setHeader(REQUEST_ID_HEADER, reqId);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCode.INTERNAL_ERROR;
    let message = 'Internal server error';

    // JSON パースエラーを詳細に処理
    if (
      exception instanceof SyntaxError &&
      exception.message.includes('JSON')
    ) {
      status = HttpStatus.BAD_REQUEST;
      code = ErrorCode.INVALID_REQUEST_BODY;
      message = `Invalid JSON format: ${exception.message}`;
      this.logger.error(
        'JSONParseError',
        'ApiExceptionFilter',
        exception.stack,
      );
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
      this.logger.error(`ValidationError`, 'ApiExceptionFilter', exception);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const msg = exception.message as ErrorCode;
      code = Object.values(ErrorCode).includes(msg as ErrorCode)
        ? msg
        : ErrorCode.INTERNAL_ERROR;
      message = exception.message;
      this.logger.error(`HttpException`, 'ApiExceptionFilter', exception.stack);
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(
        `UnhandledException`,
        'ApiExceptionFilter',
        exception.stack,
      );
    } else {
      this.logger.error('UnknownException:', 'ApiExceptionFilter', exception);
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
