import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaUserSeenDishMedia = Omit<Prisma.User_seen_dish_mediaGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseUserSeenDishMedia = TableRow<'user_seen_dish_media'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_UserSeenDishMedia(supabase: SupabaseUserSeenDishMedia): PrismaUserSeenDishMedia {
  return {
    id: supabase.id,
    dish_media_id: supabase.dish_media_id,
    user_id: supabase.user_id,
    created_at: new Date(supabase.created_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_UserSeenDishMedia(prisma: PrismaUserSeenDishMedia): SupabaseUserSeenDishMedia {
  return {
    id: prisma.id,
    dish_media_id: prisma.dish_media_id,
    user_id: prisma.user_id,
    created_at: prisma.created_at?.toISOString() ?? null,
  };
}
