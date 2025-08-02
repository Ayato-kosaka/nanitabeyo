import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishCategories = Omit<Prisma.Dish_categoriesGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishCategories = TableRow<'dish_categories'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishCategories(supabase: SupabaseDishCategories): PrismaDishCategories {
  return {
    id: supabase.id,
    label_en: supabase.label_en,
    labels: supabase.labels,
    image_url: supabase.image_url,
    origin: supabase.origin,
    cuisine: supabase.cuisine,
    tags: supabase.tags,
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
export function convertPrismaToSupabase_DishCategories(prisma: PrismaDishCategories): SupabaseDishCategories {
  return {
    id: prisma.id,
    label_en: prisma.label_en,
    labels: prisma.labels,
    image_url: prisma.image_url,
    origin: prisma.origin,
    cuisine: prisma.cuisine,
    tags: prisma.tags,
    created_at: prisma.created_at?.toISOString() ?? null,
    updated_at: prisma.updated_at?.toISOString() ?? null,
    lock_no: prisma.lock_no,
  };
}
