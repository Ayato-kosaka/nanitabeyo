import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishMedia = Omit<Prisma.Dish_mediaGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishMedia = TableRow<'dish_media'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishMedia(supabase: SupabaseDishMedia): PrismaDishMedia {
  return {
    id: supabase.id,
    dish_id: supabase.dish_id,
    user_id: supabase.user_id,
    media_path: supabase.media_path,
    media_type: supabase.media_type,
    thumbnail_path: supabase.thumbnail_path,
    created_at: new Date(supabase.created_at),
    updated_at: new Date(supabase.updated_at),
    lock_no: supabase.lock_no,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishMedia(prisma: PrismaDishMedia): SupabaseDishMedia {
  return {
    id: prisma.id,
    dish_id: prisma.dish_id,
    user_id: prisma.user_id,
    media_path: prisma.media_path,
    media_type: prisma.media_type,
    thumbnail_path: prisma.thumbnail_path,
    created_at: prisma.created_at?.toISOString() ?? null,
    updated_at: prisma.updated_at?.toISOString() ?? null,
    lock_no: prisma.lock_no,
  };
}
