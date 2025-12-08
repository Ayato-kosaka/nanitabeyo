import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaRolePermissions = Omit<Prisma.Role_permissionsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseRolePermissions = TableRow<'role_permissions'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_RolePermissions(supabase: SupabaseRolePermissions): PrismaRolePermissions {
  return {
    role_id: supabase.role_id,
    permission_id: supabase.permission_id,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_RolePermissions(prisma: PrismaRolePermissions): SupabaseRolePermissions {
  return {
    role_id: prisma.role_id,
    permission_id: prisma.permission_id,
  };
}
