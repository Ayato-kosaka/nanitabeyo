import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaPromptUsages = Omit<Prisma.Prompt_usagesGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabasePromptUsages = TableRow<'prompt_usages'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_PromptUsages(supabase: SupabasePromptUsages): PrismaPromptUsages {
  return {
    id: supabase.id,
    family_id: supabase.family_id,
    variant_id: supabase.variant_id,
    target_type: supabase.target_type,
    target_id: supabase.target_id,
    generated_text: supabase.generated_text,
    used_prompt_text: supabase.used_prompt_text,
    input_data: supabase.input_data,
    llm_model: supabase.llm_model,
    temperature: supabase.temperature !== null ? new Prisma.Decimal(supabase.temperature) : null,
    generated_user: supabase.generated_user,
    created_at: new Date(supabase.created_at),
    created_request_id: supabase.created_request_id,
    metadata: supabase.metadata,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_PromptUsages(prisma: PrismaPromptUsages): SupabasePromptUsages {
  return {
    id: prisma.id,
    family_id: prisma.family_id,
    variant_id: prisma.variant_id,
    target_type: prisma.target_type,
    target_id: prisma.target_id,
    generated_text: prisma.generated_text,
    used_prompt_text: prisma.used_prompt_text,
    input_data: prisma.input_data,
    llm_model: prisma.llm_model,
    temperature: prisma.temperature?.toNumber() ?? null,
    generated_user: prisma.generated_user,
    created_at: prisma.created_at?.toISOString() ?? null,
    created_request_id: prisma.created_request_id,
    metadata: prisma.metadata,
  };
}
