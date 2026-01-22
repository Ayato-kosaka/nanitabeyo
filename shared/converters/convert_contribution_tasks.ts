import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaContributionTasks = Omit<Prisma.Contribution_tasksGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseContributionTasks = TableRow<'contribution_tasks'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_ContributionTasks(supabase: SupabaseContributionTasks): PrismaContributionTasks {
  return {
    id: supabase.id,
    type: supabase.type,
    task_key: supabase.task_key,
    target_type: supabase.target_type,
    target_id: supabase.target_id,
    payload: supabase.payload,
    result: supabase.result,
    user_id: supabase.user_id,
    created_at: new Date(supabase.created_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_ContributionTasks(prisma: PrismaContributionTasks): SupabaseContributionTasks {
  return {
    id: prisma.id,
    type: prisma.type,
    task_key: prisma.task_key,
    target_type: prisma.target_type,
    target_id: prisma.target_id,
    payload: prisma.payload,
    result: prisma.result,
    user_id: prisma.user_id,
    created_at: prisma.created_at?.toISOString() ?? null,
  };
}
