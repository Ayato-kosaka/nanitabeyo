import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishCategoryGroupVoteSessions = Omit<Prisma.Dish_category_group_vote_sessionsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishCategoryGroupVoteSessions = TableRow<'dish_category_group_vote_sessions'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishCategoryGroupVoteSessions(supabase: SupabaseDishCategoryGroupVoteSessions): PrismaDishCategoryGroupVoteSessions {
  return {
    id: supabase.id,
    host_user_id: supabase.host_user_id,
    share_token: supabase.share_token,
    // #1507 GRP-14 冪等キー。既存行は NULL
    idempotency_key: supabase.idempotency_key,
    search_context: supabase.search_context,
    created_at: new Date(supabase.created_at),
    updated_at: new Date(supabase.updated_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishCategoryGroupVoteSessions(prisma: PrismaDishCategoryGroupVoteSessions): SupabaseDishCategoryGroupVoteSessions {
  return {
    id: prisma.id,
    host_user_id: prisma.host_user_id,
    share_token: prisma.share_token,
    idempotency_key: prisma.idempotency_key,
    search_context: prisma.search_context,
    created_at: prisma.created_at?.toISOString() ?? null,
    updated_at: prisma.updated_at?.toISOString() ?? null,
  };
}
