import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishMediaAnalysisResults = Omit<Prisma.Dish_media_analysis_resultsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishMediaAnalysisResults = TableRow<'dish_media_analysis_results'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishMediaAnalysisResults(supabase: SupabaseDishMediaAnalysisResults): PrismaDishMediaAnalysisResults {
  return {
    dish_media_id: supabase.dish_media_id,
    impr_total: BigInt(supabase.impr_total),
    view_total: BigInt(supabase.view_total),
    skip_total: BigInt(supabase.skip_total),
    completion_total: BigInt(supabase.completion_total),
    watch_ms_total: BigInt(supabase.watch_ms_total),
    save_total: BigInt(supabase.save_total),
    like_total: BigInt(supabase.like_total),
    open_map_total: BigInt(supabase.open_map_total),
    created_at: new Date(supabase.created_at),
    updated_at: new Date(supabase.updated_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishMediaAnalysisResults(prisma: PrismaDishMediaAnalysisResults): SupabaseDishMediaAnalysisResults {
  return {
    dish_media_id: prisma.dish_media_id,
    impr_total: Number(prisma.impr_total),
    view_total: Number(prisma.view_total),
    skip_total: Number(prisma.skip_total),
    completion_total: Number(prisma.completion_total),
    watch_ms_total: Number(prisma.watch_ms_total),
    save_total: Number(prisma.save_total),
    like_total: Number(prisma.like_total),
    open_map_total: Number(prisma.open_map_total),
    created_at: prisma.created_at?.toISOString() ?? null,
    updated_at: prisma.updated_at?.toISOString() ?? null,
  };
}
