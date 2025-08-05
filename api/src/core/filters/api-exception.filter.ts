// core/filters/api-exception.filter.ts
import {
    ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ErrorCode, BaseResponse } from '@shared/v1/res';
import { ClsService } from 'nestjs-cls';
import { CLS_KEY_REQUEST_ID } from '../cls/cls.constants';
import { REQUEST_ID_HEADER } from '../request-id/request-id.constants';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
    constructor(private readonly cls: ClsService) { }

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const res = ctx.getResponse<Response>();

        /* ---------- Request-ID をヘッダへ ---------- */
        const reqId = this.cls.get<string>(CLS_KEY_REQUEST_ID) ?? '';
        if (reqId) res.setHeader(REQUEST_ID_HEADER, reqId);

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let code: ErrorCode = ErrorCode.INTERNAL_ERROR;

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const msg = exception.message as ErrorCode;
            code = Object.values(ErrorCode).includes(msg as ErrorCode)
                ? msg
                : ErrorCode.INTERNAL_ERROR;
        }

        const body: BaseResponse<null> = {
            data: null,
            success: false,
            errorCode: code,
        };

        res.status(status).json(body);
    }
}
