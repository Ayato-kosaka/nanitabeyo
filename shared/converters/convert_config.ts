import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaConfig = Omit<Prisma.ConfigGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseConfig = TableRow<'config'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_Config(supabase: SupabaseConfig): PrismaConfig {
  return {
    key: supabase.key,
    value: supabase.value,
    description: supabase.description,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_Config(prisma: PrismaConfig): SupabaseConfig {
  return {
    key: prisma.key,
    value: prisma.value,
    description: prisma.description,
  };
}
