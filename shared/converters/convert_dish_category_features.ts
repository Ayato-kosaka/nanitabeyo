import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishCategoryFeatures = Omit<Prisma.Dish_category_featuresGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishCategoryFeatures = TableRow<'dish_category_features'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishCategoryFeatures(supabase: SupabaseDishCategoryFeatures): PrismaDishCategoryFeatures {
  return {
    dish_category_id: supabase.dish_category_id,
    feature_type: supabase.feature_type,
    feature_key: supabase.feature_key,
    score: supabase.score,
    synced_at: new Date(supabase.synced_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishCategoryFeatures(prisma: PrismaDishCategoryFeatures): SupabaseDishCategoryFeatures {
  return {
    dish_category_id: prisma.dish_category_id,
    feature_type: prisma.feature_type,
    feature_key: prisma.feature_key,
    score: prisma.score,
    synced_at: prisma.synced_at?.toISOString() ?? null,
  };
}
