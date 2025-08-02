import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaBackendEventLogs = Omit<Prisma.Backend_event_logsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseBackendEventLogs = TableRow<'backend_event_logs'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_BackendEventLogs(supabase: SupabaseBackendEventLogs): PrismaBackendEventLogs {
  return {
    id: supabase.id,
    event_name: supabase.event_name,
    error_level: supabase.error_level,
    function_name: supabase.function_name,
    user_id: supabase.user_id,
    payload: supabase.payload,
    request_id: supabase.request_id,
    created_at: new Date(supabase.created_at),
    created_commit_id: supabase.created_commit_id,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_BackendEventLogs(prisma: PrismaBackendEventLogs): SupabaseBackendEventLogs {
  return {
    id: prisma.id,
    event_name: prisma.event_name,
    error_level: prisma.error_level,
    function_name: prisma.function_name,
    user_id: prisma.user_id,
    payload: prisma.payload,
    request_id: prisma.request_id,
    created_at: prisma.created_at?.toISOString() ?? null,
    created_commit_id: prisma.created_commit_id,
  };
}
