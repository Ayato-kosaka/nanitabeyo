import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaNotificationRecipients = Omit<Prisma.Notification_recipientsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseNotificationRecipients = TableRow<'notification_recipients'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_NotificationRecipients(supabase: SupabaseNotificationRecipients): PrismaNotificationRecipients {
  return {
    notification_id: supabase.notification_id,
    recipient_id: supabase.recipient_id,
    thread_updated_at: new Date(supabase.thread_updated_at),
    created_at: new Date(supabase.created_at),
    // #1599 どの actor まで Push 済みか。Cloud Tasks の at-least-once による
    // 二重 Push を防ぐための列で、NULL 許容。
    last_pushed_actor_id: supabase.last_pushed_actor_id,
    last_pushed_at: supabase.last_pushed_at !== null ? new Date(supabase.last_pushed_at) : null,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_NotificationRecipients(prisma: PrismaNotificationRecipients): SupabaseNotificationRecipients {
  return {
    notification_id: prisma.notification_id,
    recipient_id: prisma.recipient_id,
    thread_updated_at: prisma.thread_updated_at?.toISOString() ?? null,
    created_at: prisma.created_at?.toISOString() ?? null,
    last_pushed_actor_id: prisma.last_pushed_actor_id,
    last_pushed_at: prisma.last_pushed_at?.toISOString() ?? null,
  };
}
