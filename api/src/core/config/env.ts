import * as dotenv from 'dotenv';
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
  DB_SCHEMA: z.string(),
  SUPABASE_JWT_SECRET: z.string(),
  GOOGLE_PLACE_API_KEY: z.string(),
  GCS_BUCKET_NAME: z.string(),
  GCS_STATIC_MASTER_DIR_PATH: z.string(),
  CLAUDE_API_KEY: z.string(),
  GOOGLE_API_KEY: z.string(),
  GOOGLE_SEARCH_ENGINE_ID: z.string(),
  GCP_PROJECT: z.string(),
  TASKS_LOCATION: z.string(),
  CLOUD_RUN_URL: z.string(),
  TASKS_INVOKER_SA: z.string(),
  GCS_DEV_SERVICE_ACCOUNT_BASE64: z.string().optional(),
  LOG_BATCH_MAX: z.string().transform(Number).default('200'),
  LOG_SPILL_THRESHOLD: z.string().transform(Number).default('500'),
  PRISMA_OPEN_BASE_MS: z
    .string()
    .default('5000')
    .transform((v) => Number(v)),
  PRISMA_OPEN_CAP_MS: z
    .string()
    .default('120000')
    .transform((v) => Number(v)),
  PRISMA_MAX_RETRIES: z
    .string()
    .default('3')
    .transform((v) => Number(v)),
  PRISMA_TX_MAX_WAIT: z
    .string()
    .default('60000')
    .transform((v) => Number(v)),
  PRISMA_TX_TIMEOUT: z
    .string()
    .default('60000')
    .transform((v) => Number(v)),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_REPO_OWNER: z.string().default('Ayato-kosaka'),
  GITHUB_REPO_NAME: z.string().default('nanitabeyo'),
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
