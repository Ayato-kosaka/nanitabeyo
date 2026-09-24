import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaDishes = Omit<Prisma.DishesGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseDishes = TableRow<'dishes'>;

/**
 * #1779 落とすことが決まっている列。**この 1 箇所だけが正**で、両方向の変換が
 * ここから «渡されなくてもよい» 形を組み立てる。列が DB から落ちたら、この配列と
 * 各方向の `??` を一緒に消す。
 *
 * - `name` … «その店でのその料理の呼び名»。表示はカテゴリのローカライズ表記へ
 *   移行済み（#1901）。書き手も無い
 * - `data_origin` … 読んで分岐するコードが 1 行も無い。`@@unique([restaurant_id,
 *   category_id])` でユーザーとパイプラインが同じ行を共有するため、行に単一の
 *   出所を持たせること自体が成立しない（#1645）。同じ区別は `synced_at` で付く
 *   （dev 実測で 1 対 1）
 */
const DROPPED_COLUMNS = ['name', 'data_origin'] as const;

type SupabaseDishesForPrisma = Omit<SupabaseDishes, (typeof DROPPED_COLUMNS)[number]> &
  Partial<Pick<SupabaseDishes, (typeof DROPPED_COLUMNS)[number]>>;

type PrismaDishesForSupabase = Omit<PrismaDishes, (typeof DROPPED_COLUMNS)[number]> &
  Partial<Pick<PrismaDishes, (typeof DROPPED_COLUMNS)[number]>>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_Dishes(
  supabase: SupabaseDishesForPrisma,
): PrismaDishes {
  return {
    id: supabase.id,
    restaurant_id: supabase.restaurant_id,
    category_id: supabase.category_id,
    name: supabase.name ?? null,
    created_at: new Date(supabase.created_at),
    updated_at: new Date(supabase.updated_at),
    lock_no: supabase.lock_no,
    // #843 BigQuery catalog 由来かの識別（migration 20260823T0000）。既定は 'user_or_google'
    data_origin: supabase.data_origin ?? 'user_or_google',
    synced_at: supabase.synced_at !== null ? new Date(supabase.synced_at) : null,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_Dishes(
  prisma: PrismaDishesForSupabase,
): SupabaseDishes {
  return {
    id: prisma.id,
    restaurant_id: prisma.restaurant_id,
    category_id: prisma.category_id,
    name: prisma.name ?? null,
    created_at: prisma.created_at?.toISOString() ?? null,
    updated_at: prisma.updated_at?.toISOString() ?? null,
    lock_no: prisma.lock_no,
    data_origin: prisma.data_origin ?? 'user_or_google',
    synced_at: prisma.synced_at?.toISOString() ?? null,
  };
}
