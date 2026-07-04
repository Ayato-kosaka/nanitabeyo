import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishCategoryGroupVoteCandidateVotes = Omit<Prisma.Dish_category_group_vote_candidate_votesGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishCategoryGroupVoteCandidateVotes = TableRow<'dish_category_group_vote_candidate_votes'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishCategoryGroupVoteCandidateVotes(supabase: SupabaseDishCategoryGroupVoteCandidateVotes): PrismaDishCategoryGroupVoteCandidateVotes {
  return {
    participant_id: supabase.participant_id,
    candidate_id: supabase.candidate_id,
    reaction: supabase.reaction,
    created_at: new Date(supabase.created_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishCategoryGroupVoteCandidateVotes(prisma: PrismaDishCategoryGroupVoteCandidateVotes): SupabaseDishCategoryGroupVoteCandidateVotes {
  return {
    participant_id: prisma.participant_id,
    candidate_id: prisma.candidate_id,
    reaction: prisma.reaction,
    created_at: prisma.created_at?.toISOString() ?? null,
  };
}
