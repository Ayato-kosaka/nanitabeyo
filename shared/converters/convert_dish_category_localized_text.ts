import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishCategoryLocalizedText = Omit<Prisma.Dish_category_localized_textGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishCategoryLocalizedText = TableRow<'dish_category_localized_text'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishCategoryLocalizedText(supabase: SupabaseDishCategoryLocalizedText): PrismaDishCategoryLocalizedText {
  return {
    dish_category_id: supabase.dish_category_id,
    locale: supabase.locale,
    topic_title: supabase.topic_title,
    tagline: supabase.tagline,
    synced_at: new Date(supabase.synced_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishCategoryLocalizedText(prisma: PrismaDishCategoryLocalizedText): SupabaseDishCategoryLocalizedText {
  return {
    dish_category_id: prisma.dish_category_id,
    locale: prisma.locale,
    topic_title: prisma.topic_title,
    tagline: prisma.tagline,
    synced_at: prisma.synced_at?.toISOString() ?? null,
  };
}
