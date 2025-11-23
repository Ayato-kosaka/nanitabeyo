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
  Scope,
  SetMetadata,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ClsService } from 'nestjs-cls';
import { Reflector } from '@nestjs/core';

import { BaseResponse } from '@shared/v1/res';
import { CLS_KEY_REQUEST_ID } from '../cls/cls.constants';
import { REQUEST_ID_HEADER } from '../request-id/request-id.constants';
import { AppLoggerService } from '../logger/logger.service';
import { maskSensitiveFields } from './response-wrap.utils';
import { CookieQueueService } from '../cookie-queue/cookie-queue.service';

/* -------------------------------------------------------------------------- */
/*                           Skip Decorator (Opt‐in)                           */
/* -------------------------------------------------------------------------- */
export const SKIP_WRAP_META_KEY = 'skipResponseWrap';
export const SkipResponseWrap = () => SetMetadata(SKIP_WRAP_META_KEY, true);

/* -------------------------------------------------------------------------- */
/*                              Interceptor 本体                               */
/* -------------------------------------------------------------------------- */
@Injectable({ scope: Scope.REQUEST })
export class ResponseWrapInterceptor implements NestInterceptor {
  constructor(
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
    private readonly logger: AppLoggerService,
    private readonly cookieQueue: CookieQueueService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    /* ――― 除外判定 ――― */
    const shouldSkip = this.reflector.getAllAndOverride<boolean>(
      SKIP_WRAP_META_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (shouldSkip) return next.handle();

    const http = ctx.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const startedAt = Date.now();

    return next.handle().pipe(
      map((payload) => {
        /* ---------- Request-ID をヘッダへ ---------- */
        const reqId = this.cls.get<string>(CLS_KEY_REQUEST_ID) ?? '';
        if (reqId) res.setHeader(REQUEST_ID_HEADER, reqId);

        /* ---------- Cookie Queue を flush ---------- */
        // #427 【設計】キュー済みクッキーを Set-Cookie ヘッダに反映
        try {
          const queuedCookies = this.cookieQueue.getAll();
          if (queuedCookies.length > 0) {
            res.setHeader('Set-Cookie', queuedCookies);
          }
        } catch (err) {
          // CookieQueueService が利用できない場合はスキップ（後方互換性）
          this.logger.warn(
            'CookieQueueServiceNotAvailable',
            'ResponseWrapInterceptor',
            {
              message:
                'CookieQueueService not available, skipping cookie flush.',
            },
          );
        }

        /* ---------- 多重ラップチェック ---------- */
        const alreadyWrapped =
          payload &&
          typeof payload === 'object' &&
          'success' in payload &&
          'errorCode' in payload;

        /* ---------- バックエンドイベントログ（成功パス） ---------- */
        const t0 = req._t0 ?? startedAt;
        const tBodyEnd = req._tBodyEnd ?? startedAt;
        const queue_ms = startedAt - t0; // ハンドラに入るまで（ボディ受信＋前段）
        const upload_ms = Math.max(0, tBodyEnd - t0); // ボディ受信完了まで
        const app_ms = Date.now() - startedAt; // ハンドラ処理時間
        const total_ms = Date.now() - t0; // ヘッダ受信からレスポンス送出まで

        // Build and send backend event log (success path)
        try {
          const reqPayload = maskSensitiveFields(req.body);
          const resPayload = maskSensitiveFields(payload);
          const info = {
            method: req?.method,
            url: req?.originalUrl ?? req?.url,
            statusCode: res?.statusCode,
            reqPayload,
            resPayload,
            wrapped: !alreadyWrapped,
            queue_ms,
            upload_ms,
            app_ms,
            total_ms,
            handler: ctx.getHandler()?.name,
            controller: ctx.getClass()?.name,
          };
          this.logger.log('response_success', 'ResponseWrapInterceptor', info);
        } catch {
          // avoid throwing from interceptor if logging fails
        }

        if (alreadyWrapped) return payload;

        /* ---------- 正常レスポンス用ラッパ ---------- */
        const body: BaseResponse<unknown> = {
          data: payload,
          success: true,
        };
        return body;
      }),
    );
  }
}
