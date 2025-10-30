import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishMediaImpressions = Omit<Prisma.Dish_media_impressionsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishMediaImpressions = TableRow<'dish_media_impressions'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishMediaImpressions(supabase: SupabaseDishMediaImpressions): PrismaDishMediaImpressions {
  return {
    id: supabase.id,
    dish_media_id: supabase.dish_media_id,
    user_id: supabase.user_id,
    session_id: supabase.session_id,
    source: supabase.source,
    created_at: new Date(supabase.created_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishMediaImpressions(prisma: PrismaDishMediaImpressions): SupabaseDishMediaImpressions {
  return {
    id: prisma.id,
    dish_media_id: prisma.dish_media_id,
    user_id: prisma.user_id,
    session_id: prisma.session_id,
    source: prisma.source,
    created_at: prisma.created_at?.toISOString() ?? null,
  };
}
