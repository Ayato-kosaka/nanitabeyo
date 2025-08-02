import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaPromptFamilies = Omit<Prisma.Prompt_familiesGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabasePromptFamilies = TableRow<'prompt_families'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_PromptFamilies(supabase: SupabasePromptFamilies): PrismaPromptFamilies {
  return {
    id: supabase.id,
    name: supabase.name,
    description: supabase.description,
    purpose: supabase.purpose,
    weight: supabase.weight,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_PromptFamilies(prisma: PrismaPromptFamilies): SupabasePromptFamilies {
  return {
    id: prisma.id,
    name: prisma.name,
    description: prisma.description,
    purpose: prisma.purpose,
    weight: prisma.weight,
  };
}
