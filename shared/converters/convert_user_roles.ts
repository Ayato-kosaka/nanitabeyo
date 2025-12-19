import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaUserRoles = Omit<Prisma.User_rolesGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseUserRoles = TableRow<'user_roles'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_UserRoles(supabase: SupabaseUserRoles): PrismaUserRoles {
  return {
    user_id: supabase.user_id,
    role_id: supabase.role_id,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_UserRoles(prisma: PrismaUserRoles): SupabaseUserRoles {
  return {
    user_id: prisma.user_id,
    role_id: prisma.role_id,
  };
}
