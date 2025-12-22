import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaPermissions = Omit<Prisma.PermissionsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabasePermissions = TableRow<'permissions'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_Permissions(supabase: SupabasePermissions): PrismaPermissions {
  return {
    id: supabase.id,
    name: supabase.name,
    description: supabase.description,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_Permissions(prisma: PrismaPermissions): SupabasePermissions {
  return {
    id: prisma.id,
    name: prisma.name,
    description: prisma.description,
  };
}
