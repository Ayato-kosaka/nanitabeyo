import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishReviews = Omit<Prisma.Dish_reviewsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishReviews = TableRow<'dish_reviews'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_DishReviews(supabase: SupabaseDishReviews): PrismaDishReviews {
  return {
    id: supabase.id,
    dish_id: supabase.dish_id,
    comment: supabase.comment,

    original_language_code: supabase.original_language_code,
    user_id: supabase.user_id,
    rating: supabase.rating,
    price_cents: supabase.price_cents,
    currency_code: supabase.currency_code,
    created_dish_media_id: supabase.created_dish_media_id,
    imported_user_name: supabase.imported_user_name,
    imported_user_avatar: supabase.imported_user_avatar,
    created_at: new Date(supabase.created_at),
    // #1513 編集・論理削除で追加した列
    updated_at: new Date(supabase.updated_at),
    lock_no: supabase.lock_no,
    deleted_at: supabase.deleted_at ? new Date(supabase.deleted_at) : null,
    // #1551 食べた日。NULL の間は created_at の日付として扱う（migration 20260826T0000）
    // ⚠️ `!== null` ではなく «真か» で見る。`undefined`（列を持たない古い行・テストの入力）が
    //    `!== null` を通り抜けて `new Date(undefined)` → Invalid Date になる
    eaten_at: supabase.eaten_at ? new Date(supabase.eaten_at) : null,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_DishReviews(prisma: PrismaDishReviews): SupabaseDishReviews {
  return {
    id: prisma.id,
    dish_id: prisma.dish_id,
    comment: prisma.comment,
    comment_tsv: null,
    original_language_code: prisma.original_language_code,
    user_id: prisma.user_id,
    rating: prisma.rating,
    price_cents: prisma.price_cents,
    currency_code: prisma.currency_code,
    created_dish_media_id: prisma.created_dish_media_id,
    imported_user_name: prisma.imported_user_name,
    imported_user_avatar: prisma.imported_user_avatar,
    created_at: prisma.created_at?.toISOString() ?? null,
    // #1513 編集・論理削除で追加した列
    updated_at: prisma.updated_at?.toISOString() ?? null,
    lock_no: prisma.lock_no,
    deleted_at: prisma.deleted_at?.toISOString() ?? null,
    // #1551 ⚠️ eaten_at は DATE（時刻を持たない列）。`toISOString()` をそのまま入れると
    //    "2026-08-24T00:00:00.000Z" になり、DB が返す "2026-08-24" と形が食い違う。
    //    日付部分だけを渡す（時刻を持たない理由は migration 20260826T0000 の冒頭を参照）
    //    ⚠️ `!== null` ではなく optional chaining で見る。`undefined` が `!== null` を
    //    通り抜けて `undefined.toISOString()` で落ちる（この merge で実際に踏んだ）
    eaten_at: prisma.eaten_at?.toISOString().slice(0, 10) ?? null,
  };
}
