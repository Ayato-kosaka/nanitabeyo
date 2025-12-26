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
    tags: supabase.tags,
    macro_genre_qid: supabase.macro_genre_qid,
    created_at: new Date(supabase.created_at),
    synced_at: supabase.synced_at !== null ? new Date(supabase.synced_at) : null,
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
    tags: prisma.tags,
    macro_genre_qid: prisma.macro_genre_qid,
    created_at: prisma.created_at?.toISOString() ?? null,
    synced_at: prisma.synced_at?.toISOString() ?? null,
  };
}
