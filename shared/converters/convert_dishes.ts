import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishes = Omit<Prisma.DishesGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishes = TableRow<'dishes'>;

/**
 * #1779 `name` / `data_origin` は **2026-09-24 に dev から実際に削除した**
 * （migration `20260924T0100_drop_google_derived_columns.sql`）。
 *
 * - `name` … «その店でのその料理の呼び名»。表示はカテゴリのローカライズ表記へ
 *   移行済み（#1901）。書き手も無かった
 * - `data_origin` … 読んで分岐するコードが 1 行も無かった。`@@unique([restaurant_id,
 *   category_id])` でユーザーとパイプラインが同じ行を共有するため、行に単一の
 *   出所を持たせること自体が成立しない（#1645）。同じ区別は `synced_at` で付く
 *
 * ⚠️ もう «渡されなくてもよい列» ではなく **存在しない列**である。
 *    `DROPPED_COLUMNS` を `keyof` の制約として使う形は、列が消えた瞬間に
 *    `TS2344` で落ちる。型から名前ごと消すのが正しい。
 */

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_Dishes(
  supabase: SupabaseDishes,
): PrismaDishes {
  return {
    id: supabase.id,
    restaurant_id: supabase.restaurant_id,
    category_id: supabase.category_id,
    created_at: new Date(supabase.created_at),
    updated_at: new Date(supabase.updated_at),
    lock_no: supabase.lock_no,
    // #843 BigQuery catalog 由来かの識別（migration 20260823T0000）。既定は 'user_or_google'
    synced_at: supabase.synced_at !== null ? new Date(supabase.synced_at) : null,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_Dishes(
  prisma: PrismaDishes,
): SupabaseDishes {
  return {
    id: prisma.id,
    restaurant_id: prisma.restaurant_id,
    category_id: prisma.category_id,
    created_at: prisma.created_at?.toISOString() ?? null,
    updated_at: prisma.updated_at?.toISOString() ?? null,
    lock_no: prisma.lock_no,
    synced_at: prisma.synced_at?.toISOString() ?? null,
  };
}
