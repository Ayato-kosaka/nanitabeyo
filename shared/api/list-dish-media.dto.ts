import { z } from 'zod';

/**
 * 🍽️ listDishMedia クエリのバリデーションスキーマ
 * - 必須項目や範囲制約を zod で定義する
 */
export const listDishMediaQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radius: z.coerce.number().int().min(1).max(5000).default(1000),
  limit: z.coerce.number().int().min(1).max(40).default(20),
  lang: z.string().default('ja'),
  category: z.string().optional(),
  pageToken: z.string().optional(),
});

/**
 * listDishMedia クエリの型定義
 */
export type ListDishMediaQuery = z.infer<typeof listDishMediaQuerySchema>;
