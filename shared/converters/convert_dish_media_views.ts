import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishMediaViews = Omit<Prisma.Dish_media_viewsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishMediaViews = TableRow<'dish_media_views'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishMediaViews(supabase: SupabaseDishMediaViews): PrismaDishMediaViews {
  return {
    id: supabase.id,
    impression_id: supabase.impression_id,
    dish_media_id: supabase.dish_media_id,
    user_id: supabase.user_id,
    started_at: new Date(supabase.started_at),
    watch_ms: supabase.watch_ms,
    is_completed: supabase.is_completed,
    is_skipped: supabase.is_skipped,
    rewatch_count: supabase.rewatch_count,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishMediaViews(prisma: PrismaDishMediaViews): SupabaseDishMediaViews {
  return {
    id: prisma.id,
    impression_id: prisma.impression_id,
    dish_media_id: prisma.dish_media_id,
    user_id: prisma.user_id,
    started_at: prisma.started_at?.toISOString() ?? null,
    watch_ms: prisma.watch_ms,
    is_completed: prisma.is_completed,
    is_skipped: prisma.is_skipped,
    rewatch_count: prisma.rewatch_count,
  };
}
