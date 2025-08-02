import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishes = Omit<Prisma.DishesGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishes = TableRow<'dishes'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_Dishes(supabase: SupabaseDishes): PrismaDishes {
  return {
    id: supabase.id,
    restaurant_id: supabase.restaurant_id,
    category_id: supabase.category_id,
    name: supabase.name,
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
export function convertPrismaToSupabase_Dishes(prisma: PrismaDishes): SupabaseDishes {
  return {
    id: prisma.id,
    restaurant_id: prisma.restaurant_id,
    category_id: prisma.category_id,
    name: prisma.name,
    created_at: prisma.created_at?.toISOString() ?? null,
    updated_at: prisma.updated_at?.toISOString() ?? null,
    lock_no: prisma.lock_no,
  };
}
