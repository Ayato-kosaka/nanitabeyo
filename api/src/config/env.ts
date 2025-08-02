import dotenv from 'dotenv';
import { z } from 'zod';

// .env ファイルから環境変数を読み込む
dotenv.config();

/**
 * 環境変数のスキーマ定義。
 * すべての必須変数を型安全に定義し、起動時にチェックできるようにする。
 */
const envSchema = z.object({
  API_COMMIT_ID: z.string(),
  API_NODE_ENV: z.string(),
  CORS_ORIGIN: z.string(),
  API_GOOGLE_PLACE_API_KEY: z.string(),
});

/**
 * 環境変数を検証し、型付きで取得する関数。
 * 必須変数が不足・誤設定されている場合はエラーを投げてアプリ起動を中断する。
 *
 * @returns {z.infer<typeof envSchema>} 検証済みの環境変数オブジェクト
 */
function loadValidatedEnv(): z.infer<typeof envSchema> {
  const parsedEnv = envSchema.safeParse(process.env);

  if (!parsedEnv.success) {
    console.error('❌ Failed to validate environment variables:');
    console.table(parsedEnv.error.flatten().fieldErrors);
    throw new Error(
      'Invalid environment variables. Please check your .env file or runtime environment.',
    );
  }

  return parsedEnv.data;
}

/**
 * 型安全かつ検証済みの環境変数オブジェクト。
 * 他のモジュールからはこの `env` を使って値にアクセスする。
 */
export const env = loadValidatedEnv();
