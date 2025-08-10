import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishReviews = Omit<Prisma.Dish_reviewsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishReviews = TableRow<'dish_reviews'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishReviews(supabase: SupabaseDishReviews): PrismaDishReviews {
  return {
    id: supabase.id,
    dish_id: supabase.dish_id,
    comment: supabase.comment,

    original_language_code: supabase.original_language_code,
    user_id: supabase.user_id,
    rating: supabase.rating,
    price_cents: supabase.price_cents,
    currency_code: supabase.currency_code,
    created_dish_media_id: supabase.created_dish_media_id,
    imported_user_name: supabase.imported_user_name,
    imported_user_avatar: supabase.imported_user_avatar,
    created_at: new Date(supabase.created_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishReviews(prisma: PrismaDishReviews): SupabaseDishReviews {
  return {
    id: prisma.id,
    dish_id: prisma.dish_id,
    comment: prisma.comment,
    comment_tsv: null,
    original_language_code: prisma.original_language_code,
    user_id: prisma.user_id,
    rating: prisma.rating,
    price_cents: prisma.price_cents,
    currency_code: prisma.currency_code,
    created_dish_media_id: prisma.created_dish_media_id,
    imported_user_name: prisma.imported_user_name,
    imported_user_avatar: prisma.imported_user_avatar,
    created_at: prisma.created_at?.toISOString() ?? null,
  };
}
