import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaFrontendEventLogs = Omit<Prisma.Frontend_event_logsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseFrontendEventLogs = TableRow<'frontend_event_logs'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_FrontendEventLogs(supabase: SupabaseFrontendEventLogs): PrismaFrontendEventLogs {
  return {
    id: supabase.id,
    user_id: supabase.user_id,
    event_name: supabase.event_name,
    error_level: supabase.error_level,
    path_name: supabase.path_name,
    payload: supabase.payload,
    created_at: new Date(supabase.created_at),
    created_app_version: supabase.created_app_version,
    created_commit_id: supabase.created_commit_id,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_FrontendEventLogs(prisma: PrismaFrontendEventLogs): SupabaseFrontendEventLogs {
  return {
    id: prisma.id,
    user_id: prisma.user_id,
    event_name: prisma.event_name,
    error_level: prisma.error_level,
    path_name: prisma.path_name,
    payload: prisma.payload,
    created_at: prisma.created_at?.toISOString() ?? null,
    created_app_version: prisma.created_app_version,
    created_commit_id: prisma.created_commit_id,
  };
}
