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
    address_components: supabase.address_components,
    plus_code: supabase.plus_code,
    created_at: new Date(supabase.created_at),
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

    image_url: prisma.image_url,
    address_components: prisma.address_components,
    plus_code: prisma.plus_code,
    created_at: prisma.created_at?.toISOString() ?? null,
  };
}
