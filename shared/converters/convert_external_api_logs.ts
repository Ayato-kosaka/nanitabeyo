import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaExternalApiLogs = Omit<Prisma.External_api_logsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseExternalApiLogs = TableRow<'external_api_logs'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_ExternalApiLogs(supabase: SupabaseExternalApiLogs): PrismaExternalApiLogs {
  return {
    id: supabase.id,
    request_id: supabase.request_id,
    function_name: supabase.function_name,
    api_name: supabase.api_name,
    endpoint: supabase.endpoint,
    request_payload: supabase.request_payload,
    response_payload: supabase.response_payload,
    status_code: supabase.status_code,
    error_message: supabase.error_message,
    response_time_ms: supabase.response_time_ms,
    user_id: supabase.user_id,
    created_at: new Date(supabase.created_at),
    created_commit_id: supabase.created_commit_id,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_ExternalApiLogs(prisma: PrismaExternalApiLogs): SupabaseExternalApiLogs {
  return {
    id: prisma.id,
    request_id: prisma.request_id,
    function_name: prisma.function_name,
    api_name: prisma.api_name,
    endpoint: prisma.endpoint,
    request_payload: prisma.request_payload,
    response_payload: prisma.response_payload,
    status_code: prisma.status_code,
    error_message: prisma.error_message,
    response_time_ms: prisma.response_time_ms,
    user_id: prisma.user_id,
    created_at: prisma.created_at?.toISOString() ?? null,
    created_commit_id: prisma.created_commit_id,
  };
}
