import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishCategoryGroupVoteParticipants = Omit<Prisma.Dish_category_group_vote_participantsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishCategoryGroupVoteParticipants = TableRow<'dish_category_group_vote_participants'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishCategoryGroupVoteParticipants(supabase: SupabaseDishCategoryGroupVoteParticipants): PrismaDishCategoryGroupVoteParticipants {
  return {
    id: supabase.id,
    session_id: supabase.session_id,
    user_id: supabase.user_id,
    display_name: supabase.display_name,
    comment: supabase.comment,
    created_at: new Date(supabase.created_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishCategoryGroupVoteParticipants(prisma: PrismaDishCategoryGroupVoteParticipants): SupabaseDishCategoryGroupVoteParticipants {
  return {
    id: prisma.id,
    session_id: prisma.session_id,
    user_id: prisma.user_id,
    display_name: prisma.display_name,
    comment: prisma.comment,
    created_at: prisma.created_at?.toISOString() ?? null,
  };
}
