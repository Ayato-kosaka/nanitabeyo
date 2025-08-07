import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaRestaurantBids = Omit<Prisma.Restaurant_bidsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseRestaurantBids = TableRow<'restaurant_bids'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_RestaurantBids(supabase: SupabaseRestaurantBids): PrismaRestaurantBids {
  return {
    id: supabase.id,
    restaurant_id: supabase.restaurant_id,
    user_id: supabase.user_id,
    payment_intent_id: supabase.payment_intent_id,
    amount_cents: BigInt(supabase.amount_cents),
    currency_code: supabase.currency_code,
    start_date: new Date(supabase.start_date),
    end_date: new Date(supabase.end_date),
    status: supabase.status,
    refund_id: supabase.refund_id,
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
export function convertPrismaToSupabase_RestaurantBids(prisma: PrismaRestaurantBids): SupabaseRestaurantBids {
  return {
    id: prisma.id,
    restaurant_id: prisma.restaurant_id,
    user_id: prisma.user_id,
    payment_intent_id: prisma.payment_intent_id,
    amount_cents: Number(prisma.amount_cents),
    currency_code: prisma.currency_code,
    start_date: prisma.start_date?.toISOString() ?? null,
    end_date: prisma.end_date?.toISOString() ?? null,
    status: prisma.status,
    refund_id: prisma.refund_id,
    created_at: prisma.created_at?.toISOString() ?? null,
    updated_at: prisma.updated_at?.toISOString() ?? null,
    lock_no: prisma.lock_no,
  };
}
