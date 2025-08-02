import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaPromptVariants = Omit<Prisma.Prompt_variantsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabasePromptVariants = TableRow<'prompt_variants'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_PromptVariants(supabase: SupabasePromptVariants): PrismaPromptVariants {
  return {
    id: supabase.id,
    family_id: supabase.family_id,
    variant_number: supabase.variant_number,
    prompt_text: supabase.prompt_text,
    improvement_note: supabase.improvement_note,
    created_by: supabase.created_by,
    metadata: supabase.metadata,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_PromptVariants(prisma: PrismaPromptVariants): SupabasePromptVariants {
  return {
    id: prisma.id,
    family_id: prisma.family_id,
    variant_number: prisma.variant_number,
    prompt_text: prisma.prompt_text,
    improvement_note: prisma.improvement_note,
    created_by: prisma.created_by,
    metadata: prisma.metadata,
  };
}
