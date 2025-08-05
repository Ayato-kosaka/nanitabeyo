// api/src/core/interceptors/response-wrap.interceptor.ts
//
// 成功レスポンスを <BaseResponse<T>> に整形し、
// 併せて `X-Request-Id` を **レスポンスヘッダ** へ付与するグローバル Interceptor
//
// ■ 特徴
// ──────────────────────────────────────────────
// 1. `@SkipResponseWrap()` で個別除外（画像ストリーム等）
// 2. CLS から requestId を取得してヘッダにセット
// 3. 既に JSON ラッパが適用済み・ネスト済みの多重ラップを自動判定
//

import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
    SetMetadata,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ClsService } from 'nestjs-cls';
import { Reflector } from '@nestjs/core';

import { BaseResponse } from '@shared/v1/res';
import {
    CLS_KEY_REQUEST_ID,
} from '../cls/cls.constants';
import { REQUEST_ID_HEADER } from '../request-id/request-id.constants';

/* -------------------------------------------------------------------------- */
/*                           Skip Decorator (Opt‐in)                           */
/* -------------------------------------------------------------------------- */
export const SKIP_WRAP_META_KEY = 'skipResponseWrap';
export const SkipResponseWrap = () => SetMetadata(SKIP_WRAP_META_KEY, true);

/* -------------------------------------------------------------------------- */
/*                              Interceptor 本体                               */
/* -------------------------------------------------------------------------- */
@Injectable()
export class ResponseWrapInterceptor implements NestInterceptor {
    constructor(
        private readonly cls: ClsService,
        private readonly reflector: Reflector,
    ) { }

    intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
        /* ――― 除外判定 ――― */
        const shouldSkip = this.reflector.getAllAndOverride<boolean>(
            SKIP_WRAP_META_KEY,
            [ctx.getHandler(), ctx.getClass()],
        );
        if (shouldSkip) return next.handle();

        const res = ctx.switchToHttp().getResponse();

        return next.handle().pipe(
            map((payload) => {
                /* ---------- Request-ID をヘッダへ ---------- */
                const reqId = this.cls.get<string>(CLS_KEY_REQUEST_ID) ?? '';
                if (reqId) res.setHeader(REQUEST_ID_HEADER, reqId);

                /* ---------- 多重ラップチェック ---------- */
                const alreadyWrapped =
                    payload &&
                    typeof payload === 'object' &&
                    'success' in payload &&
                    'errorCode' in payload;

                if (alreadyWrapped) return payload;

                /* ---------- 正常レスポンス用ラッパ ---------- */
                const body: BaseResponse<unknown> = {
                    data: payload,
                    success: true,
                    errorCode: null,
                };
                return body;
            }),
        );
    }
}
