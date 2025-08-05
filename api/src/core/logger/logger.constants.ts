import { backend_event_logs_error_level } from '../../../../shared/prisma';

/**
 * 共通で使う LogLevel。Nest のデフォルトと揃えておく
 */
export const LogLevel = backend_event_logs_error_level;
export type LogLevel = backend_event_logs_error_level;

/** console 出力を抑制する最小レベル（env.LOG_LEVEL） */
export const DEFAULT_LOG_LEVEL: LogLevel = LogLevel.log;
