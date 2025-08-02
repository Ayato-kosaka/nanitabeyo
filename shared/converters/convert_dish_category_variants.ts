import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishCategoryVariants = Omit<Prisma.Dish_category_variantsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishCategoryVariants = TableRow<'dish_category_variants'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishCategoryVariants(supabase: SupabaseDishCategoryVariants): PrismaDishCategoryVariants {
  return {
    id: supabase.id,
    dish_category_id: supabase.dish_category_id,
    surface_form: supabase.surface_form,
    source: supabase.source,
    created_at: new Date(supabase.created_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishCategoryVariants(prisma: PrismaDishCategoryVariants): SupabaseDishCategoryVariants {
  return {
    id: prisma.id,
    dish_category_id: prisma.dish_category_id,
    surface_form: prisma.surface_form,
    source: prisma.source,
    created_at: prisma.created_at?.toISOString() ?? null,
  };
}
