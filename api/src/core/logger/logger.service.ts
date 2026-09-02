import {
  Injectable,
  LoggerService as INestLoggerService,
  Scope,
} from '@nestjs/common';
import { LogLevel } from './logger.constants';
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
/**
 * #1599 ログへ残す外部 API のエンドポイントから、**クエリ文字列とフラグメントを落とす**。
 *
 * 認証情報（`?key=`、`?token=`）も、ユーザー由来の値（`?latlng=`、`?q=`）も、
 * まとめてクエリに乗る。個別のキー名を列挙して弾く方式は、
 * **新しいキー名が増えたときに黙って漏れる**ので採らない。丸ごと落とす。
 *
 * どの API を叩いたかは `api_name` と `pathname` で十分に分かる。
 * パラメータの中身が要るなら `request_payload`（マスキング付き）を見る。
 */
export function sanitizeEndpointForLog(endpoint: string): string {
  if (typeof endpoint !== 'string' || endpoint.length === 0) return '';

  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`;
  } catch {
    // URL として解釈できない文字列でも、`?` 以降は落としておく（保険）
    const queryIndex = endpoint.indexOf('?');
    return queryIndex === -1 ? endpoint : endpoint.slice(0, queryIndex);
  }
}

@Injectable({ scope: Scope.DEFAULT })
export class AppLoggerService implements INestLoggerService {
  constructor(private readonly cls: ClsService) {}

  /* ------------------------------------------------------------------ */
  /*                  Nest LoggerService 実装 (console)                 */
  /* ------------------------------------------------------------------ */
  verbose(
    eventName: CreateBackendEventInput['event_name'],
    functionName: CreateBackendEventInput['function_name'],
    payload: CreateBackendEventInput['payload'],
  ) {
    this.logBackendEvent({
      error_level: LogLevel.verbose,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }
  debug(
    eventName: CreateBackendEventInput['event_name'],
    functionName: CreateBackendEventInput['function_name'],
    payload: CreateBackendEventInput['payload'],
  ) {
    this.logBackendEvent({
      error_level: LogLevel.debug,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }
  log(
    eventName: CreateBackendEventInput['event_name'],
    functionName: CreateBackendEventInput['function_name'],
    payload: CreateBackendEventInput['payload'],
  ) {
    this.logBackendEvent({
      error_level: LogLevel.log,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }
  warn(
    eventName: CreateBackendEventInput['event_name'],
    functionName: CreateBackendEventInput['function_name'],
    payload: CreateBackendEventInput['payload'],
  ) {
    this.logBackendEvent({
      error_level: LogLevel.warn,
      payload,
      event_name: eventName,
      function_name: functionName,
    });
  }
  error(
    eventName: CreateBackendEventInput['event_name'],
    functionName: CreateBackendEventInput['function_name'],
    payload: CreateBackendEventInput['payload'],
  ) {
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
        // #1599 **クエリ文字列は落としてから記録する。**
        // 呼び出し側が `?key=<APIキー>` を含む URL をそのまま渡していたため、
        // Google の API キーと、逆ジオコーディングの `latlng=`（ユーザーの現在地）が
        // `external_api_logs` へ入っていた。ログは BigQuery へ蓄積され、
        // error-triage 経由で **公開リポジトリの Issue へも転載される**。
        //
        // ここ（唯一の出口）で落とすことで、呼び出し側が何を渡しても漏れない。
        // `safe-fetch.service.ts` も同じ方針で origin + pathname だけを渡している。
        endpoint: sanitizeEndpointForLog(input.endpoint),
        method: input.method,
        request_payload: this.convertToBigQueryRecord(input.request_payload),
        response_payload: this.convertToBigQueryRecord(input.response_payload),
        status_code: input.status_code,
        error_message: input.error_message ?? null,
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
        payload: this.convertToBigQueryRecord(input.payload),
        error_level: input.error_level,
        // `created_at` is the event-occurrence time; Cloud Logging's timestamp
        // is only the ingestion time and can lag when the client batches logs.
        created_at: input.created_at,
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
        payload: this.convertToBigQueryRecord(input.payload),
        request_id: this.cls.get<string>(CLS_KEY_REQUEST_ID),
        created_commit_id: env.API_COMMIT_ID,
      }),
    );
  }

  /**
   * BigQuery に安全に書き込める形に変換するユーティリティ
   *
   * 目的:
   * - ルートが配列だった場合はラップして配列が直接 root にならないようにする
   * - プリミティブは { value: ... } のようにラップする
   * - オブジェクトは再帰的に処理して、そのままオブジェクト構造を保持する
   * - undefined はそのまま undefined を返してフィールド省略できるようにする
   *
   * 注意:
   * - BigQuery 側のテーブルスキーマがこの変換後の形を受け取れることを事前に確認してください。
   * - 深い入れ子や循環参照がある場合は追加の対処が必要です（現在は循環参照は未サポート）。
   */
  private convertToBigQueryRecord(obj: unknown): unknown {
    if (obj === undefined) return undefined;
    if (obj === null) return null;

    // 配列はラップして root が配列にならないようにする
    if (Array.isArray(obj)) {
      // 要素も再帰的に変換した方が安全だが、要素がプリミティブの場合はそのままでも良い
      return JSON.stringify({ array_values: obj });
    }

    // ルートがオブジェクトなら浅いサニタイズのみ行う（再帰しない）
    if (typeof obj === 'object') {
      const out: { [k: string]: any } = {};
      for (const [k, v] of Object.entries(obj as Record<string, any>)) {
        // undefined は省略（BigQuery に書きたくない）
        if (v === undefined) continue;
        // 関数やシンボルは無視
        if (typeof v === 'function' || typeof v === 'symbol') continue;
        // ネストはそのまま渡す（パフォーマンス重視のため再帰はしない）
        out[k] = v;
      }
      return JSON.stringify(out);
    }

    // プリミティブはラップして型の曖昧さを避ける
    return JSON.stringify({ value: obj });
  }
}
