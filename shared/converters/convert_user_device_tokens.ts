import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaUserDeviceTokens = Omit<Prisma.User_device_tokensGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseUserDeviceTokens = TableRow<'user_device_tokens'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_UserDeviceTokens(supabase: SupabaseUserDeviceTokens): PrismaUserDeviceTokens {
  return {
    user_id: supabase.user_id,
    expo_push_token: supabase.expo_push_token,
    updated_at: new Date(supabase.updated_at),
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_UserDeviceTokens(prisma: PrismaUserDeviceTokens): SupabaseUserDeviceTokens {
  return {
    user_id: prisma.user_id,
    expo_push_token: prisma.expo_push_token,
    updated_at: prisma.updated_at?.toISOString() ?? null,
  };
}
