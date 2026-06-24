import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishCategoryGroupVoteCandidates = Omit<Prisma.Dish_category_group_vote_candidatesGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishCategoryGroupVoteCandidates = TableRow<'dish_category_group_vote_candidates'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishCategoryGroupVoteCandidates(supabase: SupabaseDishCategoryGroupVoteCandidates): PrismaDishCategoryGroupVoteCandidates {
  return {
    id: supabase.id,
    session_id: supabase.session_id,
    dish_category_id: supabase.dish_category_id,
    display_name: supabase.display_name,
    tagline: supabase.tagline,
    image_url: supabase.image_url,
    dish_media_ids: supabase.dish_media_ids,
    dish_media_search_status: supabase.dish_media_search_status,
    display_order: supabase.display_order,
    deleted_at: supabase.deleted_at !== null ? new Date(supabase.deleted_at) : null,
    created_at: new Date(supabase.created_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishCategoryGroupVoteCandidates(prisma: PrismaDishCategoryGroupVoteCandidates): SupabaseDishCategoryGroupVoteCandidates {
  return {
    id: prisma.id,
    session_id: prisma.session_id,
    dish_category_id: prisma.dish_category_id,
    display_name: prisma.display_name,
    tagline: prisma.tagline,
    image_url: prisma.image_url,
    dish_media_ids: prisma.dish_media_ids,
    dish_media_search_status: prisma.dish_media_search_status,
    display_order: prisma.display_order,
    deleted_at: prisma.deleted_at?.toISOString() ?? null,
    created_at: prisma.created_at?.toISOString() ?? null,
  };
}
