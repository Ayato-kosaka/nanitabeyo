import {
  Injectable,
  LoggerService as INestLoggerService,
  Scope,
} from '@nestjs/common';
import { LogLevel, DEFAULT_LOG_LEVEL } from './logger.constants';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { ClsService } from 'nestjs-cls';
import { CLS_KEY_REQUEST_ID, CLS_KEY_USER_ID } from '../cls/cls.constants';
import {
  CreateBackendEventInput,
  CreateExternalApiInput,
  CreateFrontendEventInput,
} from './logger.types';

/**
 * AppLoggerService
 *  - Nest LoggerService を実装
 *  - Cloud Logging 向けの構造化 JSON を stdout に出力
 */
@Injectable({ scope: Scope.DEFAULT })
export class AppLoggerService implements INestLoggerService {
  /** 環境ごとの最小レベル */
  private readonly minLevel = DEFAULT_LOG_LEVEL;

  constructor(private readonly cls: ClsService) {}

  /* ------------------------------------------------------------------ */
  /*                  Nest LoggerService 実装 (console)                 */
  /* ------------------------------------------------------------------ */
  verbose(eventName, functionName, payload: any) {
    this.logBackendEvent({
      error_level: LogLevel.verbose,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }
  debug(eventName, functionName, payload: any) {
    this.logBackendEvent({
      error_level: LogLevel.debug,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }
  log(eventName, functionName, payload: any) {
    this.logBackendEvent({
      error_level: LogLevel.log,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }
  warn(eventName, functionName, payload: any) {
    this.logBackendEvent({
      error_level: LogLevel.warn,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }
  error(eventName, functionName, payload: any) {
    this.logBackendEvent({
      error_level: LogLevel.error,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }

  /* ------------------------------------------------------------------ */
  /*            外部 API コールを詳細に残すための専用メソッド           */
  /* ------------------------------------------------------------------ */
  async externalApi(input: CreateExternalApiInput) {
    // #487 【設計】Cloud Logging 向けの構造化 JSON を stdout に出力
    console.log(
      JSON.stringify({
        log_type: 'external_api_logs',
        id: randomUUID(),
        request_id: this.cls.get<string>(CLS_KEY_REQUEST_ID),
        function_name: input.function_name,
        api_name: input.api_name,
        endpoint: input.endpoint,
        method: input.method,
        request_payload: input.request_payload,
        response_payload: input.response_payload ?? undefined,
        status_code: input.status_code,
        error_message: input.error_message ?? undefined,
        response_time_ms: input.response_time_ms,
        user_id: this.cls.get<string>(CLS_KEY_USER_ID),
        created_commit_id: env.API_COMMIT_ID,
      }),
    );
  }

  /* ------------------------------------------------------------------ */
  /*                   フロントエンドログ出力メソッド                    */
  /* ------------------------------------------------------------------ */
  /**
   * フロントエンドログを Cloud Logging 向けの構造化 JSON で出力
   * @param input フロントエンドログ入力
   */
  async logFrontendEvent(input: CreateFrontendEventInput) {
    // #487 【設計】Cloud Logging 向けの構造化 JSON を stdout に出力
    console.log(
      JSON.stringify({
        log_type: 'frontend_event_logs',
        id: input.id,
        event_name: input.event_name,
        user_id: input.user_id,
        path_name: input.path_name,
        payload: input.payload,
        error_level: input.error_level,
        created_app_version: input.created_app_version,
        created_commit_id: input.created_commit_id,
      }),
    );
  }

  /* ------------------------------------------------------------------ */
  /*                           private helpers                          */
  /* ------------------------------------------------------------------ */
  /**
   * バックエンドイベントログを Cloud Logging 向けの構造化 JSON で出力
   * @param input バックエンドイベントログ入力
   */
  private logBackendEvent(input: CreateBackendEventInput) {
    // #487 【設計】Cloud Logging 向けの構造化 JSON を stdout に出力
    console.log(
      JSON.stringify({
        log_type: 'backend_event_logs',
        id: randomUUID(),
        event_name: input.event_name,
        error_level: input.error_level,
        function_name: input.function_name,
        user_id: this.cls.get<string>(CLS_KEY_USER_ID),
        payload: input.payload,
        request_id: this.cls.get<string>(CLS_KEY_REQUEST_ID),
        created_commit_id: env.API_COMMIT_ID,
      }),
    );
  }

  /** #487 【パフォーマンス】printStructured を無効化（ログ量削減） */
  private printStructured(
    severity: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR',
    eventName: string,
    functionName: string,
    payload: any,
  ) {
    // no-op
  }

  /** console へ出力すべきか判定 */
  private shouldPrint(level: LogLevel): boolean {
    const order: LogLevel[] = [
      LogLevel.verbose,
      LogLevel.debug,
      LogLevel.log,
      LogLevel.warn,
      LogLevel.error,
    ];
    return order.indexOf(level) >= order.indexOf(this.minLevel);
  }
}
