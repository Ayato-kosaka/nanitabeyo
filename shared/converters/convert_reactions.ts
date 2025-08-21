import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaReactions = Omit<Prisma.ReactionsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseReactions = TableRow<'reactions'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_Reactions(supabase: SupabaseReactions): PrismaReactions {
  return {
    id: supabase.id,
    user_id: supabase.user_id,
    target_type: supabase.target_type,
    target_id: supabase.target_id,
    action_type: supabase.action_type,
    meta: supabase.meta,
    created_at: new Date(supabase.created_at),
    created_version: supabase.created_version,
    lock_no: supabase.lock_no,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_Reactions(prisma: PrismaReactions): SupabaseReactions {
  return {
    id: prisma.id,
    user_id: prisma.user_id,
    target_type: prisma.target_type,
    target_id: prisma.target_id,
    action_type: prisma.action_type,
    meta: prisma.meta,
    created_at: prisma.created_at?.toISOString() ?? null,
    created_version: prisma.created_version,
    lock_no: prisma.lock_no,
  };
}
