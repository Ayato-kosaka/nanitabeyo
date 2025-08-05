import { Injectable } from '@nestjs/common';
import fetch, { Headers } from 'node-fetch';
// Using the built-in AbortController

import { AppLoggerService } from '../logger/logger.service';
import {
    DEFAULT_TIMEOUT_MS,
    DEFAULT_MAX_RETRIES,
    RETRY_BACKOFF_MS,
} from './http.constants';
import { HttpRequestOptions, HttpResponse } from './http.types';

@Injectable()
export class HttpService {
    constructor(private readonly logger: AppLoggerService) { }

    /* ------------------------------------------------------------------ */
    /*           callExternalApi — 外部 REST 呼び出しの共通窓口            */
    /* ------------------------------------------------------------------ */
    async callExternalApi<T = any>(
        functionName: string,
        apiName: string,
        opts: HttpRequestOptions,
    ): Promise<HttpResponse<T>> {
        const {
            url,
            timeoutMs = DEFAULT_TIMEOUT_MS,
            retries = DEFAULT_MAX_RETRIES,
            ...fetchInit
        } = opts;

        let lastError: Error | undefined;
        const startedAt = Date.now();

        for (let attempt = 0; attempt <= retries; attempt++) {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const res = await fetch(url, {
                    ...fetchInit,
                    headers: new Headers(fetchInit.headers),
                    signal: controller.signal as AbortSignal,
                });
                clearTimeout(id);

                const text = await res.text(); // raw
                const isJson = res.headers
                    .get('content-type')
                    ?.includes('application/json');
                const body = (isJson ? JSON.parse(text) : text) as T;

                // ログ永続化
                await this.logger.externalApi({
                    method: fetchInit.method ?? null,
                    function_name: functionName,
                    api_name: apiName,
                    endpoint: url,
                    status_code: res.status,
                    response_time_ms: Date.now() - startedAt,
                    request_payload: fetchInit.body as any,
                    response_payload: body as any,
                    error_message: null,
                });

                return {
                    status: res.status,
                    headers: Object.fromEntries(res.headers.entries()),
                    body,
                };
            } catch (err) {
                lastError = err as Error;

                // Abort or network error → リトライ
                if (attempt < retries) {
                    await this.delay(RETRY_BACKOFF_MS * (attempt + 1));
                    continue;
                }

                // ログに失敗記録
                await this.logger.externalApi({
                    function_name: functionName,
                    api_name: apiName,
                    endpoint: url,
                    method: fetchInit.method ?? null,
                    response_time_ms: Date.now() - startedAt,
                    request_payload: fetchInit.body as any,
                    status_code: 0,
                    response_payload: null as any,
                    error_message: lastError.message,
                });
                throw lastError;
            }
        }
        /* ここには到達しないが TS 的に必要 */
        throw lastError!;
    }

    /* ---------------------------- private ----------------------------- */
    private delay(ms: number) {
        return new Promise((r) => setTimeout(r, ms));
    }
}
