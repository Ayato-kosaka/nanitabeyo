import {
  Injectable,
  LoggerService as INestLoggerService,
  Scope,
} from '@nestjs/common';
import { LogLevel, DEFAULT_LOG_LEVEL } from './logger.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { ClsService } from 'nestjs-cls';
import { CLS_KEY_REQUEST_ID, CLS_KEY_USER_ID } from '../cls/cls.constants';
import {
  CreateBackendEventInput,
  CreateExternalApiInput,
} from './logger.types';

/**
 * AppLoggerService
 *  - Nest LoggerService を実装
 *  - console 出力 + Prisma DB へ永続化
 */
@Injectable({ scope: Scope.DEFAULT })
export class AppLoggerService implements INestLoggerService {
  /** 環境ごとの最小レベル */
  private readonly minLevel = DEFAULT_LOG_LEVEL as LogLevel;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) { }

  /* ------------------------------------------------------------------ */
  /*                  Nest LoggerService 実装 (console)                 */
  /* ------------------------------------------------------------------ */
  verbose(eventName, functionName, payload: any) {
    if (this.shouldPrint(LogLevel.verbose))
      this.printStructured('DEBUG', eventName, functionName, payload);
    this.persistBackendEvent({
      error_level: LogLevel.verbose,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }
  debug(eventName, functionName, payload: any) {
    if (this.shouldPrint(LogLevel.debug))
      this.printStructured('DEBUG', eventName, functionName, payload);
    this.persistBackendEvent({
      error_level: LogLevel.debug,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }
  log(eventName, functionName, payload: any) {
    if (this.shouldPrint(LogLevel.log))
      this.printStructured('INFO', eventName, functionName, payload);
    this.persistBackendEvent({
      error_level: LogLevel.log,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }
  warn(eventName, functionName, payload: any) {
    if (this.shouldPrint(LogLevel.warn))
      this.printStructured('WARNING', eventName, functionName, payload);
    this.persistBackendEvent({
      error_level: LogLevel.warn,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }
  error(eventName, functionName, payload: any) {
    if (this.shouldPrint(LogLevel.error))
      this.printStructured('ERROR', eventName, functionName, payload);
    this.persistBackendEvent({
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
    try {
      await this.prisma.prisma.external_api_logs.create({
        data: {
          ...input,
          response_payload: input.response_payload ?? undefined,
          id: randomUUID(),
          user_id: this.cls.get<string>(CLS_KEY_USER_ID),
          request_id: this.cls.get<string>(CLS_KEY_REQUEST_ID),
          created_at: new Date(),
          created_commit_id: env.API_COMMIT_ID,
        },
      });
      // Cloud Run 構造化ログ
      this.printStructured('INFO', 'externalApi', input.function_name, {
        api_name: input.api_name,
        endpoint: input.endpoint,
        method: input.method,
        status_code: input.status_code,
        response_time_ms: input.response_time_ms,
      });
    } catch (err) {
      /* console にだけ出す（循環ロギングを避ける）*/
      this.printStructured('ERROR', 'externalApiPersistError', input.function_name, {
        message: (err as Error).message,
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*                           private helpers                          */
  /* ------------------------------------------------------------------ */
  private async persistBackendEvent(input: CreateBackendEventInput) {
    try {
      await this.prisma.prisma.backend_event_logs.create({
        data: {
          ...input,
          id: randomUUID(),
          user_id: this.cls.get<string>(CLS_KEY_USER_ID),
          request_id: this.cls.get<string>(CLS_KEY_REQUEST_ID),
          created_at: new Date(),
          created_commit_id: env.API_COMMIT_ID,
        },
      });
    } catch (err) {
      this.printStructured('ERROR', 'backendEventPersistError', input.function_name, {
        message: (err as Error).message,
      });
    }
  }

  /** Cloud Run で見やすい構造化ログを stdout に出力 */
  private printStructured(
    severity: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR',
    eventName: string,
    functionName: string,
    payload: any,
  ) {
    const entry = {
      severity,
      type: 'app',
      event_name: eventName,
      function_name: functionName,
      request_id: this.cls.get<string>(CLS_KEY_REQUEST_ID),
      user_id: this.cls.get<string>(CLS_KEY_USER_ID),
      payload,
      timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify(entry));
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
