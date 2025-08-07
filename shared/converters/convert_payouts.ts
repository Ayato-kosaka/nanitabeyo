import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaPayouts = Omit<Prisma.PayoutsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabasePayouts = TableRow<'payouts'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_Payouts(supabase: SupabasePayouts): PrismaPayouts {
  return {
    id: supabase.id,
    bid_id: supabase.bid_id,
    transfer_id: supabase.transfer_id,
    dish_media_id: supabase.dish_media_id,
    amount_cents: BigInt(supabase.amount_cents),
    currency_code: supabase.currency_code,
    status: supabase.status,
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
export function convertPrismaToSupabase_Payouts(prisma: PrismaPayouts): SupabasePayouts {
  return {
    id: prisma.id,
    bid_id: prisma.bid_id,
    transfer_id: prisma.transfer_id,
    dish_media_id: prisma.dish_media_id,
    amount_cents: Number(prisma.amount_cents),
    currency_code: prisma.currency_code,
    status: prisma.status,
    created_at: prisma.created_at?.toISOString() ?? null,
    updated_at: prisma.updated_at?.toISOString() ?? null,
    lock_no: prisma.lock_no,
  };
}
