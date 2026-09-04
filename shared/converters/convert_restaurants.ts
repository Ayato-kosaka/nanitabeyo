import { TableRow } from '../utils/devDB.types';
import { Prisma } from '../prisma';


export type PrismaRestaurants = Omit<Prisma.RestaurantsGroupByOutputType, '_count' | '_avg' | '_sum' | '_min' | '_max'>;

export type SupabaseRestaurants = TableRow<'restaurants'>;

/**
 * Supabase 型 → Prisma 型 に変換
 * @param supabase 通信用の Supabase 型オブジェクト
 * @returns アプリ内部用の Prisma 型オブジェクト
 */
export function convertSupabaseToPrisma_Restaurants(supabase: SupabaseRestaurants): PrismaRestaurants {
  return {
    id: supabase.id,
    google_place_id: supabase.google_place_id,
    name: supabase.name,
    name_language_code: supabase.name_language_code,
    latitude: supabase.latitude,
    longitude: supabase.longitude,

    image_url: supabase.image_url,
    image_path: supabase.image_path,
    // #843 その行を誰が作ったか（user / owner / pipeline / manual）。
    // 9_1 の同期はこの値が 'pipeline' の行だけを上書きする。
    created_by_source: supabase.created_by_source,
    // #1681 表示用の1行住所と ISO-3166-1 alpha-2。どちらもオープンデータ由来で、
    // 係争地域など国が引けない店があるため NULL 許容。
    address: supabase.address,
    country_code: supabase.country_code,
    // #1671 州・県の識別子。ISO 3166-2 «風» だが ISO そのものではない
    // （値は country_code + '-' + Google の administrative_area_level_1.shortText）。
    subterritory_code: supabase.subterritory_code,
    address_components: supabase.address_components,
    plus_code: supabase.plus_code,
    created_at: new Date(supabase.created_at),
    // #843 店提案 catalog との名寄せ監査用の metadata（migration 20260823T0000）
    source_seed_id: supabase.source_seed_id,
    source_names: supabase.source_names,
    source_row_hash: supabase.source_row_hash,
    synced_at: supabase.synced_at !== null ? new Date(supabase.synced_at) : null,
  };
}

/**
 * Prisma 型 → Supabase 型 に変換
 * @param prisma アプリ内部で操作される Prisma 型オブジェクト
 * @returns API 通信用の Supabase 型オブジェクト
 */
export function convertPrismaToSupabase_Restaurants(prisma: PrismaRestaurants): SupabaseRestaurants {
  return {
    id: prisma.id,
    google_place_id: prisma.google_place_id,
    name: prisma.name,
    name_language_code: prisma.name_language_code,
    latitude: prisma.latitude,
    longitude: prisma.longitude,
    location: null,
    image_url: prisma.image_url,
    image_path: prisma.image_path,
    created_by_source: prisma.created_by_source,
    address: prisma.address,
    country_code: prisma.country_code,
    subterritory_code: prisma.subterritory_code,
    address_components: prisma.address_components,
    plus_code: prisma.plus_code,
    created_at: prisma.created_at?.toISOString() ?? null,
    source_seed_id: prisma.source_seed_id,
    source_names: prisma.source_names,
    source_row_hash: prisma.source_row_hash,
    synced_at: prisma.synced_at?.toISOString() ?? null,
  };
}
