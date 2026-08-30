import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaUsers = Omit<Prisma.UsersGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseUsers = TableRow<'users'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_Users(supabase: SupabaseUsers): PrismaUsers {
  return {
    id: supabase.id,
    username: supabase.username,
    display_name: supabase.display_name,
    avatar_path: supabase.avatar_path,
    bio: supabase.bio,
    preferred_locale: supabase.preferred_locale,
    last_login_at: supabase.last_login_at !== null ? new Date(supabase.last_login_at) : null,
    // #1511 ACC-01 論理削除日時。NULL は未削除
    deleted_at: supabase.deleted_at !== null ? new Date(supabase.deleted_at) : null,
    created_at: new Date(supabase.created_at),
    updated_at: new Date(supabase.updated_at),
    lock_no: supabase.lock_no,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_Users(prisma: PrismaUsers): SupabaseUsers {
  return {
    id: prisma.id,
    username: prisma.username,
    display_name: prisma.display_name,
    avatar_path: prisma.avatar_path,
    bio: prisma.bio,
    preferred_locale: prisma.preferred_locale,
    last_login_at: prisma.last_login_at?.toISOString() ?? null,
    // #1511 ACC-01 論理削除日時。NULL は未削除
    deleted_at: prisma.deleted_at?.toISOString() ?? null,
    created_at: prisma.created_at?.toISOString() ?? null,
    updated_at: prisma.updated_at?.toISOString() ?? null,
    lock_no: prisma.lock_no,
  };
}
