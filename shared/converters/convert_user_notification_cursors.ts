import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaUserNotificationCursors = Omit<Prisma.User_notification_cursorsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseUserNotificationCursors = TableRow<'user_notification_cursors'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_UserNotificationCursors(supabase: SupabaseUserNotificationCursors): PrismaUserNotificationCursors {
  return {
    user_id: supabase.user_id,
    last_read_at: new Date(supabase.last_read_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_UserNotificationCursors(prisma: PrismaUserNotificationCursors): SupabaseUserNotificationCursors {
  return {
    user_id: prisma.user_id,
    last_read_at: prisma.last_read_at?.toISOString() ?? null,
  };
}
