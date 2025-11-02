import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaNotifications = Omit<Prisma.NotificationsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseNotifications = TableRow<'notifications'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_Notifications(supabase: SupabaseNotifications): PrismaNotifications {
  return {
    id: supabase.id,
    action_type: supabase.action_type,
    target_table: supabase.target_table,
    target_id: supabase.target_id,
    actor_ids: supabase.actor_ids,
    idempotency_key: supabase.idempotency_key,
    created_at: new Date(supabase.created_at),
    updated_at: new Date(supabase.updated_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_Notifications(prisma: PrismaNotifications): SupabaseNotifications {
  return {
    id: prisma.id,
    action_type: prisma.action_type,
    target_table: prisma.target_table,
    target_id: prisma.target_id,
    actor_ids: prisma.actor_ids,
    idempotency_key: prisma.idempotency_key,
    created_at: prisma.created_at?.toISOString() ?? null,
    updated_at: prisma.updated_at?.toISOString() ?? null,
  };
}
